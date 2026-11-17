import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import type {
  AnimeEntry,
  ArchiveStatus,
  DownloadedRecord,
  DownloadJob,
  DownloadSettings,
  DriveSessionSummary,
  EpisodeProbeSummary,
  ProbeResult,
  StreamVariant,
} from '../src/shared/types.ts';
import {
  buildEpisodeFileName,
  DEFAULT_DRIVE_FOLDER_ID,
  pickBestProbeResult,
  pickBestVariant,
  planByteRanges,
  rankCandidateLinks,
  sanitizeFileName,
} from '../src/shared/playerPriority.ts';
import {
  findEpisodeInDriveFolder,
  findOrCreateAnimeFolder,
  isDriveAuthError,
  uploadFileResumableToDrive,
} from './driveUploader.ts';
import { probePlayerUrl, probeVideoResolutionWithFfprobe } from './extractors.ts';
import { searchFallbackEpisodeSources } from './fallbackSources.ts';

const DOWNLOADS_DIR = path.resolve(process.cwd(), 'downloads');
const DEFAULT_JOBS_FILE = path.resolve(process.cwd(), 'data', 'jobs.json');

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const ACTIVE_STATUSES = new Set([
  'probing',
  'downloading',
  'muxing',
  'uploading_drive',
]);

const MAX_CONCURRENT_PER_HOST = 3;
const PROBE_CACHE_MAX_AGE_MS = 45 * 60 * 1000;

function ensureDirs(jobsFilePath: string): void {
  if (!fs.existsSync(DOWNLOADS_DIR)) {
    fs.mkdirSync(DOWNLOADS_DIR, { recursive: true });
  }
  const dataDir = path.dirname(jobsFilePath);
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
}

function getHostKey(rawUrl: string, fallbackName = 'host'): string {
  try {
    return new URL(rawUrl).hostname.toLowerCase();
  } catch {
    return fallbackName.toLowerCase();
  }
}

function buildRecordFromJob(job: DownloadJob): DownloadedRecord {
  return {
    key: `${job.slug}:${job.episode}`,
    slug: job.slug,
    animeTitle: job.animeTitle,
    episode: job.episode,
    quality: job.selectedQuality || 'MP4',
    resolutionHeight: job.resolutionHeight || 0,
    player: job.selectedPlayer || '',
    fansub: job.selectedFansub || '',
    fileName: job.fileName || `${job.animeTitle} - Bolum ${job.episode}.mp4`,
    totalBytes: job.totalBytes || job.bytesDownloaded || 0,
    downloadedAt: job.completedAt || Date.now(),
    driveFileId: job.driveFileId,
    driveWebViewLink: job.driveWebViewLink,
    driveFolderId: job.driveFolderId,
    driveFolderLink: job.driveFolderLink,
  };
}

function sleepAbortable(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.reject(new Error('İptal edildi'));
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new Error('İptal edildi'));
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

export class DownloadManager {
  private jobs = new Map<string, DownloadJob>();
  private activeControllers = new Map<string, AbortController>();
  private abortedForPause = new Set<string>();
  private queuePaused = false;
  private driveToken: string | null = null; // In-memory only; never persisted to disk
  private driveUserEmail: string | null = null;
  private driveFolderName: string | null = null;
  private driveTokenExpired = false;
  private driveTokenObtainedAt: number | null = null;
  private hostActiveDownloads = new Map<string, number>();
  private hostLastProbeAt = new Map<string, number>();
  private isUploadingPendingDrive = false;
  private readonly jobsFilePath: string;

  private getCatalog: () => AnimeEntry[];
  private getSettings: () => DownloadSettings;
  private getProbeCache?: () => Record<string, EpisodeProbeSummary>;
  private onProbeUpdated?: (key: string, summary: EpisodeProbeSummary) => void;
  private onCatalogUpdated?: () => void;
  private onCompletedRecord?: (record: DownloadedRecord) => void;
  private hasRecordedEpisode?: (slug: string, episode: string) => boolean;
  private isEpisodeAlreadyOnDrive?: (slug: string, episode: string) => boolean;

  constructor(options: {
    getCatalog: () => AnimeEntry[];
    getSettings: () => DownloadSettings;
    getProbeCache?: () => Record<string, EpisodeProbeSummary>;
    onProbeUpdated?: (key: string, summary: EpisodeProbeSummary) => void;
    onCatalogUpdated?: () => void;
    onCompletedRecord?: (record: DownloadedRecord) => void;
    hasRecordedEpisode?: (slug: string, episode: string) => boolean;
    isEpisodeAlreadyOnDrive?: (slug: string, episode: string) => boolean;
    jobsFile?: string;
  }) {
    this.getCatalog = options.getCatalog;
    this.getSettings = options.getSettings;
    this.getProbeCache = options.getProbeCache;
    this.onProbeUpdated = options.onProbeUpdated;
    this.onCatalogUpdated = options.onCatalogUpdated;
    this.onCompletedRecord = options.onCompletedRecord;
    this.hasRecordedEpisode = options.hasRecordedEpisode;
    this.isEpisodeAlreadyOnDrive = options.isEpisodeAlreadyOnDrive;
    this.jobsFilePath = options.jobsFile || DEFAULT_JOBS_FILE;
    this.loadJobs();

    // Auto-resume queued/re-queued jobs cleanly after server startup
    const hasQueued = Array.from(this.jobs.values()).some((j) => j.status === 'queued');
    if (hasQueued && !this.queuePaused) {
      setTimeout(() => this.pumpQueue(), 500);
    }
  }

  setDriveToken(
    token: string | null,
    meta?: { userEmail?: string | null; folderName?: string | null; expired?: boolean },
  ): void {
    const clean = token ? token.trim() : null;
    if (clean) {
      if (clean !== this.driveToken) {
        this.driveTokenObtainedAt = Date.now();
      }
      this.driveToken = clean;
      this.driveTokenExpired = false;
      if (meta?.userEmail !== undefined) this.driveUserEmail = meta.userEmail;
      if (meta?.folderName !== undefined) this.driveFolderName = meta.folderName;
      if (this.getSettings().driveAutoUpload) {
        void this.uploadPendingDriveJobs({ includeSkipped: true });
      }
    } else {
      this.driveToken = null;
      this.driveTokenObtainedAt = null;
      if (meta?.expired) {
        this.driveTokenExpired = true;
      } else {
        this.driveTokenExpired = false;
        this.driveUserEmail = null;
        this.driveFolderName = null;
      }
    }
  }

  setDriveSessionMeta(meta: { userEmail?: string | null; folderName?: string | null }): void {
    if (meta.userEmail !== undefined) this.driveUserEmail = meta.userEmail;
    if (meta.folderName !== undefined) this.driveFolderName = meta.folderName;
  }

  markDriveTokenExpired(): void {
    this.driveToken = null;
    this.driveTokenExpired = true;
    this.driveTokenObtainedAt = null;

    let changed = false;
    for (const job of this.jobs.values()) {
      if (
        job.status === 'completed' &&
        !job.driveWebViewLink &&
        job.driveStatus === 'error' &&
        isDriveAuthError(job.driveError)
      ) {
        job.driveStatus = 'pending';
        job.driveError =
          'Google Drive oturum süresi (~1 saat) doldu — yeniden bağlanınca otomatik yüklenecek.';
        job.updatedAt = Date.now();
        changed = true;
      }
    }
    if (changed) {
      this.persistJobs();
    }
  }

  hasDriveToken(): boolean {
    return Boolean(this.driveToken);
  }

  getDriveToken(): string | null {
    return this.driveToken;
  }

  isQueuePaused(): boolean {
    return this.queuePaused;
  }

  private isJobPendingDriveUpload(job: DownloadJob, includeSkipped: boolean): boolean {
    if (job.status !== 'completed' || job.driveWebViewLink) return false;
    if (!job.filePath || !fs.existsSync(job.filePath)) return false;
    if (includeSkipped) return true;
    return job.driveStatus === 'pending' || job.driveStatus === 'error' || !job.driveStatus;
  }

  getPendingDriveJobs(includeSkipped = this.getSettings().driveAutoUpload): DownloadJob[] {
    return Array.from(this.jobs.values()).filter((j) =>
      this.isJobPendingDriveUpload(j, includeSkipped),
    );
  }

  getPendingDriveCount(): number {
    return this.getPendingDriveJobs(this.getSettings().driveAutoUpload).length;
  }

  getMissingLocalDriveCount(): number {
    return Array.from(this.jobs.values()).filter(
      (j) =>
        j.status === 'completed' &&
        !j.driveWebViewLink &&
        (!j.filePath || !fs.existsSync(j.filePath)),
    ).length;
  }

  getDriveSessionSummary(): DriveSessionSummary {
    return {
      connected: Boolean(this.driveToken),
      expired: this.driveTokenExpired,
      userEmail: this.driveUserEmail,
      folderName: this.driveFolderName,
      pendingDriveCount: this.getPendingDriveCount(),
      uploadingCount: Array.from(this.jobs.values()).filter((j) => j.status === 'uploading_drive')
        .length,
      missingLocalDriveCount: this.getMissingLocalDriveCount(),
      tokenExpiresAt: this.driveTokenObtainedAt
        ? this.driveTokenObtainedAt + 55 * 60 * 1000
        : null,
    };
  }

  async uploadPendingDriveJobs(options: { includeSkipped?: boolean } = {}): Promise<number> {
    if (this.isUploadingPendingDrive) return 0;
    const token = this.driveToken;
    if (!token) return 0;

    const includeSkipped = options.includeSkipped ?? this.getSettings().driveAutoUpload;
    const pending = this.getPendingDriveJobs(includeSkipped);
    if (!pending.length) return 0;

    this.isUploadingPendingDrive = true;
    let uploadedCount = 0;
    try {
      for (let i = 0; i < pending.length; i += 3) {
        if (!this.driveToken) break;
        const batch = pending.slice(i, i + 3);
        const results = await Promise.allSettled(
          batch.map((job) => this.uploadJobToDrive(job.id, this.driveToken!)),
        );
        for (const r of results) {
          if (r.status === 'fulfilled') uploadedCount++;
        }
        if (!this.driveToken || this.driveTokenExpired) break;
      }
      return uploadedCount;
    } finally {
      this.isUploadingPendingDrive = false;
    }
  }

  triggerPendingDriveUploads(options: { includeSkipped?: boolean } = {}): number {
    if (!this.driveToken) return 0;
    const includeSkipped = options.includeSkipped ?? true;
    const pending = this.getPendingDriveJobs(includeSkipped);
    if (pending.length > 0 && !this.isUploadingPendingDrive) {
      void this.uploadPendingDriveJobs({ includeSkipped });
    }
    return pending.length;
  }

  private loadJobs(): void {
    ensureDirs(this.jobsFilePath);
    if (!fs.existsSync(this.jobsFilePath)) return;
    let modified = false;
    try {
      const list = JSON.parse(fs.readFileSync(this.jobsFilePath, 'utf8'));
      if (Array.isArray(list)) {
        for (const job of list as DownloadJob[]) {
          if (typeof job.minQualityHeight !== 'number') {
            job.minQualityHeight = job.strict1080p ? 1080 : 720;
          }
          if (job.status === 'uploading_drive') {
            if (job.filePath && fs.existsSync(job.filePath)) {
              job.status = 'completed';
              job.driveStatus = 'pending';
              job.percent = 100;
              job.speedBps = 0;
              job.error = undefined;
            } else {
              job.status = 'queued';
              job.bytesDownloaded = 0;
              job.percent = 0;
              job.speedBps = 0;
              job.error = undefined;
            }
            modified = true;
          } else if (ACTIVE_STATUSES.has(job.status)) {
            // Re-queue interrupted downloads instead of failing so background jobs survive restarts
            job.status = 'queued';
            job.bytesDownloaded = 0;
            job.totalBytes = 0;
            job.percent = 0;
            job.speedBps = 0;
            job.error = undefined;
            modified = true;
          }
          this.jobs.set(job.id, job);
        }
      }
      if (modified) {
        this.persistJobs();
      }
    } catch {
      // ignore corrupted jobs file
    }
  }

  private persistJobs(): void {
    ensureDirs(this.jobsFilePath);
    const list = Array.from(this.jobs.values())
      .sort((a, b) => b.createdAt - a.createdAt)
      .map(({ localFileExists: _omit, ...rest }) => rest);
    fs.writeFileSync(this.jobsFilePath, JSON.stringify(list, null, 2), 'utf8');
  }

  listJobs(): DownloadJob[] {
    return Array.from(this.jobs.values())
      .sort((a, b) => b.createdAt - a.createdAt)
      .map((job) => ({
        ...job,
        localFileExists: Boolean(job.filePath && fs.existsSync(job.filePath)),
      }));
  }

  getJob(id: string): DownloadJob | undefined {
    return this.jobs.get(id);
  }

  private applyDriveRecordToJob(job: DownloadJob, record: DownloadedRecord): boolean {
    if (!record.driveWebViewLink) return false;
    const isStaleNonActive =
      job.status === 'queued' ||
      job.status === 'paused' ||
      job.status === 'failed' ||
      job.status === 'cancelled';

    if (job.status === 'completed' && !job.driveWebViewLink) {
      job.driveStatus = 'uploaded';
      job.driveProgress = 100;
      job.driveError = undefined;
      job.driveFileId = record.driveFileId;
      job.driveWebViewLink = record.driveWebViewLink;
      job.driveFolderId = record.driveFolderId;
      job.driveFolderLink = record.driveFolderLink;
      job.updatedAt = Date.now();
      return true;
    }

    if (isStaleNonActive) {
      job.status = 'completed';
      job.percent = 100;
      job.speedBps = 0;
      job.error = undefined;
      job.selectedQuality = job.selectedQuality || record.quality;
      job.resolutionHeight = job.resolutionHeight || record.resolutionHeight;
      job.selectedPlayer = job.selectedPlayer || record.player;
      job.selectedFansub = job.selectedFansub || record.fansub;
      job.fileName = job.fileName || record.fileName;
      job.totalBytes = job.totalBytes || record.totalBytes || 0;
      job.bytesDownloaded = job.totalBytes;
      job.driveStatus = 'uploaded';
      job.driveProgress = 100;
      job.driveError = undefined;
      job.driveFileId = record.driveFileId;
      job.driveWebViewLink = record.driveWebViewLink;
      job.driveFolderId = record.driveFolderId;
      job.driveFolderLink = record.driveFolderLink;
      job.completedAt = job.completedAt || record.downloadedAt || Date.now();
      job.updatedAt = Date.now();
      return true;
    }
    return false;
  }

  markEpisodeSyncedFromDrive(record: DownloadedRecord): void {
    let changed = false;
    for (const job of this.jobs.values()) {
      if (job.slug === record.slug && job.episode === record.episode) {
        if (this.applyDriveRecordToJob(job, record)) {
          changed = true;
        }
      }
    }
    if (changed) {
      this.persistJobs();
    }
  }

  markEpisodesSyncedFromDrive(records: DownloadedRecord[]): number {
    if (!records.length) return 0;
    const byKey = new Map(records.map((r) => [`${r.slug}:${r.episode}`, r]));
    let reconciledCount = 0;
    for (const job of this.jobs.values()) {
      const rec = byKey.get(`${job.slug}:${job.episode}`);
      if (rec && this.applyDriveRecordToJob(job, rec)) {
        reconciledCount++;
      }
    }
    if (reconciledCount > 0) {
      this.persistJobs();
    }
    return reconciledCount;
  }

  enqueue(
    items: Array<{ slug: string; episode: string; preferUrl?: string }>,
    options: { skipAlreadyDownloaded?: boolean; forceRedownload?: boolean } = {},
  ): { created: DownloadJob[]; skippedExisting: number } {
    const catalog = this.getCatalog();
    const settings = this.getSettings();
    const bySlug = new Map(catalog.map((a) => [a.slug, a]));
    const created: DownloadJob[] = [];
    let skippedExisting = 0;
    const shouldSkipExisting =
      !options.forceRedownload && options.skipAlreadyDownloaded !== false;

    for (const item of items) {
      const anime = bySlug.get(item.slug);
      if (!anime) continue;

      if (shouldSkipExisting && this.hasRecordedEpisode?.(item.slug, item.episode)) {
        skippedExisting++;
        continue;
      }

      const existing = Array.from(this.jobs.values()).find(
        (j) =>
          j.slug === item.slug &&
          j.episode === item.episode &&
          (j.status === 'queued' || j.status === 'paused' || ACTIVE_STATUSES.has(j.status)),
      );
      if (existing) {
        created.push(existing);
        continue;
      }

      const minQualityHeight: 1080 | 720 | 0 = settings.strict1080p
        ? 1080
        : settings.minQualityHeight;

      const now = Date.now();
      const job: DownloadJob = {
        id: crypto.randomUUID(),
        slug: anime.slug,
        animeTitle: anime.t,
        episode: item.episode,
        status: this.queuePaused ? 'paused' : 'queued',
        strict1080p: minQualityHeight === 1080,
        minQualityHeight,
        embedUrl: item.preferUrl,
        forceRedownload: Boolean(options.forceRedownload) || undefined,
        bytesDownloaded: 0,
        totalBytes: 0,
        speedBps: 0,
        percent: 0,
        attempts: [],
        createdAt: now,
        updatedAt: now,
      };
      this.jobs.set(job.id, job);
      created.push(job);
    }

    this.persistJobs();
    this.pumpQueue();
    return { created, skippedExisting };
  }

  pauseJob(id: string): DownloadJob | null {
    const job = this.jobs.get(id);
    if (!job) return null;
    if (job.status === 'queued') {
      job.status = 'paused';
      job.updatedAt = Date.now();
      this.persistJobs();
      return job;
    }
    if (ACTIVE_STATUSES.has(job.status)) {
      this.abortedForPause.add(id);
      job.status = 'paused';
      job.speedBps = 0;
      job.updatedAt = Date.now();
      const ctrl = this.activeControllers.get(id);
      if (ctrl) {
        ctrl.abort();
        this.activeControllers.delete(id);
      }
      this.persistJobs();
      return job;
    }
    return job;
  }

  resumeJob(id: string): DownloadJob | null {
    const job = this.jobs.get(id);
    if (!job) return null;
    if (job.status === 'paused') {
      this.queuePaused = false;
      job.status = 'queued';
      job.error = undefined;
      job.bytesDownloaded = 0;
      job.totalBytes = 0;
      job.speedBps = 0;
      job.percent = 0;
      job.updatedAt = Date.now();
      this.persistJobs();
      this.pumpQueue();
    }
    return job;
  }

  pauseAll(): void {
    this.queuePaused = true;
    for (const [id, job] of this.jobs.entries()) {
      if (job.status === 'queued') {
        job.status = 'paused';
        job.updatedAt = Date.now();
      } else if (ACTIVE_STATUSES.has(job.status)) {
        this.abortedForPause.add(id);
        job.status = 'paused';
        job.speedBps = 0;
        job.updatedAt = Date.now();
        const ctrl = this.activeControllers.get(id);
        if (ctrl) {
          ctrl.abort();
          this.activeControllers.delete(id);
        }
      }
    }
    this.persistJobs();
  }

  resumeAll(): void {
    this.queuePaused = false;
    for (const job of this.jobs.values()) {
      if (job.status === 'paused') {
        if (!job.forceRedownload && this.isEpisodeAlreadyOnDrive?.(job.slug, job.episode)) {
          job.status = 'completed';
          job.driveStatus = 'uploaded';
          job.percent = 100;
          job.speedBps = 0;
          job.error = undefined;
          job.updatedAt = Date.now();
          continue;
        }
        job.status = 'queued';
        job.error = undefined;
        job.bytesDownloaded = 0;
        job.totalBytes = 0;
        job.speedBps = 0;
        job.percent = 0;
        job.updatedAt = Date.now();
      }
    }
    this.persistJobs();
    this.pumpQueue();
  }

  cancelAll(): void {
    this.queuePaused = false;
    for (const [id, job] of this.jobs.entries()) {
      if (job.status === 'queued' || job.status === 'paused' || ACTIVE_STATUSES.has(job.status)) {
        this.abortedForPause.delete(id);
        const ctrl = this.activeControllers.get(id);
        if (ctrl) {
          ctrl.abort();
          this.activeControllers.delete(id);
        }
        job.status = 'cancelled';
        job.speedBps = 0;
        job.updatedAt = Date.now();
      }
    }
    this.persistJobs();
  }

  cancelJob(id: string): DownloadJob | null {
    const job = this.jobs.get(id);
    if (!job) return null;
    this.abortedForPause.delete(id);
    const ctrl = this.activeControllers.get(id);
    if (ctrl) {
      ctrl.abort();
      this.activeControllers.delete(id);
    }
    job.status = 'cancelled';
    job.speedBps = 0;
    job.updatedAt = Date.now();
    this.persistJobs();
    this.pumpQueue();
    return job;
  }

  retryJob(id: string): DownloadJob | null {
    const job = this.jobs.get(id);
    if (!job) return null;
    const settings = this.getSettings();
    const minQualityHeight: 1080 | 720 | 0 = settings.strict1080p
      ? 1080
      : settings.minQualityHeight;

    this.queuePaused = false;
    job.status = 'queued';
    job.forceRedownload = true;
    job.strict1080p = minQualityHeight === 1080;
    job.minQualityHeight = minQualityHeight;
    job.error = undefined;
    job.driveError = undefined;
    job.bytesDownloaded = 0;
    job.totalBytes = 0;
    job.speedBps = 0;
    job.percent = 0;
    job.attempts = [];
    job.updatedAt = Date.now();
    this.persistJobs();
    this.pumpQueue();
    return job;
  }

  requeueFailedJobs(): number {
    const settings = this.getSettings();
    const minQualityHeight: 1080 | 720 | 0 = settings.strict1080p
      ? 1080
      : settings.minQualityHeight;
    let count = 0;
    let changed = false;
    const now = Date.now();
    for (const job of this.jobs.values()) {
      if (job.status === 'failed') {
        if (!job.forceRedownload && this.isEpisodeAlreadyOnDrive?.(job.slug, job.episode)) {
          job.status = 'completed';
          job.driveStatus = 'uploaded';
          job.percent = 100;
          job.speedBps = 0;
          job.error = undefined;
          job.updatedAt = now;
          changed = true;
          continue;
        }
        job.status = 'queued';
        job.strict1080p = minQualityHeight === 1080;
        job.minQualityHeight = minQualityHeight;
        job.error = undefined;
        job.driveError = undefined;
        job.bytesDownloaded = 0;
        job.totalBytes = 0;
        job.speedBps = 0;
        job.percent = 0;
        job.attempts = [];
        job.updatedAt = now;
        count++;
        changed = true;
      }
    }
    if (changed) {
      if (count > 0) this.queuePaused = false;
      this.persistJobs();
      if (count > 0) this.pumpQueue();
    }
    return count;
  }

  deleteJob(id: string, removeFile = false): boolean {
    const job = this.jobs.get(id);
    if (!job) return false;
    this.abortedForPause.delete(id);
    const ctrl = this.activeControllers.get(id);
    if (ctrl) {
      ctrl.abort();
      this.activeControllers.delete(id);
    }
    if (removeFile && job.filePath && fs.existsSync(job.filePath)) {
      try {
        fs.unlinkSync(job.filePath);
      } catch {
        // ignore
      }
    }
    this.jobs.delete(id);
    this.persistJobs();
    return true;
  }

  clearFinished(): void {
    for (const [id, job] of this.jobs.entries()) {
      if (job.status === 'cancelled' || job.status === 'failed') {
        this.jobs.delete(id);
      }
    }
    this.persistJobs();
  }

  async uploadJobToDrive(id: string, tokenOverride?: string): Promise<DownloadJob> {
    const job = this.jobs.get(id);
    if (!job) throw new Error('İş bulunamadı.');
    const token = tokenOverride || this.driveToken;
    if (!token) throw new Error('Google Drive oturumu açık değil.');
    if (!job.filePath || !fs.existsSync(job.filePath)) {
      throw new Error('Yerel dosya sunucuda bulunamadı.');
    }

    const settings = this.getSettings();
    const rootFolderId = settings.driveFolderId || DEFAULT_DRIVE_FOLDER_ID;
    const prevStatus = job.status;
    const ctrl = new AbortController();
    this.activeControllers.set(job.id, ctrl);

    try {
      job.status = 'uploading_drive';
      job.driveStatus = 'uploading';
      job.driveProgress = 0;
      job.driveError = undefined;
      job.updatedAt = Date.now();
      this.persistJobs();

      const folder = await findOrCreateAnimeFolder(token, rootFolderId, job.animeTitle);
      const fileName =
        job.fileName ||
        buildEpisodeFileName(
          job.animeTitle,
          job.episode,
          job.selectedFansub || 'Fansub',
          job.selectedQuality || '1080p',
        );

      const uploaded = await uploadFileResumableToDrive(
        token,
        folder.id,
        job.filePath,
        fileName,
        (pct) => {
          job.driveProgress = pct;
          job.updatedAt = Date.now();
        },
        ctrl.signal,
      );

      job.driveStatus = 'uploaded';
      job.driveProgress = 100;
      job.driveFileId = uploaded.id;
      job.driveWebViewLink = uploaded.webViewLink;
      job.driveFolderId = folder.id;
      job.driveFolderLink = folder.webViewLink;
      job.status = 'completed';
      job.updatedAt = Date.now();

      if (settings.driveDeleteLocalAfterUpload && job.filePath && fs.existsSync(job.filePath)) {
        try {
          fs.unlinkSync(job.filePath);
          job.filePath = undefined;
        } catch {
          // keep path if unlink fails
        }
      }

      this.persistJobs();
      this.onCompletedRecord?.(buildRecordFromJob(job));
      return job;
    } catch (err) {
      if (isDriveAuthError(err)) {
        this.markDriveTokenExpired();
        job.driveStatus = 'pending';
        job.driveError =
          'Google Drive oturum süresi (~1 saat) doldu — yeniden bağlanınca otomatik yüklenecek.';
      } else {
        job.driveStatus = 'error';
        job.driveError = err instanceof Error ? err.message : 'Drive yükleme hatası';
      }
      job.status = prevStatus === 'uploading_drive' ? 'completed' : prevStatus;
      job.updatedAt = Date.now();
      this.persistJobs();
      throw err;
    } finally {
      this.activeControllers.delete(job.id);
    }
  }

  private pumpQueue(): void {
    if (this.queuePaused) return;

    const settings = this.getSettings();
    const activeCount = Array.from(this.jobs.values()).filter((j) =>
      ACTIVE_STATUSES.has(j.status),
    ).length;

    const slots = Math.max(0, settings.maxConcurrency - activeCount);
    if (slots === 0) return;

    const queued = Array.from(this.jobs.values())
      .filter((j) => j.status === 'queued')
      .sort((a, b) => a.createdAt - b.createdAt);

    for (const job of queued.slice(0, slots)) {
      void this.runJob(job);
    }
  }

  private async paceHostProbe(hostKey: string, signal: AbortSignal): Promise<void> {
    const now = Date.now();
    const prev = this.hostLastProbeAt.get(hostKey) || 0;
    const waitMs = Math.max(0, prev + 180 - now);
    this.hostLastProbeAt.set(hostKey, now + waitMs);
    if (waitMs > 0) {
      await sleepAbortable(waitMs, signal);
    }
  }

  private async acquireHostDownloadSlot(hostKey: string, signal: AbortSignal): Promise<void> {
    while ((this.hostActiveDownloads.get(hostKey) || 0) >= MAX_CONCURRENT_PER_HOST) {
      await sleepAbortable(250, signal);
    }
    this.hostActiveDownloads.set(hostKey, (this.hostActiveDownloads.get(hostKey) || 0) + 1);
  }

  private releaseHostDownloadSlot(hostKey: string): void {
    const cur = this.hostActiveDownloads.get(hostKey) || 0;
    if (cur <= 1) {
      this.hostActiveDownloads.delete(hostKey);
    } else {
      this.hostActiveDownloads.set(hostKey, cur - 1);
    }
  }

  private async mergeFallbackSourcesIntoAnime(
    anime: AnimeEntry,
    episode: string,
  ): Promise<number> {
    const { links: discovered } = await searchFallbackEpisodeSources(anime, episode);
    if (!discovered.length) return 0;

    const existing = anime.f[episode] ?? [];
    const seen = new Set(existing.map((l) => l[2]));
    const merged = [...existing];
    let added = 0;

    for (const item of discovered) {
      if (!seen.has(item[2])) {
        seen.add(item[2]);
        merged.push(item);
        added++;
      }
    }

    if (added > 0) {
      anime.f[episode] = merged;
      const epsWithLinks = anime.miss.filter((ep) => (anime.f[ep] ?? []).length > 0).length;
      const nextStatus: ArchiveStatus =
        epsWithLinks === anime.miss.length && anime.miss.length > 0
          ? 'tam'
          : epsWithLinks > 0
            ? 'kismi'
            : 'yok';
      anime.d = nextStatus;
      this.onCatalogUpdated?.();
    }
    return added;
  }

  private async runJob(job: DownloadJob): Promise<void> {
    const controller = new AbortController();
    this.activeControllers.set(job.id, controller);

    try {
      const anime = this.getCatalog().find((a) => a.slug === job.slug);
      if (!anime) {
        throw new Error('Anime katalogda bulunamadı.');
      }

      const settings = this.getSettings();
      if (!job.forceRedownload) {
        if (this.isEpisodeAlreadyOnDrive?.(job.slug, job.episode)) {
          job.status = 'completed';
          job.driveStatus = 'uploaded';
          job.driveProgress = 100;
          job.percent = 100;
          job.speedBps = 0;
          job.error = undefined;
          job.completedAt = job.completedAt || Date.now();
          job.updatedAt = Date.now();
          this.persistJobs();
          return;
        }
        if (this.driveToken) {
          try {
            const rootFolderId = settings.driveFolderId || DEFAULT_DRIVE_FOLDER_ID;
            const liveDriveRec = await findEpisodeInDriveFolder(
              this.driveToken,
              rootFolderId,
              anime,
              job.episode,
            );
            if (liveDriveRec) {
              this.onCompletedRecord?.(liveDriveRec);
              this.applyDriveRecordToJob(job, liveDriveRec);
              job.status = 'completed';
              job.driveStatus = 'uploaded';
              job.driveProgress = 100;
              job.percent = 100;
              job.speedBps = 0;
              job.error = undefined;
              job.completedAt = job.completedAt || Date.now();
              job.updatedAt = Date.now();
              this.persistJobs();
              return;
            }
          } catch (err) {
            if (isDriveAuthError(err)) {
              this.markDriveTokenExpired();
            }
          }
        }
      }

      const minHeight = job.strict1080p
        ? 1080
        : (job.minQualityHeight ?? (settings.strict1080p ? 1080 : settings.minQualityHeight));

      job.status = 'probing';
      job.updatedAt = Date.now();
      this.persistJobs();

      let searchedFallback = false;
      let rawLinks = anime.f[job.episode] ?? [];
      if (!rawLinks.length && settings.autoFallbackSearch) {
        searchedFallback = true;
        job.attempts.push({
          player: 'FANSUB-ARAMA',
          fansub: 'TürkAnime İzle / Animeİzle.pro',
          embedUrl: '',
          outcome: 'Arşivde link yoktu, harici fansublar taranıyor...',
        });
        await this.mergeFallbackSourcesIntoAnime(anime, job.episode).catch(() => 0);
        rawLinks = anime.f[job.episode] ?? [];
      }

      if (!rawLinks.length) {
        throw new Error('Bu eksik bölüm için arşivde ve harici fansublarda link bulunamadı.');
      }

      const probeResults: ProbeResult[] = [];
      const testedUrls = new Set<string>();

      const inspectRankedLinks = async (
        links: typeof rawLinks,
        existingFallback: { probe: ProbeResult; variant: StreamVariant } | null,
      ): Promise<{
        chosen1080: { probe: ProbeResult; variant: StreamVariant } | null;
        fallback: { probe: ProbeResult; variant: StreamVariant } | null;
      }> => {
        let ranked = rankCandidateLinks(links, settings.preferredPlayers, settings.preferredFansubs);
        if (job.embedUrl) {
          const preferred = ranked.find((l) => l[2] === job.embedUrl);
          if (preferred) {
            ranked = [preferred, ...ranked.filter((l) => l[2] !== job.embedUrl)];
          }
        }

        // Fast-path: reuse fresh probeCache if available and not explicitly overridden
        const cached = this.getProbeCache?.()[`${anime.slug}:${job.episode}`];
        if (
          !job.embedUrl &&
          cached?.probedAt &&
          Date.now() - cached.probedAt < PROBE_CACHE_MAX_AGE_MS &&
          cached.results.length > 0
        ) {
          const cachedBest = pickBestProbeResult(
            cached.results,
            minHeight,
            settings.preferredPlayers,
          );
          if (cachedBest && cachedBest.variant.height >= 720) {
            job.attempts.push({
              player: cachedBest.probe.player,
              fansub: cachedBest.probe.fansub,
              embedUrl: cachedBest.probe.embedUrl,
              outcome: `Önbellekten hızlı seçildi (${cachedBest.variant.qualityLabel})`,
            });
            if (cachedBest.variant.height >= 1080) {
              return { chosen1080: cachedBest, fallback: existingFallback };
            }
            existingFallback = cachedBest;
          }
          for (const r of cached.results) {
            testedUrls.add(r.embedUrl);
            probeResults.push(r);
          }
        }

        let localFallback = existingFallback;
        let batchesAfter720 = 0;
        const candidates = ranked.filter(([, , url]) => !testedUrls.has(url));

        // Probe candidates in parallel batches of 4 for major speedup
        for (let i = 0; i < candidates.length; i += 4) {
          if (controller.signal.aborted || this.abortedForPause.has(job.id)) {
            throw new Error('Duraklatıldı veya iptal edildi');
          }

          const batch = candidates.slice(i, i + 4);
          for (const [, , url] of batch) {
            testedUrls.add(url);
          }

          const batchProbes = await Promise.all(
            batch.map(async ([fansub, player, embedUrl]) => {
              await this.paceHostProbe(getHostKey(embedUrl, player), controller.signal);
              return probePlayerUrl(fansub, player, embedUrl, { skipHeadSize: true });
            }),
          );

          const usableCandidates: Array<{ probe: ProbeResult; variant: StreamVariant }> = [];

          for (const probe of batchProbes) {
            probeResults.push(probe);
            if (probe.status !== 'ok' || !probe.variants.length) {
              job.attempts.push({
                player: probe.player,
                fansub: probe.fansub,
                embedUrl: probe.embedUrl,
                outcome: probe.message || 'Kaynak erişilemedi',
              });
              continue;
            }

            const variant = pickBestVariant(probe.variants, minHeight);
            if (!variant) {
              const maxFound = Math.max(...probe.variants.map((v) => v.height), 0);
              job.attempts.push({
                player: probe.player,
                fansub: probe.fansub,
                embedUrl: probe.embedUrl,
                outcome: maxFound
                  ? `En yüksek ${maxFound}p (${minHeight}p+ gerekli)`
                  : 'Çözünürlük tespit edilemedi',
              });
              continue;
            }

            if (variant.height === 0) {
              const dims = await probeVideoResolutionWithFfprobe(variant.url, variant.headers);
              if (dims?.height) {
                variant.height = dims.height;
                variant.qualityLabel = `${dims.height}p`;
              }
              if (minHeight > 0 && variant.height > 0 && variant.height < minHeight) {
                job.attempts.push({
                  player: probe.player,
                  fansub: probe.fansub,
                  embedUrl: probe.embedUrl,
                  outcome: `Gerçek çözünürlük ${variant.height}p (${minHeight}p+ gerekli)`,
                });
                continue;
              }
            }

            usableCandidates.push({ probe, variant });
          }

          // Check if any usable candidate in this batch reaches 1080p
          const best1080 = usableCandidates
            .filter((c) => c.variant.height >= 1080)
            .sort((a, b) => {
              if (b.variant.height !== a.variant.height) return b.variant.height - a.variant.height;
              if (a.variant.format === 'mp4' && b.variant.format !== 'mp4') return -1;
              if (b.variant.format === 'mp4' && a.variant.format !== 'mp4') return 1;
              return 0;
            })[0];

          if (best1080) {
            job.attempts.push({
              player: best1080.probe.player,
              fansub: best1080.probe.fansub,
              embedUrl: best1080.probe.embedUrl,
              outcome: `Seçildi (${best1080.variant.qualityLabel})`,
            });
            return { chosen1080: best1080, fallback: localFallback };
          }

          for (const item of usableCandidates) {
            if (!localFallback || item.variant.height > localFallback.variant.height) {
              localFallback = item;
            }
            job.attempts.push({
              player: item.probe.player,
              fansub: item.probe.fansub,
              embedUrl: item.probe.embedUrl,
              outcome: `Yedek aday (${item.variant.qualityLabel}) — 1080p varsa kontrol ediliyor`,
            });
          }

          if (localFallback) {
            batchesAfter720++;
            if (batchesAfter720 >= 1) {
              break;
            }
          }
        }

        return { chosen1080: null, fallback: localFallback };
      };

      let result = await inspectRankedLinks(rawLinks, null);

      if (!result.chosen1080 && !result.fallback && !searchedFallback && settings.autoFallbackSearch) {
        searchedFallback = true;
        const added = await this.mergeFallbackSourcesIntoAnime(anime, job.episode).catch(() => 0);
        if (added > 0) {
          job.attempts.push({
            player: 'FANSUB-ARAMA',
            fansub: 'Harici Kaynaklar',
            embedUrl: '',
            outcome: `${added} ek fansub kaynağı bulundu, taranıyor...`,
          });
          result = await inspectRankedLinks(anime.f[job.episode] ?? [], result.fallback);
        }
      }

      const chosen = result.chosen1080 ?? result.fallback;

      if (this.onProbeUpdated) {
        this.onProbeUpdated(`${anime.slug}:${job.episode}`, {
          slug: anime.slug,
          episode: job.episode,
          probing: false,
          results: probeResults,
          recommended: chosen ?? undefined,
          probedAt: Date.now(),
        });
      }

      if (!chosen) {
        throw new Error(
          minHeight >= 1080
            ? 'Tüm oynatıcılar ve fansublar tarandı ancak doğrulanmış 1080p akış bulunamadı.'
            : minHeight >= 720
              ? 'Tüm oynatıcılar tarandı ancak 720p/1080p indirilebilir akış bulunamadı.'
              : 'Tüm oynatıcılar tarandı ancak indirilebilir aktif akış bulunamadı.',
        );
      }

      const { probe, variant } = chosen;
      job.selectedPlayer = probe.player;
      job.selectedFansub = probe.fansub;
      job.selectedQuality = variant.qualityLabel;
      job.resolutionHeight = variant.height;
      job.streamUrl = variant.url;
      job.embedUrl = probe.embedUrl;

      const fileName = buildEpisodeFileName(
        anime.t,
        job.episode,
        probe.fansub,
        variant.qualityLabel,
      );
      const targetDir =
        settings.outputPattern === 'folder_per_anime'
          ? path.join(DOWNLOADS_DIR, sanitizeFileName(anime.slug))
          : DOWNLOADS_DIR;
      fs.mkdirSync(targetDir, { recursive: true });
      const filePath = path.join(targetDir, fileName);

      job.fileName = fileName;
      job.filePath = filePath;
      job.status = variant.format === 'hls' ? 'muxing' : 'downloading';
      job.updatedAt = Date.now();
      this.persistJobs();

      const streamHostKey = getHostKey(variant.url, probe.player);
      await this.acquireHostDownloadSlot(streamHostKey, controller.signal);
      try {
        if (variant.format === 'hls') {
          await this.downloadHlsWithFfmpeg(job, variant, filePath, controller.signal);
        } else {
          await this.downloadDirectMp4(job, variant, filePath, controller.signal);
        }
      } finally {
        this.releaseHostDownloadSlot(streamHostKey);
      }

      const stat = fs.statSync(filePath);
      if (stat.size < 50_000) {
        throw new Error('İndirilen dosya çok küçük (bozuk veya engellenmiş olabilir).');
      }

      job.bytesDownloaded = stat.size;
      job.totalBytes = stat.size;
      job.percent = 100;
      job.speedBps = 0;
      job.completedAt = Date.now();
      job.updatedAt = Date.now();

      this.onCompletedRecord?.(buildRecordFromJob(job));

      const activeToken = this.driveToken;
      const rootFolderId = settings.driveFolderId || DEFAULT_DRIVE_FOLDER_ID;

      if (settings.driveAutoUpload && rootFolderId && activeToken) {
        job.status = 'uploading_drive';
        job.driveStatus = 'uploading';
        job.driveProgress = 0;
        this.persistJobs();

        try {
          const folder = await findOrCreateAnimeFolder(activeToken, rootFolderId, anime.t);
          const uploaded = await uploadFileResumableToDrive(
            activeToken,
            folder.id,
            filePath,
            fileName,
            (pct) => {
              job.driveProgress = pct;
              job.updatedAt = Date.now();
            },
            controller.signal,
          );

          job.driveStatus = 'uploaded';
          job.driveProgress = 100;
          job.driveFileId = uploaded.id;
          job.driveWebViewLink = uploaded.webViewLink;
          job.driveFolderId = folder.id;
          job.driveFolderLink = folder.webViewLink;

          if (settings.driveDeleteLocalAfterUpload && fs.existsSync(filePath)) {
            try {
              fs.unlinkSync(filePath);
              job.filePath = undefined;
            } catch {
              // ignore cleanup failure
            }
          }
        } catch (driveErr) {
          if (this.abortedForPause.has(job.id) || controller.signal.aborted) {
            throw driveErr;
          }
          if (isDriveAuthError(driveErr)) {
            this.markDriveTokenExpired();
            job.driveStatus = 'pending';
            job.driveError =
              'Google Drive oturum süresi (~1 saat) doldu — yeniden bağlanınca otomatik yüklenecek.';
          } else {
            job.driveStatus = 'error';
            job.driveError =
              driveErr instanceof Error ? driveErr.message : 'Google Drive yüklemesi başarısız';
          }
        }
      } else if (settings.driveAutoUpload && !activeToken) {
        job.driveStatus = 'pending';
      } else {
        job.driveStatus = 'skipped';
      }

      job.status = 'completed';
      job.updatedAt = Date.now();
      this.persistJobs();
      this.onCompletedRecord?.(buildRecordFromJob(job));
    } catch (err) {
      if (this.abortedForPause.has(job.id)) {
        job.status = 'paused';
        job.speedBps = 0;
        job.updatedAt = Date.now();
        this.persistJobs();
      } else if (job.status !== 'cancelled') {
        job.status = 'failed';
        job.error = err instanceof Error ? err.message : 'İndirme hatası';
        job.speedBps = 0;
        job.updatedAt = Date.now();
        this.persistJobs();
      }
    } finally {
      this.abortedForPause.delete(job.id);
      this.activeControllers.delete(job.id);
      this.pumpQueue();
    }
  }

  private async downloadDirectMp4(
    job: DownloadJob,
    variant: StreamVariant,
    filePath: string,
    signal: AbortSignal,
  ): Promise<void> {
    const reqHeaders = {
      'User-Agent': USER_AGENT,
      ...(variant.headers || {}),
    };

    // Quick HEAD check for Accept-Ranges + exact Content-Length to unlock 4-connection Range acceleration
    let supportsRanges = false;
    let knownTotalBytes = variant.sizeBytes || 0;
    try {
      const headCtrl = new AbortController();
      const headTimer = setTimeout(() => headCtrl.abort(), 3500);
      const onOuterAbort = () => headCtrl.abort();
      signal.addEventListener('abort', onOuterAbort, { once: true });
      try {
        const headRes = await fetch(variant.url, {
          method: 'HEAD',
          signal: headCtrl.signal,
          headers: reqHeaders,
        });
        if (headRes.ok) {
          const len = Number(headRes.headers.get('content-length'));
          if (Number.isFinite(len) && len > 0) knownTotalBytes = len;
          const ar = (headRes.headers.get('accept-ranges') || '').toLowerCase();
          supportsRanges = ar.includes('bytes');
        }
      } finally {
        clearTimeout(headTimer);
        signal.removeEventListener('abort', onOuterAbort);
      }
    } catch {
      // ignore HEAD failure and proceed with standard GET
    }

    if (supportsRanges && knownTotalBytes >= 8 * 1024 * 1024) {
      try {
        await this.downloadParallelRanges(job, variant.url, reqHeaders, knownTotalBytes, filePath, signal);
        return;
      } catch (err) {
        if (signal.aborted) throw err;
        // Fallback cleanly to single-stream download if a CDN drops a range request
      }
    }

    await this.downloadSingleStream(job, variant.url, reqHeaders, knownTotalBytes, filePath, signal);
  }

  private async downloadParallelRanges(
    job: DownloadJob,
    url: string,
    headers: Record<string, string>,
    totalBytes: number,
    filePath: string,
    signal: AbortSignal,
  ): Promise<void> {
    const ranges = planByteRanges(totalBytes, 4);
    job.totalBytes = totalBytes;

    const tmpPath = `${filePath}.part`;
    const fh = await fs.promises.open(tmpPath, 'w+');
    let downloaded = 0;
    let lastTick = Date.now();
    let lastBytes = 0;

    try {
      await fh.truncate(totalBytes);

      await Promise.all(
        ranges.map(async (range) => {
          let attempt = 0;
          while (attempt < 2) {
            attempt++;
            if (signal.aborted) throw new Error('İptal edildi');

            const res = await fetch(url, {
              signal,
              headers: {
                ...headers,
                Range: `bytes=${range.start}-${range.end}`,
              },
            });

            if (res.status === 429 || res.status === 503) {
              if (attempt < 2) {
                await sleepAbortable(1000, signal);
                continue;
              }
            }

            if (res.status !== 206 || !res.body) {
              throw new Error(`Parçalı indirme yanıtı uygun değil (HTTP ${res.status})`);
            }

            let writeOffset = range.start;
            const reader = res.body.getReader();
            try {
              while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                const buf = Buffer.from(value.buffer, value.byteOffset, value.byteLength);
                await fh.write(buf, 0, buf.length, writeOffset);
                writeOffset += buf.length;
                downloaded += buf.length;

                const now = Date.now();
                if (now - lastTick >= 400) {
                  const dt = Math.max(0.1, (now - lastTick) / 1000);
                  job.speedBps = Math.round((downloaded - lastBytes) / dt);
                  job.bytesDownloaded = downloaded;
                  job.percent = Math.min(99, Math.round((downloaded / totalBytes) * 100));
                  job.updatedAt = now;
                  lastTick = now;
                  lastBytes = downloaded;
                }
              }
              return;
            } catch (chunkErr) {
              if (attempt >= 2 || signal.aborted) throw chunkErr;
              await sleepAbortable(800, signal);
            }
          }
        }),
      );

      await fh.close();
      fs.renameSync(tmpPath, filePath);
    } catch (err) {
      await fh.close().catch(() => {});
      try {
        if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
      } catch {
        // ignore
      }
      throw err;
    }
  }

  private async downloadSingleStream(
    job: DownloadJob,
    url: string,
    headers: Record<string, string>,
    knownTotalBytes: number,
    filePath: string,
    signal: AbortSignal,
  ): Promise<void> {
    let res = await fetch(url, { signal, headers });
    if (res.status === 429 || res.status === 503) {
      await sleepAbortable(1200, signal);
      res = await fetch(url, { signal, headers });
    }
    if (!res.ok || !res.body) {
      throw new Error(`Akış indirilemedi (HTTP ${res.status})`);
    }

    const totalBytes = Number(res.headers.get('content-length')) || knownTotalBytes || 0;
    job.totalBytes = totalBytes;

    const tmpPath = `${filePath}.part`;
    const writeStream = fs.createWriteStream(tmpPath);
    const readable = Readable.fromWeb(res.body as never);

    let downloaded = 0;
    let lastTick = Date.now();
    let lastBytes = 0;
    let lastDataAt = Date.now();

    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const stallTimer = setInterval(() => {
        if (!settled && Date.now() - lastDataAt > 60_000) {
          settled = true;
          clearInterval(stallTimer);
          signal.removeEventListener('abort', cleanupOnAbort);
          readable.destroy();
          writeStream.destroy();
          reject(new Error('İndirme akışı 60 saniyedir veri göndermedi (zaman aşımı).'));
        }
      }, 10_000);

      const cleanupOnAbort = () => {
        if (settled) return;
        settled = true;
        clearInterval(stallTimer);
        readable.destroy();
        writeStream.destroy();
        try {
          if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
        } catch {
          // ignore
        }
        reject(new Error('İptal edildi'));
      };
      signal.addEventListener('abort', cleanupOnAbort, { once: true });

      readable.on('data', (chunk: Buffer) => {
        downloaded += chunk.length;
        const now = Date.now();
        lastDataAt = now;
        if (now - lastTick >= 400) {
          const dt = Math.max(0.1, (now - lastTick) / 1000);
          job.speedBps = Math.round((downloaded - lastBytes) / dt);
          job.bytesDownloaded = downloaded;
          job.percent = totalBytes > 0 ? Math.min(99, Math.round((downloaded / totalBytes) * 100)) : 0;
          job.updatedAt = now;
          lastTick = now;
          lastBytes = downloaded;
        }
      });

      readable.on('error', (err) => {
        if (settled) return;
        settled = true;
        clearInterval(stallTimer);
        signal.removeEventListener('abort', cleanupOnAbort);
        writeStream.destroy();
        reject(err);
      });

      writeStream.on('error', (err) => {
        if (settled) return;
        settled = true;
        clearInterval(stallTimer);
        signal.removeEventListener('abort', cleanupOnAbort);
        readable.destroy();
        reject(err);
      });

      writeStream.on('finish', () => {
        if (settled) return;
        settled = true;
        clearInterval(stallTimer);
        signal.removeEventListener('abort', cleanupOnAbort);
        fs.renameSync(tmpPath, filePath);
        resolve();
      });

      readable.pipe(writeStream);
    });
  }

  private async downloadHlsWithFfmpeg(
    job: DownloadJob,
    variant: StreamVariant,
    filePath: string,
    signal: AbortSignal,
  ): Promise<void> {
    const headerLines = variant.headers
      ? Object.entries(variant.headers)
          .map(([k, v]) => `${k}: ${v}`)
          .join('\r\n') + '\r\n'
      : '';

    const args = [
      '-y',
      '-reconnect',
      '1',
      '-reconnect_streamed',
      '1',
      '-reconnect_delay_max',
      '2',
      '-http_persistent',
      '1',
      ...(headerLines ? ['-headers', headerLines] : []),
      '-i',
      variant.url,
      '-c',
      'copy',
      '-bsf:a',
      'aac_adtstoasc',
      filePath,
    ];

    let lastTick = Date.now();
    let lastBytes = 0;

    await new Promise<void>((resolve, reject) => {
      const child = spawn('ffmpeg', args, { stdio: ['ignore', 'ignore', 'pipe'] });
      let stderr = '';

      const onAbort = () => {
        child.kill('SIGTERM');
        try {
          if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
        } catch {
          // ignore
        }
        reject(new Error('İptal edildi'));
      };
      signal.addEventListener('abort', onAbort, { once: true });

      child.stderr.on('data', (d: Buffer) => {
        stderr += d.toString('utf8').slice(-800);
        if (fs.existsSync(filePath)) {
          try {
            const size = fs.statSync(filePath).size;
            const now = Date.now();
            if (now - lastTick >= 500) {
              const dt = Math.max(0.1, (now - lastTick) / 1000);
              job.speedBps = Math.max(0, Math.round((size - lastBytes) / dt));
              lastTick = now;
              lastBytes = size;
            }
            job.bytesDownloaded = size;
            job.updatedAt = now;
          } catch {
            // ignore
          }
        }
      });

      child.on('error', (err) => {
        signal.removeEventListener('abort', onAbort);
        reject(err);
      });

      child.on('close', (code) => {
        signal.removeEventListener('abort', onAbort);
        if (code === 0) resolve();
        else reject(new Error(`ffmpeg çıkış kodu ${code}: ${stderr.slice(-180)}`));
      });
    });
  }
}
