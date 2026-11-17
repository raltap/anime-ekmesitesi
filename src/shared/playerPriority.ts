import type {
  AnimeEntry,
  DownloadedRecord,
  DownloadSettings,
  FilterState,
  PlayerLink,
  ProbeResult,
  StreamVariant,
} from './types.ts';

export const DEFAULT_DRIVE_FOLDER_ID = '13YFkjFla33CLn4Vkvj_eC43I_9lGvaF-';

export const DEFAULT_PLAYER_PRIORITY: string[] = [
  'ODNOKLASSNIKI',
  'OK.RU',
  'ANIZMPLAYER',
  'SAVEFILEWAY',
  'SIBNET',
  'MAIL',
  'VK',
  'MP4UPLOAD',
  'SENDVID',
  'UQLOAD',
  'VOE',
  'YADISK',
  'GDRIVE',
  'DAILYMOTION',
  'FILEMOON',
];

export const DIRECT_EXTRACTABLE_PLAYERS = new Set<string>([
  'ODNOKLASSNIKI',
  'OK.RU',
  'ANIZMPLAYER',
  'SIBNET',
  'MAIL',
  'MP4UPLOAD',
  'SENDVID',
  'SAVEFILEWAY',
  'VK',
  'VOE',
  'UQLOAD',
]);

export const DEFAULT_SETTINGS: DownloadSettings = {
  strict1080p: false,
  minQualityHeight: 720,
  autoFallbackSearch: true,
  maxConcurrency: 5,
  preferredPlayers: [...DEFAULT_PLAYER_PRIORITY],
  preferredFansubs: [],
  outputPattern: 'folder_per_anime',
  driveFolderId: DEFAULT_DRIVE_FOLDER_ID,
  driveAutoUpload: true,
  driveDeleteLocalAfterUpload: true,
};

export function parseDriveFolderId(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return '';
  const folderMatch = trimmed.match(/\/folders\/([a-zA-Z0-9_-]+)/);
  if (folderMatch) return folderMatch[1];
  const idParamMatch = trimmed.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  if (idParamMatch) return idParamMatch[1];
  if (/^[a-zA-Z0-9_-]{10,}$/.test(trimmed)) return trimmed;
  return trimmed;
}

export function normalizePlayerName(player: string): string {
  const upper = player.trim().toUpperCase();
  if (upper === 'OK.RU') return 'ODNOKLASSNIKI';
  return upper;
}

export function resolveMinHeight(minQualityOrStrict: boolean | number): number {
  if (typeof minQualityOrStrict === 'boolean') {
    return minQualityOrStrict ? 1080 : 0;
  }
  return minQualityOrStrict;
}

export function isAnimeCompleted(
  entry: AnimeEntry,
  history: Record<string, DownloadedRecord>,
): boolean {
  return entry.miss.length > 0 && entry.miss.every((ep) => Boolean(history[`${entry.slug}:${ep}`]));
}

export function planByteRanges(
  totalBytes: number,
  connections = 4,
): Array<{ start: number; end: number }> {
  if (!Number.isFinite(totalBytes) || totalBytes <= 0) return [];
  const count = Math.max(1, Math.min(8, Math.floor(connections)));
  if (count === 1 || totalBytes < 1024 * 1024) {
    return [{ start: 0, end: totalBytes - 1 }];
  }
  const chunkSize = Math.ceil(totalBytes / count);
  const ranges: Array<{ start: number; end: number }> = [];
  for (let start = 0; start < totalBytes; start += chunkSize) {
    const end = Math.min(totalBytes - 1, start + chunkSize - 1);
    ranges.push({ start, end });
  }
  return ranges;
}

export function filterAndSortCatalog(
  entries: AnimeEntry[],
  filters: FilterState,
  history?: Record<string, DownloadedRecord>,
): AnimeEntry[] {
  const searchLower = filters.search.trim().toLowerCase();
  const targetPlayer = filters.player ? normalizePlayerName(filters.player) : '';

  const filtered = entries.filter((entry) => {
    if (history && !filters.showCompleted && isAnimeCompleted(entry, history)) {
      return false;
    }

    if (filters.missingCount === '2-3') {
      if (entry.miss.length !== 2 && entry.miss.length !== 3) return false;
    } else if (filters.missingCount !== 'all') {
      const targetCount = Number(filters.missingCount);
      if (entry.miss.length !== targetCount) return false;
    }

    if (filters.archiveStatus !== 'all' && entry.d !== filters.archiveStatus) {
      return false;
    }

    if (filters.format && entry.fmt !== filters.format) {
      return false;
    }

    if (targetPlayer) {
      let hasPlayer = false;
      for (const links of Object.values(entry.f)) {
        if (links.some(([, p]) => normalizePlayerName(p) === targetPlayer)) {
          hasPlayer = true;
          break;
        }
      }
      if (!hasPlayer) return false;
    }

    if (searchLower) {
      const haystack = `${entry.t} ${entry.at} ${entry.slug}`.toLowerCase();
      if (!haystack.includes(searchLower)) return false;
    }

    return true;
  });

  const sorted = [...filtered];
  sorted.sort((a, b) => {
    if (filters.sortBy === 'missing') {
      const diff = a.miss.length - b.miss.length;
      if (diff !== 0) return diff;
      return a.t.localeCompare(b.t, 'tr');
    }
    if (filters.sortBy === 'year') {
      const ya = Number(a.yr) || 0;
      const yb = Number(b.yr) || 0;
      if (yb !== ya) return yb - ya;
      return a.t.localeCompare(b.t, 'tr');
    }
    if (filters.sortBy === 'archive') {
      const rank = { tam: 0, kismi: 1, yok: 2 };
      const diff = rank[a.d] - rank[b.d];
      if (diff !== 0) return diff;
      return a.t.localeCompare(b.t, 'tr');
    }
    return a.t.localeCompare(b.t, 'tr');
  });

  return sorted;
}

export function rankCandidateLinks(
  links: PlayerLink[],
  preferredPlayers: string[] = DEFAULT_PLAYER_PRIORITY,
  preferredFansubs: string[] = [],
): PlayerLink[] {
  const playerRank = new Map<string, number>();
  preferredPlayers.forEach((p, idx) => {
    const norm = normalizePlayerName(p);
    if (!playerRank.has(norm)) {
      playerRank.set(norm, idx);
    }
  });

  const fansubRank = new Map<string, number>();
  preferredFansubs.forEach((f, idx) => {
    fansubRank.set(f.trim().toLowerCase(), idx);
  });

  return [...links].sort((a, b) => {
    const pa = playerRank.get(normalizePlayerName(a[1])) ?? 999;
    const pb = playerRank.get(normalizePlayerName(b[1])) ?? 999;
    if (pa !== pb) return pa - pb;

    const fa = fansubRank.get(a[0].trim().toLowerCase()) ?? 999;
    const fb = fansubRank.get(b[0].trim().toLowerCase()) ?? 999;
    if (fa !== fb) return fa - fb;

    const extA = DIRECT_EXTRACTABLE_PLAYERS.has(normalizePlayerName(a[1])) ? 0 : 1;
    const extB = DIRECT_EXTRACTABLE_PLAYERS.has(normalizePlayerName(b[1])) ? 0 : 1;
    return extA - extB;
  });
}

export function pickBestVariant(
  variants: StreamVariant[],
  minQualityOrStrict: boolean | number,
): StreamVariant | null {
  if (!variants.length) return null;
  const minHeight = resolveMinHeight(minQualityOrStrict);

  const sorted = [...variants].sort((a, b) => {
    if (b.height !== a.height) return b.height - a.height;
    if (a.format === 'mp4' && b.format !== 'mp4') return -1;
    if (b.format === 'mp4' && a.format !== 'mp4') return 1;
    return (b.sizeBytes ?? 0) - (a.sizeBytes ?? 0);
  });

  if (minHeight > 0) {
    // Allow height === 0 only as unprobed candidate (Downloader validates via ffprobe)
    const matching = sorted.find((v) => v.height >= minHeight || v.height === 0);
    return matching ?? null;
  }

  return sorted[0];
}

export function pickBestProbeResult(
  probes: ProbeResult[],
  minQualityOrStrict: boolean | number,
  preferredPlayers: string[] = DEFAULT_PLAYER_PRIORITY,
): { probe: ProbeResult; variant: StreamVariant } | null {
  const minHeight = resolveMinHeight(minQualityOrStrict);
  const playerRank = new Map<string, number>();
  preferredPlayers.forEach((p, idx) => {
    const norm = normalizePlayerName(p);
    if (!playerRank.has(norm)) playerRank.set(norm, idx);
  });

  const candidates: Array<{ probe: ProbeResult; variant: StreamVariant; rank: number }> = [];

  for (const probe of probes) {
    if (probe.status !== 'ok') continue;
    const variant = pickBestVariant(probe.variants, minHeight);
    if (!variant) continue;
    if (minHeight > 0 && variant.height > 0 && variant.height < minHeight) continue;
    const rank = playerRank.get(normalizePlayerName(probe.player)) ?? 999;
    candidates.push({ probe, variant, rank });
  }

  if (!candidates.length) return null;

  candidates.sort((a, b) => {
    const a1080 = a.variant.height >= 1080 ? 1 : 0;
    const b1080 = b.variant.height >= 1080 ? 1 : 0;
    if (b1080 !== a1080) return b1080 - a1080;
    if (b.variant.height !== a.variant.height) return b.variant.height - a.variant.height;
    if (a.variant.format === 'mp4' && b.variant.format !== 'mp4') return -1;
    if (b.variant.format === 'mp4' && a.variant.format !== 'mp4') return 1;
    return a.rank - b.rank;
  });

  return { probe: candidates[0].probe, variant: candidates[0].variant };
}

export function sanitizeFileName(name: string): string {
  return name
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 140);
}

export function buildEpisodeFileName(
  animeTitle: string,
  episode: string,
  fansub: string,
  qualityLabel: string,
): string {
  const paddedEp = /^\d+$/.test(episode) ? episode.padStart(2, '0') : episode;
  const safeTitle = sanitizeFileName(animeTitle);
  const safeFansub = sanitizeFileName(fansub || 'Fansub');
  const safeQuality = sanitizeFileName(qualityLabel || '1080p');
  return `${safeTitle} - Bolum ${paddedEp} [${safeFansub} ${safeQuality}].mp4`;
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let idx = 0;
  let value = bytes;
  while (value >= 1024 && idx < units.length - 1) {
    value /= 1024;
    idx++;
  }
  return `${value >= 100 || idx === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[idx]}`;
}

export function buildYtDlpBatchScript(
  items: Array<{
    animeTitle: string;
    slug: string;
    episode: string;
    links: PlayerLink[];
  }>,
  preferredPlayers: string[] = DEFAULT_PLAYER_PRIORITY,
  minQualityOrStrict: boolean | number = 720,
): string {
  const minHeight = resolveMinHeight(minQualityOrStrict);
  const lines: string[] = [
    '#!/usr/bin/env bash',
    '# AnimeArsiv Eksik Bolum Indirme Betigi (yt-dlp)',
    'set -u',
    '',
  ];

  const formatSelector =
    minHeight >= 1080
      ? '-f "bestvideo[height>=1080]+bestaudio/best[height>=1080]"'
      : minHeight >= 720
        ? '-f "bestvideo[height<=1080][height>=720]+bestaudio/best[height<=1080][height>=720]/best[height>=720]"'
        : '-f "bestvideo[height<=1080]+bestaudio/best[height<=1080]/best"';

  for (const item of items) {
    const ranked = rankCandidateLinks(item.links, preferredPlayers);
    const safeDir = sanitizeFileName(item.slug || item.animeTitle);
    const epPad = /^\d+$/.test(item.episode) ? item.episode.padStart(2, '0') : item.episode;
    const outFile = `${safeDir}/${sanitizeFileName(item.animeTitle)} - Bolum ${epPad}.%(ext)s`;

    lines.push(`mkdir -p "${safeDir}"`);
    if (!ranked.length) {
      lines.push(`# [UYARI] ${item.animeTitle} Bolum ${item.episode} icin arsiv linki bulunamadi`);
      continue;
    }

    const attemptCmds = ranked.slice(0, 4).map(([, , url]) => {
      return `yt-dlp --no-playlist ${formatSelector} --merge-output-format mp4 -o "${outFile}" "${url}"`;
    });
    lines.push(attemptCmds.join(' || \\\n  '));
    lines.push('');
  }

  return lines.join('\n');
}
