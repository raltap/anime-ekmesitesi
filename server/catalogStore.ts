import fs from 'node:fs';
import path from 'node:path';
import type {
  AnimeEntry,
  DownloadedRecord,
  DownloadJob,
  DownloadSettings,
  EpisodeProbeSummary,
} from '../src/shared/types.ts';
import {
  DEFAULT_DRIVE_FOLDER_ID,
  DEFAULT_SETTINGS,
  parseDriveFolderId,
} from '../src/shared/playerPriority.ts';
import { normalizeAnimeEntry, parseReportInput } from '../src/shared/reportParser.ts';

const DATA_DIR = path.resolve(process.cwd(), 'data');
const CATALOG_FILE = path.join(DATA_DIR, 'catalog.json');
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');
const PROBES_FILE = path.join(DATA_DIR, 'probes.json');
const HISTORY_FILE = path.join(DATA_DIR, 'history.json');
const JOBS_FILE = path.join(DATA_DIR, 'jobs.json');
const V2_CATALOG_FILE = path.join(DATA_DIR, 'v2_catalog.json');
const V2_JOBS_FILE = path.join(DATA_DIR, 'v2_jobs.json');
const V2_HISTORY_FILE = path.join(DATA_DIR, 'v2_history.json');
const FULL_REPORT_HTML = path.resolve(
  process.cwd(),
  'public/assets/aistudio/eksik_bolumler_arsiv_313eff3f.html',
);
const SEED_FILES = [
  path.resolve(process.cwd(), 'src/data/seed1.json'),
  path.resolve(process.cwd(), 'src/data/seed2.json'),
  path.resolve(process.cwd(), 'src/data/seed3.json'),
];

function ensureDataDir(): void {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

export function loadCatalog(): AnimeEntry[] {
  ensureDataDir();
  if (fs.existsSync(CATALOG_FILE)) {
    try {
      const raw = JSON.parse(fs.readFileSync(CATALOG_FILE, 'utf8'));
      if (Array.isArray(raw)) {
        const normalized = raw
          .map(normalizeAnimeEntry)
          .filter((e): e is AnimeEntry => e !== null);
        if (normalized.length > 0) {
          return normalized;
        }
      }
    } catch {
      // fallback to seed
    }
  }
  return loadSeedCatalog();
}

export function loadSeedCatalog(): AnimeEntry[] {
  if (fs.existsSync(FULL_REPORT_HTML)) {
    try {
      const html = fs.readFileSync(FULL_REPORT_HTML, 'utf8');
      const { entries } = parseReportInput(html);
      if (entries.length > 0) {
        return entries;
      }
    } catch {
      // fallback to JSON seed slices below
    }
  }

  const combined: AnimeEntry[] = [];
  for (const seedFile of SEED_FILES) {
    if (!fs.existsSync(seedFile)) continue;
    try {
      const raw = JSON.parse(fs.readFileSync(seedFile, 'utf8'));
      if (Array.isArray(raw)) {
        for (const item of raw) {
          const norm = normalizeAnimeEntry(item);
          if (norm) combined.push(norm);
        }
      }
    } catch {
      // ignore
    }
  }
  return combined;
}

export function resetCatalogToSeed(): AnimeEntry[] {
  const seed = loadSeedCatalog();
  saveCatalog(seed);
  return seed;
}

export function saveCatalog(entries: AnimeEntry[]): void {
  ensureDataDir();
  fs.writeFileSync(CATALOG_FILE, JSON.stringify(entries, null, 2), 'utf8');
}

export function normalizeSettings(raw: Record<string, unknown>, base: DownloadSettings = DEFAULT_SETTINGS): DownloadSettings {
  const strict1080p =
    typeof raw.strict1080p === 'boolean' ? raw.strict1080p : base.strict1080p;

  let minQualityHeight: 1080 | 720 | 0 = base.minQualityHeight;
  if (raw.minQualityHeight === 1080 || raw.minQualityHeight === 720 || raw.minQualityHeight === 0) {
    minQualityHeight = raw.minQualityHeight;
  } else if (typeof raw.strict1080p === 'boolean') {
    minQualityHeight = raw.strict1080p ? 1080 : 720;
  }

  const parsedFolderId =
    typeof raw.driveFolderId === 'string'
      ? parseDriveFolderId(raw.driveFolderId) || DEFAULT_DRIVE_FOLDER_ID
      : base.driveFolderId || DEFAULT_DRIVE_FOLDER_ID;

  return {
    strict1080p: minQualityHeight === 1080 || strict1080p,
    minQualityHeight,
    autoFallbackSearch:
      typeof raw.autoFallbackSearch === 'boolean' ? raw.autoFallbackSearch : base.autoFallbackSearch,
    maxConcurrency:
      typeof raw.maxConcurrency === 'number' && raw.maxConcurrency >= 1 && raw.maxConcurrency <= 20
        ? Math.round(raw.maxConcurrency)
        : base.maxConcurrency,
    preferredPlayers:
      Array.isArray(raw.preferredPlayers) && raw.preferredPlayers.length
        ? raw.preferredPlayers.map((p: unknown) => String(p).toUpperCase())
        : [...base.preferredPlayers],
    preferredFansubs: Array.isArray(raw.preferredFansubs)
      ? raw.preferredFansubs.map((f: unknown) => String(f))
      : [...base.preferredFansubs],
    outputPattern: raw.outputPattern === 'flat' ? 'flat' : 'folder_per_anime',
    driveFolderId: parsedFolderId,
    driveAutoUpload:
      typeof raw.driveAutoUpload === 'boolean' ? raw.driveAutoUpload : base.driveAutoUpload,
    driveDeleteLocalAfterUpload:
      typeof raw.driveDeleteLocalAfterUpload === 'boolean'
        ? raw.driveDeleteLocalAfterUpload
        : base.driveDeleteLocalAfterUpload,
  };
}

export function loadSettings(): DownloadSettings {
  ensureDataDir();
  if (fs.existsSync(SETTINGS_FILE)) {
    try {
      const raw = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'));
      if (raw && typeof raw === 'object') {
        return normalizeSettings(raw as Record<string, unknown>, DEFAULT_SETTINGS);
      }
    } catch {
      return { ...DEFAULT_SETTINGS };
    }
  }
  return { ...DEFAULT_SETTINGS };
}

export function saveSettings(settings: DownloadSettings): void {
  ensureDataDir();
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2), 'utf8');
}

export function loadProbeCache(): Record<string, EpisodeProbeSummary> {
  ensureDataDir();
  if (fs.existsSync(PROBES_FILE)) {
    try {
      const raw = JSON.parse(fs.readFileSync(PROBES_FILE, 'utf8'));
      if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
        return raw as Record<string, EpisodeProbeSummary>;
      }
    } catch {
      return {};
    }
  }
  return {};
}

export function saveProbeCache(cache: Record<string, EpisodeProbeSummary>): void {
  ensureDataDir();
  fs.writeFileSync(PROBES_FILE, JSON.stringify(cache), 'utf8');
}

export function loadHistory(): Record<string, DownloadedRecord> {
  ensureDataDir();
  if (fs.existsSync(HISTORY_FILE)) {
    try {
      const raw = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8'));
      if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
        return raw as Record<string, DownloadedRecord>;
      }
    } catch {
      return {};
    }
  }

  // Seed/backfill from existing completed jobs on disk if history.json doesn't exist yet
  const seeded: Record<string, DownloadedRecord> = {};
  if (fs.existsSync(JOBS_FILE)) {
    try {
      const jobs = JSON.parse(fs.readFileSync(JOBS_FILE, 'utf8'));
      if (Array.isArray(jobs)) {
        for (const j of jobs as DownloadJob[]) {
          if (j.status === 'completed') {
            const key = `${j.slug}:${j.episode}`;
            seeded[key] = {
              key,
              slug: j.slug,
              animeTitle: j.animeTitle,
              episode: j.episode,
              quality: j.selectedQuality || 'MP4',
              resolutionHeight: j.resolutionHeight || 0,
              player: j.selectedPlayer || '',
              fansub: j.selectedFansub || '',
              fileName: j.fileName || `${j.animeTitle} - Bolum ${j.episode}.mp4`,
              totalBytes: j.totalBytes || j.bytesDownloaded || 0,
              downloadedAt: j.completedAt || j.updatedAt || Date.now(),
              driveFileId: j.driveFileId,
              driveWebViewLink: j.driveWebViewLink,
              driveFolderId: j.driveFolderId,
              driveFolderLink: j.driveFolderLink,
            };
          }
        }
      }
    } catch {
      // ignore
    }
  }
  if (Object.keys(seeded).length > 0) {
    saveHistory(seeded);
  }
  return seeded;
}

export function saveHistory(history: Record<string, DownloadedRecord>): void {
  ensureDataDir();
  fs.writeFileSync(HISTORY_FILE, JSON.stringify(history, null, 2), 'utf8');
}

export function upsertHistoryRecord(
  history: Record<string, DownloadedRecord>,
  record: DownloadedRecord,
): Record<string, DownloadedRecord> {
  history[record.key] = record;
  saveHistory(history);
  return history;
}

export function loadV2SeedCatalog(): AnimeEntry[] {
  const seed = loadSeedCatalog();
  return seed.slice(0, 500);
}

export function loadV2Catalog(): AnimeEntry[] {
  ensureDataDir();
  if (fs.existsSync(V2_CATALOG_FILE)) {
    try {
      const raw = JSON.parse(fs.readFileSync(V2_CATALOG_FILE, 'utf8'));
      if (Array.isArray(raw)) {
        const normalized = raw
          .map(normalizeAnimeEntry)
          .filter((e): e is AnimeEntry => e !== null);
        if (normalized.length > 0) return normalized;
      }
    } catch {
      // fallback
    }
  }
  const seed = loadV2SeedCatalog();
  saveV2Catalog(seed);
  return seed;
}

export function saveV2Catalog(entries: AnimeEntry[]): void {
  ensureDataDir();
  fs.writeFileSync(V2_CATALOG_FILE, JSON.stringify(entries, null, 2), 'utf8');
}

export function loadV2History(): Record<string, DownloadedRecord> {
  ensureDataDir();
  if (fs.existsSync(V2_HISTORY_FILE)) {
    try {
      const raw = JSON.parse(fs.readFileSync(V2_HISTORY_FILE, 'utf8'));
      if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
        return raw as Record<string, DownloadedRecord>;
      }
    } catch {
      return {};
    }
  }
  return {};
}

export function saveV2History(history: Record<string, DownloadedRecord>): void {
  ensureDataDir();
  fs.writeFileSync(V2_HISTORY_FILE, JSON.stringify(history, null, 2), 'utf8');
}

export function removeHistoryRecord(
  history: Record<string, DownloadedRecord>,
  key: string,
): Record<string, DownloadedRecord> {
  if (history[key]) {
    delete history[key];
    saveHistory(history);
  }
  return history;
}

