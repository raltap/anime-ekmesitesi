import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { createServer as createViteServer } from 'vite';
import {
  loadCatalog,
  loadHistory,
  loadProbeCache,
  loadSettings,
  loadV2Catalog,
  loadV2History,
  normalizeSettings,
  removeHistoryRecord,
  resetCatalogToSeed,
  saveCatalog,
  saveHistory,
  saveProbeCache,
  saveSettings,
  saveV2Catalog,
  saveV2History,
  upsertHistoryRecord,
} from './server/catalogStore.ts';
import { DownloadManager } from './server/downloader.ts';
import {
  deleteDriveFile,
  isDriveAuthError,
  scanDriveFolderAuto,
  validateDriveFolder,
} from './server/driveUploader.ts';
import { probePlayerUrl } from './server/extractors.ts';
import {
  resolveTurkAnimeIzleAnimePage,
  searchFallbackAnimeBatch,
  searchFallbackEpisodeSources,
} from './server/fallbackSources.ts';
import {
  DEFAULT_DRIVE_FOLDER_ID,
  parseDriveFolderId,
  pickBestProbeResult,
  rankCandidateLinks,
} from './src/shared/playerPriority.ts';
import { normalizeAnimeEntry, parseReportInput } from './src/shared/reportParser.ts';
import type {
  AnimeEntry,
  ArchiveStatus,
  CatalogScanStatus,
  DownloadedRecord,
  DownloadSettings,
  DriveSessionSummary,
  DriveSyncStatus,
  EpisodeProbeSummary,
  PlayerLink,
  ProbeResult,
} from './src/shared/types.ts';

const PORT = Number(process.env.PORT) || 3000;

function extractBearerToken(req: express.Request): string | null {
  const auth = req.headers.authorization;
  if (!auth || typeof auth !== 'string') return null;
  const match = auth.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : null;
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '25mb' }));

  let catalog: AnimeEntry[] = loadCatalog();
  let settings: DownloadSettings = loadSettings();
  const probeCache: Record<string, EpisodeProbeSummary> = loadProbeCache();
  const history: Record<string, DownloadedRecord> = loadHistory();

  const downloader = new DownloadManager({
    getCatalog: () => catalog,
    getSettings: () => settings,
    getProbeCache: () => probeCache,
    onProbeUpdated: (key, summary) => {
      probeCache[key] = summary;
      saveProbeCache(probeCache);
    },
    onCatalogUpdated: () => {
      saveCatalog(catalog);
    },
    onCompletedRecord: (record) => {
      upsertHistoryRecord(history, record);
    },
    hasRecordedEpisode: (slug, episode) => Boolean(history[`${slug}:${episode}`]),
    isEpisodeAlreadyOnDrive: (slug, episode) =>
      Boolean(history[`${slug}:${episode}`]?.driveWebViewLink),
  });

  let catalogScanStatus: CatalogScanStatus = {
    running: false,
    mode: 'incomplete',
    totalAnime: 0,
    processedAnime: 0,
    totalEpisodes: 0,
    processedEpisodes: 0,
    addedLinksCount: 0,
    updatedAnimeCount: 0,
  };
  let catalogScanCancelRequested = false;

  let lastDriveVerifyAt = 0;

  let driveSyncStatus: DriveSyncStatus = {
    syncing: false,
    lastSyncedAt: null,
    source: null,
    scannedFolders: 0,
    matchedFiles: 0,
    newlyImported: 0,
    error: null,
  };
  let activeDriveSyncPromise: Promise<{
    scannedFolders: number;
    matchedFiles: number;
    newlyImported: number;
    source: 'oauth' | 'public';
  }> | null = null;

  function getFullDriveSessionSummary(): DriveSessionSummary {
    return {
      ...downloader.getDriveSessionSummary(),
      syncStatus: { ...driveSyncStatus },
    };
  }

  async function runAutoDriveSync(options: {
    tokenOverride?: string | null;
    folderIdOverride?: string;
    force?: boolean;
  } = {}): Promise<{
    scannedFolders: number;
    matchedFiles: number;
    newlyImported: number;
    source: 'oauth' | 'public';
  }> {
    if (activeDriveSyncPromise) {
      return activeDriveSyncPromise;
    }
    if (
      !options.force &&
      driveSyncStatus.lastSyncedAt &&
      Date.now() - driveSyncStatus.lastSyncedAt < 20_000
    ) {
      return {
        scannedFolders: driveSyncStatus.scannedFolders,
        matchedFiles: driveSyncStatus.matchedFiles,
        newlyImported: driveSyncStatus.newlyImported,
        source: driveSyncStatus.source || 'public',
      };
    }

    const token = options.tokenOverride || downloader.getDriveToken();
    const folderId =
      parseDriveFolderId(options.folderIdOverride || settings.driveFolderId) ||
      DEFAULT_DRIVE_FOLDER_ID;

    driveSyncStatus = {
      ...driveSyncStatus,
      syncing: true,
      error: null,
    };

    const task = (async () => {
      try {
        const result = await scanDriveFolderAuto({
          token,
          rootFolderId: folderId,
          catalog,
        });
        if (result.source === 'oauth') {
          lastDriveVerifyAt = Date.now();
        }
        let newlyImported = 0;
        let updatedExisting = false;
        for (const rec of result.records) {
          const existing = history[rec.key];
          if (!existing) {
            newlyImported++;
            history[rec.key] = rec;
            updatedExisting = true;
          } else {
            const needsPatch =
              (!existing.driveWebViewLink && Boolean(rec.driveWebViewLink)) ||
              (!existing.driveFolderLink && Boolean(rec.driveFolderLink)) ||
              (!existing.resolutionHeight && (rec.resolutionHeight || 0) > 0);
            if (needsPatch) updatedExisting = true;
            history[rec.key] = {
              ...existing,
              quality:
                existing.quality && existing.quality !== 'Drive' ? existing.quality : rec.quality,
              resolutionHeight: existing.resolutionHeight || rec.resolutionHeight,
              fansub:
                existing.fansub && existing.fansub !== 'Drive Klasörü' ? existing.fansub : rec.fansub,
              fileName: existing.fileName || rec.fileName,
              driveFileId: rec.driveFileId || existing.driveFileId,
              driveWebViewLink: rec.driveWebViewLink || existing.driveWebViewLink,
              driveFolderId: rec.driveFolderId || existing.driveFolderId,
              driveFolderLink: rec.driveFolderLink || existing.driveFolderLink,
              totalBytes: existing.totalBytes || rec.totalBytes,
            };
          }
        }
        downloader.markEpisodesSyncedFromDrive(
          result.records.map((r) => history[r.key] || r),
        );
        if (updatedExisting || newlyImported > 0) {
          saveHistory(history);
        }
        driveSyncStatus = {
          syncing: false,
          lastSyncedAt: Date.now(),
          source: result.source,
          scannedFolders: result.scannedFolders,
          matchedFiles: result.matchedFiles,
          newlyImported,
          error: null,
        };
        return {
          scannedFolders: result.scannedFolders,
          matchedFiles: result.matchedFiles,
          newlyImported,
          source: result.source,
        };
      } catch (err) {
        if (token && isDriveAuthError(err)) {
          downloader.markDriveTokenExpired();
          lastDriveVerifyAt = 0;
        }
        const message = err instanceof Error ? err.message : 'Google Drive klasörü taranamadı.';
        driveSyncStatus = {
          ...driveSyncStatus,
          syncing: false,
          error: message,
        };
        throw err;
      } finally {
        activeDriveSyncPromise = null;
      }
    })();

    activeDriveSyncPromise = task;
    return task;
  }

  // Automatic initial scan of configured Drive folder in the background so archived episodes are recognized immediately
  void runAutoDriveSync({ force: true }).catch(() => {});

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, catalogCount: catalog.length });
  });

  app.get('/api/catalog', (_req, res) => {
    res.json({
      entries: catalog,
      settings,
      probeCache,
      history,
      driveSession: getFullDriveSessionSummary(),
    });
  });

  app.post('/api/catalog/import', (req, res) => {
    try {
      const rawText = typeof req.body?.rawText === 'string' ? req.body.rawText : '';
      const mode = req.body?.mode === 'merge' ? 'merge' : 'replace';
      const { entries, skippedCount } = parseReportInput(rawText);

      if (mode === 'merge') {
        const map = new Map(catalog.map((e) => [e.slug, e]));
        for (const entry of entries) {
          map.set(entry.slug, entry);
        }
        catalog = Array.from(map.values());
      } else {
        catalog = entries;
      }

      saveCatalog(catalog);
      res.json({
        entries: catalog,
        importedCount: entries.length,
        skippedCount,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Rapor içe aktarılamadı.';
      res.status(400).json({ error: message });
    }
  });

  app.post('/api/catalog/reset', (_req, res) => {
    catalog = resetCatalogToSeed();
    res.json({ entries: catalog });
  });

  app.post('/api/catalog/add-entry', (req, res) => {
    try {
      const normalized = normalizeAnimeEntry(req.body?.entry);
      if (!normalized) {
        res.status(400).json({ error: 'Geçersiz anime kaydı: başlık ve slug zorunludur.' });
        return;
      }
      const idx = catalog.findIndex((e) => e.slug === normalized.slug);
      if (idx >= 0) {
        catalog[idx] = normalized;
      } else {
        catalog = [normalized, ...catalog];
      }
      saveCatalog(catalog);
      res.json({ entry: normalized, entries: catalog });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Kayıt eklenemedi.';
      res.status(400).json({ error: message });
    }
  });

  app.post('/api/archive/lookup', async (req, res) => {
    const slug = typeof req.body?.slug === 'string' ? req.body.slug.trim() : '';
    if (!slug) {
      res.status(400).json({ error: 'Slug belirtilmedi.' });
      return;
    }

    const candidates = [
      `https://berke-aras.github.io/turkanime-arsiv/data/anime/${encodeURIComponent(slug)}.json`,
      `https://berke-aras.github.io/turkanime-arsiv/data/${encodeURIComponent(slug)}.json`,
    ];

    for (const url of candidates) {
      try {
        const r = await fetch(url, { signal: AbortSignal.timeout(7000) });
        if (r.ok) {
          const data = await r.json();
          res.json({ found: true, sourceUrl: url, data });
          return;
        }
      } catch {
        // try next
      }
    }

    res.json({
      found: false,
      archivePageUrl: `https://berke-aras.github.io/turkanime-arsiv/#anime=${encodeURIComponent(slug)}`,
      message: 'Arşivde bu slug için doğrudan JSON kaydı bulunamadı.',
    });
  });

  function mergeDiscoveredEpisodeLinks(
    anime: AnimeEntry,
    episode: string,
    discoveredLinks: PlayerLink[],
  ): number {
    if (!discoveredLinks.length) return 0;
    const existing = anime.f[episode] ?? [];
    const seenUrls = new Set(existing.map((l) => l[2]));
    let addedCount = 0;

    const merged = [...existing];
    for (const item of discoveredLinks) {
      if (!seenUrls.has(item[2])) {
        seenUrls.add(item[2]);
        merged.push(item);
        addedCount++;
      }
    }

    if (addedCount > 0) {
      anime.f[episode] = merged;
      const epsWithLinks = anime.miss.filter((ep) => (anime.f[ep] ?? []).length > 0).length;
      const nextStatus: ArchiveStatus =
        epsWithLinks === anime.miss.length && anime.miss.length > 0
          ? 'tam'
          : epsWithLinks > 0
            ? 'kismi'
            : 'yok';
      anime.d = nextStatus;

      const cacheKey = `${anime.slug}:${episode}`;
      if (probeCache[cacheKey]) {
        delete probeCache[cacheKey];
        saveProbeCache(probeCache);
      }
    }

    return addedCount;
  }

  async function searchAndMergeEpisode(anime: AnimeEntry, episode: string) {
    const { links: discoveredLinks, reports } = await searchFallbackEpisodeSources(anime, episode);
    const addedCount = mergeDiscoveredEpisodeLinks(anime, episode, discoveredLinks);
    if (addedCount > 0) {
      saveCatalog(catalog);
    }
    return { addedCount, reports };
  }

  app.post('/api/fallback/search-episode', async (req, res) => {
    const slug = typeof req.body?.slug === 'string' ? req.body.slug.trim() : '';
    const episode = typeof req.body?.episode === 'string' ? req.body.episode.trim() : '';
    if (!slug || !episode) {
      res.status(400).json({ error: 'slug ve episode zorunludur.' });
      return;
    }

    const anime = catalog.find((a) => a.slug === slug);
    if (!anime) {
      res.status(404).json({ error: 'Anime bulunamadı.' });
      return;
    }

    try {
      const { addedCount, reports } = await searchAndMergeEpisode(anime, episode);
      res.json({
        slug,
        episode,
        addedCount,
        links: anime.f[episode] ?? [],
        entry: anime,
        reports,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Harici kaynak araması başarısız.';
      res.status(500).json({ error: message });
    }
  });

  app.post('/api/fallback/search-anime', async (req, res) => {
    const slug = typeof req.body?.slug === 'string' ? req.body.slug.trim() : '';
    const anime = catalog.find((a) => a.slug === slug);
    if (!anime) {
      res.status(404).json({ error: 'Anime bulunamadı.' });
      return;
    }
    try {
      let totalAdded = 0;
      const batchMap = await searchFallbackAnimeBatch(anime, anime.miss);
      for (const [ep, result] of batchMap.entries()) {
        totalAdded += mergeDiscoveredEpisodeLinks(anime, ep, result.links);
      }
      if (totalAdded > 0) {
        saveCatalog(catalog);
      }
      res.json({ slug, addedCount: totalAdded, entry: anime });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Toplu fansub araması başarısız.';
      res.status(500).json({ error: message });
    }
  });

  app.get('/api/fallback/scan-status', (_req, res) => {
    res.json({ status: catalogScanStatus });
  });

  app.post('/api/fallback/scan-cancel', (_req, res) => {
    catalogScanCancelRequested = true;
    res.json({ status: catalogScanStatus });
  });

  app.post('/api/fallback/scan-catalog', (req, res) => {
    if (catalogScanStatus.running) {
      res.json({ started: false, alreadyRunning: true, status: catalogScanStatus });
      return;
    }

    const rawMode = req.body?.mode;
    const mode: CatalogScanStatus['mode'] =
      rawMode === 'selected' || rawMode === 'all' ? rawMode : 'incomplete';
    const selectedSlugs = Array.isArray(req.body?.slugs)
      ? new Set(req.body.slugs.map((s: unknown) => String(s)))
      : null;

    const targets: Array<{ anime: AnimeEntry; episodes: string[] }> = [];
    for (const anime of catalog) {
      if (mode === 'selected' && selectedSlugs && !selectedSlugs.has(anime.slug)) continue;
      if (mode === 'incomplete' && anime.d === 'tam') continue;

      const emptyEps = anime.miss.filter(
        (ep) => !history[`${anime.slug}:${ep}`] && (anime.f[ep] ?? []).length === 0,
      );
      const epsToScan = emptyEps.length > 0 ? emptyEps : mode === 'selected' ? anime.miss : [];
      if (epsToScan.length > 0) {
        targets.push({ anime, episodes: epsToScan });
      }
    }

    catalogScanCancelRequested = false;
    catalogScanStatus = {
      running: targets.length > 0,
      mode,
      totalAnime: targets.length,
      processedAnime: 0,
      totalEpisodes: targets.reduce((sum, t) => sum + t.episodes.length, 0),
      processedEpisodes: 0,
      addedLinksCount: 0,
      updatedAnimeCount: 0,
      currentAnimeTitle: targets[0]?.anime.t,
      startedAt: Date.now(),
      finishedAt: targets.length === 0 ? Date.now() : undefined,
    };

    if (targets.length > 0) {
      void (async () => {
        try {
          for (let i = 0; i < targets.length; i += 3) {
            if (catalogScanCancelRequested) break;
            const batch = targets.slice(i, i + 3);
            catalogScanStatus.currentAnimeTitle = batch.map((b) => b.anime.t).join(', ');
            let batchSaved = false;

            await Promise.all(
              batch.map(async ({ anime, episodes }) => {
                if (catalogScanCancelRequested) return;
                try {
                  const foundMap = await searchFallbackAnimeBatch(anime, episodes);
                  let animeAdded = 0;
                  for (const [ep, result] of foundMap.entries()) {
                    animeAdded += mergeDiscoveredEpisodeLinks(anime, ep, result.links);
                  }
                  if (animeAdded > 0) {
                    catalogScanStatus.addedLinksCount += animeAdded;
                    catalogScanStatus.updatedAnimeCount += 1;
                    batchSaved = true;
                  }
                } catch {
                  // continue scanning remaining anime
                } finally {
                  catalogScanStatus.processedAnime += 1;
                  catalogScanStatus.processedEpisodes += episodes.length;
                }
              }),
            );

            if (batchSaved) {
              saveCatalog(catalog);
            }
          }
        } catch (err) {
          catalogScanStatus.error =
            err instanceof Error ? err.message : 'Toplu tarama hatası';
        } finally {
          catalogScanStatus.running = false;
          catalogScanStatus.currentAnimeTitle = undefined;
          catalogScanStatus.finishedAt = Date.now();
        }
      })();
    }

    res.json({ started: true, status: catalogScanStatus });
  });

  app.put('/api/settings', (req, res) => {
    const prevFolderId = settings.driveFolderId;
    const body = (req.body || {}) as Record<string, unknown>;
    settings = normalizeSettings(body, settings);
    saveSettings(settings);
    if (settings.driveAutoUpload && downloader.hasDriveToken()) {
      downloader.triggerPendingDriveUploads({ includeSkipped: true });
    }
    if (settings.driveFolderId && settings.driveFolderId !== prevFolderId) {
      void runAutoDriveSync({ folderIdOverride: settings.driveFolderId, force: true }).catch(
        () => {},
      );
    }
    res.json({ settings, driveSession: getFullDriveSessionSummary() });
  });

  // Google Drive session (token lives ONLY in server RAM; never written to disk)
  app.get('/api/drive/status', async (req, res) => {
    const token = downloader.getDriveToken();
    const forceVerify = req.query.verify === '1';
    if (token && (forceVerify || Date.now() - lastDriveVerifyAt > 45_000)) {
      const folderId = parseDriveFolderId(settings.driveFolderId) || DEFAULT_DRIVE_FOLDER_ID;
      try {
        const folder = await validateDriveFolder(token, folderId);
        lastDriveVerifyAt = Date.now();
        downloader.setDriveSessionMeta({
          userEmail: folder.userEmail || undefined,
          folderName: folder.name,
        });
      } catch (err) {
        if (isDriveAuthError(err)) {
          downloader.markDriveTokenExpired();
          lastDriveVerifyAt = 0;
        }
      }
    }
    res.json(getFullDriveSessionSummary());
  });

  app.post('/api/drive/session', async (req, res) => {
    const token = extractBearerToken(req);
    if (!token) {
      res.status(401).json({ error: 'Authorization Bearer token eksik.' });
      return;
    }
    const folderId =
      parseDriveFolderId(
        typeof req.body?.folderId === 'string' ? req.body.folderId : settings.driveFolderId,
      ) || DEFAULT_DRIVE_FOLDER_ID;
    try {
      const folder = await validateDriveFolder(token, folderId);
      lastDriveVerifyAt = Date.now();
      downloader.setDriveToken(token, {
        userEmail: folder.userEmail || null,
        folderName: folder.name,
      });
      void runAutoDriveSync({ tokenOverride: token, folderIdOverride: folderId, force: true }).catch(
        () => {},
      );
      res.json({
        connected: true,
        folder,
        pendingDriveCount: downloader.getPendingDriveCount(),
        driveSession: getFullDriveSessionSummary(),
      });
    } catch (err) {
      if (isDriveAuthError(err)) {
        downloader.markDriveTokenExpired();
        lastDriveVerifyAt = 0;
        res.status(401).json({
          error: 'Google Drive oturumu geçersiz veya süresi dolmuş. Lütfen yeniden giriş yapın.',
          expired: true,
          driveSession: getFullDriveSessionSummary(),
        });
        return;
      }
      downloader.setDriveToken(token);
      void runAutoDriveSync({ tokenOverride: token, folderIdOverride: folderId, force: true }).catch(
        () => {},
      );
      res.json({
        connected: true,
        folder: null,
        pendingDriveCount: downloader.getPendingDriveCount(),
        folderWarning: err instanceof Error ? err.message : 'Klasör doğrulanamadı.',
        driveSession: getFullDriveSessionSummary(),
      });
    }
  });

  app.post('/api/drive/session/clear', (_req, res) => {
    lastDriveVerifyAt = 0;
    downloader.setDriveToken(null);
    res.json({ connected: false, driveSession: getFullDriveSessionSummary() });
  });

  app.post('/api/drive/upload-pending', (req, res) => {
    const bearer = extractBearerToken(req);
    const token = bearer || downloader.getDriveToken();
    if (!token) {
      res.status(401).json({
        error: 'Drive yüklemesi için Google hesabınızı bağlayın (veya süresi dolan oturumu yenileyin).',
        expired: true,
        driveSession: getFullDriveSessionSummary(),
      });
      return;
    }
    if (bearer && bearer !== downloader.getDriveToken()) {
      downloader.setDriveToken(bearer);
    }
    const queuedUploadCount = downloader.triggerPendingDriveUploads({ includeSkipped: true });
    res.json({
      started: queuedUploadCount > 0,
      queuedUploadCount,
      jobs: downloader.listJobs(),
      history,
      driveSession: getFullDriveSessionSummary(),
    });
  });

  app.post('/api/drive/test-folder', async (req, res) => {
    const token = extractBearerToken(req) || downloader.getDriveToken();
    const rawFolder = typeof req.body?.folderId === 'string' ? req.body.folderId : settings.driveFolderId;
    const folderId = parseDriveFolderId(rawFolder);
    if (!folderId) {
      res.status(400).json({ error: 'Geçerli bir Google Drive klasör linki veya ID girin.' });
      return;
    }
    if (!token) {
      // Allow immediate public folder check/sync even without OAuth token
      try {
        const result = await runAutoDriveSync({ folderIdOverride: folderId, force: true });
        res.json({
          ok: true,
          folder: null,
          syncResult: result,
          history,
          jobs: downloader.listJobs(),
          driveSession: getFullDriveSessionSummary(),
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Önce Google ile giriş yapmalısınız.';
        res.status(401).json({
          error: message,
          expired: true,
          driveSession: getFullDriveSessionSummary(),
        });
      }
      return;
    }
    try {
      const folder = await validateDriveFolder(token, folderId);
      lastDriveVerifyAt = Date.now();
      downloader.setDriveSessionMeta({
        userEmail: folder.userEmail || undefined,
        folderName: folder.name,
      });
      void runAutoDriveSync({ tokenOverride: token, folderIdOverride: folderId, force: true }).catch(
        () => {},
      );
      res.json({ ok: true, folder, driveSession: getFullDriveSessionSummary() });
    } catch (err) {
      if (isDriveAuthError(err)) {
        downloader.markDriveTokenExpired();
        lastDriveVerifyAt = 0;
        res.status(401).json({
          error: 'Google Drive oturum süresi doldu (~1 saat). Lütfen yeniden bağlanın.',
          expired: true,
          driveSession: getFullDriveSessionSummary(),
        });
        return;
      }
      const message = err instanceof Error ? err.message : 'Klasör doğrulanamadı.';
      res.status(400).json({ error: message });
    }
  });

  app.post('/api/drive/sync-folder', async (req, res) => {
    const bearer = extractBearerToken(req);
    const token = bearer || downloader.getDriveToken();
    if (bearer && bearer !== downloader.getDriveToken()) {
      downloader.setDriveToken(bearer);
    }
    const rawFolder = typeof req.body?.folderId === 'string' ? req.body.folderId : settings.driveFolderId;
    const folderId = parseDriveFolderId(rawFolder) || DEFAULT_DRIVE_FOLDER_ID;
    try {
      const result = await runAutoDriveSync({
        tokenOverride: token,
        folderIdOverride: folderId,
        force: true,
      });
      res.json({
        ok: true,
        source: result.source,
        scannedFolders: result.scannedFolders,
        matchedFiles: result.matchedFiles,
        newlyImported: result.newlyImported,
        history,
        jobs: downloader.listJobs(),
        driveSession: getFullDriveSessionSummary(),
      });
    } catch (err) {
      if (token && isDriveAuthError(err)) {
        res.status(401).json({
          error: 'Google Drive oturum süresi doldu (~1 saat). Lütfen yeniden bağlanın.',
          expired: true,
          driveSession: getFullDriveSessionSummary(),
        });
        return;
      }
      const message = err instanceof Error ? err.message : 'Google Drive klasörü taranamadı.';
      res.status(isDriveAuthError(err) ? 401 : 400).json({
        error: message,
        driveSession: getFullDriveSessionSummary(),
      });
    }
  });

  app.post('/api/drive/upload/:id', async (req, res) => {
    const bearer = extractBearerToken(req);
    const token = bearer || downloader.getDriveToken();
    if (!token) {
      res.status(401).json({
        error: 'Drive yüklemesi için önce Google ile giriş yapın.',
        expired: true,
        driveSession: downloader.getDriveSessionSummary(),
      });
      return;
    }
    if (bearer && bearer !== downloader.getDriveToken()) {
      downloader.setDriveToken(bearer);
    }
    try {
      const job = await downloader.uploadJobToDrive(req.params.id, token);
      res.json({
        job,
        jobs: downloader.listJobs(),
        history,
        driveSession: downloader.getDriveSessionSummary(),
      });
    } catch (err) {
      if (isDriveAuthError(err)) {
        downloader.markDriveTokenExpired();
        lastDriveVerifyAt = 0;
        res.status(401).json({
          error: 'Google Drive oturum süresi doldu (~1 saat). Yeniden bağlanınca otomatik yüklenecek.',
          expired: true,
          jobs: downloader.listJobs(),
          driveSession: downloader.getDriveSessionSummary(),
        });
        return;
      }
      const message = err instanceof Error ? err.message : 'Drive yüklemesi başarısız.';
      res.status(400).json({
        error: message,
        jobs: downloader.listJobs(),
        driveSession: downloader.getDriveSessionSummary(),
      });
    }
  });

  app.post('/api/drive/delete-file', async (req, res) => {
    const token = extractBearerToken(req) || downloader.getDriveToken();
    if (!token) {
      res.status(401).json({
        error: 'Drive dosyası silmek için Google ile giriş yapın.',
        expired: true,
        driveSession: downloader.getDriveSessionSummary(),
      });
      return;
    }
    const fileId = typeof req.body?.fileId === 'string' ? req.body.fileId.trim() : '';
    const historyKey = typeof req.body?.historyKey === 'string' ? req.body.historyKey.trim() : '';
    if (!fileId) {
      res.status(400).json({ error: 'fileId zorunludur.' });
      return;
    }

    try {
      await deleteDriveFile(token, fileId);
      if (historyKey && history[historyKey]) {
        delete history[historyKey].driveFileId;
        delete history[historyKey].driveWebViewLink;
        saveHistory(history);
      }
      for (const job of downloader.listJobs()) {
        if (job.driveFileId === fileId) {
          job.driveFileId = undefined;
          job.driveWebViewLink = undefined;
          job.driveStatus = 'skipped';
        }
      }
      res.json({
        ok: true,
        history,
        jobs: downloader.listJobs(),
        driveSession: downloader.getDriveSessionSummary(),
      });
    } catch (err) {
      if (isDriveAuthError(err)) {
        downloader.markDriveTokenExpired();
        lastDriveVerifyAt = 0;
        res.status(401).json({
          error: 'Google Drive oturum süresi doldu (~1 saat). Lütfen yeniden bağlanın.',
          expired: true,
          driveSession: downloader.getDriveSessionSummary(),
        });
        return;
      }
      const message = err instanceof Error ? err.message : 'Drive dosyası silinemedi.';
      res.status(400).json({ error: message });
    }
  });

  app.post('/api/probe/single', async (req, res) => {
    const { fansub = 'Varsayılan', player = '', embedUrl = '' } = req.body || {};
    if (!embedUrl || !player) {
      res.status(400).json({ error: 'player ve embedUrl zorunludur.' });
      return;
    }
    const result = await probePlayerUrl(String(fansub), String(player), String(embedUrl));
    res.json({ result });
  });

  app.post('/api/probe/episode', async (req, res) => {
    const slug = typeof req.body?.slug === 'string' ? req.body.slug.trim() : '';
    const episode = typeof req.body?.episode === 'string' ? req.body.episode.trim() : '';
    const forceRefresh = Boolean(req.body?.forceRefresh);
    const maxLinks = Number(req.body?.maxLinks) || 10;

    const anime = catalog.find((a) => a.slug === slug);
    if (!anime) {
      res.status(404).json({ error: 'Anime bulunamadı.' });
      return;
    }

    const cacheKey = `${slug}:${episode}`;
    if (!forceRefresh && probeCache[cacheKey]) {
      res.json({ summary: probeCache[cacheKey] });
      return;
    }

    const rawLinks = anime.f[episode] ?? [];
    const ranked = rankCandidateLinks(
      rawLinks,
      settings.preferredPlayers,
      settings.preferredFansubs,
    ).slice(0, maxLinks);

    const results: ProbeResult[] = [];
    for (let i = 0; i < ranked.length; i += 3) {
      const batch = ranked.slice(i, i + 3);
      const batchResults = await Promise.all(
        batch.map(([fansub, player, embedUrl]) => probePlayerUrl(fansub, player, embedUrl)),
      );
      results.push(...batchResults);
    }

    const minHeight = settings.strict1080p ? 1080 : settings.minQualityHeight;
    const recommended =
      pickBestProbeResult(results, minHeight, settings.preferredPlayers) ?? undefined;
    const summary: EpisodeProbeSummary = {
      slug,
      episode,
      probing: false,
      results,
      recommended,
      probedAt: Date.now(),
    };

    probeCache[cacheKey] = summary;
    saveProbeCache(probeCache);
    res.json({ summary });
  });

  app.get('/api/downloads', (_req, res) => {
    res.json({
      jobs: downloader.listJobs(),
      queuePaused: downloader.isQueuePaused(),
      pendingDriveCount: downloader.getPendingDriveCount(),
      driveSession: getFullDriveSessionSummary(),
      history,
    });
  });

  app.post('/api/downloads/enqueue', (req, res) => {
    const items = Array.isArray(req.body?.items) ? req.body.items : [];
    const forceRedownload = Boolean(req.body?.forceRedownload);
    const skipAlreadyDownloaded =
      !forceRedownload && req.body?.skipAlreadyDownloaded !== false;
    if (!items.length) {
      res.status(400).json({ error: 'Kuyruğa eklenecek bölüm seçilmedi.' });
      return;
    }
    const { created, skippedExisting } = downloader.enqueue(items, {
      skipAlreadyDownloaded,
      forceRedownload,
    });
    res.json({
      created,
      skippedExisting,
      jobs: downloader.listJobs(),
      queuePaused: downloader.isQueuePaused(),
    });
  });

  app.post('/api/downloads/pause-all', (_req, res) => {
    downloader.pauseAll();
    res.json({ jobs: downloader.listJobs(), queuePaused: downloader.isQueuePaused() });
  });

  app.post('/api/downloads/resume-all', (_req, res) => {
    downloader.resumeAll();
    res.json({ jobs: downloader.listJobs(), queuePaused: downloader.isQueuePaused() });
  });

  app.post('/api/downloads/retry-failed', (_req, res) => {
    const requeuedCount = downloader.requeueFailedJobs();
    res.json({
      requeuedCount,
      jobs: downloader.listJobs(),
      queuePaused: downloader.isQueuePaused(),
      driveSession: getFullDriveSessionSummary(),
    });
  });

  app.post('/api/downloads/cancel-all', (_req, res) => {
    downloader.cancelAll();
    res.json({ jobs: downloader.listJobs(), queuePaused: downloader.isQueuePaused() });
  });

  app.post('/api/downloads/:id/pause', (req, res) => {
    const job = downloader.pauseJob(req.params.id);
    if (!job) {
      res.status(404).json({ error: 'İş bulunamadı.' });
      return;
    }
    res.json({ job, jobs: downloader.listJobs(), queuePaused: downloader.isQueuePaused() });
  });

  app.post('/api/downloads/:id/resume', (req, res) => {
    const job = downloader.resumeJob(req.params.id);
    if (!job) {
      res.status(404).json({ error: 'İş bulunamadı.' });
      return;
    }
    res.json({ job, jobs: downloader.listJobs(), queuePaused: downloader.isQueuePaused() });
  });

  app.post('/api/downloads/:id/cancel', (req, res) => {
    const job = downloader.cancelJob(req.params.id);
    if (!job) {
      res.status(404).json({ error: 'İş bulunamadı.' });
      return;
    }
    res.json({ job, jobs: downloader.listJobs(), queuePaused: downloader.isQueuePaused() });
  });

  app.post('/api/downloads/:id/retry', (req, res) => {
    const job = downloader.retryJob(req.params.id);
    if (!job) {
      res.status(404).json({ error: 'İş bulunamadı.' });
      return;
    }
    res.json({ job, jobs: downloader.listJobs(), queuePaused: downloader.isQueuePaused() });
  });

  app.delete('/api/downloads/:id', (req, res) => {
    const removeFile = req.query.removeFile === '1';
    const ok = downloader.deleteJob(req.params.id, removeFile);
    if (!ok) {
      res.status(404).json({ error: 'İş bulunamadı.' });
      return;
    }
    res.json({ ok: true, jobs: downloader.listJobs() });
  });

  app.post('/api/downloads/clear-finished', (_req, res) => {
    downloader.clearFinished();
    res.json({ jobs: downloader.listJobs() });
  });

  app.delete('/api/history/:key', (req, res) => {
    const key = decodeURIComponent(req.params.key);
    removeHistoryRecord(history, key);
    res.json({ ok: true, history });
  });

  app.get('/api/downloads/:id/file', (req, res) => {
    const job = downloader.getJob(req.params.id);
    if (!job || !job.filePath || !fs.existsSync(job.filePath)) {
      res.status(404).json({ error: 'İndirilen dosya diskte bulunamadı.' });
      return;
    }
    res.download(job.filePath, job.fileName || path.basename(job.filePath));
  });

  app.get('/api/history/export', (req, res) => {
    const format = req.query.format === 'csv' ? 'csv' : 'json';
    const recs = Object.values(history);
    if (format === 'csv') {
      const header = 'Slug,Anime Title,Episode,Quality,Resolution,Player,Fansub,FileName,Bytes,DownloadedAt,DriveWebViewLink\n';
      const rows = recs.map(r => 
        `"${r.slug}","${r.animeTitle.replace(/"/g, '""')}","${r.episode}","${r.quality}","${r.resolutionHeight}","${r.player}","${r.fansub}","${r.fileName.replace(/"/g, '""')}","${r.totalBytes}","${new Date(r.downloadedAt || Date.now()).toISOString()}","${r.driveWebViewLink || ''}"`
      ).join('\n');
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="anime_tamamlananlar_gecmis.csv"');
      res.send(header + rows);
    } else {
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="anime_tamamlananlar_gecmis.json"');
      res.json(recs);
    }
  });

  // V2 Top 500 & Full Series Discovery Store & Downloader
  let v2Catalog = loadV2Catalog();
  let v2History = loadV2History();
  const v2Downloader = new DownloadManager({
    getCatalog: () => v2Catalog,
    getSettings: () => settings,
    jobsFile: path.resolve(process.cwd(), 'data', 'v2_jobs.json'),
    onCatalogUpdated: () => saveV2Catalog(v2Catalog),
    onCompletedRecord: (record) => {
      v2History[record.key] = record;
      saveV2History(v2History);
    },
    hasRecordedEpisode: (slug, episode) => Boolean(v2History[`${slug}:${episode}`]),
    isEpisodeAlreadyOnDrive: (slug, episode) =>
      Boolean(v2History[`${slug}:${episode}`]?.driveWebViewLink),
  });

  app.get('/api/v2/catalog', (_req, res) => {
    res.json({
      entries: v2Catalog,
      history: v2History,
      jobs: v2Downloader.listJobs(),
      queuePaused: v2Downloader.isQueuePaused(),
      driveSession: getFullDriveSessionSummary(),
    });
  });

  app.post('/api/v2/catalog/discover', async (req, res) => {
    const title = typeof req.body?.title === 'string' ? req.body.title.trim() : '';
    if (!title) {
      res.status(400).json({ error: 'Anime adı zorunludur.' });
      return;
    }
    const slug = title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');

    const dummyEntry: AnimeEntry = {
      slug,
      t: title,
      at: title,
      fmt: 'TV',
      yr: 2023,
      ec: 0,
      E: 12,
      miss: ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12'],
      d: 'yok',
      f: {},
    };

    try {
      const resolved = await resolveTurkAnimeIzleAnimePage(dummyEntry);
      const episodeCount = resolved.episodeLinks.length > 0 ? resolved.episodeLinks.length : 12;
      const miss: string[] = [];
      for (let i = 1; i <= episodeCount; i++) {
        miss.push(String(i));
      }

      const batchMap = await searchFallbackAnimeBatch(dummyEntry, miss.slice(0, 15));
      const linkMap: Record<string, PlayerLink[]> = {};
      for (const [ep, result] of batchMap.entries()) {
        if (result.links.length > 0) {
          linkMap[ep] = result.links;
        }
      }

      const entry: AnimeEntry = {
        slug,
        t: title,
        at: title,
        fmt: 'TV',
        yr: 2023,
        ec: 0,
        E: miss.length,
        miss,
        d: Object.keys(linkMap).length > 0 ? 'kismi' : 'yok',
        f: linkMap,
      };

      const existingIdx = v2Catalog.findIndex((e) => e.slug === slug);
      if (existingIdx >= 0) {
        v2Catalog[existingIdx] = entry;
      } else {
        v2Catalog = [entry, ...v2Catalog];
      }
      saveV2Catalog(v2Catalog);

      res.json({ ok: true, entry, entries: v2Catalog });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'MAL / Fansub keşfi başarısız.';
      res.status(500).json({ error: message });
    }
  });

  app.post('/api/v2/catalog/auto-scan-top500', async (_req, res) => {
    try {
      if (!v2Catalog || v2Catalog.length === 0) {
        v2Catalog = loadV2Catalog();
      }
      const topList = v2Catalog.slice(0, 500);

      // Do NOT auto-enqueue downloads when scanning. Only scan/verify catalog entries and seasons/episodes.
      saveV2Catalog(v2Catalog);

      res.json({
        ok: true,
        discoveredCount: topList.length,
        enqueuedCount: 0,
        entries: v2Catalog,
        jobs: v2Downloader.listJobs(),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Top 500 tarama hatası.';
      res.status(500).json({ error: message });
    }
  });

  app.get('/api/v2/downloads', (_req, res) => {
    res.json({
      jobs: v2Downloader.listJobs(),
      queuePaused: v2Downloader.isQueuePaused(),
      history: v2History,
    });
  });

  app.post('/api/v2/downloads/enqueue', (req, res) => {
    const items = Array.isArray(req.body?.items) ? req.body.items : [];
    const forceRedownload = Boolean(req.body?.forceRedownload);
    const skipAlreadyDownloaded = !forceRedownload && req.body?.skipAlreadyDownloaded !== false;
    if (!items.length) {
      res.status(400).json({ error: 'Kuyruğa eklenecek V2 bölüm seçilmedi.' });
      return;
    }
    const { created, skippedExisting } = v2Downloader.enqueue(items, {
      skipAlreadyDownloaded,
      forceRedownload,
    });
    res.json({
      created,
      skippedExisting,
      jobs: v2Downloader.listJobs(),
      queuePaused: v2Downloader.isQueuePaused(),
    });
  });

  app.post('/api/v2/downloads/pause-all', (_req, res) => {
    v2Downloader.pauseAll();
    res.json({ jobs: v2Downloader.listJobs(), queuePaused: v2Downloader.isQueuePaused() });
  });

  app.post('/api/v2/downloads/resume-all', (_req, res) => {
    v2Downloader.resumeAll();
    res.json({ jobs: v2Downloader.listJobs(), queuePaused: v2Downloader.isQueuePaused() });
  });

  app.post('/api/v2/downloads/cancel-all', (_req, res) => {
    v2Downloader.cancelAll();
    res.json({ jobs: v2Downloader.listJobs(), queuePaused: v2Downloader.isQueuePaused() });
  });

  app.post('/api/v2/downloads/:id/pause', (req, res) => {
    const job = v2Downloader.pauseJob(req.params.id);
    if (!job) {
      res.status(404).json({ error: 'İş bulunamadı.' });
      return;
    }
    res.json({ job, jobs: v2Downloader.listJobs(), queuePaused: v2Downloader.isQueuePaused() });
  });

  app.post('/api/v2/downloads/:id/resume', (req, res) => {
    const job = v2Downloader.resumeJob(req.params.id);
    if (!job) {
      res.status(404).json({ error: 'İş bulunamadı.' });
      return;
    }
    res.json({ job, jobs: v2Downloader.listJobs(), queuePaused: v2Downloader.isQueuePaused() });
  });

  app.post('/api/v2/downloads/:id/cancel', (req, res) => {
    const job = v2Downloader.cancelJob(req.params.id);
    if (!job) {
      res.status(404).json({ error: 'İş bulunamadı.' });
      return;
    }
    res.json({ job, jobs: v2Downloader.listJobs(), queuePaused: v2Downloader.isQueuePaused() });
  });

  app.post('/api/v2/downloads/:id/retry', (req, res) => {
    const job = v2Downloader.retryJob(req.params.id);
    if (!job) {
      res.status(404).json({ error: 'İş bulunamadı.' });
      return;
    }
    res.json({ job, jobs: v2Downloader.listJobs(), queuePaused: v2Downloader.isQueuePaused() });
  });

  app.delete('/api/v2/downloads/:id', (req, res) => {
    const removeFile = req.query.removeFile === '1';
    const ok = v2Downloader.deleteJob(req.params.id, removeFile);
    if (!ok) {
      res.status(404).json({ error: 'İş bulunamadı.' });
      return;
    }
    res.json({ ok: true, jobs: v2Downloader.listJobs() });
  });

  app.post('/api/v2/downloads/clear-finished', (_req, res) => {
    v2Downloader.clearFinished();
    res.json({ jobs: v2Downloader.listJobs() });
  });

  app.post('/api/v2/drive/sync-folder', async (req, res) => {
    const bearer = extractBearerToken(req);
    const token = bearer || downloader.getDriveToken();
    const rawFolder = typeof req.body?.folderId === 'string' ? req.body.folderId : settings.driveFolderId;
    const folderId = parseDriveFolderId(rawFolder) || DEFAULT_DRIVE_FOLDER_ID;
    try {
      const result = await scanDriveFolderAuto({
        token,
        rootFolderId: folderId,
        catalog: v2Catalog,
      });
      let newlyImported = 0;
      for (const rec of result.records) {
        if (!v2History[rec.key]) {
          newlyImported++;
          v2History[rec.key] = rec;
        }
      }
      if (newlyImported > 0) {
        saveV2History(v2History);
      }
      v2Downloader.markEpisodesSyncedFromDrive(result.records.map((r) => v2History[r.key] || r));
      res.json({
        ok: true,
        scannedFolders: result.scannedFolders,
        matchedFiles: result.matchedFiles,
        newlyImported,
        history: v2History,
        jobs: v2Downloader.listJobs(),
        driveSession: getFullDriveSessionSummary(),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'V2 Drive taraması başarısız.';
      res.status(400).json({ error: message });
    }
  });

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`AnimeArşiv İndirici sunucusu http://localhost:${PORT} adresinde çalışıyor`);
  });
}

startServer().catch((err) => {
  console.error('Sunucu başlatılamadı:', err);
  process.exit(1);
});
