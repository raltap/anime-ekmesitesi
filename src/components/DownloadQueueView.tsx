import {
  CheckCircle2,
  CloudUpload,
  Download,
  ExternalLink,
  FileCode2,
  FolderOpen,
  Loader2,
  Pause,
  Play,
  RotateCw,
  Trash2,
  XCircle,
} from 'lucide-react';
import { buildYtDlpBatchScript, formatBytes } from '../shared/playerPriority.ts';
import type { AnimeEntry, DownloadJob, DownloadSettings } from '../shared/types.ts';
import { GoogleSignInButton } from './GoogleSignInButton.tsx';

interface DownloadQueueViewProps {
  jobs: DownloadJob[];
  entries: AnimeEntry[];
  settings: DownloadSettings;
  queuePaused: boolean;
  driveConnected: boolean;
  driveSessionExpired: boolean;
  driveUserEmail: string | null;
  pendingDriveCount: number;
  missingLocalDriveCount: number;
  isDriveLoggingIn: boolean;
  isUploadingPendingDrive: boolean;
  onDriveSignIn: () => void;
  onUploadPendingToDrive: () => void;
  onPauseAll: () => void;
  onResumeAll: () => void;
  onRetryFailedJobs: () => void;
  onCancelAll: () => void;
  onPauseJob: (id: string) => void;
  onResumeJob: (id: string) => void;
  onCancelJob: (id: string) => void;
  onRetryJob: (id: string) => void;
  onDeleteJob: (id: string) => void;
  onUploadJobToDrive: (id: string) => void;
  onClearFinished: () => void;
  onGoToCatalog: () => void;
}

export function DownloadQueueView({
  jobs,
  entries,
  settings,
  queuePaused,
  driveConnected,
  driveSessionExpired,
  driveUserEmail,
  pendingDriveCount,
  missingLocalDriveCount,
  isDriveLoggingIn,
  isUploadingPendingDrive,
  onDriveSignIn,
  onUploadPendingToDrive,
  onPauseAll,
  onResumeAll,
  onRetryFailedJobs,
  onCancelAll,
  onPauseJob,
  onResumeJob,
  onCancelJob,
  onRetryJob,
  onDeleteJob,
  onUploadJobToDrive,
  onClearFinished,
  onGoToCatalog,
}: DownloadQueueViewProps) {
  const statusLabel: Record<DownloadJob['status'], string> = {
    queued: 'Sırada',
    paused: 'Duraklatıldı',
    probing: 'Kalite & Kaynak Aranıyor',
    downloading: 'İndiriliyor',
    muxing: 'MP4 Birleştiriliyor',
    uploading_drive: "Drive'a Yükleniyor",
    completed: 'Tamamlandı',
    failed: 'Başarısız',
    cancelled: 'İptal Edildi',
  };

  const activeOrQueuedCount = jobs.filter((j) =>
    ['queued', 'probing', 'downloading', 'muxing', 'uploading_drive'].includes(j.status),
  ).length;
  const pausedCount = jobs.filter((j) => j.status === 'paused').length;
  const failedCount = jobs.filter((j) => j.status === 'failed').length;

  const handleExportQueueScript = () => {
    const bySlug = new Map(entries.map((e) => [e.slug, e]));
    const items = jobs.map((j) => {
      const anime = bySlug.get(j.slug);
      return {
        animeTitle: j.animeTitle,
        slug: j.slug,
        episode: j.episode,
        links:
          anime?.f[j.episode] ??
          (j.embedUrl
            ? [['Varsayılan', j.selectedPlayer || 'ODNOKLASSNIKI', j.embedUrl]]
            : []),
      };
    });
    const minHeight = settings.strict1080p ? 1080 : settings.minQualityHeight;
    const content = buildYtDlpBatchScript(items, settings.preferredPlayers, minHeight);
    const blob = new Blob([content], { type: 'text/x-shellscript;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'kuyruk_indir.sh';
    a.click();
    URL.revokeObjectURL(url);
  };

  const qualitySummary = settings.strict1080p
    ? 'yalnızca 1080p'
    : settings.minQualityHeight === 720
      ? 'önce 1080p, yoksa 720p'
      : 'en yüksek kalite';

  return (
    <div className="space-y-5 flex-1 min-w-0">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-xl font-bold text-slate-900 dark:text-slate-100">
            İndirme Kuyruğu
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Oynatıcılar ve fansublar taranır; {qualitySummary} MP4 indirilir
            {settings.driveAutoUpload ? ' ve doğrudan Google Drive klasörüne aktarılır.' : '.'}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {driveConnected && pendingDriveCount > 0 && (
            <button
              type="button"
              disabled={isUploadingPendingDrive}
              onClick={onUploadPendingToDrive}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold bg-indigo-600 hover:bg-indigo-700 text-white disabled:opacity-50 whitespace-nowrap"
            >
              {isUploadingPendingDrive ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
              ) : (
                <CloudUpload className="w-3.5 h-3.5" aria-hidden="true" />
              )}
              <span>Bekleyenleri Drive&apos;a Yükle ({pendingDriveCount})</span>
            </button>
          )}

          {jobs.length > 0 && (
            <>
              {(activeOrQueuedCount > 0 || !queuePaused) && activeOrQueuedCount > 0 && (
                <button
                  type="button"
                  onClick={onPauseAll}
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/40 text-amber-800 dark:text-amber-300 hover:bg-amber-100 dark:hover:bg-amber-950/70 whitespace-nowrap"
                >
                  <Pause className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>Tümünü Duraklat</span>
                </button>
              )}

              {(pausedCount > 0 || queuePaused) && (
                <button
                  type="button"
                  onClick={onResumeAll}
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold bg-emerald-600 hover:bg-emerald-700 text-white whitespace-nowrap"
                >
                  <Play className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>Tümünü Devam Ettir</span>
                </button>
              )}

              {failedCount > 0 && (
                <button
                  type="button"
                  onClick={onRetryFailedJobs}
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300 hover:bg-blue-100 dark:hover:bg-blue-950/70 whitespace-nowrap"
                >
                  <RotateCw className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>Hatalıları Tekrar Dene ({failedCount})</span>
                </button>
              )}

              {(activeOrQueuedCount > 0 || pausedCount > 0) && (
                <button
                  type="button"
                  onClick={onCancelAll}
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium border border-red-200 dark:border-red-900 bg-red-50/70 dark:bg-red-950/40 text-red-700 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-950/70 whitespace-nowrap"
                >
                  <XCircle className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>Tümünü İptal Et</span>
                </button>
              )}

              <button
                type="button"
                onClick={handleExportQueueScript}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 whitespace-nowrap"
              >
                <FileCode2 className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Betik (.sh)</span>
              </button>
              <button
                type="button"
                onClick={onClearFinished}
                className="px-3 py-2 rounded-lg text-xs font-medium border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 whitespace-nowrap"
              >
                Hatalı/İptalleri Temizle
              </button>
            </>
          )}
        </div>
      </div>

      {(settings.driveAutoUpload || pendingDriveCount > 0 || driveSessionExpired) && !driveConnected && (
        <div
          className={`rounded-xl p-3.5 flex flex-wrap items-center justify-between gap-3 border ${
            driveSessionExpired
              ? 'bg-amber-50/80 dark:bg-amber-950/30 border-amber-200 dark:border-amber-900/60 text-amber-900 dark:text-amber-200'
              : 'bg-blue-50/80 dark:bg-blue-950/30 border-blue-200 dark:border-blue-900/60 text-blue-900 dark:text-blue-200'
          }`}
        >
          <div className="text-xs space-y-0.5">
            <div className="font-semibold flex items-center gap-1.5">
              <CloudUpload className="w-4 h-4 shrink-0" aria-hidden="true" />
              <span>
                {driveSessionExpired
                  ? `Google Drive oturumunun (~1 saat) süresi doldu${driveUserEmail ? ` (${driveUserEmail})` : ''}`
                  : pendingDriveCount > 0
                    ? `İndirilip Drive'a yüklenmeyi bekleyen ${pendingDriveCount} bölüm var`
                    : "Otomatik Google Drive yüklemesi için Google hesabınızı bağlayın"}
              </span>
            </div>
            <p className="text-[11px] opacity-90">
              {pendingDriveCount > 0
                ? `${pendingDriveCount} bölüm sunucu diskinde hazır bekliyor. Google ile yeniden bağlandığınız anda tümü otomatik Drive'a aktarılacaktır.`
                : missingLocalDriveCount > 0
                  ? `Sunucu yeniden başladığı için geçici diskteki ${missingLocalDriveCount} dosya temizlenmiş; ilgili satırlardan "Tekrar İndir" ile yeniden indirip Drive'a aktarabilirsiniz.`
                  : 'İndirmeler sizin internetinizi değil sunucu bağlantısını kullanır. Bağlandığınızda yeni inen bölümler doğrudan Drive klasörünüze gider.'}
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

      {jobs.length === 0 ? (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-12 text-center space-y-3">
          <p className="text-sm font-medium text-slate-800 dark:text-slate-200">
            İndirme kuyruğu şu anda boş.
          </p>
          <p className="text-xs text-slate-500 dark:text-slate-400 max-w-md mx-auto">
            Eksik bölümler listesinden 1 bölümlük animeleri seçip &quot;Seçilen Eksikleri İndir&quot; diyerek veya tek bir bölümü genişleterek kuyruğa ekleyebilirsiniz.
          </p>
          <button
            type="button"
            onClick={onGoToCatalog}
            className="inline-flex items-center px-4 py-2 rounded-lg text-xs font-semibold bg-blue-600 hover:bg-blue-700 text-white"
          >
            Eksik Bölümlere Dön
          </button>
        </div>
      ) : (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl divide-y divide-slate-200 dark:divide-slate-800">
          {jobs.map((job) => {
            const isActive =
              job.status === 'queued' ||
              job.status === 'probing' ||
              job.status === 'downloading' ||
              job.status === 'muxing' ||
              job.status === 'uploading_drive';
            const isPaused = job.status === 'paused';

            return (
              <div key={job.id} className="p-4 space-y-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-sm text-slate-900 dark:text-slate-100">
                        {job.animeTitle}
                      </span>
                      <span className="font-mono text-xs text-slate-500 dark:text-slate-400">
                        Bölüm {job.episode}
                      </span>
                    </div>
                    <div className="mt-1 text-xs text-slate-500 dark:text-slate-400 tabular-nums flex flex-wrap items-center gap-2">
                      <span
                        className={`inline-flex items-center gap-1 font-medium ${
                          job.status === 'completed'
                            ? 'text-emerald-700 dark:text-emerald-400'
                            : job.status === 'paused'
                              ? 'text-amber-700 dark:text-amber-400'
                              : job.status === 'failed' || job.status === 'cancelled'
                                ? 'text-red-600 dark:text-red-400'
                                : 'text-blue-600 dark:text-blue-400'
                        }`}
                      >
                        {job.status === 'completed' ? (
                          <CheckCircle2 className="w-3.5 h-3.5" aria-hidden="true" />
                        ) : job.status === 'paused' ? (
                          <Pause className="w-3.5 h-3.5" aria-hidden="true" />
                        ) : job.status === 'failed' || job.status === 'cancelled' ? (
                          <XCircle className="w-3.5 h-3.5" aria-hidden="true" />
                        ) : (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
                        )}
                        <span>{statusLabel[job.status]}</span>
                      </span>

                      {job.selectedPlayer && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span className="font-mono">{job.selectedPlayer}</span>
                        </>
                      )}
                      {job.selectedFansub && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span>{job.selectedFansub}</span>
                        </>
                      )}
                      {job.selectedQuality && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span className="font-mono font-semibold text-slate-800 dark:text-slate-200">
                            {job.selectedQuality}
                          </span>
                        </>
                      )}
                      {job.bytesDownloaded > 0 && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span className="font-mono">
                            {formatBytes(job.bytesDownloaded)}
                            {job.totalBytes > 0 ? ` / ${formatBytes(job.totalBytes)}` : ''}
                          </span>
                        </>
                      )}
                      {job.speedBps > 0 && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span className="font-mono">{formatBytes(job.speedBps)}/sn</span>
                        </>
                      )}
                      {job.status === 'uploading_drive' && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span className="font-mono text-indigo-600 dark:text-indigo-400">
                            Drive %{job.driveProgress ?? 0}
                          </span>
                        </>
                      )}
                      {job.driveStatus === 'uploaded' && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span className="text-emerald-700 dark:text-emerald-400 font-medium">
                            Drive&apos;a Aktarıldı
                          </span>
                        </>
                      )}
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-1.5 shrink-0">
                    {job.status === 'completed' && job.driveWebViewLink && (
                      <a
                        href={job.driveWebViewLink}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-emerald-600 hover:bg-emerald-700 text-white whitespace-nowrap"
                      >
                        <ExternalLink className="w-3.5 h-3.5" aria-hidden="true" />
                        <span>Drive&apos;da Aç</span>
                      </a>
                    )}
                    {job.status === 'completed' && job.driveFolderLink && (
                      <a
                        href={job.driveFolderLink}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 whitespace-nowrap"
                      >
                        <FolderOpen className="w-3.5 h-3.5" aria-hidden="true" />
                        <span>Klasör</span>
                      </a>
                    )}
                    {(() => {
                      const hasLocalFile = job.localFileExists ?? Boolean(job.filePath);
                      return (
                        <>
                          {job.status === 'completed' && !job.driveWebViewLink && hasLocalFile && driveConnected && (
                            <button
                              type="button"
                              onClick={() => onUploadJobToDrive(job.id)}
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-indigo-600 hover:bg-indigo-700 text-white whitespace-nowrap"
                            >
                              <CloudUpload className="w-3.5 h-3.5" aria-hidden="true" />
                              <span>Drive&apos;a Yükle</span>
                            </button>
                          )}
                          {job.status === 'completed' && !job.driveWebViewLink && !hasLocalFile && (
                            <button
                              type="button"
                              onClick={() => onRetryJob(job.id)}
                              title="Sunucu yeniden başladığı için geçici MP4 silinmiş; tekrar indirip Drive'a aktarabilirsiniz"
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/40 text-amber-800 dark:text-amber-300 hover:bg-amber-100 whitespace-nowrap"
                            >
                              <RotateCw className="w-3.5 h-3.5" aria-hidden="true" />
                              <span>Tekrar İndir &amp; Yükle</span>
                            </button>
                          )}
                          {job.status === 'completed' && hasLocalFile && (
                            <a
                              href={`/api/downloads/${encodeURIComponent(job.id)}/file`}
                              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 whitespace-nowrap"
                            >
                              <Download className="w-3.5 h-3.5" aria-hidden="true" />
                              <span>MP4 İndir</span>
                            </a>
                          )}
                        </>
                      );
                    })()}
                    {isActive && (
                      <>
                        <button
                          type="button"
                          onClick={() => onPauseJob(job.id)}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium border border-amber-300 dark:border-amber-800 text-amber-800 dark:text-amber-300 hover:bg-amber-50 dark:hover:bg-amber-950/50"
                        >
                          <Pause className="w-3 h-3" aria-hidden="true" />
                          <span>Duraklat</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => onCancelJob(job.id)}
                          className="px-2.5 py-1.5 rounded-lg text-xs font-medium border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800"
                        >
                          İptal
                        </button>
                      </>
                    )}
                    {isPaused && (
                      <>
                        <button
                          type="button"
                          onClick={() => onResumeJob(job.id)}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold bg-emerald-600 hover:bg-emerald-700 text-white"
                        >
                          <Play className="w-3 h-3" aria-hidden="true" />
                          <span>Devam Et</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => onCancelJob(job.id)}
                          className="px-2.5 py-1.5 rounded-lg text-xs font-medium border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800"
                        >
                          İptal
                        </button>
                      </>
                    )}
                    {(job.status === 'failed' || job.status === 'cancelled') && (
                      <button
                        type="button"
                        onClick={() => onRetryJob(job.id)}
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800"
                      >
                        <RotateCw className="w-3 h-3" aria-hidden="true" />
                        <span>Tekrar Dene</span>
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => onDeleteJob(job.id)}
                      aria-label={`Kuyruktan sil: ${job.animeTitle} Bölüm ${job.episode}`}
                      className="p-1.5 rounded-lg text-slate-400 hover:text-red-600 hover:bg-slate-100 dark:hover:bg-slate-800"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                {(job.status === 'downloading' ||
                  job.status === 'muxing' ||
                  job.status === 'probing' ||
                  job.status === 'uploading_drive') && (
                  <div className="w-full h-1.5 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
                    <div
                      className={`h-full transition-all duration-300 ${
                        job.status === 'uploading_drive' ? 'bg-indigo-600' : 'bg-blue-600'
                      }`}
                      style={{
                        width: `${
                          job.status === 'uploading_drive'
                            ? job.driveProgress ?? 10
                            : job.percent > 0
                              ? job.percent
                              : job.status === 'probing'
                                ? 12
                                : 35
                        }%`,
                      }}
                    />
                  </div>
                )}

                {job.error && (
                  <p className="text-xs text-red-600 dark:text-red-400">{job.error}</p>
                )}
                {job.driveError && (
                  <p className="text-xs text-amber-700 dark:text-amber-400">
                    Drive uyarısı: {job.driveError}
                  </p>
                )}

                {job.attempts.length > 0 && (
                  <details className="text-xs text-slate-500 dark:text-slate-400">
                    <summary className="cursor-pointer hover:text-slate-800 dark:hover:text-slate-200">
                      Denenen oynatıcılar ({job.attempts.length})
                    </summary>
                    <ul className="mt-2 space-y-1 pl-3 border-l border-slate-200 dark:border-slate-700 font-mono text-[11px]">
                      {job.attempts.map((a, idx) => (
                        <li key={idx}>
                          {a.player} ({a.fansub}) → {a.outcome}
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
