import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CatalogTable } from './components/CatalogTable.tsx';
import { CompletedView } from './components/CompletedView.tsx';
import { ConfirmModal, type ConfirmDialogState } from './components/ConfirmModal.tsx';
import { DownloadQueueView } from './components/DownloadQueueView.tsx';
import { FilterSidebar } from './components/FilterSidebar.tsx';
import { ImportReportView } from './components/ImportReportView.tsx';
import { V2CatalogView } from './components/V2CatalogView.tsx';
import { TopBar, type ActiveTab } from './components/TopBar.tsx';
import {
  clearCachedDriveToken,
  getDriveAccessToken,
  initDriveAuth,
  signInWithGoogleDrive,
  signOutGoogleDrive,
} from './lib/driveAuth.ts';
import { DEFAULT_SETTINGS, isAnimeCompleted } from './shared/playerPriority.ts';
import {
  collectAvailableFormats,
  collectAvailablePlayers,
  computeCatalogStats,
} from './shared/reportParser.ts';
import type {
  AnimeEntry,
  CatalogScanStatus,
  DownloadedRecord,
  DownloadJob,
  DownloadSettings,
  DriveSessionSummary,
  DriveSyncStatus,
  EpisodeProbeSummary,
  FallbackSiteReport,
  FilterState,
} from './shared/types.ts';

const INITIAL_FILTERS: FilterState = {
  search: '',
  missingCount: 'all',
  archiveStatus: 'all',
  format: '',
  player: '',
  sortBy: 'title',
  showCompleted: false,
};

export default function App() {
  const [activeTab, setActiveTab] = useState<ActiveTab>('catalog');
  const [entries, setEntries] = useState<AnimeEntry[]>([]);
  const [settings, setSettings] = useState<DownloadSettings>(DEFAULT_SETTINGS);
  const [probeCache, setProbeCache] = useState<Record<string, EpisodeProbeSummary>>({});
  const [probingKeys, setProbingKeys] = useState<Record<string, boolean>>({});
  const [fallbackReports, setFallbackReports] = useState<Record<string, FallbackSiteReport[]>>({});
  const [searchingFallbackKeys, setSearchingFallbackKeys] = useState<Record<string, boolean>>({});
  const [isBatchSearchingFallback, setIsBatchSearchingFallback] = useState(false);
  const [catalogScanStatus, setCatalogScanStatus] = useState<CatalogScanStatus | null>(null);
  const [jobs, setJobs] = useState<DownloadJob[]>([]);
  const [queuePaused, setQueuePaused] = useState(false);
  const [history, setHistory] = useState<Record<string, DownloadedRecord>>({});
  const [filters, setFilters] = useState<FilterState>(INITIAL_FILTERS);
  const [selectedSlugs, setSelectedSlugs] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [errorBanner, setErrorBanner] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [darkMode, setDarkMode] = useState(false);

  const [v2Entries, setV2Entries] = useState<AnimeEntry[]>([]);
  const [v2Jobs, setV2Jobs] = useState<DownloadJob[]>([]);
  const [v2History, setV2History] = useState<Record<string, DownloadedRecord>>({});
  const [isSyncingV2, setIsSyncingV2] = useState(false);

  // Google Drive Auth state (OAuth access token stays strictly in memory)
  const [driveConnected, setDriveConnected] = useState(false);
  const [driveSessionExpired, setDriveSessionExpired] = useState(false);
  const [driveUserEmail, setDriveUserEmail] = useState<string | null>(null);
  const [firebaseUserEmail, setFirebaseUserEmail] = useState<string | null>(null);
  const [driveFolderName, setDriveFolderName] = useState<string | null>(null);
  const [driveFolderWarning, setDriveFolderWarning] = useState<string | null>(null);
  const [pendingDriveCount, setPendingDriveCount] = useState(0);
  const [missingLocalDriveCount, setMissingLocalDriveCount] = useState(0);
  const [isDriveLoggingIn, setIsDriveLoggingIn] = useState(false);
  const [isSyncingDrive, setIsSyncingDrive] = useState(false);
  const [isUploadingPendingDrive, setIsUploadingPendingDrive] = useState(false);
  const [driveSyncStatus, setDriveSyncStatus] = useState<DriveSyncStatus | null>(null);

  const driveFolderIdRef = useRef(settings.driveFolderId);
  driveFolderIdRef.current = settings.driveFolderId;
  const hadFirebaseUserRef = useRef(false);

  // Explicit confirmation dialog for destructive/mutating operations
  const [confirmDialog, setConfirmDialog] = useState<ConfirmDialogState | null>(null);
  const [confirmBusy, setConfirmBusy] = useState(false);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', darkMode);
  }, [darkMode]);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => {
      setToast((cur) => (cur === msg ? null : cur));
    }, 4200);
  }, []);

  const applyDriveSession = useCallback((session?: DriveSessionSummary | null) => {
    if (!session) return;
    setDriveConnected(Boolean(session.connected));
    setDriveSessionExpired(Boolean(session.expired));
    if (session.userEmail) {
      setDriveUserEmail(session.userEmail);
    } else if (!session.connected && !session.expired) {
      setDriveUserEmail((cur) => cur);
    }
    if (session.folderName) {
      setDriveFolderName(session.folderName);
    } else if (!session.connected) {
      setDriveFolderName(null);
    }
    setPendingDriveCount(Number(session.pendingDriveCount) || 0);
    setMissingLocalDriveCount(Number(session.missingLocalDriveCount) || 0);
    if (session.syncStatus) {
      setDriveSyncStatus(session.syncStatus);
    }
  }, []);

  const refreshDriveStatus = useCallback(
    async (verify = false) => {
      try {
        const res = await fetch(`/api/drive/status${verify ? '?verify=1' : ''}`);
        if (res.ok) {
          const data = (await res.json()) as DriveSessionSummary;
          applyDriveSession(data);
        }
      } catch {
        // ignore transient errors
      }
    },
    [applyDriveSession],
  );

  const syncDriveTokenToServer = useCallback(
    async (token: string, folderId: string) => {
      try {
        const res = await fetch('/api/drive/session', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ folderId }),
        });
        const data = await res.json().catch(() => ({}));
        if (res.status === 401) {
          clearCachedDriveToken();
          setDriveConnected(false);
          setDriveSessionExpired(true);
          if (data.driveSession) applyDriveSession(data.driveSession);
          showToast(data.error || 'Google Drive oturum süresi dolmuş, lütfen tekrar bağlanın.');
          return;
        }
        if (res.ok) {
          setDriveConnected(Boolean(data.connected));
          setDriveSessionExpired(false);
          setDriveFolderName(data.folder?.name || null);
          setDriveFolderWarning(data.folderWarning || null);
          if (data.folder?.userEmail) setDriveUserEmail(data.folder.userEmail);
          if (data.driveSession) applyDriveSession(data.driveSession);
          if (Number(data.pendingDriveCount) > 0) {
            showToast(
              `Bekleyen ${data.pendingDriveCount} bölüm Google Drive'a otomatik aktarılıyor...`,
            );
          }
        }
      } catch {
        // ignore transient errors
      }
    },
    [applyDriveSession, showToast],
  );

  useEffect(() => {
    const unsubscribe = initDriveAuth(
      (user, token) => {
        hadFirebaseUserRef.current = true;
        const email = user.email || user.displayName || 'Google Hesabı';
        setFirebaseUserEmail(email);
        setDriveUserEmail(email);
        setDriveConnected(true);
        setDriveSessionExpired(false);
        void syncDriveTokenToServer(token, driveFolderIdRef.current);
      },
      (reason, user) => {
        if (reason === 'needs_token' && user) {
          // Reload / reconnect: user is still logged into Firebase; DO NOT wipe server RAM token!
          hadFirebaseUserRef.current = true;
          const email = user.email || user.displayName || null;
          setFirebaseUserEmail(email);
          setDriveUserEmail((cur) => cur || email);
          void refreshDriveStatus(true);
          return;
        }
        // Only clear server session if this browser session actually had a signed-in user who signed out
        if (hadFirebaseUserRef.current) {
          hadFirebaseUserRef.current = false;
          setFirebaseUserEmail(null);
          setDriveConnected(false);
          setDriveSessionExpired(false);
          setDriveUserEmail(null);
          setDriveFolderName(null);
          setDriveFolderWarning(null);
          void fetch('/api/drive/session/clear', { method: 'POST' }).catch(() => {});
        } else {
          setFirebaseUserEmail(null);
          void refreshDriveStatus(false);
        }
      },
    );
    return unsubscribe;
  }, [refreshDriveStatus, syncDriveTokenToServer]);

  // Verify Drive token status periodically & on tab focus so 1h expiry is detected promptly
  useEffect(() => {
    const onFocusOrVisible = () => {
      if (document.visibilityState === 'visible') {
        void refreshDriveStatus(true);
      }
    };
    window.addEventListener('focus', onFocusOrVisible);
    document.addEventListener('visibilitychange', onFocusOrVisible);
    const timer = setInterval(() => {
      if (driveConnected) {
        void refreshDriveStatus(true);
      }
    }, 60_000);
    return () => {
      window.removeEventListener('focus', onFocusOrVisible);
      document.removeEventListener('visibilitychange', onFocusOrVisible);
      clearInterval(timer);
    };
  }, [driveConnected, refreshDriveStatus]);

  const handleDriveSignIn = async () => {
    setIsDriveLoggingIn(true);
    try {
      const { user, accessToken } = await signInWithGoogleDrive(
        firebaseUserEmail || driveUserEmail,
      );
      hadFirebaseUserRef.current = true;
      const email = user.email || user.displayName || 'Google Hesabı';
      setFirebaseUserEmail(email);
      setDriveConnected(true);
      setDriveSessionExpired(false);
      setDriveUserEmail(email);
      await syncDriveTokenToServer(accessToken, settings.driveFolderId);
      showToast('Google Drive bağlantısı kuruldu.');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Google ile giriş yapılamadı.');
    } finally {
      setIsDriveLoggingIn(false);
    }
  };

  const handleDriveSignOut = async () => {
    hadFirebaseUserRef.current = false;
    await signOutGoogleDrive();
    await fetch('/api/drive/session/clear', { method: 'POST' }).catch(() => {});
    setDriveConnected(false);
    setDriveSessionExpired(false);
    setFirebaseUserEmail(null);
    setDriveUserEmail(null);
    setDriveFolderName(null);
    setDriveFolderWarning(null);
    showToast('Google Drive bağlantısı kapatıldı.');
  };

  const buildDriveHeaders = useCallback((json = false): Record<string, string> => {
    const headers: Record<string, string> = {};
    if (json) headers['Content-Type'] = 'application/json';
    const token = getDriveAccessToken();
    if (token) headers.Authorization = `Bearer ${token}`;
    return headers;
  }, []);

  const handleDriveAuthFailure = useCallback(
    (data: { error?: string; driveSession?: DriveSessionSummary }) => {
      clearCachedDriveToken();
      setDriveConnected(false);
      setDriveSessionExpired(true);
      if (data.driveSession) applyDriveSession(data.driveSession);
      showToast(
        data.error || "Google Drive oturum süresi doldu (~1 saat). Yeniden bağlanmanız gerekiyor.",
      );
    },
    [applyDriveSession, showToast],
  );

  const handleDriveTestFolder = async (folderId: string) => {
    try {
      const res = await fetch('/api/drive/test-folder', {
        method: 'POST',
        headers: buildDriveHeaders(true),
        body: JSON.stringify({ folderId }),
      });
      const data = await res.json();
      if (res.status === 401 && (driveConnected || getDriveAccessToken())) {
        handleDriveAuthFailure(data);
        return;
      }
      if (!res.ok) {
        setDriveFolderName(null);
        setDriveFolderWarning(data.error || 'Klasör doğrulanamadı.');
      } else {
        if (data.folder?.name) setDriveFolderName(data.folder.name);
        setDriveFolderWarning(null);
        if (data.history) setHistory(data.history);
        if (Array.isArray(data.jobs)) setJobs(data.jobs);
        if (data.driveSession) applyDriveSession(data.driveSession);
        if (data.syncResult) {
          showToast(
            `Drive klasörü tarandı: ${data.syncResult.matchedFiles} bölüm eşleşti (${data.syncResult.newlyImported} yeni eklendi).`,
          );
        } else {
          showToast(`Drive hedef klasörü doğrulandı: ${data.folder?.name || folderId}`);
        }
      }
    } catch {
      setDriveFolderWarning('Klasör doğrulanırken hata oluştu.');
    }
  };

  const handleSyncDriveFolder = async () => {
    setIsSyncingDrive(true);
    try {
      const res = await fetch('/api/drive/sync-folder', {
        method: 'POST',
        headers: buildDriveHeaders(true),
        body: JSON.stringify({ folderId: settings.driveFolderId }),
      });
      const data = await res.json();
      if (res.status === 401 && (driveConnected || getDriveAccessToken())) {
        handleDriveAuthFailure(data);
        return;
      }
      if (!res.ok) throw new Error(data.error || 'Drive klasörü taranamadı.');
      if (data.history) setHistory(data.history);
      if (Array.isArray(data.jobs)) setJobs(data.jobs);
      if (data.driveSession) applyDriveSession(data.driveSession);
      showToast(
        `${data.scannedFolders} anime klasörü tarandı · ${data.matchedFiles} bölüm Drive'da bulundu (${data.newlyImported} yeni eklendi).`,
      );
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Drive klasörü taranamadı.');
    } finally {
      setIsSyncingDrive(false);
    }
  };

  const handleUploadPendingToDrive = async () => {
    if (!getDriveAccessToken() && !driveConnected) {
      showToast('Önce Google Drive ile giriş yapmalısınız.');
      return;
    }
    setIsUploadingPendingDrive(true);
    try {
      const res = await fetch('/api/drive/upload-pending', {
        method: 'POST',
        headers: buildDriveHeaders(true),
        body: JSON.stringify({ includeSkipped: true }),
      });
      const data = await res.json();
      if (res.status === 401) {
        handleDriveAuthFailure(data);
        return;
      }
      if (!res.ok) throw new Error(data.error || 'Bekleyen Drive yüklemesi başlatılamadı.');
      if (Array.isArray(data.jobs)) setJobs(data.jobs);
      if (data.history) setHistory(data.history);
      if (data.driveSession) applyDriveSession(data.driveSession);
      if (Number(data.queuedUploadCount) > 0) {
        showToast(`Bekleyen ${data.queuedUploadCount} bölüm Google Drive'a yükleniyor...`);
      } else {
        showToast("Drive'a yüklenmeyi bekleyen yerel dosya bulunamadı.");
      }
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Bekleyen yükleme başlatılamadı.');
    } finally {
      setIsUploadingPendingDrive(false);
    }
  };

  const refreshCatalogEntries = useCallback(async () => {
    try {
      const res = await fetch('/api/catalog');
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.entries)) setEntries(data.entries);
        if (data.history) setHistory(data.history);
        if (data.driveSession) applyDriveSession(data.driveSession);
      }
    } catch {
      // ignore transient error
    }
  }, [applyDriveSession]);

  const loadInitialData = useCallback(async () => {
    setLoading(true);
    setErrorBanner(null);
    try {
      const [catRes, dlRes, scanRes, v2Res] = await Promise.all([
        fetch('/api/catalog'),
        fetch('/api/downloads'),
        fetch('/api/fallback/scan-status'),
        fetch('/api/v2/catalog'),
      ]);
      if (!catRes.ok) throw new Error('Katalog sunucudan alınamadı.');
      const catData = await catRes.json();
      setEntries(Array.isArray(catData.entries) ? catData.entries : []);
      if (catData.settings) setSettings(catData.settings);
      if (catData.probeCache) setProbeCache(catData.probeCache);
      if (catData.history) setHistory(catData.history);
      if (catData.driveSession) applyDriveSession(catData.driveSession);

      if (dlRes.ok) {
        const dlData = await dlRes.json();
        setJobs(Array.isArray(dlData.jobs) ? dlData.jobs : []);
        setQueuePaused(Boolean(dlData.queuePaused));
        if (dlData.history) setHistory(dlData.history);
        if (dlData.driveSession) applyDriveSession(dlData.driveSession);
      }
      if (scanRes.ok) {
        const scanData = await scanRes.json();
        if (scanData.status) setCatalogScanStatus(scanData.status);
      }
      if (v2Res.ok) {
        const v2Data = await v2Res.json();
        if (Array.isArray(v2Data.entries)) setV2Entries(v2Data.entries);
        if (v2Data.history) setV2History(v2Data.history);
        if (Array.isArray(v2Data.jobs)) setV2Jobs(v2Data.jobs);
      }
    } catch (err) {
      setErrorBanner(err instanceof Error ? err.message : 'Veri yüklenemedi.');
    } finally {
      setLoading(false);
    }
  }, [applyDriveSession]);

  useEffect(() => {
    void loadInitialData();
  }, [loadInitialData]);

  // Prune selections automatically if an anime reaches completion
  useEffect(() => {
    if (selectedSlugs.size === 0) return;
    const bySlug = new Map(entries.map((e) => [e.slug, e]));
    let changed = false;
    const next = new Set<string>();
    for (const slug of selectedSlugs) {
      const entry = bySlug.get(slug);
      if (entry && !isAnimeCompleted(entry, history)) {
        next.add(slug);
      } else if (entry) {
        changed = true;
      }
    }
    if (changed) {
      setSelectedSlugs(next);
    }
  }, [entries, history, selectedSlugs]);

  const hasActiveJobs = useMemo(
    () =>
      jobs.some((j) =>
        ['queued', 'probing', 'downloading', 'muxing', 'uploading_drive'].includes(j.status),
      ),
    [jobs],
  );

  useEffect(() => {
    if (!hasActiveJobs && !driveSyncStatus?.syncing) return;
    const timer = setInterval(async () => {
      try {
        const res = await fetch('/api/downloads');
        if (res.ok) {
          const data = await res.json();
          if (Array.isArray(data.jobs)) setJobs(data.jobs);
          setQueuePaused(Boolean(data.queuePaused));
          if (data.history) setHistory(data.history);
          if (data.driveSession) applyDriveSession(data.driveSession);
        }
      } catch {
        // ignore transient polling error
      }
    }, 1200);
    return () => clearInterval(timer);
  }, [applyDriveSession, driveSyncStatus?.syncing, hasActiveJobs]);

  useEffect(() => {
    if (!catalogScanStatus?.running) return;
    let lastAdded = catalogScanStatus.addedLinksCount;
    const timer = setInterval(async () => {
      try {
        const res = await fetch('/api/fallback/scan-status');
        if (!res.ok) return;
        const data = await res.json();
        const st = data.status as CatalogScanStatus | undefined;
        if (!st) return;
        setCatalogScanStatus(st);
        if (st.addedLinksCount !== lastAdded || !st.running) {
          lastAdded = st.addedLinksCount;
          await refreshCatalogEntries();
        }
        if (!st.running) {
          showToast(
            st.addedLinksCount > 0
              ? `Fansub taraması tamamlandı: ${st.updatedAnimeCount} animede +${st.addedLinksCount} link eklendi.`
              : 'Fansub taraması tamamlandı.',
          );
        }
      } catch {
        // ignore transient error
      }
    }, 1500);
    return () => clearInterval(timer);
  }, [catalogScanStatus?.running, catalogScanStatus?.addedLinksCount, refreshCatalogEntries, showToast]);

  const stats = useMemo(() => computeCatalogStats(entries), [entries]);
  const availableFormats = useMemo(() => collectAvailableFormats(entries), [entries]);
  const availablePlayers = useMemo(() => collectAvailablePlayers(entries), [entries]);

  const selectedEpisodesCount = useMemo(() => {
    let count = 0;
    for (const anime of entries) {
      if (!selectedSlugs.has(anime.slug)) continue;
      for (const ep of anime.miss) {
        if (history[`${anime.slug}:${ep}`]) continue;
        if ((anime.f[ep] ?? []).length > 0 || settings.autoFallbackSearch) {
          count++;
        }
      }
    }
    return count;
  }, [entries, history, selectedSlugs, settings.autoFallbackSearch]);

  const activeDownloadsCount = useMemo(
    () =>
      jobs.filter((j) =>
        ['queued', 'paused', 'probing', 'downloading', 'muxing', 'uploading_drive'].includes(
          j.status,
        ),
      ).length,
    [jobs],
  );

  const completedCount = useMemo(() => Object.keys(history).length, [history]);

  const handleUpdateSettings = async (next: DownloadSettings) => {
    setSettings(next);
    try {
      const res = await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(next),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.settings) setSettings(data.settings);
        if (data.driveSession) applyDriveSession(data.driveSession);
      }
    } catch {
      // ignore
    }
  };

  const handleProbeEpisode = async (slug: string, episode: string, forceRefresh = false) => {
    const key = `${slug}:${episode}`;
    setProbingKeys((prev) => ({ ...prev, [key]: true }));
    try {
      const res = await fetch('/api/probe/episode', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug, episode, forceRefresh }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Tarama başarısız.');
      if (data.summary) {
        setProbeCache((prev) => ({ ...prev, [key]: data.summary }));
      }
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Oynatıcı taraması başarısız.');
    } finally {
      setProbingKeys((prev) => ({ ...prev, [key]: false }));
    }
  };

  const handleFallbackSearchEpisode = async (slug: string, episode: string) => {
    const key = `${slug}:${episode}`;
    setSearchingFallbackKeys((prev) => ({ ...prev, [key]: true }));
    try {
      const res = await fetch('/api/fallback/search-episode', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug, episode }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Harici kaynak araması başarısız.');

      if (data.entry) {
        setEntries((prev) => prev.map((item) => (item.slug === slug ? data.entry : item)));
      }
      if (data.addedCount > 0) {
        setProbeCache((prev) => {
          const next = { ...prev };
          delete next[key];
          return next;
        });
        showToast(`Bölüm ${episode} için ${data.addedCount} yeni oynatıcı kaynağı eklendi.`);
      } else {
        showToast('Yeni harici kaynak bulunamadı — site sonuçlarını inceleyebilirsiniz.');
      }
      if (Array.isArray(data.reports)) {
        setFallbackReports((prev) => ({ ...prev, [key]: data.reports }));
      }
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Harici kaynak araması başarısız.');
    } finally {
      setSearchingFallbackKeys((prev) => ({ ...prev, [key]: false }));
    }
  };

  const handleFallbackSearchSelected = async () => {
    const slugs = Array.from(selectedSlugs);
    if (!slugs.length) return;
    setIsBatchSearchingFallback(true);
    let totalAdded = 0;
    try {
      showToast(`${slugs.length} anime için fansublar taranıyor...`);
      for (const slug of slugs) {
        const res = await fetch('/api/fallback/search-anime', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ slug }),
        });
        if (res.ok) {
          const data = await res.json();
          totalAdded += Number(data.addedCount) || 0;
          if (data.entry) {
            setEntries((prev) => prev.map((item) => (item.slug === slug ? data.entry : item)));
          }
        }
      }
      showToast(
        totalAdded > 0
          ? `Toplam ${totalAdded} yeni fansub kaynağı kataloğa eklendi.`
          : 'Seçili animeler için yeni harici link bulunamadı.',
      );
    } finally {
      setIsBatchSearchingFallback(false);
    }
  };

  const handleStartCatalogScan = async (mode: 'incomplete' | 'all') => {
    try {
      const res = await fetch('/api/fallback/scan-catalog', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Tarama başlatılamadı.');
      if (data.status) setCatalogScanStatus(data.status);
      if (data.status?.totalAnime === 0) {
        showToast('Taranacak linki eksik anime bulunamadı.');
      } else {
        showToast(`${data.status?.totalAnime ?? 0} anime için arka plan fansub taraması başladı.`);
      }
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Tarama başlatılamadı.');
    }
  };

  const handleCancelCatalogScan = async () => {
    try {
      await fetch('/api/fallback/scan-cancel', { method: 'POST' });
      showToast('Fansub taraması durduruluyor...');
    } catch {
      // ignore
    }
  };

  const enqueueItems = async (
    items: Array<{ slug: string; episode: string; preferUrl?: string }>,
    skipAlreadyDownloaded = true,
    forceRedownload = false,
  ) => {
    if (!items.length) {
      showToast('Seçili animelerde eklenecek yeni eksik bölüm bulunamadı.');
      return;
    }
    try {
      const res = await fetch('/api/downloads/enqueue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items, skipAlreadyDownloaded, forceRedownload }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Kuyruğa eklenemedi.');
      if (Array.isArray(data.jobs)) setJobs(data.jobs);
      setQueuePaused(Boolean(data.queuePaused));
      const addedLen = Array.isArray(data.created) ? data.created.length : items.length;
      const skipped = Number(data.skippedExisting) || 0;
      if (addedLen === 0 && skipped > 0) {
        showToast(`${skipped} bölüm zaten tamamlandığı / Drive'da olduğu için atlandı.`);
      } else {
        showToast(
          skipped > 0
            ? `${addedLen} bölüm kuyruğa eklendi (${skipped} zaten indirilen atlandı).`
            : `${addedLen} eksik bölüm indirme kuyruğuna eklendi.`,
        );
      }
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Kuyruğa ekleme hatası.');
    }
  };

  const handleEnqueueEpisode = (
    slug: string,
    episode: string,
    preferUrl?: string,
    forceRedownload = false,
  ) => {
    void enqueueItems([{ slug, episode, preferUrl }], !forceRedownload, forceRedownload);
  };

  const handleEnqueueV2Episode = async (slug: string, episode: string, forceRedownload = false) => {
    try {
      const res = await fetch('/api/v2/downloads/enqueue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items: [{ slug, episode }],
          skipAlreadyDownloaded: !forceRedownload,
          forceRedownload,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'V2 kuyruğa eklenemedi.');
      if (Array.isArray(data.jobs)) setV2Jobs(data.jobs);
      showToast(`V2 Bölüm ${episode} indirme kuyruğuna eklendi.`);
      setActiveTab('queue');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'V2 Kuyruk hatası');
    }
  };

  const handleEnqueueV2Selected = async (slugs: string[]) => {
    const items: Array<{ slug: string; episode: string }> = [];
    const bySlug = new Map(v2Entries.map((e) => [e.slug, e]));
    for (const slug of slugs) {
      const anime = bySlug.get(slug);
      if (!anime) continue;
      for (const ep of anime.miss) {
        if (v2History[`${slug}:${ep}`]) continue;
        items.push({ slug, episode: ep });
      }
    }
    if (!items.length) {
      showToast('Seçilen V2 serilerinde eklenecek yeni bölüm kalmadı.');
      return;
    }
    try {
      const res = await fetch('/api/v2/downloads/enqueue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items, skipAlreadyDownloaded: true }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'V2 toplu kuyruk hatası');
      if (Array.isArray(data.jobs)) setV2Jobs(data.jobs);
      showToast(`Seçilen serilerden ${items.length} bölüm V2 indirme kuyruğuna eklendi.`);
      setActiveTab('queue');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'V2 Kuyruk hatası');
    }
  };

  const handleSyncV2Folder = async () => {
    setIsSyncingV2(true);
    try {
      const res = await fetch('/api/v2/drive/sync-folder', {
        method: 'POST',
        headers: buildDriveHeaders(true),
        body: JSON.stringify({ folderId: settings.driveFolderId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'V2 Drive taraması başarısız.');
      if (data.history) setV2History(data.history);
      if (Array.isArray(data.jobs)) setV2Jobs(data.jobs);
      showToast(`V2 Drive tarandı: ${data.matchedFiles} bölüm eşleşti (${data.newlyImported} yeni).`);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'V2 Drive taraması başarısız.');
    } finally {
      setIsSyncingV2(false);
    }
  };

  const handleAutoScanTop500 = async () => {
    try {
      showToast('MAL Top 500 serileri ve sezonları Türk fansub kaynaklarından taranıyor...');
      const res = await fetch('/api/v2/catalog/auto-scan-top500', {
        method: 'POST',
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Top 500 taraması başarısız.');
      if (Array.isArray(data.entries)) setV2Entries(data.entries);
      if (Array.isArray(data.jobs)) setV2Jobs(data.jobs);
      showToast(`Top 500 taraması tamamlandı: ${data.discoveredCount} seri incelendi. (İndirme başlatılmadı, listeyi inceleyip kuyruğa ekleyebilirsiniz).`);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Tarama hatası.');
    }
  };

  const hasActiveV2Jobs = useMemo(
    () =>
      v2Jobs.some((j) =>
        ['queued', 'probing', 'downloading', 'muxing', 'uploading_drive'].includes(j.status),
      ),
    [v2Jobs],
  );

  useEffect(() => {
    if (!hasActiveV2Jobs) return;
    const timer = setInterval(async () => {
      try {
        const res = await fetch('/api/v2/downloads');
        if (res.ok) {
          const data = await res.json();
          if (Array.isArray(data.jobs)) setV2Jobs(data.jobs);
          if (data.history) setV2History(data.history);
        }
      } catch {
        // ignore
      }
    }, 1200);
    return () => clearInterval(timer);
  }, [hasActiveV2Jobs]);

  const handleProbeSelected = async () => {
    const targets: Array<{ slug: string; episode: string }> = [];
    for (const anime of entries) {
      if (!selectedSlugs.has(anime.slug)) continue;
      for (const ep of anime.miss) {
        if ((anime.f[ep] ?? []).length > 0) {
          targets.push({ slug: anime.slug, episode: ep });
        }
      }
    }
    if (!targets.length) {
      showToast('Seçili animelerde taranabilecek link bulunamadı.');
      return;
    }
    showToast(`${targets.length} eksik bölüm için kalite taraması başlatıldı...`);
    for (const item of targets) {
      await handleProbeEpisode(item.slug, item.episode, false);
    }
    showToast(`${targets.length} bölüm taraması tamamlandı.`);
  };

  const handleEnqueueSelected = () => {
    const items: Array<{ slug: string; episode: string }> = [];
    for (const anime of entries) {
      if (!selectedSlugs.has(anime.slug)) continue;
      for (const ep of anime.miss) {
        if (history[`${anime.slug}:${ep}`]) continue;
        if ((anime.f[ep] ?? []).length > 0 || settings.autoFallbackSearch) {
          items.push({ slug: anime.slug, episode: ep });
        }
      }
    }
    void enqueueItems(items, true);
    if (items.length > 0) {
      setActiveTab('queue');
    }
  };

  const handlePauseAll = async () => {
    const res = await fetch('/api/downloads/pause-all', { method: 'POST' });
    if (res.ok) {
      const data = await res.json();
      setJobs(data.jobs);
      setQueuePaused(Boolean(data.queuePaused));
      showToast('Tüm indirmeler duraklatıldı.');
    }
  };

  const handleResumeAll = async () => {
    const res = await fetch('/api/downloads/resume-all', { method: 'POST' });
    if (res.ok) {
      const data = await res.json();
      setJobs(data.jobs);
      setQueuePaused(Boolean(data.queuePaused));
      showToast('Kuyruktaki indirmeler devam ettiriliyor.');
    }
  };

  const handleRetryFailedJobs = async () => {
    const res = await fetch('/api/downloads/retry-failed', { method: 'POST' });
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data.jobs)) setJobs(data.jobs);
      setQueuePaused(Boolean(data.queuePaused));
      if (data.driveSession) applyDriveSession(data.driveSession);
      showToast(`${Number(data.requeuedCount) || 0} hatalı görev tekrar kuyruğa alındı.`);
    }
  };

  const handleCancelAllRequest = () => {
    setConfirmDialog({
      title: 'Tüm Aktif İndirmeler İptal Edilsin mi?',
      description:
        'Sıradaki, duraklatılmış ve devam eden tüm indirme görevleri iptal edilecek. Daha sonra Tekrar Dene ile yeniden başlatabilirsiniz.',
      confirmLabel: 'Tümünü İptal Et',
      tone: 'danger',
      onConfirm: async () => {
        setConfirmBusy(true);
        try {
          const res = await fetch('/api/downloads/cancel-all', { method: 'POST' });
          if (res.ok) {
            const data = await res.json();
            setJobs(data.jobs);
            setQueuePaused(Boolean(data.queuePaused));
            showToast('Aktif indirmeler iptal edildi.');
          }
        } finally {
          setConfirmBusy(false);
          setConfirmDialog(null);
        }
      },
    });
  };

  const handlePauseJob = async (id: string) => {
    const res = await fetch(`/api/downloads/${encodeURIComponent(id)}/pause`, { method: 'POST' });
    if (res.ok) {
      const data = await res.json();
      setJobs(data.jobs);
      setQueuePaused(Boolean(data.queuePaused));
    }
  };

  const handleResumeJob = async (id: string) => {
    const res = await fetch(`/api/downloads/${encodeURIComponent(id)}/resume`, { method: 'POST' });
    if (res.ok) {
      const data = await res.json();
      setJobs(data.jobs);
      setQueuePaused(Boolean(data.queuePaused));
    }
  };

  const handleCancelJob = async (id: string) => {
    const res = await fetch(`/api/downloads/${encodeURIComponent(id)}/cancel`, {
      method: 'POST',
    });
    if (res.ok) {
      const data = await res.json();
      setJobs(data.jobs);
      setQueuePaused(Boolean(data.queuePaused));
    }
  };

  const handleRetryJob = async (id: string) => {
    const res = await fetch(`/api/downloads/${encodeURIComponent(id)}/retry`, {
      method: 'POST',
    });
    if (res.ok) {
      const data = await res.json();
      setJobs(data.jobs);
      setQueuePaused(Boolean(data.queuePaused));
    }
  };

  const handleDeleteJob = async (id: string, removeFile = false) => {
    const res = await fetch(
      `/api/downloads/${encodeURIComponent(id)}${removeFile ? '?removeFile=1' : ''}`,
      { method: 'DELETE' },
    );
    if (res.ok) {
      const data = await res.json();
      setJobs(data.jobs);
    }
  };

  const handleDeleteJobConfirmed = (id: string, removeFile: boolean, title: string) => {
    setConfirmDialog({
      title: 'İndirilen Dosya ve İş Silinsin mi?',
      description: `"${title}" kaydı kuyruktan${removeFile ? ' ve sunucu diskinden' : ''} kaldırılacak.`,
      confirmLabel: 'Evet, Sil',
      tone: 'danger',
      onConfirm: async () => {
        setConfirmBusy(true);
        try {
          await handleDeleteJob(id, removeFile);
          showToast('Kayıt kaldırıldı.');
        } finally {
          setConfirmBusy(false);
          setConfirmDialog(null);
        }
      },
    });
  };

  const handleUploadJobToDrive = async (jobId: string) => {
    if (!getDriveAccessToken() && !driveConnected) {
      showToast('Önce Google Drive ile giriş yapmalısınız.');
      return;
    }
    showToast("Google Drive'a yükleme başlatıldı...");
    try {
      const res = await fetch(`/api/drive/upload/${encodeURIComponent(jobId)}`, {
        method: 'POST',
        headers: buildDriveHeaders(false),
      });
      const data = await res.json();
      if (Array.isArray(data.jobs)) setJobs(data.jobs);
      if (data.history) setHistory(data.history);
      if (data.driveSession) applyDriveSession(data.driveSession);
      if (res.status === 401) {
        handleDriveAuthFailure(data);
        return;
      }
      if (!res.ok) throw new Error(data.error || 'Drive yüklemesi başarısız.');
      showToast("Bölüm başarıyla Google Drive'a yüklendi.");
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Drive yüklemesi başarısız.');
    }
  };

  const handleDeleteDriveFileRequest = (fileId: string, historyKey: string, title: string) => {
    setConfirmDialog({
      title: "Google Drive Dosyası Silinsin mi?",
      description: `"${title}" dosyası Google Drive hesabınızdan kalıcı olarak silinecek. Bu işlem geri alınamaz.`,
      confirmLabel: "Drive'dan Sil",
      tone: 'danger',
      onConfirm: async () => {
        if (!getDriveAccessToken() && !driveConnected) {
          showToast('Önce Google ile giriş yapmalısınız.');
          setConfirmDialog(null);
          return;
        }
        setConfirmBusy(true);
        try {
          const res = await fetch('/api/drive/delete-file', {
            method: 'POST',
            headers: buildDriveHeaders(true),
            body: JSON.stringify({ fileId, historyKey }),
          });
          const data = await res.json();
          if (res.status === 401) {
            handleDriveAuthFailure(data);
            return;
          }
          if (!res.ok) throw new Error(data.error || 'Drive dosyası silinemedi.');
          if (data.history) setHistory(data.history);
          if (Array.isArray(data.jobs)) setJobs(data.jobs);
          if (data.driveSession) applyDriveSession(data.driveSession);
          showToast('Dosya Google Drive üzerinden silindi.');
        } catch (err) {
          showToast(err instanceof Error ? err.message : 'Drive dosyası silinemedi.');
        } finally {
          setConfirmBusy(false);
          setConfirmDialog(null);
        }
      },
    });
  };

  const handleDeleteHistoryRecordRequest = (key: string, title: string) => {
    setConfirmDialog({
      title: 'İndirme Geçmişi Kaydı Silinsin mi?',
      description: `"${title}" hatırlanan indirme geçmişinden silinecek; bu bölümü tekrar kuyruğa ekleyebileceksiniz.`,
      confirmLabel: 'Geçmişten Sil',
      tone: 'danger',
      onConfirm: async () => {
        setConfirmBusy(true);
        try {
          const res = await fetch(`/api/history/${encodeURIComponent(key)}`, {
            method: 'DELETE',
          });
          if (res.ok) {
            const data = await res.json();
            if (data.history) setHistory(data.history);
            showToast('Geçmiş kaydı silindi.');
          }
        } finally {
          setConfirmBusy(false);
          setConfirmDialog(null);
        }
      },
    });
  };

  const handleClearFinished = async () => {
    const res = await fetch('/api/downloads/clear-finished', { method: 'POST' });
    if (res.ok) {
      const data = await res.json();
      setJobs(data.jobs);
    }
  };

  const handleImportReport = async (rawText: string, mode: 'replace' | 'merge') => {
    const res = await fetch('/api/catalog/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rawText, mode }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'İçe aktarma başarısız.');
    setEntries(data.entries);
    setSelectedSlugs(new Set());
    return {
      importedCount: Number(data.importedCount) || 0,
      skippedCount: Number(data.skippedCount) || 0,
    };
  };

  const handleResetCatalog = async (): Promise<number> => {
    const res = await fetch('/api/catalog/reset', { method: 'POST' });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Katalog sıfırlanamadı.');
    setEntries(data.entries);
    setSelectedSlugs(new Set());
    const count = Array.isArray(data.entries) ? data.entries.length : 0;
    showToast(`Katalog varsayılan ${count} animeye sıfırlandı.`);
    return count;
  };

  const handleAddManualEntry = async (payload: {
    t: string;
    slug: string;
    fmt: string;
    yr: string;
    episode: string;
    fansub: string;
    player: string;
    embedUrl: string;
  }) => {
    const res = await fetch('/api/catalog/add-entry', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        entry: {
          t: payload.t,
          slug: payload.slug,
          at: payload.t,
          fmt: payload.fmt,
          yr: payload.yr,
          ec: 0,
          E: Number(payload.episode) || 1,
          miss: [payload.episode],
          d: 'tam',
          f: {
            [payload.episode]: [[payload.fansub, payload.player, payload.embedUrl]],
          },
        },
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Kayıt eklenemedi.');
    setEntries(data.entries);
  };

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100">
      <TopBar
        activeTab={activeTab}
        onTabChange={setActiveTab}
        selectedEpisodesCount={selectedEpisodesCount}
        activeDownloadsCount={activeDownloadsCount}
        completedDownloadsCount={completedCount}
        onPrimaryAction={() => {
          if (selectedEpisodesCount > 0) {
            handleEnqueueSelected();
          } else {
            setActiveTab('import');
          }
        }}
        mobileSidebarOpen={mobileSidebarOpen}
        onToggleMobileSidebar={() => setMobileSidebarOpen((v) => !v)}
      />

      <ConfirmModal
        dialog={confirmDialog}
        busy={confirmBusy}
        onClose={() => {
          if (!confirmBusy) setConfirmDialog(null);
        }}
      />

      {toast && (
        <div
          role="status"
          className="fixed bottom-5 right-5 z-50 px-4 py-2.5 rounded-lg bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 text-xs font-medium shadow-lg"
        >
          {toast}
        </div>
      )}

      <main className="max-w-[1440px] mx-auto px-4 lg:px-6 py-6">
        {errorBanner && (
          <div className="mb-5 p-3 rounded-xl border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/40 text-xs text-red-700 dark:text-red-300 flex items-center justify-between">
            <span>{errorBanner}</span>
            <button
              type="button"
              onClick={() => void loadInitialData()}
              className="font-semibold underline"
            >
              Tekrar Dene
            </button>
          </div>
        )}

        <div className="flex flex-col lg:flex-row gap-6 items-stretch lg:items-start">
          <div className={`${mobileSidebarOpen ? 'block w-full' : 'hidden'} lg:block`}>
            <FilterSidebar
              filters={filters}
              onFiltersChange={(next) => {
                setFilters(next);
                if (activeTab !== 'catalog') setActiveTab('catalog');
              }}
              onResetFilters={() => setFilters(INITIAL_FILTERS)}
              availablePlayers={availablePlayers}
              settings={settings}
              onUpdateSettings={handleUpdateSettings}
              darkMode={darkMode}
              onToggleDarkMode={() => setDarkMode((d) => !d)}
              driveConnected={driveConnected}
              driveSessionExpired={driveSessionExpired}
              driveUserEmail={driveUserEmail || firebaseUserEmail}
              driveFolderName={driveFolderName}
              driveFolderWarning={driveFolderWarning}
              driveSyncStatus={driveSyncStatus}
              pendingDriveCount={pendingDriveCount}
              isDriveLoggingIn={isDriveLoggingIn}
              isSyncingDrive={isSyncingDrive || Boolean(driveSyncStatus?.syncing)}
              isUploadingPendingDrive={isUploadingPendingDrive}
              onDriveSignIn={() => void handleDriveSignIn()}
              onDriveSignOut={() => void handleDriveSignOut()}
              onDriveTestFolder={(fid) => void handleDriveTestFolder(fid)}
              onDriveSyncFolder={() => void handleSyncDriveFolder()}
              onUploadPendingToDrive={() => void handleUploadPendingToDrive()}
            />
          </div>

          {loading ? (
            <div className="flex-1 min-w-0 space-y-4 w-full">
              <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
                {[1, 2, 3, 4].map((i) => (
                  <div
                    key={i}
                    className="h-24 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 animate-pulse"
                  />
                ))}
              </div>
              <div className="h-96 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 animate-pulse" />
            </div>
          ) : activeTab === 'catalog' ? (
            <CatalogTable
              entries={entries}
              stats={stats}
              filters={filters}
              onFiltersChange={setFilters}
              onResetFilters={() => setFilters(INITIAL_FILTERS)}
              availableFormats={availableFormats}
              selectedSlugs={selectedSlugs}
              onToggleSelectSlug={(slug) => {
                setSelectedSlugs((prev) => {
                  const next = new Set(prev);
                  if (next.has(slug)) next.delete(slug);
                  else next.add(slug);
                  return next;
                });
              }}
              onSelectSlugs={(slugs) => setSelectedSlugs(new Set(slugs))}
              onClearSelection={() => setSelectedSlugs(new Set())}
              settings={settings}
              probeCache={probeCache}
              probingKeys={probingKeys}
              fallbackReports={fallbackReports}
              searchingFallbackKeys={searchingFallbackKeys}
              isBatchSearchingFallback={isBatchSearchingFallback}
              catalogScanStatus={catalogScanStatus}
              jobs={jobs}
              history={history}
              onProbeEpisode={handleProbeEpisode}
              onFallbackSearchEpisode={handleFallbackSearchEpisode}
              onFallbackSearchSelected={() => void handleFallbackSearchSelected()}
              onStartCatalogScan={(mode) => void handleStartCatalogScan(mode)}
              onCancelCatalogScan={() => void handleCancelCatalogScan()}
              onProbeSelected={() => void handleProbeSelected()}
              onEnqueueEpisode={handleEnqueueEpisode}
              onEnqueueSelected={handleEnqueueSelected}
            />
          ) : activeTab === 'queue' ? (
            <DownloadQueueView
              jobs={jobs}
              entries={entries}
              settings={settings}
              queuePaused={queuePaused}
              driveConnected={driveConnected}
              driveSessionExpired={driveSessionExpired}
              driveUserEmail={driveUserEmail || firebaseUserEmail}
              pendingDriveCount={pendingDriveCount}
              missingLocalDriveCount={missingLocalDriveCount}
              isDriveLoggingIn={isDriveLoggingIn}
              isUploadingPendingDrive={isUploadingPendingDrive}
              onDriveSignIn={() => void handleDriveSignIn()}
              onUploadPendingToDrive={() => void handleUploadPendingToDrive()}
              onPauseAll={() => void handlePauseAll()}
              onResumeAll={() => void handleResumeAll()}
              onRetryFailedJobs={() => void handleRetryFailedJobs()}
              onCancelAll={handleCancelAllRequest}
              onPauseJob={(id) => void handlePauseJob(id)}
              onResumeJob={(id) => void handleResumeJob(id)}
              onCancelJob={(id) => void handleCancelJob(id)}
              onRetryJob={(id) => void handleRetryJob(id)}
              onDeleteJob={(id) => void handleDeleteJob(id, false)}
              onUploadJobToDrive={(id) => void handleUploadJobToDrive(id)}
              onClearFinished={() => void handleClearFinished()}
              onGoToCatalog={() => setActiveTab('catalog')}
            />
          ) : activeTab === 'completed' ? (
            <CompletedView
              entries={entries}
              jobs={jobs}
              history={history}
              settings={settings}
              driveConnected={driveConnected}
              driveSessionExpired={driveSessionExpired}
              driveUserEmail={driveUserEmail || firebaseUserEmail}
              driveSyncStatus={driveSyncStatus}
              pendingDriveCount={pendingDriveCount}
              isDriveLoggingIn={isDriveLoggingIn}
              isSyncingDrive={isSyncingDrive || Boolean(driveSyncStatus?.syncing)}
              isUploadingPendingDrive={isUploadingPendingDrive}
              onDriveSignIn={() => void handleDriveSignIn()}
              onSyncDriveFolder={() => void handleSyncDriveFolder()}
              onUploadPendingToDrive={() => void handleUploadPendingToDrive()}
              onUploadJobToDrive={(id) => void handleUploadJobToDrive(id)}
              onDeleteDriveFile={handleDeleteDriveFileRequest}
              onDeleteHistoryRecord={handleDeleteHistoryRecordRequest}
              onDeleteJob={handleDeleteJobConfirmed}
              onRetryJob={(id) => void handleRetryJob(id)}
              onGoToCatalog={() => setActiveTab('catalog')}
            />
          ) : activeTab === 'v2' ? (
            <V2CatalogView
              entries={v2Entries}
              jobs={v2Jobs}
              history={v2History}
              settings={settings}
              driveConnected={driveConnected}
              driveSessionExpired={driveSessionExpired}
              driveUserEmail={driveUserEmail || firebaseUserEmail}
              pendingDriveCount={pendingDriveCount}
              isDriveLoggingIn={isDriveLoggingIn}
              isSyncingV2={isSyncingV2}
              isUploadingPendingDrive={isUploadingPendingDrive}
              onDriveSignIn={() => void handleDriveSignIn()}
              onSyncV2Folder={() => void handleSyncV2Folder()}
              onUploadPendingToDrive={() => void handleUploadPendingToDrive()}
              onEnqueueV2Episode={(slug, ep, force) => void handleEnqueueV2Episode(slug, ep, force)}
              onEnqueueV2Selected={(slugs) => void handleEnqueueV2Selected(slugs)}
              onAutoScanTop500={() => handleAutoScanTop500()}
            />
          ) : (
            <ImportReportView
              catalogCount={entries.length}
              onImportReport={handleImportReport}
              onResetCatalog={handleResetCatalog}
              onAddManualEntry={handleAddManualEntry}
            />
          )}
        </div>
      </main>
    </div>
  );
}
