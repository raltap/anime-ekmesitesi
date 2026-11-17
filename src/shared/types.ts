export type PlayerLink = [fansub: string, player: string, url: string];

export type ArchiveStatus = 'tam' | 'kismi' | 'yok';

export interface AnimeEntry {
  t: string;
  fmt: string;
  yr: number | string;
  ec: number;
  E: number;
  miss: string[];
  slug: string;
  at: string;
  d: ArchiveStatus;
  f: Record<string, PlayerLink[]>;
}

export interface StreamVariant {
  qualityLabel: string;
  height: number;
  url: string;
  format: 'mp4' | 'hls' | 'unknown';
  sizeBytes?: number;
  headers?: Record<string, string>;
}

export interface ProbeResult {
  embedUrl: string;
  player: string;
  fansub: string;
  status: 'ok' | 'dead' | 'unsupported' | 'error';
  message?: string;
  variants: StreamVariant[];
  bestHeight: number;
  has1080p: boolean;
  probedAt: number;
}

export interface EpisodeProbeSummary {
  slug: string;
  episode: string;
  probing: boolean;
  results: ProbeResult[];
  recommended?: {
    probe: ProbeResult;
    variant: StreamVariant;
  };
  probedAt?: number;
}

export type DownloadStatus =
  | 'queued'
  | 'paused'
  | 'probing'
  | 'downloading'
  | 'muxing'
  | 'uploading_drive'
  | 'completed'
  | 'failed'
  | 'cancelled';

export interface DownloadJob {
  id: string;
  slug: string;
  animeTitle: string;
  episode: string;
  status: DownloadStatus;
  strict1080p: boolean;
  minQualityHeight: 1080 | 720 | 0;
  selectedPlayer?: string;
  selectedFansub?: string;
  selectedQuality?: string;
  resolutionHeight?: number;
  streamUrl?: string;
  embedUrl?: string;
  fileName?: string;
  filePath?: string;
  bytesDownloaded: number;
  totalBytes: number;
  speedBps: number;
  percent: number;
  driveStatus?: 'pending' | 'uploading' | 'uploaded' | 'error' | 'skipped';
  driveProgress?: number;
  driveFileId?: string;
  driveWebViewLink?: string;
  driveFolderId?: string;
  driveFolderLink?: string;
  driveError?: string;
  attempts: Array<{
    player: string;
    fansub: string;
    embedUrl: string;
    outcome: string;
  }>;
  error?: string;
  localFileExists?: boolean;
  forceRedownload?: boolean;
  createdAt: number;
  updatedAt: number;
  completedAt?: number;
}

export interface DriveSyncStatus {
  syncing: boolean;
  lastSyncedAt: number | null;
  source: 'oauth' | 'public' | null;
  scannedFolders: number;
  matchedFiles: number;
  newlyImported: number;
  error: string | null;
}

export interface DriveSessionSummary {
  connected: boolean;
  expired: boolean;
  userEmail: string | null;
  folderName: string | null;
  pendingDriveCount: number;
  uploadingCount: number;
  missingLocalDriveCount: number;
  tokenExpiresAt?: number | null;
  syncStatus?: DriveSyncStatus;
}

export interface DownloadedRecord {
  key: string; // `${slug}:${episode}`
  slug: string;
  animeTitle: string;
  episode: string;
  quality: string;
  resolutionHeight: number;
  player: string;
  fansub: string;
  fileName: string;
  totalBytes: number;
  downloadedAt: number;
  driveFileId?: string;
  driveWebViewLink?: string;
  driveFolderId?: string;
  driveFolderLink?: string;
}

export interface DownloadSettings {
  strict1080p: boolean;
  minQualityHeight: 1080 | 720 | 0;
  autoFallbackSearch: boolean;
  maxConcurrency: number;
  preferredPlayers: string[];
  preferredFansubs: string[];
  outputPattern: 'folder_per_anime' | 'flat';
  driveFolderId: string;
  driveAutoUpload: boolean;
  driveDeleteLocalAfterUpload: boolean;
}

export interface CatalogStats {
  totalAnime: number;
  missing1: number;
  missing2: number;
  missing3: number;
  tamCount: number;
  kismiCount: number;
  yokCount: number;
  totalMissingEpisodes: number;
}

export interface FilterState {
  search: string;
  missingCount: 'all' | '1' | '2' | '3' | '2-3';
  archiveStatus: 'all' | ArchiveStatus;
  format: string;
  player: string;
  sortBy: 'title' | 'missing' | 'year' | 'archive';
  showCompleted?: boolean;
}

export interface FallbackSiteReport {
  site: 'TürkAnime İzle' | 'Animeİzle.pro' | 'TrAnimeİzle';
  status: 'found' | 'not_found' | 'blocked' | 'error';
  message: string;
  searchUrl: string;
  animeUrl?: string;
  episodeUrl?: string;
  foundCount: number;
}

export interface FallbackSearchResponse {
  slug: string;
  episode: string;
  addedCount: number;
  links: PlayerLink[];
  entry: AnimeEntry;
  reports: FallbackSiteReport[];
}

export interface CatalogScanStatus {
  running: boolean;
  mode: 'incomplete' | 'selected' | 'all';
  totalAnime: number;
  processedAnime: number;
  totalEpisodes: number;
  processedEpisodes: number;
  addedLinksCount: number;
  updatedAnimeCount: number;
  currentAnimeTitle?: string;
  startedAt?: number;
  finishedAt?: number;
  error?: string;
}

