import {
  CheckCircle2,
  CloudUpload,
  Download,
  ExternalLink,
  FolderOpen,
  FolderSync,
  Loader2,
  RotateCw,
  Search,
  Trash2,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { DEFAULT_DRIVE_FOLDER_ID, formatBytes } from '../shared/playerPriority.ts';
import type {
  AnimeEntry,
  DownloadedRecord,
  DownloadJob,
  DownloadSettings,
  DriveSyncStatus,
} from '../shared/types.ts';
import { GoogleSignInButton } from './GoogleSignInButton.tsx';

interface CompletedViewProps {
  entries: AnimeEntry[];
  jobs: DownloadJob[];
  history: Record<string, DownloadedRecord>;
  settings: DownloadSettings;
  driveConnected: boolean;
  driveSessionExpired: boolean;
  driveUserEmail: string | null;
  driveSyncStatus?: DriveSyncStatus | null;
  pendingDriveCount: number;
  isDriveLoggingIn?: boolean;
  isSyncingDrive?: boolean;
  isUploadingPendingDrive?: boolean;
  onDriveSignIn: () => void;
  onSyncDriveFolder: () => void;
  onUploadPendingToDrive: () => void;
  onUploadJobToDrive: (jobId: string) => void;
  onDeleteDriveFile: (fileId: string, historyKey: string, title: string) => void;
  onDeleteHistoryRecord: (key: string, title: string) => void;
  onDeleteJob: (id: string, removeFile: boolean, title: string) => void;
  onRetryJob: (id: string) => void;
  onGoToCatalog: () => void;
}

export function CompletedView({
  entries,
  jobs,
  history,
  settings,
  driveConnected,
  driveSessionExpired,
  driveUserEmail,
  driveSyncStatus,
  pendingDriveCount,
  isDriveLoggingIn = false,
  isSyncingDrive = false,
  isUploadingPendingDrive = false,
  onDriveSignIn,
  onSyncDriveFolder,
  onUploadPendingToDrive,
  onUploadJobToDrive,
  onDeleteDriveFile,
  onDeleteHistoryRecord,
  onDeleteJob,
  onRetryJob,
  onGoToCatalog,
}: CompletedViewProps) {
  const [subTab, setSubTab] = useState<'anime' | 'episodes'>('anime');
  const [search, setSearch] = useState('');

  const records = useMemo(
    () =>
      Object.values(history).sort((a, b) => (b.downloadedAt || 0) - (a.downloadedAt || 0)),
    [history],
  );

  const completedJobsByKey = useMemo(() => {
    const map = new Map<string, DownloadJob>();
    for (const j of jobs) {
      if (j.status === 'completed') {
        map.set(`${j.slug}:${j.episode}`, j);
      }
    }
    return map;
  }, [jobs]);

  const animeCompletionList = useMemo(() => {
    const bySlug = new Map<string, DownloadedRecord[]>();
    for (const rec of records) {
      const list = bySlug.get(rec.slug) ?? [];
      list.push(rec);
      bySlug.set(rec.slug, list);
    }

    const entryMap = new Map(entries.map((e) => [e.slug, e]));
    const rows: Array<{
      slug: string;
      animeTitle: string;
      fmt: string;
      yr: string | number;
      totalMissing: number;
      completedCount: number;
      isFullyCompleted: boolean;
      episodes: DownloadedRecord[];
      driveFolderLink?: string;
    }> = [];

    for (const [slug, recs] of bySlug.entries()) {
      const entry = entryMap.get(slug);
      const totalMissing = entry ? entry.miss.length : recs.length;
      const doneEps = entry
        ? entry.miss.filter((ep) => Boolean(history[`${slug}:${ep}`])).length
        : recs.length;
      const folderLink = recs.find((r) => r.driveFolderLink)?.driveFolderLink;
      rows.push({
        slug,
        animeTitle: entry?.t || recs[0].animeTitle,
        fmt: entry?.fmt || 'Anime',
        yr: entry?.yr || '—',
        totalMissing,
        completedCount: doneEps,
        isFullyCompleted: totalMissing > 0 && doneEps >= totalMissing,
        episodes: [...recs].sort((a, b) => Number(a.episode) - Number(b.episode)),
        driveFolderLink: folderLink,
      });
    }

    rows.sort((a, b) => {
      if (a.isFullyCompleted !== b.isFullyCompleted) {
        return a.isFullyCompleted ? -1 : 1;
      }
      const lastA = Math.max(...a.episodes.map((e) => e.downloadedAt || 0));
      const lastB = Math.max(...b.episodes.map((e) => e.downloadedAt || 0));
      return lastB - lastA;
    });

    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (r) => r.animeTitle.toLowerCase().includes(q) || r.slug.toLowerCase().includes(q),
    );
  }, [entries, history, records, search]);

  const filteredRecords = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return records;
    return records.filter(
      (r) =>
        r.animeTitle.toLowerCase().includes(q) ||
        r.fileName.toLowerCase().includes(q) ||
        r.slug.toLowerCase().includes(q),
    );
  }, [records, search]);

  const fullyCompletedAnimeCount = animeCompletionList.filter((a) => a.isFullyCompleted).length;
  const partialAnimeCount = animeCompletionList.filter((a) => !a.isFullyCompleted).length;
  const driveUploadedCount = records.filter((r) => Boolean(r.driveWebViewLink)).length;

  const rootDriveUrl = `https://drive.google.com/drive/folders/${encodeURIComponent(settings.driveFolderId || DEFAULT_DRIVE_FOLDER_ID)}`;

  return (
    <div className="space-y-5 flex-1 min-w-0">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-xl font-bold text-slate-900 dark:text-slate-100">
            Tamamlananlar & İndirme Geçmişi
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Hangi animelerin eksik bölümlerinin tamamlandığını ve Google Drive klasör linklerini buradan takip edin.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <a
            href="/api/history/export?format=json"
            download="tamamlananlar_gecmis.json"
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100 hover:bg-slate-50 dark:hover:bg-slate-800"
          >
            <Download className="w-3.5 h-3.5" />
            <span>JSON Dışa Aktar</span>
          </a>
          <a
            href="/api/history/export?format=csv"
            download="tamamlananlar_gecmis.csv"
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100 hover:bg-slate-50 dark:hover:bg-slate-800"
          >
            <Download className="w-3.5 h-3.5" />
            <span>CSV Dışa Aktar</span>
          </a>
          {driveConnected && pendingDriveCount > 0 && (
            <button
              type="button"
              disabled={isUploadingPendingDrive}
              onClick={onUploadPendingToDrive}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-semibold bg-indigo-600 hover:bg-indigo-700 text-white disabled:opacity-50 whitespace-nowrap"
            >
              {isUploadingPendingDrive ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
              ) : (
                <CloudUpload className="w-3.5 h-3.5" aria-hidden="true" />
              )}
              <span>Bekleyenleri Drive&apos;a Yükle ({pendingDriveCount})</span>
            </button>
          )}
          <button
            type="button"
            disabled={isSyncingDrive}
            onClick={onSyncDriveFolder}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-semibold border border-emerald-300 dark:border-emerald-800 bg-emerald-50/70 dark:bg-emerald-950/30 text-emerald-800 dark:text-emerald-300 hover:bg-emerald-100 dark:hover:bg-emerald-950/60 disabled:opacity-50 whitespace-nowrap"
          >
            {isSyncingDrive ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
            ) : (
              <FolderSync className="w-3.5 h-3.5" aria-hidden="true" />
            )}
            <span>
              {isSyncingDrive ? 'Drive Taranıyor...' : 'Drive Klasörünü Kontrol Et'}
            </span>
          </button>
          <a
            href={rootDriveUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-semibold border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100 hover:bg-slate-50 dark:hover:bg-slate-800 whitespace-nowrap"
          >
            <FolderOpen className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" aria-hidden="true" />
            <span>Ana Drive Klasörünü Aç</span>
            <ExternalLink className="w-3 h-3" aria-hidden="true" />
          </a>
        </div>
      </div>

      {driveSyncStatus?.syncing && (
        <div className="bg-blue-50/80 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-900/60 rounded-xl p-3 flex items-center gap-2.5 text-xs text-blue-900 dark:text-blue-200">
          <Loader2 className="w-4 h-4 animate-spin shrink-0" aria-hidden="true" />
          <span>
            Drive klasöründeki animeler ve bölümler taranıyor; bulunanlar otomatik tamamlandı olarak işaretlenecek ve tekrar indirilmeyecek.
          </span>
        </div>
      )}

      {!driveConnected && (pendingDriveCount > 0 || driveSessionExpired) && (
        <div className="bg-amber-50/80 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900/60 rounded-xl p-3.5 flex flex-wrap items-center justify-between gap-3">
          <div className="text-xs text-amber-900 dark:text-amber-200 space-y-0.5">
            <div className="font-semibold flex items-center gap-1.5">
              <CloudUpload className="w-4 h-4 shrink-0" aria-hidden="true" />
              <span>
                {pendingDriveCount > 0
                  ? `Drive'a yüklenmeyi bekleyen ${pendingDriveCount} indirilmiş bölüm var`
                  : `Google Drive oturumunun (~1 saat) süresi doldu${driveUserEmail ? ` (${driveUserEmail})` : ''}`}
              </span>
            </div>
            <p className="text-[11px] opacity-90">
              Google hesabınızı yeniden bağladığınız anda bekleyen bölümler Drive klasörünüze aktarılır.
            </p>
          </div>
          <div className="w-48 shrink-0">
            <GoogleSignInButton
              onClick={onDriveSignIn}
              disabled={isDriveLoggingIn}
              label={isDriveLoggingIn ? 'Bağlanılıyor...' : 'Sign in with Google'}
            />
          </div>
        </div>
      )}

      {/* Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
          <div className="text-xs font-medium text-slate-500 dark:text-slate-400">
            Tamamlanan Anime
          </div>
          <div className="mt-1 font-display text-2xl font-bold tabular-nums text-emerald-700 dark:text-emerald-400">
            {fullyCompletedAnimeCount}
          </div>
          <div className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
            {partialAnimeCount} anime kısmi tamamlandı
          </div>
        </div>

        <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
          <div className="text-xs font-medium text-slate-500 dark:text-slate-400">
            Hatırlanan Bölüm
          </div>
          <div className="mt-1 font-display text-2xl font-bold tabular-nums text-slate-900 dark:text-slate-100">
            {records.length}
          </div>
          <div className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
            Otomatik tekrar indirme engelli
          </div>
        </div>

        <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
          <div className="text-xs font-medium text-slate-500 dark:text-slate-400">
            Google Drive Aktarımı
          </div>
          <div className="mt-1 font-display text-2xl font-bold tabular-nums text-blue-600 dark:text-blue-400">
            {driveUploadedCount}
          </div>
          <div className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
            Bölüm buluta yüklendi
          </div>
        </div>
      </div>

      {/* Sub-navigation + Search */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1 p-1 bg-slate-100 dark:bg-slate-800 rounded-lg">
          <button
            type="button"
            onClick={() => setSubTab('anime')}
            className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors whitespace-nowrap ${
              subTab === 'anime'
                ? 'bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 shadow-xs'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'
            }`}
          >
            Anime Tamamlanma Durumu ({animeCompletionList.length})
          </button>
          <button
            type="button"
            onClick={() => setSubTab('episodes')}
            className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors whitespace-nowrap ${
              subTab === 'episodes'
                ? 'bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 shadow-xs'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'
            }`}
          >
            Bölüm & Drive Geçmişi ({records.length})
          </button>
        </div>

        <div className="relative min-w-[220px] flex-1 max-w-sm">
          <Search
            className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
            aria-hidden="true"
          />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Tamamlananlarda ara..."
            aria-label="Tamamlananlarda ara"
            className="w-full pl-8 pr-3 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100"
          />
        </div>
      </div>

      {records.length === 0 ? (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-12 text-center space-y-3">
          <p className="text-sm font-medium text-slate-800 dark:text-slate-200">
            Henüz tamamlanan bölüm kaydı yok.
          </p>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            İndirilen ve Google Drive&apos;a aktarılan bölümler burada kalıcı olarak hatırlanır ve anime bazında tamamlanma durumu gösterilir.
          </p>
          <button
            type="button"
            onClick={onGoToCatalog}
            className="inline-flex items-center px-4 py-2 rounded-lg text-xs font-semibold bg-blue-600 hover:bg-blue-700 text-white"
          >
            Eksik Bölümlere Git
          </button>
        </div>
      ) : subTab === 'anime' ? (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400 bg-slate-50/70 dark:bg-slate-950/40">
                  <th className="py-2.5 px-4 font-medium">Anime</th>
                  <th className="py-2.5 px-3 font-medium">Tamamlanma</th>
                  <th className="py-2.5 px-3 font-medium">İndirilen Bölümler</th>
                  <th className="py-2.5 px-4 font-medium text-right">Drive Klasörü</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {animeCompletionList.map((row) => (
                  <tr key={row.slug} className="hover:bg-slate-50 dark:hover:bg-slate-800/30">
                    <td className="py-3 px-4">
                      <div className="font-semibold text-sm text-slate-900 dark:text-slate-100">
                        {row.animeTitle}
                      </div>
                      <div className="text-[11px] text-slate-500 dark:text-slate-400">
                        {row.fmt} · {row.yr}
                      </div>
                    </td>
                    <td className="py-3 px-3 whitespace-nowrap">
                      <span
                        className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md font-semibold ${
                          row.isFullyCompleted
                            ? 'bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-900'
                            : 'bg-amber-50 dark:bg-amber-950/50 text-amber-800 dark:text-amber-300 border border-amber-200 dark:border-amber-900'
                        }`}
                      >
                        <CheckCircle2 className="w-3.5 h-3.5" aria-hidden="true" />
                        <span>
                          {row.completedCount} / {row.totalMissing}{' '}
                          {row.isFullyCompleted ? 'Tamamlandı' : 'Kısmi'}
                        </span>
                      </span>
                    </td>
                    <td className="py-3 px-3">
                      <div className="flex flex-wrap gap-1.5">
                        {row.episodes.map((ep) =>
                          ep.driveWebViewLink ? (
                            <a
                              key={ep.key}
                              href={ep.driveWebViewLink}
                              target="_blank"
                              rel="noopener noreferrer"
                              title={`Drive'da aç: ${ep.fileName}`}
                              className="inline-flex items-center gap-1 px-2 py-0.5 rounded border border-emerald-200 dark:border-emerald-800 bg-emerald-50/70 dark:bg-emerald-950/40 font-mono text-[11px] font-medium text-emerald-800 dark:text-emerald-300 hover:underline"
                            >
                              <span>
                                #{ep.episode} · {ep.quality}
                              </span>
                              <ExternalLink className="w-2.5 h-2.5" aria-hidden="true" />
                            </a>
                          ) : (
                            <span
                              key={ep.key}
                              className="inline-flex items-center gap-1 px-2 py-0.5 rounded border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 font-mono text-[11px] font-medium text-slate-700 dark:text-slate-200"
                            >
                              #{ep.episode} · {ep.quality}
                            </span>
                          ),
                        )}
                      </div>
                    </td>
                    <td className="py-3 px-4 text-right whitespace-nowrap">
                      {row.driveFolderLink ? (
                        <a
                          href={row.driveFolderLink}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-blue-600 hover:bg-blue-700 text-white"
                        >
                          <FolderOpen className="w-3.5 h-3.5" aria-hidden="true" />
                          <span>Drive Klasörünü Aç</span>
                        </a>
                      ) : (
                        <span className="text-[11px] text-slate-400 dark:text-slate-500">
                          Yerel / Beklemede
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400 bg-slate-50/70 dark:bg-slate-950/40">
                  <th className="py-2.5 px-4 font-medium">Dosya / Anime</th>
                  <th className="py-2.5 px-3 font-medium">Kalite</th>
                  <th className="py-2.5 px-3 font-medium">Kaynak</th>
                  <th className="py-2.5 px-3 font-medium text-right">Boyut</th>
                  <th className="py-2.5 px-4 font-medium text-right">Drive & İşlem</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {filteredRecords.map((rec) => {
                  const localJob = completedJobsByKey.get(rec.key);
                  const hasLocalFile = localJob
                    ? (localJob.localFileExists ?? Boolean(localJob.filePath))
                    : false;

                  return (
                    <tr key={rec.key} className="hover:bg-slate-50 dark:hover:bg-slate-800/30">
                      <td className="py-3 px-4 font-medium text-slate-900 dark:text-slate-100">
                        <div>{rec.fileName}</div>
                        <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                          {rec.animeTitle} · Bölüm {rec.episode}
                        </div>
                      </td>
                      <td className="py-3 px-3 font-mono font-semibold text-emerald-700 dark:text-emerald-400 whitespace-nowrap">
                        {rec.quality}
                      </td>
                      <td className="py-3 px-3 text-slate-600 dark:text-slate-300 whitespace-nowrap">
                        {rec.player} · {rec.fansub}
                      </td>
                      <td className="py-3 px-3 text-right font-mono tabular-nums text-slate-700 dark:text-slate-300 whitespace-nowrap">
                        {formatBytes(rec.totalBytes)}
                      </td>
                      <td className="py-3 px-4 text-right whitespace-nowrap">
                        <div className="inline-flex items-center gap-1.5">
                          {rec.driveWebViewLink && (
                            <a
                              href={rec.driveWebViewLink}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold bg-emerald-600 hover:bg-emerald-700 text-white"
                            >
                              <ExternalLink className="w-3.5 h-3.5" aria-hidden="true" />
                              <span>Drive&apos;da Aç</span>
                            </a>
                          )}
                          {!rec.driveWebViewLink && hasLocalFile && localJob && driveConnected && (
                            <button
                              type="button"
                              onClick={() => onUploadJobToDrive(localJob.id)}
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold bg-indigo-600 hover:bg-indigo-700 text-white"
                            >
                              <CloudUpload className="w-3.5 h-3.5" aria-hidden="true" />
                              <span>Drive&apos;a Yükle</span>
                            </button>
                          )}
                          {!rec.driveWebViewLink && localJob && !hasLocalFile && (
                            <button
                              type="button"
                              onClick={() => onRetryJob(localJob.id)}
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/40 text-amber-800 dark:text-amber-300 hover:bg-amber-100"
                            >
                              <RotateCw className="w-3.5 h-3.5" aria-hidden="true" />
                              <span>Tekrar İndir</span>
                            </button>
                          )}
                          {hasLocalFile && localJob && (
                            <a
                              href={`/api/downloads/${encodeURIComponent(localJob.id)}/file`}
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800"
                            >
                              <Download className="w-3.5 h-3.5" aria-hidden="true" />
                              <span>MP4</span>
                            </a>
                          )}
                          {rec.driveFileId && driveConnected && (
                            <button
                              type="button"
                              onClick={() =>
                                onDeleteDriveFile(
                                  rec.driveFileId!,
                                  rec.key,
                                  `${rec.animeTitle} Bölüm ${rec.episode}`,
                                )
                              }
                              title="Drive'dan Sil"
                              aria-label={`Drive'dan sil: ${rec.fileName}`}
                              className="p-1.5 rounded-lg text-slate-400 hover:text-red-600 hover:bg-slate-100 dark:hover:bg-slate-800"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() =>
                              localJob && hasLocalFile
                                ? onDeleteJob(
                                    localJob.id,
                                    true,
                                    `${rec.animeTitle} Bölüm ${rec.episode}`,
                                  )
                                : onDeleteHistoryRecord(
                                    rec.key,
                                    `${rec.animeTitle} Bölüm ${rec.episode}`,
                                  )
                            }
                            title="Geçmişten Sil"
                            aria-label={`Geçmişten sil: ${rec.fileName}`}
                            className="px-2 py-1 rounded-lg text-[11px] font-medium text-slate-500 hover:text-red-600 hover:bg-slate-100 dark:hover:bg-slate-800"
                          >
                            Kaydı Sil
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
