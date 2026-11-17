import fs from 'node:fs';
import { qualityLabelToHeight } from './extractors.ts';
import { sanitizeFileName } from '../src/shared/playerPriority.ts';
import type { AnimeEntry, DownloadedRecord } from '../src/shared/types.ts';

const DRIVE_API_BASE = 'https://www.googleapis.com/drive/v3';
const DRIVE_UPLOAD_BASE = 'https://www.googleapis.com/upload/drive/v3';
const CHUNK_SIZE = 16 * 1024 * 1024; // 16 MB chunks (must be multiple of 256 KB)

export interface DriveFolderInfo {
  id: string;
  name: string;
  webViewLink: string;
  userEmail?: string;
  userName?: string;
}

export interface DriveUploadedFile {
  id: string;
  name: string;
  webViewLink: string;
  sizeBytes?: number;
}

export function escapeDriveQuery(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

export function buildDriveFolderUrl(folderId: string): string {
  return `https://drive.google.com/drive/folders/${encodeURIComponent(folderId)}`;
}

export function buildDriveFileUrl(fileId: string): string {
  return `https://drive.google.com/file/d/${encodeURIComponent(fileId)}/view`;
}

export function buildContentRangeHeader(start: number, endInclusive: number, total: number): string {
  return `bytes ${start}-${endInclusive}/${total}`;
}

export function sanitizeDriveFolderName(title: string): string {
  return sanitizeFileName(title).replace(/^\.+/, '').trim() || 'Anime';
}

export function parseEpisodeFromDriveFileName(
  fileName: string,
  allowBareNumber = false,
): string | null {
  const stem = fileName.replace(/\.[a-z0-9]{2,5}$/i, '');
  const patterns = [
    /(?:^|[\s._-])(?:bolum|bölüm|episode|ep)[\s._-]*0*(\d{1,4})(?=$|[\s._\-\[\(v])/i,
    /(?:^|[\s._-])0*(\d{1,4})\.\s*(?:bolum|bölüm|episode|ep)(?=$|[\s._\-\[\(])/i,
    /(?:^|[\s._-])S\d{1,2}E0*(\d{1,4})(?=$|[\s._\-\[\(v])/i,
    /(?:\s-\s|_)0*(\d{1,4})(?:v\d+)?(?:\s*(?:\[|\(|$))/i,
  ];
  for (const re of patterns) {
    const m = stem.match(re);
    if (m?.[1]) {
      return String(Number(m[1]));
    }
  }
  if (allowBareNumber) {
    // Strip bracketed tags `[...]`, parenthesized years `(...)`, and resolution tokens before reading trailing episode number
    const cleaned = stem
      .replace(/\[[^\]]*\]/g, ' ')
      .replace(/\((?:19|20)\d{2}\)/g, ' ')
      .replace(/\b(?:2160|1440|1080|720|480|360)p\b/gi, ' ')
      .trim();
    const bareMatch =
      cleaned.match(/^0*(\d{1,4})$/) || cleaned.match(/(?:^|[\s._-])0*(\d{1,4})(?:v\d+)?$/i);
    if (bareMatch?.[1]) {
      const n = Number(bareMatch[1]);
      if (n >= 0 && n <= 1950) {
        return String(n);
      }
    }
  }
  return null;
}

export function parseFansubFromDriveFileName(fileName: string): string | undefined {
  const bracketMatches = [...fileName.matchAll(/\[([^\]]+)\]/g)];
  for (const m of bracketMatches) {
    const cleaned = m[1]
      .replace(/\b(2160p|1440p|1080p|720p|480p|360p|x264|x265|hevc|10bit)\b/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (cleaned && cleaned.length >= 2) {
      return cleaned;
    }
  }
  return undefined;
}

export function parseQualityFromDriveFileName(fileName: string): {
  quality: string;
  height: number;
} {
  const m = fileName.match(/\b(2160p|1440p|1080p|720p|480p|360p)\b/i);
  if (m) {
    const quality = m[1].toLowerCase();
    return { quality, height: qualityLabelToHeight(quality) };
  }
  return { quality: 'Drive', height: 0 };
}

export function normalizeDriveTitleKey(title: string): string {
  return title
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[:/\\?*<>|"!?,.'’`~()\[\]]+/g, ' ')
    .replace(/&/g, ' and ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&#(\d+);/g, (_, dec) => String.fromCharCode(Number(dec)))
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

export interface DriveApiError extends Error {
  status?: number;
}

export function createDriveError(message: string, status?: number): DriveApiError {
  const err = new Error(message) as DriveApiError;
  if (typeof status === 'number') {
    err.status = status;
  }
  return err;
}

export function isDriveAuthError(err: unknown): boolean {
  if (!err || typeof err !== 'object') {
    const text = String(err ?? '').toLowerCase();
    return text.includes('http 401') || text.includes('invalid credentials');
  }
  const maybeStatus = (err as { status?: unknown }).status;
  if (maybeStatus === 401) return true;
  const msg = String((err as { message?: unknown }).message ?? '').toLowerCase();
  return (
    msg.includes('http 401') ||
    msg.includes('invalid credentials') ||
    msg.includes('unauthenticated') ||
    msg.includes('invalid authentication credentials') ||
    msg.includes('oturum süresi doldu') ||
    msg.includes('oturumu açık değil')
  );
}

const folderLocks = new Map<string, Promise<{ id: string; name: string; webViewLink: string }>>();

async function driveJsonFetch<T>(
  url: string,
  token: string,
  init: RequestInit = {},
): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init.headers || {}),
    },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    let msg = `Google Drive API hatası (HTTP ${res.status})`;
    try {
      const parsed = JSON.parse(text) as { error?: { message?: string } };
      if (parsed?.error?.message) msg = `${parsed.error.message} (HTTP ${res.status})`;
    } catch {
      if (text) msg = `${msg}: ${text.slice(0, 160)}`;
    }
    throw createDriveError(msg, res.status);
  }
  return (await res.json()) as T;
}

export async function validateDriveFolder(
  token: string,
  folderId: string,
): Promise<DriveFolderInfo> {
  const folder = await driveJsonFetch<{
    id: string;
    name: string;
    mimeType: string;
    webViewLink?: string;
    trashed?: boolean;
  }>(
    `${DRIVE_API_BASE}/files/${encodeURIComponent(folderId)}?fields=id,name,mimeType,webViewLink,trashed&supportsAllDrives=true`,
    token,
  );

  if (folder.trashed) {
    throw new Error('Seçilen Google Drive klasörü çöp kutusunda.');
  }
  if (folder.mimeType !== 'application/vnd.google-apps.folder') {
    throw new Error('Belirtilen Google Drive kimliği bir klasöre ait değil.');
  }

  let userEmail: string | undefined;
  let userName: string | undefined;
  try {
    const about = await driveJsonFetch<{
      user?: { emailAddress?: string; displayName?: string };
    }>(`${DRIVE_API_BASE}/about?fields=user(emailAddress,displayName)`, token);
    userEmail = about.user?.emailAddress;
    userName = about.user?.displayName;
  } catch {
    // non-fatal
  }

  return {
    id: folder.id,
    name: folder.name,
    webViewLink: folder.webViewLink || buildDriveFolderUrl(folder.id),
    userEmail,
    userName,
  };
}

export async function findOrCreateAnimeFolder(
  token: string,
  rootFolderId: string,
  animeTitle: string,
): Promise<{ id: string; name: string; webViewLink: string }> {
  const folderName = sanitizeDriveFolderName(animeTitle);
  const lockKey = `${rootFolderId}:${folderName.toLowerCase()}`;

  const existingPromise = folderLocks.get(lockKey);
  if (existingPromise) {
    return existingPromise;
  }

  const task = (async () => {
    const query = `'${escapeDriveQuery(rootFolderId)}' in parents and name = '${escapeDriveQuery(folderName)}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`;
    const list = await driveJsonFetch<{
      files?: Array<{ id: string; name: string; webViewLink?: string }>;
    }>(
      `${DRIVE_API_BASE}/files?q=${encodeURIComponent(query)}&fields=files(id,name,webViewLink)&pageSize=1&supportsAllDrives=true&includeItemsFromAllDrives=true`,
      token,
    );

    const hit = list.files?.[0];
    if (hit) {
      return {
        id: hit.id,
        name: hit.name,
        webViewLink: hit.webViewLink || buildDriveFolderUrl(hit.id),
      };
    }

    const created = await driveJsonFetch<{
      id: string;
      name: string;
      webViewLink?: string;
    }>(`${DRIVE_API_BASE}/files?fields=id,name,webViewLink&supportsAllDrives=true`, token, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: folderName,
        mimeType: 'application/vnd.google-apps.folder',
        parents: [rootFolderId],
      }),
    });

    return {
      id: created.id,
      name: created.name,
      webViewLink: created.webViewLink || buildDriveFolderUrl(created.id),
    };
  })();

  folderLocks.set(lockKey, task);
  try {
    return await task;
  } finally {
    folderLocks.delete(lockKey);
  }
}

export async function findExistingDriveFile(
  token: string,
  folderId: string,
  fileName: string,
): Promise<DriveUploadedFile | null> {
  const query = `'${escapeDriveQuery(folderId)}' in parents and name = '${escapeDriveQuery(fileName)}' and trashed = false`;
  const list = await driveJsonFetch<{
    files?: Array<{ id: string; name: string; webViewLink?: string; size?: string }>;
  }>(
    `${DRIVE_API_BASE}/files?q=${encodeURIComponent(query)}&fields=files(id,name,webViewLink,size)&pageSize=1&supportsAllDrives=true&includeItemsFromAllDrives=true`,
    token,
  );
  const hit = list.files?.[0];
  if (!hit) return null;
  return {
    id: hit.id,
    name: hit.name,
    webViewLink: hit.webViewLink || buildDriveFileUrl(hit.id),
    sizeBytes: hit.size ? Number(hit.size) : undefined,
  };
}

export interface DriveChildItem {
  id: string;
  name: string;
  mimeType: string;
  webViewLink?: string;
  size?: string;
  createdTime?: string;
}

const VIDEO_FILE_REGEX = /\.(mp4|mkv|webm|avi|mov|m4v)$/i;

export function buildCatalogFolderLookup(catalog: AnimeEntry[]): Map<string, AnimeEntry> {
  const lookup = new Map<string, AnimeEntry>();
  const register = (key: string, entry: AnimeEntry) => {
    const trimmed = key.trim().toLowerCase();
    if (trimmed && !lookup.has(trimmed)) {
      lookup.set(trimmed, entry);
    }
    const norm = normalizeDriveTitleKey(key);
    if (norm && !lookup.has(norm)) {
      lookup.set(norm, entry);
    }
  };
  for (const entry of catalog) {
    register(sanitizeDriveFolderName(entry.t), entry);
    register(entry.t, entry);
    if (entry.at) {
      register(sanitizeDriveFolderName(entry.at), entry);
      register(entry.at, entry);
    }
    register(entry.slug, entry);
    register(entry.slug.replace(/-/g, ' '), entry);
  }
  return lookup;
}

export function matchAnimeByFolderName(
  folderName: string,
  lookup: Map<string, AnimeEntry>,
): AnimeEntry | undefined {
  const direct = lookup.get(folderName.trim().toLowerCase());
  if (direct) return direct;
  return lookup.get(normalizeDriveTitleKey(folderName));
}

export function parseEmbeddedDriveFolderHtml(html: string): DriveChildItem[] {
  const items: DriveChildItem[] = [];
  const regex =
    /class="flip-entry"[^>]*id="entry-([^"]+)"[\s\S]*?<a[^>]+href="([^"]+)"[\s\S]*?class="flip-entry-title">([^<]+)</g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(html)) !== null) {
    const id = decodeHtmlEntities(match[1]).trim();
    const href = decodeHtmlEntities(match[2]).trim();
    const name = decodeHtmlEntities(match[3]).trim();
    if (!id || !name) continue;
    const isFolder = href.includes('/drive/folders/') || href.includes('/folders/');
    items.push({
      id,
      name,
      mimeType: isFolder ? 'application/vnd.google-apps.folder' : 'video/mp4',
      webViewLink: isFolder ? buildDriveFolderUrl(id) : buildDriveFileUrl(id),
    });
  }
  return items;
}

function mergeBestDriveRecords(records: DownloadedRecord[]): DownloadedRecord[] {
  const byKey = new Map<string, DownloadedRecord>();
  for (const rec of records) {
    const prev = byKey.get(rec.key);
    if (!prev) {
      byKey.set(rec.key, rec);
      continue;
    }
    if ((rec.resolutionHeight || 0) > (prev.resolutionHeight || 0)) {
      byKey.set(rec.key, rec);
    } else if (
      (rec.resolutionHeight || 0) === (prev.resolutionHeight || 0) &&
      (rec.totalBytes || 0) > (prev.totalBytes || 0)
    ) {
      byKey.set(rec.key, rec);
    }
  }
  return Array.from(byKey.values());
}

function buildRecordFromDriveFile(
  anime: AnimeEntry,
  folder: { id: string; webViewLink?: string },
  file: DriveChildItem,
  allowBareNumber = true,
): DownloadedRecord | null {
  const ep = parseEpisodeFromDriveFileName(file.name, allowBareNumber);
  if (!ep) return null;
  const { quality, height } = parseQualityFromDriveFileName(file.name);
  const parsedFansub = parseFansubFromDriveFileName(file.name);
  return {
    key: `${anime.slug}:${ep}`,
    slug: anime.slug,
    animeTitle: anime.t,
    episode: ep,
    quality,
    resolutionHeight: height,
    player: 'GDRIVE',
    fansub: parsedFansub || 'Drive Klasörü',
    fileName: file.name,
    totalBytes: file.size ? Number(file.size) : 0,
    downloadedAt: file.createdTime ? Date.parse(file.createdTime) || Date.now() : Date.now(),
    driveFileId: file.id,
    driveWebViewLink: file.webViewLink || buildDriveFileUrl(file.id),
    driveFolderId: folder.id,
    driveFolderLink: folder.webViewLink || buildDriveFolderUrl(folder.id),
  };
}

async function listDriveFolderChildren(token: string, folderId: string): Promise<DriveChildItem[]> {
  const items: DriveChildItem[] = [];
  let pageToken: string | undefined;
  const query = `'${escapeDriveQuery(folderId)}' in parents and trashed = false`;

  do {
    const url =
      `${DRIVE_API_BASE}/files?q=${encodeURIComponent(query)}` +
      `&fields=nextPageToken,files(id,name,mimeType,webViewLink,size,createdTime)` +
      `&pageSize=1000&supportsAllDrives=true&includeItemsFromAllDrives=true` +
      (pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : '');
    const res = await driveJsonFetch<{
      nextPageToken?: string;
      files?: DriveChildItem[];
    }>(url, token);
    if (Array.isArray(res.files)) {
      items.push(...res.files);
    }
    pageToken = res.nextPageToken;
  } while (pageToken);

  return items;
}

async function listPublicDriveFolderChildren(folderId: string): Promise<DriveChildItem[]> {
  const url = `https://drive.google.com/embeddedfolderview?id=${encodeURIComponent(folderId)}`;
  const res = await fetch(url, {
    signal: AbortSignal.timeout(15_000),
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      'Accept-Language': 'tr-TR,tr;q=0.9,en;q=0.8',
    },
  });
  if (res.url.includes('accounts.google.com') || res.status === 401 || res.status === 403) {
    throw createDriveError(
      'Google Drive klasörü herkese açık değil; otomatik kontrol için Google ile giriş yapın.',
      res.status === 403 ? 403 : 401,
    );
  }
  if (!res.ok) {
    throw createDriveError(`Drive klasörü okunamadı (HTTP ${res.status}).`, res.status);
  }
  const html = await res.text();
  if (html.includes('accounts.google.com/ServiceLogin') && !html.includes('flip-entry')) {
    throw createDriveError(
      'Google Drive klasörü herkese açık değil; otomatik kontrol için Google ile giriş yapın.',
      401,
    );
  }
  return parseEmbeddedDriveFolderHtml(html);
}

async function collectRecordsFromAnimeFolder(
  listChildren: (folderId: string) => Promise<DriveChildItem[]>,
  anime: AnimeEntry,
  folder: DriveChildItem,
  depth = 0,
): Promise<DownloadedRecord[]> {
  const children = await listChildren(folder.id);
  const found: DownloadedRecord[] = [];
  const nestedFolders: DriveChildItem[] = [];

  for (const f of children) {
    if (f.mimeType === 'application/vnd.google-apps.folder') {
      nestedFolders.push(f);
      continue;
    }
    if (!VIDEO_FILE_REGEX.test(f.name) && f.mimeType && !f.mimeType.startsWith('video/')) {
      continue;
    }
    const rec = buildRecordFromDriveFile(anime, folder, f, true);
    if (rec) found.push(rec);
  }

  if (depth < 1 && nestedFolders.length > 0) {
    for (const sub of nestedFolders.slice(0, 8)) {
      const nested = await collectRecordsFromAnimeFolder(listChildren, anime, sub, depth + 1);
      found.push(...nested);
    }
  }
  return found;
}

async function scanRootWithLister(
  listChildren: (folderId: string) => Promise<DriveChildItem[]>,
  rootFolderId: string,
  catalog: AnimeEntry[],
): Promise<{
  scannedFolders: number;
  matchedFiles: number;
  records: DownloadedRecord[];
}> {
  const lookup = buildCatalogFolderLookup(catalog);
  const rootItems = await listChildren(rootFolderId);
  const subfolders = rootItems.filter(
    (item) => item.mimeType === 'application/vnd.google-apps.folder',
  );
  const directVideos = rootItems.filter(
    (item) =>
      item.mimeType !== 'application/vnd.google-apps.folder' && VIDEO_FILE_REGEX.test(item.name),
  );

  const records: DownloadedRecord[] = [];
  const matchedSubfolders = subfolders
    .map((folder) => ({
      folder,
      anime: matchAnimeByFolderName(folder.name, lookup),
    }))
    .filter((pair): pair is { folder: DriveChildItem; anime: AnimeEntry } => Boolean(pair.anime));

  // Scan matched anime subfolders in batches of 6
  for (let i = 0; i < matchedSubfolders.length; i += 6) {
    const batch = matchedSubfolders.slice(i, i + 6);
    const batchResults = await Promise.all(
      batch.map(({ folder, anime }) =>
        collectRecordsFromAnimeFolder(listChildren, anime, folder, 0).catch(() => []),
      ),
    );
    for (const list of batchResults) {
      records.push(...list);
    }
  }

  // Also match any flat video files placed directly inside the root folder
  for (const file of directVideos) {
    const prefix = file.name
      .split(/\s-\sBolum|\s-\sBölüm|\s-\s\d|\sS\d{1,2}E/i)[0]
      ?.trim();
    if (!prefix) continue;
    const anime = matchAnimeByFolderName(prefix, lookup);
    if (!anime) continue;
    const rec = buildRecordFromDriveFile(
      anime,
      { id: rootFolderId, webViewLink: buildDriveFolderUrl(rootFolderId) },
      file,
      false,
    );
    if (rec) records.push(rec);
  }

  const deduped = mergeBestDriveRecords(records);
  return {
    scannedFolders: subfolders.length,
    matchedFiles: deduped.length,
    records: deduped,
  };
}

export async function scanDriveRootFolder(
  token: string,
  rootFolderId: string,
  catalog: AnimeEntry[],
): Promise<{
  scannedFolders: number;
  matchedFiles: number;
  records: DownloadedRecord[];
}> {
  return scanRootWithLister(
    (folderId) => listDriveFolderChildren(token, folderId),
    rootFolderId,
    catalog,
  );
}

export async function scanPublicDriveRootFolder(
  rootFolderId: string,
  catalog: AnimeEntry[],
): Promise<{
  scannedFolders: number;
  matchedFiles: number;
  records: DownloadedRecord[];
}> {
  return scanRootWithLister(listPublicDriveFolderChildren, rootFolderId, catalog);
}

export async function scanDriveFolderAuto(options: {
  token?: string | null;
  rootFolderId: string;
  catalog: AnimeEntry[];
}): Promise<{
  source: 'oauth' | 'public';
  scannedFolders: number;
  matchedFiles: number;
  records: DownloadedRecord[];
}> {
  const { token, rootFolderId, catalog } = options;
  if (token) {
    const res = await scanDriveRootFolder(token, rootFolderId, catalog);
    return { source: 'oauth', ...res };
  }
  const res = await scanPublicDriveRootFolder(rootFolderId, catalog);
  return { source: 'public', ...res };
}

export async function findEpisodeInDriveFolder(
  token: string,
  rootFolderId: string,
  anime: AnimeEntry,
  episode: string,
): Promise<DownloadedRecord | null> {
  const folderName = sanitizeDriveFolderName(anime.t);
  const query = `'${escapeDriveQuery(rootFolderId)}' in parents and name = '${escapeDriveQuery(folderName)}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`;
  const list = await driveJsonFetch<{
    files?: Array<{ id: string; name: string; webViewLink?: string }>;
  }>(
    `${DRIVE_API_BASE}/files?q=${encodeURIComponent(query)}&fields=files(id,name,webViewLink)&pageSize=1&supportsAllDrives=true&includeItemsFromAllDrives=true`,
    token,
  );
  const folder = list.files?.[0];
  if (!folder) return null;

  const children = await listDriveFolderChildren(token, folder.id);
  const targetEp = String(Number(episode) || episode);
  const matches: DownloadedRecord[] = [];
  for (const child of children) {
    if (child.mimeType === 'application/vnd.google-apps.folder') continue;
    const rec = buildRecordFromDriveFile(anime, folder, child, true);
    if (rec && rec.episode === targetEp) {
      matches.push(rec);
    }
  }
  if (!matches.length) return null;
  return mergeBestDriveRecords(matches)[0] ?? null;
}

export async function uploadFileResumableToDrive(
  token: string,
  folderId: string,
  filePath: string,
  fileName: string,
  onProgress?: (percent: number) => void,
  signal?: AbortSignal,
): Promise<DriveUploadedFile> {
  const stat = await fs.promises.stat(filePath);
  const totalBytes = stat.size;
  if (totalBytes <= 0) {
    throw new Error('Yüklenecek dosya boş.');
  }

  // If an identical non-empty file already exists in this folder, return it directly
  const existing = await findExistingDriveFile(token, folderId, fileName);
  if (existing && (!existing.sizeBytes || Math.abs(existing.sizeBytes - totalBytes) < 1024)) {
    onProgress?.(100);
    return existing;
  }

  const initRes = await fetch(
    `${DRIVE_UPLOAD_BASE}/files?uploadType=resumable&fields=id,name,webViewLink,size&supportsAllDrives=true`,
    {
      method: 'POST',
      signal,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json; charset=UTF-8',
        'X-Upload-Content-Type': 'video/mp4',
        'X-Upload-Content-Length': String(totalBytes),
      },
      body: JSON.stringify({
        name: fileName,
        parents: [folderId],
      }),
    },
  );

  if (!initRes.ok) {
    const errText = await initRes.text().catch(() => '');
    throw createDriveError(
      `Drive yükleme oturumu başlatılamadı (HTTP ${initRes.status}): ${errText.slice(0, 140)}`,
      initRes.status,
    );
  }

  const uploadUrl = initRes.headers.get('location');
  if (!uploadUrl) {
    throw new Error('Google Drive yükleme adresi döndürmedi.');
  }

  const fh = await fs.promises.open(filePath, 'r');
  try {
    let offset = 0;
    while (offset < totalBytes) {
      if (signal?.aborted) {
        throw new Error('İptal edildi');
      }
      const bytesToRead = Math.min(CHUNK_SIZE, totalBytes - offset);
      const buffer = Buffer.allocUnsafe(bytesToRead);
      const { bytesRead } = await fh.read(buffer, 0, bytesToRead, offset);
      if (bytesRead <= 0) break;

      const chunk = bytesRead === bytesToRead ? buffer : buffer.subarray(0, bytesRead);
      const endInclusive = offset + bytesRead - 1;

      let putRes: Response | null = null;
      let lastChunkErr: unknown = null;
      for (let attempt = 0; attempt < 3; attempt++) {
        if (signal?.aborted) {
          throw new Error('İptal edildi');
        }
        const chunkSignal = signal
          ? AbortSignal.any([signal, AbortSignal.timeout(90_000)])
          : AbortSignal.timeout(90_000);
        try {
          putRes = await fetch(uploadUrl, {
            method: 'PUT',
            signal: chunkSignal,
            headers: {
              'Content-Length': String(bytesRead),
              'Content-Range': buildContentRangeHeader(offset, endInclusive, totalBytes),
            },
            body: chunk,
          });
          if (putRes.status >= 500 && attempt < 2) {
            await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
            continue;
          }
          break;
        } catch (err) {
          lastChunkErr = err;
          if (signal?.aborted || attempt >= 2) throw err;
          await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
        }
      }

      if (!putRes) {
        throw lastChunkErr instanceof Error ? lastChunkErr : new Error('Drive parça yüklemesi başarısız');
      }

      if (putRes.status === 308) {
        offset += bytesRead;
        const pct = Math.min(99, Math.round((offset / totalBytes) * 100));
        onProgress?.(pct);
        continue;
      }

      if (putRes.ok) {
        const uploaded = (await putRes.json()) as {
          id: string;
          name: string;
          webViewLink?: string;
          size?: string;
        };
        onProgress?.(100);
        return {
          id: uploaded.id,
          name: uploaded.name,
          webViewLink: uploaded.webViewLink || buildDriveFileUrl(uploaded.id),
          sizeBytes: uploaded.size ? Number(uploaded.size) : totalBytes,
        };
      }

      const errText = await putRes.text().catch(() => '');
      throw createDriveError(
        `Drive parça yüklemesi başarısız (HTTP ${putRes.status}): ${errText.slice(0, 160)}`,
        putRes.status,
      );
    }

    throw new Error('Drive yüklemesi beklenmedik şekilde sonlandı.');
  } finally {
    await fh.close();
  }
}

export async function deleteDriveFile(token: string, fileId: string): Promise<void> {
  const res = await fetch(
    `${DRIVE_API_BASE}/files/${encodeURIComponent(fileId)}?supportsAllDrives=true`,
    {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    },
  );
  if (!res.ok && res.status !== 404) {
    const text = await res.text().catch(() => '');
    throw createDriveError(
      `Drive dosyası silinemedi (HTTP ${res.status}): ${text.slice(0, 140)}`,
      res.status,
    );
  }
}
