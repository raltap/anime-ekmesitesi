import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Download,
  Eye,
  FileCode2,
  Globe,
  Loader2,
  Search,
  Square,
  XCircle,
} from 'lucide-react';
import { Fragment, useMemo, useState } from 'react';
import {
  buildYtDlpBatchScript,
  filterAndSortCatalog,
  isAnimeCompleted,
} from '../shared/playerPriority.ts';
import type {
  AnimeEntry,
  CatalogScanStatus,
  CatalogStats,
  DownloadedRecord,
  DownloadJob,
  DownloadSettings,
  EpisodeProbeSummary,
  FallbackSiteReport,
  FilterState,
} from '../shared/types.ts';
import { EpisodeInspector } from './EpisodeInspector.tsx';

interface CatalogTableProps {
  entries: AnimeEntry[];
  stats: CatalogStats;
  filters: FilterState;
  onFiltersChange: (next: FilterState) => void;
  onResetFilters: () => void;
  availableFormats: string[];
  selectedSlugs: Set<string>;
  onToggleSelectSlug: (slug: string) => void;
  onSelectSlugs: (slugs: string[]) => void;
  onClearSelection: () => void;
  settings: DownloadSettings;
  probeCache: Record<string, EpisodeProbeSummary>;
  probingKeys: Record<string, boolean>;
  fallbackReports: Record<string, FallbackSiteReport[]>;
  searchingFallbackKeys: Record<string, boolean>;
  isBatchSearchingFallback?: boolean;
  catalogScanStatus?: CatalogScanStatus | null;
  jobs: DownloadJob[];
  history: Record<string, DownloadedRecord>;
  onProbeEpisode: (slug: string, episode: string, forceRefresh?: boolean) => void;
  onFallbackSearchEpisode: (slug: string, episode: string) => void;
  onFallbackSearchSelected: () => void;
  onStartCatalogScan: (mode: 'incomplete' | 'all') => void;
  onCancelCatalogScan: () => void;
  onProbeSelected: () => void;
  onEnqueueEpisode: (
    slug: string,
    episode: string,
    preferUrl?: string,
    forceRedownload?: boolean,
  ) => void;
  onEnqueueSelected: () => void;
}

export function CatalogTable({
  entries,
  stats,
  filters,
  onFiltersChange,
  onResetFilters,
  availableFormats,
  selectedSlugs,
  onToggleSelectSlug,
  onSelectSlugs,
  onClearSelection,
  settings,
  probeCache,
  probingKeys,
  fallbackReports,
  searchingFallbackKeys,
  isBatchSearchingFallback = false,
  catalogScanStatus,
  jobs,
  history,
  onProbeEpisode,
  onFallbackSearchEpisode,
  onFallbackSearchSelected,
  onStartCatalogScan,
  onCancelCatalogScan,
  onProbeSelected,
  onEnqueueEpisode,
  onEnqueueSelected,
}: CatalogTableProps) {
  const [expandedSlug, setExpandedSlug] = useState<string | null>(null);
  const [expandedEpisode, setExpandedEpisode] = useState<string>('');
  const [visibleLimit, setVisibleLimit] = useState<number>(60);

  const completedAnimeCount = useMemo(
    () => entries.filter((entry) => isAnimeCompleted(entry, history)).length,
    [entries, history],
  );

  const filtered = useMemo(
    () => filterAndSortCatalog(entries, filters, history),
    [entries, filters, history],
  );

  const visibleEntries = filtered.slice(0, visibleLimit);
  const selectableVisible = useMemo(
    () => visibleEntries.filter((a) => !isAnimeCompleted(a, history)),
    [visibleEntries, history],
  );

  const handleToggleExpand = (anime: AnimeEntry, ep?: string) => {
    if (expandedSlug === anime.slug && (!ep || expandedEpisode === ep)) {
      setExpandedSlug(null);
      return;
    }
    setExpandedSlug(anime.slug);
    setExpandedEpisode(ep || anime.miss[0] || '');
  };

  const handleSelectOneMissingVisible = () => {
    const slugs = filtered
      .filter(
        (a) =>
          a.miss.length === 1 &&
          !isAnimeCompleted(a, history) &&
          (settings.autoFallbackSearch || a.d !== 'yok'),
      )
      .map((a) => a.slug);
    onSelectSlugs(slugs);
  };

  const handleExportScript = () => {
    const targetEntries =
      selectedSlugs.size > 0
        ? entries.filter((e) => selectedSlugs.has(e.slug))
        : filtered.slice(0, 50);

    const items = targetEntries.flatMap((anime) =>
      anime.miss.map((ep) => ({
        animeTitle: anime.t,
        slug: anime.slug,
        episode: ep,
        links: anime.f[ep] ?? [],
      })),
    );

    const minHeight = settings.strict1080p ? 1080 : settings.minQualityHeight;
    const content = buildYtDlpBatchScript(items, settings.preferredPlayers, minHeight);
    const blob = new Blob([content], { type: 'text/x-shellscript;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = minHeight >= 1080 ? 'eksik_bolumler_1080p.sh' : 'eksik_bolumler_hd.sh';
    a.click();
    URL.revokeObjectURL(url);
  };

  const statCards: Array<{
    label: string;
    value: number;
    sub: string;
    active: boolean;
    onClick: () => void;
  }> = [
    {
      label: 'Katalogdaki Anime',
      value: stats.totalAnime,
      sub: `${stats.totalMissingEpisodes} toplam eksik bölüm`,
      active: filters.missingCount === 'all' && filters.archiveStatus === 'all',
      onClick: () =>
        onFiltersChange({ ...filters, missingCount: 'all', archiveStatus: 'all' }),
    },
    {
      label: '1 Bölüm Eksik',
      value: stats.missing1,
      sub: 'Tek bölümle tamamlananlar',
      active: filters.missingCount === '1',
      onClick: () =>
        onFiltersChange({
          ...filters,
          missingCount: filters.missingCount === '1' ? 'all' : '1',
        }),
    },
    {
      label: 'Tam Arşiv Eşleşmesi',
      value: stats.tamCount,
      sub: `${stats.kismiCount} kısmi · ${stats.yokCount} yok`,
      active: filters.archiveStatus === 'tam',
      onClick: () =>
        onFiltersChange({
          ...filters,
          archiveStatus: filters.archiveStatus === 'tam' ? 'all' : 'tam',
        }),
    },
    {
      label: '2–3 Bölüm Eksik',
      value: stats.missing2 + stats.missing3,
      sub: `${stats.missing2} ikili · ${stats.missing3} üçlü`,
      active: filters.missingCount === '2-3',
      onClick: () =>
        onFiltersChange({
          ...filters,
          missingCount: filters.missingCount === '2-3' ? 'all' : '2-3',
        }),
    },
  ];

  const qualityLabelShort = settings.strict1080p
    ? '1080p'
    : settings.minQualityHeight === 720
      ? '1080p/720p'
      : 'En Yüksek';

  return (
    <div className="space-y-5 min-w-0 w-full flex-1">
      {/* 4-column summary strip */}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
        {statCards.map((card) => (
          <button
            key={card.label}
            type="button"
            onClick={card.onClick}
            className={`min-w-0 text-left p-3 sm:p-4 rounded-xl border transition-colors bg-white dark:bg-slate-900 ${
              card.active
                ? 'border-blue-600 dark:border-blue-500 ring-1 ring-blue-600/20'
                : 'border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700'
            }`}
          >
            <div className="text-xs font-medium text-slate-500 dark:text-slate-400 truncate">
              {card.label}
            </div>
            <div className="mt-1 font-display text-2xl font-bold tabular-nums text-slate-900 dark:text-slate-100">
              {card.value}
            </div>
            <div className="mt-1 text-xs text-slate-500 dark:text-slate-400 tabular-nums truncate">
              {card.sub}
            </div>
          </button>
        ))}
      </div>

      {/* Search & Action Toolbar */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-3 flex flex-wrap items-center gap-2.5">
        <div className="relative flex-1 min-w-[220px]">
          <Search
            className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
            aria-hidden="true"
          />
          <input
            type="search"
            aria-label="Anime ara"
            value={filters.search}
            onChange={(e) => onFiltersChange({ ...filters, search: e.target.value })}
            placeholder="Anime adı veya slug ara..."
            className="w-full pl-9 pr-3 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-600"
          />
        </div>

        <select
          aria-label="Tür filtresi"
          value={filters.format}
          onChange={(e) => onFiltersChange({ ...filters, format: e.target.value })}
          className="px-3 py-2 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-700 dark:text-slate-200"
        >
          <option value="">Bütün türler</option>
          {availableFormats.map((fmt) => (
            <option key={fmt} value={fmt}>
              {fmt}
            </option>
          ))}
        </select>

        <select
          aria-label="Sıralama"
          value={filters.sortBy}
          onChange={(e) =>
            onFiltersChange({
              ...filters,
              sortBy: e.target.value as FilterState['sortBy'],
            })
          }
          className="px-3 py-2 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-700 dark:text-slate-200"
        >
          <option value="title">Ada göre (A–Z)</option>
          <option value="missing">Eksik sayısına göre</option>
          <option value="archive">Arşiv durumuna göre</option>
          <option value="year">Yıla göre (Yeni)</option>
        </select>

        <button
          type="button"
          onClick={handleSelectOneMissingVisible}
          className="px-3 py-2 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 whitespace-nowrap"
        >
          1 Bölümlükleri Seç
        </button>

        <button
          type="button"
          onClick={() =>
            onFiltersChange({ ...filters, showCompleted: !filters.showCompleted })
          }
          aria-pressed={Boolean(filters.showCompleted)}
          className={`inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg border transition-colors whitespace-nowrap ${
            filters.showCompleted
              ? 'border-emerald-400 dark:border-emerald-700 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-300'
              : 'border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800'
          }`}
        >
          <Eye className="w-3.5 h-3.5" aria-hidden="true" />
          <span>
            {filters.showCompleted
              ? `Tamamlananları Gizle (${completedAnimeCount})`
              : `Tamamlananları Göster (${completedAnimeCount})`}
          </span>
        </button>

        {!catalogScanStatus?.running && (
          <button
            type="button"
            onClick={() => onStartCatalogScan('incomplete')}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg border border-blue-200 dark:border-blue-800 bg-blue-50/80 dark:bg-blue-950/30 text-blue-700 dark:text-blue-300 hover:bg-blue-100 dark:hover:bg-blue-950/60 whitespace-nowrap"
          >
            <Globe className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Eksik Linkleri Tara (YOK/Kısmi)</span>
          </button>
        )}

        {selectedSlugs.size > 0 && (
          <button
            type="button"
            onClick={onClearSelection}
            className="px-3 py-2 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 whitespace-nowrap"
          >
            Seçimi Temizle ({selectedSlugs.size})
          </button>
        )}

        <button
          type="button"
          onClick={handleExportScript}
          className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 whitespace-nowrap"
        >
          <FileCode2 className="w-3.5 h-3.5" aria-hidden="true" />
          <span>yt-dlp Betiği</span>
        </button>
      </div>

      {catalogScanStatus?.running && (
        <div className="bg-blue-50/90 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-900 rounded-xl p-3 space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
            <div className="flex items-center gap-2 text-blue-900 dark:text-blue-200 min-w-0">
              <Loader2 className="w-4 h-4 animate-spin shrink-0" aria-hidden="true" />
              <span className="font-semibold">
                Türkçe Fansublar Taranıyor ({catalogScanStatus.processedAnime}/
                {catalogScanStatus.totalAnime} anime)
              </span>
              {catalogScanStatus.currentAnimeTitle && (
                <span className="truncate opacity-80">
                  · {catalogScanStatus.currentAnimeTitle}
                </span>
              )}
            </div>
            <div className="flex items-center gap-3 shrink-0">
              <span className="font-mono font-semibold text-emerald-700 dark:text-emerald-400">
                +{catalogScanStatus.addedLinksCount} yeni link ({catalogScanStatus.updatedAnimeCount} anime)
              </span>
              <button
                type="button"
                onClick={onCancelCatalogScan}
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium border border-red-200 dark:border-red-900 bg-white dark:bg-slate-900 text-red-700 dark:text-red-400 hover:bg-red-50"
              >
                <Square className="w-3 h-3" aria-hidden="true" />
                <span>Durdur</span>
              </button>
            </div>
          </div>
          <div className="w-full h-1.5 bg-blue-100 dark:bg-blue-950 rounded-full overflow-hidden">
            <div
              className="h-full bg-blue-600 transition-all duration-300"
              style={{
                width: `${
                  catalogScanStatus.totalAnime > 0
                    ? Math.round(
                        (catalogScanStatus.processedAnime / catalogScanStatus.totalAnime) * 100,
                      )
                    : 0
                }%`,
              }}
            />
          </div>
        </div>
      )}

      {/* Results count & batch action bar */}
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500 dark:text-slate-400">
        <span className="tabular-nums">
          {filtered.length} anime gösteriliyor (toplam {entries.length} kayıt
          {!filters.showCompleted && completedAnimeCount > 0
            ? ` · ${completedAnimeCount} tamamlanan gizli`
            : ''}
          )
        </span>
        {selectedSlugs.size > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium text-slate-900 dark:text-slate-100 tabular-nums mr-1">
              {selectedSlugs.size} anime seçili
            </span>
            <button
              type="button"
              disabled={isBatchSearchingFallback}
              onClick={onFallbackSearchSelected}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-50 whitespace-nowrap"
            >
              {isBatchSearchingFallback ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
              ) : (
                <Globe className="w-3.5 h-3.5" aria-hidden="true" />
              )}
              <span>
                {isBatchSearchingFallback ? 'Fansublar Taranıyor...' : 'Fansublardan Eksikleri Bul'}
              </span>
            </button>
            <button
              type="button"
              onClick={onProbeSelected}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 whitespace-nowrap"
            >
              <Search className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Seçilenleri {qualityLabelShort} Tara</span>
            </button>
            <button
              type="button"
              onClick={onEnqueueSelected}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-blue-600 hover:bg-blue-700 text-white whitespace-nowrap"
            >
              <Download className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Seçilen Eksikleri İndir</span>
            </button>
          </div>
        )}
      </div>

      {/* Main Table */}
      {filtered.length === 0 ? (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-10 text-center space-y-3">
          <p className="text-sm font-medium text-slate-800 dark:text-slate-200">
            Seçili filtrelere uyan anime bulunamadı.
          </p>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Arama terimini temizleyin veya farklı bir eksik bölüm sayısı seçin.
          </p>
          <button
            type="button"
            onClick={onResetFilters}
            className="inline-flex items-center px-4 py-2 rounded-lg text-xs font-semibold bg-blue-600 hover:bg-blue-700 text-white"
          >
            Filtreleri Sıfırla
          </button>
        </div>
      ) : (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800 text-xs font-medium text-slate-500 dark:text-slate-400 bg-slate-50/70 dark:bg-slate-950/40">
                  <th className="py-2.5 pl-4 pr-2 w-9">
                    <input
                      type="checkbox"
                      aria-label="Görünen tüm animeleri seç"
                      checked={
                        selectableVisible.length > 0 &&
                        selectableVisible.every((a) => selectedSlugs.has(a.slug))
                      }
                      onChange={(e) => {
                        if (e.target.checked) {
                          onSelectSlugs(selectableVisible.map((a) => a.slug));
                        } else {
                          onClearSelection();
                        }
                      }}
                      className="rounded border-slate-300 dark:border-slate-600 text-blue-600 focus:ring-blue-600"
                    />
                  </th>
                  <th className="py-2.5 px-3">Anime</th>
                  <th className="py-2.5 px-3">Eksik Bölümler</th>
                  <th className="py-2.5 px-3">Arşiv</th>
                  <th className="py-2.5 pr-4 pl-3 text-right">İşlem</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-sm">
                {visibleEntries.map((anime) => {
                  const isExpanded = expandedSlug === anime.slug;
                  const isSelected = selectedSlugs.has(anime.slug);
                  const totalLinks = Object.values(anime.f).reduce(
                    (sum, list) => sum + list.length,
                    0,
                  );
                  const downloadedCount = anime.miss.filter(
                    (ep) => Boolean(history[`${anime.slug}:${ep}`]),
                  ).length;
                  const allDone = anime.miss.length > 0 && downloadedCount === anime.miss.length;

                  return (
                    <Fragment key={anime.slug}>
                      <tr
                        className={`transition-colors ${
                          isSelected
                            ? 'bg-blue-50/50 dark:bg-blue-950/20'
                            : 'hover:bg-slate-50/80 dark:hover:bg-slate-800/30'
                        }`}
                      >
                        <td className="py-2.5 pl-4 pr-2 align-middle">
                          <input
                            type="checkbox"
                            aria-label={`${anime.t} seç`}
                            checked={isSelected}
                            onChange={() => onToggleSelectSlug(anime.slug)}
                            className="rounded border-slate-300 dark:border-slate-600 text-blue-600 focus:ring-blue-600"
                          />
                        </td>

                        <td className="py-2.5 px-3 align-middle">
                          <button
                            type="button"
                            onClick={() => handleToggleExpand(anime)}
                            aria-expanded={isExpanded}
                            className="group flex items-start gap-2 text-left"
                          >
                            <span className="mt-0.5 text-slate-400 group-hover:text-slate-700 dark:group-hover:text-slate-200">
                              {isExpanded ? (
                                <ChevronDown className="w-4 h-4" />
                              ) : (
                                <ChevronRight className="w-4 h-4" />
                              )}
                            </span>
                            <div>
                              <div className="font-semibold text-slate-900 dark:text-slate-100 group-hover:text-blue-600 dark:group-hover:text-blue-400 leading-snug">
                                {anime.t}
                              </div>
                              <div className="mt-0.5 text-xs text-slate-500 dark:text-slate-400 tabular-nums">
                                <span>{anime.fmt}</span>
                                <span aria-hidden="true"> · </span>
                                <span>{anime.yr || '—'}</span>
                                <span aria-hidden="true"> · </span>
                                <span>
                                  {anime.ec}/{anime.E} mevcut
                                </span>
                                {totalLinks > 0 && (
                                  <>
                                    <span aria-hidden="true"> · </span>
                                    <span>{totalLinks} oynatıcı</span>
                                  </>
                                )}
                                {downloadedCount > 0 && (
                                  <>
                                    <span aria-hidden="true"> · </span>
                                    <span className="font-semibold text-emerald-700 dark:text-emerald-400">
                                      {allDone
                                        ? 'Eksikler Tamamlandı'
                                        : `${downloadedCount}/${anime.miss.length} indirildi`}
                                    </span>
                                  </>
                                )}
                              </div>
                            </div>
                          </button>
                        </td>

                        <td className="py-2.5 px-3 align-middle">
                          <div className="flex flex-wrap items-center gap-1.5">
                            {anime.miss.map((ep) => {
                              const rec = history[`${anime.slug}:${ep}`];
                              const hasLinks = (anime.f[ep] ?? []).length > 0;
                              const cache = probeCache[`${anime.slug}:${ep}`];
                              const recHeight = cache?.recommended?.variant.height ?? 0;

                              return (
                                <button
                                  key={ep}
                                  type="button"
                                  onClick={() => handleToggleExpand(anime, ep)}
                                  title={
                                    rec
                                      ? `Bölüm ${ep} indirildi (${rec.quality}${rec.driveWebViewLink ? ' · Drive' : ''})`
                                      : hasLinks
                                        ? `Bölüm ${ep} oynatıcılarını aç`
                                        : `Bölüm ${ep} arşivde bulunamadı (harici fansub aranabilir)`
                                  }
                                  className={`px-2 py-0.5 text-xs font-mono font-medium rounded border transition-colors whitespace-nowrap ${
                                    rec
                                      ? 'border-emerald-400 dark:border-emerald-700 bg-emerald-100/80 dark:bg-emerald-950/70 text-emerald-800 dark:text-emerald-300'
                                      : recHeight >= 1080
                                        ? 'border-emerald-300 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-400'
                                        : recHeight >= 720
                                          ? 'border-blue-300 dark:border-blue-800 bg-blue-50 dark:bg-blue-950/50 text-blue-700 dark:text-blue-400'
                                          : hasLinks
                                            ? 'border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-800 dark:text-slate-200 hover:border-blue-500'
                                            : 'border-red-200 dark:border-red-900 bg-red-50/70 dark:bg-red-950/40 text-red-700 dark:text-red-400'
                                  }`}
                                >
                                  {rec ? `✓ #${ep} ${rec.quality}` : `#${ep}${recHeight >= 720 ? ` ${recHeight}p` : ''}`}
                                </button>
                              );
                            })}
                          </div>
                        </td>

                        <td className="py-2.5 px-3 align-middle whitespace-nowrap text-xs">
                          {allDone ? (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md font-semibold bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800">
                              <CheckCircle2 className="w-3.5 h-3.5" aria-hidden="true" />
                              <span>Tamamlandı</span>
                            </span>
                          ) : anime.d === 'tam' ? (
                            <span className="inline-flex items-center gap-1 font-medium text-emerald-700 dark:text-emerald-400">
                              <CheckCircle2 className="w-3.5 h-3.5" aria-hidden="true" />
                              <span>Tam</span>
                            </span>
                          ) : anime.d === 'kismi' ? (
                            <span className="inline-flex items-center gap-1 font-medium text-amber-700 dark:text-amber-400">
                              <AlertTriangle className="w-3.5 h-3.5" aria-hidden="true" />
                              <span>Kısmi</span>
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 font-medium text-red-600 dark:text-red-400">
                              <XCircle className="w-3.5 h-3.5" aria-hidden="true" />
                              <span>Yok</span>
                            </span>
                          )}
                        </td>

                        <td className="py-2.5 pr-4 pl-3 align-middle text-right whitespace-nowrap">
                          <div className="inline-flex items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => handleToggleExpand(anime)}
                              className="px-2.5 py-1.5 rounded-lg text-xs font-medium border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800"
                            >
                              {isExpanded ? 'Kapat' : 'İncele'}
                            </button>
                            {!allDone && (totalLinks > 0 || settings.autoFallbackSearch) && (
                              <button
                                type="button"
                                onClick={() => {
                                  for (const ep of anime.miss) {
                                    if (history[`${anime.slug}:${ep}`]) continue;
                                    if ((anime.f[ep] ?? []).length > 0 || settings.autoFallbackSearch) {
                                      onEnqueueEpisode(anime.slug, ep);
                                    }
                                  }
                                }}
                                className="px-2.5 py-1.5 rounded-lg text-xs font-semibold bg-blue-600 hover:bg-blue-700 text-white"
                              >
                                İndir
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>

                      {isExpanded && (
                        <tr>
                          <td colSpan={5} className="p-0">
                            <EpisodeInspector
                              anime={anime}
                              initialEpisode={expandedEpisode}
                              settings={settings}
                              probeCache={probeCache}
                              probingKeys={probingKeys}
                              fallbackReports={fallbackReports}
                              searchingFallbackKeys={searchingFallbackKeys}
                              jobs={jobs}
                              history={history}
                              onProbeEpisode={onProbeEpisode}
                              onFallbackSearchEpisode={onFallbackSearchEpisode}
                              onEnqueueEpisode={onEnqueueEpisode}
                            />
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>

          {filtered.length > visibleLimit && (
            <div className="p-3 border-t border-slate-200 dark:border-slate-800 text-center">
              <button
                type="button"
                onClick={() => setVisibleLimit((n) => n + 100)}
                className="px-4 py-2 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800"
              >
                Daha Fazla Göster ({filtered.length - visibleLimit} kaldı)
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
