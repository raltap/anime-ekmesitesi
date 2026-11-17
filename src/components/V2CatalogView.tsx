import {
  CheckCircle2,
  CloudUpload,
  Download,
  ExternalLink,
  FolderOpen,
  FolderSync,
  Globe,
  Loader2,
  RefreshCw,
  Search,
} from 'lucide-react';
import { useState } from 'react';
import type {
  AnimeEntry,
  DownloadedRecord,
  DownloadJob,
  DownloadSettings,
  DriveSessionSummary,
} from '../shared/types.ts';

interface V2CatalogViewProps {
  entries: AnimeEntry[];
  jobs: DownloadJob[];
  history: Record<string, DownloadedRecord>;
  settings: DownloadSettings;
  driveConnected: boolean;
  driveSessionExpired: boolean;
  driveUserEmail: string | null;
  pendingDriveCount: number;
  isDriveLoggingIn: boolean;
  isSyncingV2: boolean;
  isUploadingPendingDrive: boolean;
  onDriveSignIn: () => void;
  onSyncV2Folder: () => void;
  onUploadPendingToDrive: () => void;
  onEnqueueV2Episode: (slug: string, episode: string, forceRedownload?: boolean) => void;
  onEnqueueV2Selected: (slugs: string[]) => void;
  onAutoScanTop500: () => Promise<void>;
}

export function V2CatalogView({
  entries,
  jobs,
  history,
  settings: _settings,
  driveConnected,
  driveSessionExpired,
  driveUserEmail,
  pendingDriveCount,
  isDriveLoggingIn,
  isSyncingV2,
  isUploadingPendingDrive,
  onDriveSignIn,
  onSyncV2Folder,
  onUploadPendingToDrive,
  onEnqueueV2Episode,
  onEnqueueV2Selected,
  onAutoScanTop500,
}: V2CatalogViewProps) {
  const [search, setSearch] = useState('');
  const [selectedSlugs, setSelectedSlugs] = useState<Set<string>>(new Set());
  const [isDiscovering, setIsDiscovering] = useState(false);
  const [discoverTitle, setDiscoverTitle] = useState('');
  const [isSingleDiscovering, setIsSingleDiscovering] = useState(false);

  const handleDiscoverSubmit = async () => {
    if (!discoverTitle.trim()) return;
    setIsSingleDiscovering(true);
    try {
      const res = await fetch('/api/v2/catalog/discover', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: discoverTitle.trim() }),
      });
      const contentType = res.headers.get('content-type') || '';
      if (!contentType.includes('application/json')) {
        const text = await res.text();
        throw new Error(text.includes('<!doctype') ? 'Fansub sitelerine erişim zaman aşımına uğradı veya sunucu yanıt veremedi.' : text || 'Arama başarısız.');
      }
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Arama başarısız.');
      setDiscoverTitle('');
      window.location.reload();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Arama hatası.');
    } finally {
      setIsSingleDiscovering(false);
    }
  };

  const filteredEntries = entries.filter(
    (e) =>
      !search ||
      e.t.toLowerCase().includes(search.toLowerCase()) ||
      e.slug.toLowerCase().includes(search.toLowerCase()) ||
      (e.at && e.at.toLowerCase().includes(search.toLowerCase())),
  );

  const activeV2JobsMap = new Map<string, DownloadJob>();
  for (const j of jobs) {
    if (['queued', 'probing', 'downloading', 'muxing', 'uploading_drive'].includes(j.status)) {
      activeV2JobsMap.set(`${j.slug}:${j.episode}`, j);
    }
  }

  const toggleSelect = (slug: string) => {
    setSelectedSlugs((prev) => {
      const next = new Set(prev);
      if (next.has(slug)) next.delete(slug);
      else next.add(slug);
      return next;
    });
  };

  const selectAllFiltered = () => {
    setSelectedSlugs(new Set(filteredEntries.map((e) => e.slug)));
  };

  const clearSelection = () => {
    setSelectedSlugs(new Set());
  };

  return (
    <div className="space-y-6 flex-1 min-w-0">
      {/* Header Banner */}
      <div className="bg-gradient-to-r from-indigo-900 via-slate-900 to-blue-950 text-white rounded-2xl p-6 shadow-xl border border-indigo-500/20">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="space-y-1.5 max-w-2xl">
            <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded-full text-xs font-semibold bg-indigo-500/20 text-indigo-300 border border-indigo-400/30">
              <Globe className="w-3.5 h-3.5" />
              <span>V2 · TarçınAnime & Top 500 Seri Keşfi</span>
            </div>
            <h1 className="font-display text-2xl font-bold tracking-tight">
              Tam Seri, Sezon, OVA & Film İndirici (V2)
            </h1>
            <p className="text-xs text-indigo-200/80 leading-relaxed">
              Mevcut arşivimizde olmayan popüler seriler, devam sezonları ve filmler (örn. Honzuki no Gekokujou tüm sezonlar, Steins;Gate, FMA, Attack on Titan) otomatik taranır, Türk fansublardan 1080p/720p bulunarak Google Drive V2 klasörünüze doğrudan aktarılır.
            </p>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <button
              type="button"
              disabled={isSyncingV2}
              onClick={onSyncV2Folder}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold bg-white/10 hover:bg-white/20 text-white border border-white/20 transition-all disabled:opacity-50"
            >
              {isSyncingV2 ? (
                <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
              ) : (
                <FolderSync className="w-4 h-4 text-emerald-400" aria-hidden="true" />
              )}
              <span>{isSyncingV2 ? 'V2 Drive Taranıyor...' : 'V2 Drive Kontrolü'}</span>
            </button>
            {driveConnected && pendingDriveCount > 0 && (
              <button
                type="button"
                disabled={isUploadingPendingDrive}
                onClick={onUploadPendingToDrive}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold bg-indigo-600 hover:bg-indigo-500 text-white shadow-lg transition-all disabled:opacity-50"
              >
                {isUploadingPendingDrive ? (
                  <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
                ) : (
                  <CloudUpload className="w-4 h-4" aria-hidden="true" />
                )}
                <span>Bekleyenleri Yükle ({pendingDriveCount})</span>
              </button>
            )}
          </div>
        </div>
      </div>

      {/* MAL Top 500 Scan Bar */}
      <div className="bg-gradient-to-r from-blue-900 via-indigo-900 to-slate-900 text-white rounded-xl p-5 shadow-xl flex flex-wrap items-center justify-between gap-4">
        <div className="space-y-1 max-w-xl">
          <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-white/10 text-indigo-200">
            <Globe className="w-3.5 h-3.5" />
            <span>Top 500 & Full Series Sezon Tarama</span>
          </div>
          <h2 className="font-display font-bold text-lg">
            MAL Top 500 Sezon & Bölümleri Tara (İndirmez)
          </h2>
          <p className="text-xs text-indigo-200/80 leading-relaxed">
            Butona bastığınızda sistem MAL Top 500 listesindeki serilerin tüm sezonlarını, OVA&apos;larını, filmlerini ve bölümlerini Türk fansub kaynaklarından tarar ve katalogda günceller. Otomatik olarak indirme başlatmaz; dilediğiniz sezona tıklayıp inceleyebilir ve kuyruğa manuel ekleyebilirsiniz.
          </p>
        </div>

        <button
          type="button"
          disabled={isDiscovering}
          onClick={async () => {
            setIsDiscovering(true);
            try {
              await onAutoScanTop500();
            } finally {
              setIsDiscovering(false);
            }
          }}
          className="inline-flex items-center gap-2 px-5 py-3 rounded-xl text-xs font-bold bg-indigo-600 hover:bg-indigo-500 text-white shadow-lg transition-all disabled:opacity-50"
        >
          {isDiscovering ? (
            <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
          ) : (
            <Search className="w-4 h-4" aria-hidden="true" />
          )}
          <span>{isDiscovering ? 'Top 500 Taranıyor...' : 'MAL Top 500 Sezonları Tara'}</span>
        </button>
      </div>

      {/* Toolbar & Search */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-3.5 flex flex-wrap items-center justify-between gap-3">
        <div className="relative flex-1 min-w-[240px] max-w-md">
          <Search
            className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
            aria-hidden="true"
          />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="V2 serilerinde ara (örn. Honzuki, Steins)..."
            aria-label="V2 serilerinde ara"
            className="w-full pl-9 pr-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100"
          />
        </div>

        <div className="flex items-center gap-2 flex-wrap text-xs">
          <span className="text-slate-500 dark:text-slate-400">
            {filteredEntries.length} seri listeleniyor ({selectedSlugs.size} seçildi)
          </span>
          <button
            type="button"
            onClick={selectAllFiltered}
            className="px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 font-medium hover:bg-slate-50 dark:hover:bg-slate-800"
          >
            Tümünü Seç
          </button>
          {selectedSlugs.size > 0 && (
            <>
              <button
                type="button"
                onClick={clearSelection}
                className="px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 font-medium hover:bg-slate-50 dark:hover:bg-slate-800"
              >
                Seçimi Kaldır
              </button>
              <button
                type="button"
                onClick={() => {
                  onEnqueueV2Selected(Array.from(selectedSlugs));
                  clearSelection();
                }}
                className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-lg font-semibold bg-blue-600 hover:bg-blue-700 text-white shadow-sm"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Seçilenleri İndirmeye Başla ({selectedSlugs.size})</span>
              </button>
            </>
          )}
        </div>
      </div>

      {/* Series Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {filteredEntries.map((anime) => {
          const isSelected = selectedSlugs.has(anime.slug);
          const completedEps = anime.miss.filter((ep) => Boolean(history[`${anime.slug}:${ep}`])).length;
          const allDone = completedEps >= anime.miss.length && anime.miss.length > 0;

          return (
            <div
              key={anime.slug}
              className={`rounded-xl border transition-all bg-white dark:bg-slate-900 p-4 flex flex-col justify-between gap-4 ${
                isSelected
                  ? 'border-indigo-600 dark:border-indigo-500 ring-2 ring-indigo-600/20'
                  : 'border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700'
              }`}
            >
              <div className="space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="space-y-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggleSelect(anime.slug)}
                        aria-label={`Seç: ${anime.t}`}
                        className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-600"
                      />
                      <span className="inline-block px-2 py-0.5 rounded text-[10px] font-mono font-semibold bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800">
                        {anime.fmt} · {anime.yr || '—'}
                      </span>
                    </div>
                    <h2 className="font-display font-bold text-sm text-slate-900 dark:text-slate-100 leading-snug">
                      {anime.t}
                    </h2>
                    {anime.at && anime.at !== anime.t && (
                      <p className="text-[11px] text-slate-500 dark:text-slate-400 italic">
                        {anime.at}
                      </p>
                    )}
                  </div>

                  {allDone ? (
                    <span className="shrink-0 inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-semibold bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800">
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      <span>Tam</span>
                    </span>
                  ) : (
                    <span className="shrink-0 text-xs font-semibold text-slate-600 dark:text-slate-300 tabular-nums">
                      {completedEps}/{anime.miss.length} bölüm
                    </span>
                  )}
                </div>

                {/* Episodes pills */}
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {anime.miss.map((ep) => {
                    const rec = history[`${anime.slug}:${ep}`];
                    const job = activeV2JobsMap.get(`${anime.slug}:${ep}`);
                    return (
                      <button
                        key={ep}
                        type="button"
                        onClick={() => onEnqueueV2Episode(anime.slug, ep, Boolean(rec))}
                        title={
                          rec
                            ? `Bölüm ${ep} indirildi (${rec.quality}). Tekrar indirmek için tıklayın.`
                            : job
                              ? `İşlem durumunda: ${job.status}`
                              : `Bölüm ${ep} indir / ara`
                        }
                        className={`px-2 py-0.5 text-xs font-mono font-medium rounded border transition-colors ${
                          rec
                            ? 'border-emerald-400 dark:border-emerald-700 bg-emerald-100 dark:bg-emerald-950/70 text-emerald-800 dark:text-emerald-300'
                            : job
                              ? 'border-amber-400 dark:border-amber-700 bg-amber-100 dark:bg-amber-950/70 text-amber-800 dark:text-amber-300 animate-pulse'
                              : 'border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:border-indigo-500'
                        }`}
                      >
                        {rec ? `✓ #${ep} ${rec.quality}` : job ? `#${ep} (${job.status})` : `#${ep}`}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="pt-2 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between gap-2">
                <a
                  href={`https://tarcinanime.com/archive`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-[11px] font-medium text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100"
                >
                  <span>TarçınArchive</span>
                  <ExternalLink className="w-3 h-3" />
                </a>

                <button
                  type="button"
                  onClick={() => {
                    for (const ep of anime.miss) {
                      onEnqueueV2Episode(anime.slug, ep, false);
                    }
                  }}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-indigo-600 hover:bg-indigo-700 text-white shadow-xs"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>{allDone ? 'Seriyi Tekrar İndir' : 'Tüm Sezonu İndir'}</span>
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
