import {
  AlertTriangle,
  CheckCircle2,
  Copy,
  Download,
  ExternalLink,
  Globe,
  Loader2,
  RefreshCw,
  Search,
  XCircle,
} from 'lucide-react';
import { useState } from 'react';
import { formatBytes, rankCandidateLinks } from '../shared/playerPriority.ts';
import type {
  AnimeEntry,
  DownloadedRecord,
  DownloadJob,
  DownloadSettings,
  EpisodeProbeSummary,
  FallbackSiteReport,
  ProbeResult,
} from '../shared/types.ts';

interface EpisodeInspectorProps {
  anime: AnimeEntry;
  initialEpisode: string;
  settings: DownloadSettings;
  probeCache: Record<string, EpisodeProbeSummary>;
  probingKeys: Record<string, boolean>;
  fallbackReports: Record<string, FallbackSiteReport[]>;
  searchingFallbackKeys: Record<string, boolean>;
  jobs: DownloadJob[];
  history: Record<string, DownloadedRecord>;
  onProbeEpisode: (slug: string, episode: string, forceRefresh?: boolean) => void;
  onFallbackSearchEpisode: (slug: string, episode: string) => void;
  onEnqueueEpisode: (
    slug: string,
    episode: string,
    preferUrl?: string,
    forceRedownload?: boolean,
  ) => void;
}

export function EpisodeInspector({
  anime,
  initialEpisode,
  settings,
  probeCache,
  probingKeys,
  fallbackReports,
  searchingFallbackKeys,
  jobs,
  history,
  onProbeEpisode,
  onFallbackSearchEpisode,
  onEnqueueEpisode,
}: EpisodeInspectorProps) {
  const [activeEp, setActiveEp] = useState<string>(initialEpisode || anime.miss[0] || '');
  const [copiedUrl, setCopiedUrl] = useState<string | null>(null);

  const currentEp = anime.miss.includes(activeEp) ? activeEp : anime.miss[0] || '';
  const cacheKey = `${anime.slug}:${currentEp}`;
  const summary = probeCache[cacheKey];
  const recorded = history[cacheKey];
  const isProbing = Boolean(probingKeys[cacheKey]);
  const isSearchingFallback = Boolean(searchingFallbackKeys[cacheKey]);
  const siteReports = fallbackReports[cacheKey] ?? [];

  const rawLinks = anime.f[currentEp] ?? [];
  const rankedLinks = rankCandidateLinks(
    rawLinks,
    settings.preferredPlayers,
    settings.preferredFansubs,
  );

  const probeByUrl = new Map<string, ProbeResult>();
  if (summary) {
    for (const r of summary.results) {
      probeByUrl.set(r.embedUrl, r);
    }
  }

  const activeJob = jobs.find(
    (j) =>
      j.slug === anime.slug &&
      j.episode === currentEp &&
      ['queued', 'paused', 'probing', 'downloading', 'muxing', 'uploading_drive'].includes(
        j.status,
      ),
  );

  const copyUrl = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      setCopiedUrl(url);
      setTimeout(() => setCopiedUrl(null), 1500);
    } catch {
      // ignore clipboard errors
    }
  };

  const qualityText = settings.strict1080p
    ? '1080p'
    : settings.minQualityHeight === 720
      ? '1080p / 720p'
      : 'En Yüksek';

  return (
    <div className="px-4 py-4 bg-slate-50/80 dark:bg-slate-950/60 border-t border-slate-200 dark:border-slate-800 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs font-medium text-slate-600 dark:text-slate-400">
            Eksik Bölümler:
          </span>
          <div className="flex items-center gap-1 p-0.5 bg-slate-200/70 dark:bg-slate-800 rounded-lg">
            {anime.miss.map((ep) => {
              const hasLinks = (anime.f[ep] ?? []).length > 0;
              const isSelected = ep === currentEp;
              const isDone = Boolean(history[`${anime.slug}:${ep}`]);
              return (
                <button
                  key={ep}
                  type="button"
                  onClick={() => setActiveEp(ep)}
                  className={`px-2.5 py-1 text-xs font-mono font-medium rounded-md transition-colors whitespace-nowrap ${
                    isSelected
                      ? 'bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 shadow-xs'
                      : isDone
                        ? 'text-emerald-700 dark:text-emerald-400 font-semibold'
                        : hasLinks
                          ? 'text-slate-700 dark:text-slate-300 hover:text-slate-900'
                          : 'text-red-600 dark:text-red-400'
                  }`}
                >
                  {isDone ? `✓ Bölüm ${ep}` : `Bölüm ${ep}`}
                </button>
              );
            })}
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <a
            href={`https://berke-aras.github.io/turkanime-arsiv/#anime=${encodeURIComponent(anime.slug)}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 whitespace-nowrap"
          >
            <span>TürkAnime Arşivi</span>
            <ExternalLink className="w-3 h-3" aria-hidden="true" />
          </a>

          <button
            type="button"
            disabled={isSearchingFallback}
            onClick={() => onFallbackSearchEpisode(anime.slug, currentEp)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-50 whitespace-nowrap"
          >
            {isSearchingFallback ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
            ) : (
              <Globe className="w-3.5 h-3.5" aria-hidden="true" />
            )}
            <span>
              {isSearchingFallback
                ? 'Fansublar Aranıyor...'
                : 'Tüm Fansublardan Ara'}
            </span>
          </button>

          {rankedLinks.length > 0 && (
            <button
              type="button"
              disabled={isProbing}
              onClick={() => onProbeEpisode(anime.slug, currentEp, Boolean(summary))}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-50 whitespace-nowrap"
            >
              {isProbing ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
              ) : summary ? (
                <RefreshCw className="w-3.5 h-3.5" aria-hidden="true" />
              ) : (
                <Search className="w-3.5 h-3.5" aria-hidden="true" />
              )}
              <span>
                {isProbing ? 'Taranıyor...' : summary ? 'Yeniden Tara' : `${qualityText} Tara`}
              </span>
            </button>
          )}

          {(rankedLinks.length > 0 || settings.autoFallbackSearch) && (
            <button
              type="button"
              disabled={Boolean(activeJob)}
              onClick={() =>
                onEnqueueEpisode(anime.slug, currentEp, undefined, Boolean(recorded))
              }
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50 whitespace-nowrap"
            >
              <Download className="w-3.5 h-3.5" aria-hidden="true" />
              <span>
                {activeJob
                  ? 'Kuyrukta'
                  : recorded
                    ? 'Tekrar İndir'
                    : `Otomatik ${qualityText} İndir`}
              </span>
            </button>
          )}
        </div>
      </div>

      {recorded && (
        <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 rounded-lg border border-emerald-200 dark:border-emerald-900/60 bg-emerald-50/70 dark:bg-emerald-950/30 text-xs">
          <div className="flex items-center gap-2 text-emerald-800 dark:text-emerald-300">
            <CheckCircle2 className="w-4 h-4 shrink-0" aria-hidden="true" />
            <span>
              Bu bölüm daha önce indirildi: <strong>{recorded.quality}</strong> ·{' '}
              {recorded.fansub} ({recorded.player})
            </span>
          </div>
          {recorded.driveWebViewLink && (
            <a
              href={recorded.driveWebViewLink}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 font-semibold text-emerald-800 dark:text-emerald-300 underline hover:no-underline whitespace-nowrap"
            >
              <span>Drive&apos;da Aç</span>
              <ExternalLink className="w-3 h-3" aria-hidden="true" />
            </a>
          )}
        </div>
      )}

      {siteReports.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
          {siteReports.map((rep) => (
            <div
              key={rep.site}
              className={`flex items-start justify-between gap-2 px-3 py-2 rounded-lg border text-xs ${
                rep.status === 'found'
                  ? 'border-emerald-200 dark:border-emerald-900/60 bg-emerald-50/60 dark:bg-emerald-950/30 text-emerald-900 dark:text-emerald-200'
                  : rep.status === 'blocked'
                    ? 'border-amber-200 dark:border-amber-900/60 bg-amber-50/60 dark:bg-amber-950/30 text-amber-900 dark:text-amber-200'
                    : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300'
              }`}
            >
              <div className="space-y-0.5 min-w-0">
                <div className="font-semibold flex items-center gap-1.5">
                  {rep.status === 'found' ? (
                    <CheckCircle2 className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                  ) : rep.status === 'blocked' ? (
                    <AlertTriangle className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                  ) : (
                    <XCircle className="w-3.5 h-3.5 shrink-0 opacity-70" aria-hidden="true" />
                  )}
                  <span>{rep.site}</span>
                </div>
                <p className="text-[11px] opacity-90">{rep.message}</p>
              </div>
              <a
                href={rep.episodeUrl || rep.animeUrl || rep.searchUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-[11px] font-medium underline hover:no-underline whitespace-nowrap shrink-0"
              >
                <span>Siteyi Aç</span>
                <ExternalLink className="w-3 h-3" aria-hidden="true" />
              </a>
            </div>
          ))}
        </div>
      )}

      {summary?.recommended && (
        <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 rounded-lg border border-emerald-200 dark:border-emerald-900/60 bg-emerald-50/70 dark:bg-emerald-950/30 text-xs">
          <div className="flex items-center gap-2 text-emerald-800 dark:text-emerald-300">
            <CheckCircle2 className="w-4 h-4 shrink-0" aria-hidden="true" />
            <span>
              Önerilen kaynak: <strong>{summary.recommended.probe.player}</strong> ·{' '}
              {summary.recommended.probe.fansub} ·{' '}
              <span className="font-mono font-semibold">
                {summary.recommended.variant.qualityLabel}
              </span>
              {summary.recommended.variant.sizeBytes
                ? ` · ${formatBytes(summary.recommended.variant.sizeBytes)}`
                : ''}
            </span>
          </div>
          <button
            type="button"
            onClick={() =>
              onEnqueueEpisode(anime.slug, currentEp, summary.recommended?.probe.embedUrl)
            }
            className="font-semibold text-emerald-800 dark:text-emerald-300 underline hover:no-underline whitespace-nowrap"
          >
            Bu Kaynaktan İndir
          </button>
        </div>
      )}

      {rankedLinks.length === 0 ? (
        <div className="py-6 px-4 text-center border border-dashed border-slate-300 dark:border-slate-700 rounded-lg space-y-3">
          <p className="text-xs text-slate-600 dark:text-slate-300">
            Bölüm {currentEp} için ana arşivde kayıtlı oynatıcı linki bulunmuyor.
          </p>
          <div className="flex flex-wrap items-center justify-center gap-2">
            <button
              type="button"
              disabled={isSearchingFallback}
              onClick={() => onFallbackSearchEpisode(anime.slug, currentEp)}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-semibold bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50"
            >
              {isSearchingFallback ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
              ) : (
                <Globe className="w-3.5 h-3.5" aria-hidden="true" />
              )}
              <span>
                {isSearchingFallback
                  ? 'Harici Fansublar Taranıyor...'
                  : 'Tüm Fansublarda Kaynak Ara'}
              </span>
            </button>
            <a
              href={`https://turkanimeizle.com/arama?q=${encodeURIComponent(anime.t)}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 px-3 py-2 rounded-lg text-xs font-medium border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800"
            >
              <span>TürkAnime İzle</span>
              <ExternalLink className="w-3 h-3" aria-hidden="true" />
            </a>
            <a
              href={`https://www.animeizle.pro/?s=${encodeURIComponent(anime.t)}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 px-3 py-2 rounded-lg text-xs font-medium border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800"
            >
              <span>Animeİzle.pro</span>
              <ExternalLink className="w-3 h-3" aria-hidden="true" />
            </a>
            <a
              href={`https://www.tranimeizle.io/arama?q=${encodeURIComponent(anime.t)}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 px-3 py-2 rounded-lg text-xs font-medium border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800"
            >
              <span>TrAnimeİzle</span>
              <ExternalLink className="w-3 h-3" aria-hidden="true" />
            </a>
          </div>
        </div>
      ) : (
        <div className="overflow-x-auto border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400 bg-slate-50 dark:bg-slate-950/40">
                <th className="py-2 px-3 font-medium">Fansub</th>
                <th className="py-2 px-3 font-medium">Oynatıcı</th>
                <th className="py-2 px-3 font-medium">Kalite / Durum</th>
                <th className="py-2 px-3 font-medium">Embed Linki</th>
                <th className="py-2 px-3 font-medium text-right">İşlem</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {rankedLinks.map(([fansub, player, url], idx) => {
                const probe = probeByUrl.get(url);
                const maxVar = probe?.variants.reduce(
                  (best, cur) => (cur.height > best.height ? cur : best),
                  probe.variants[0],
                );

                return (
                  <tr
                    key={`${url}-${idx}`}
                    className="hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors"
                  >
                    <td className="py-2 px-3 font-medium text-slate-800 dark:text-slate-200 whitespace-nowrap">
                      {fansub}
                    </td>
                    <td className="py-2 px-3 font-mono text-[11px] text-slate-700 dark:text-slate-300 whitespace-nowrap">
                      {player}
                    </td>
                    <td className="py-2 px-3 whitespace-nowrap">
                      {!probe ? (
                        <span className="text-slate-400 dark:text-slate-500">Taranmadı</span>
                      ) : probe.status === 'ok' ? (
                        <span
                          className={`inline-flex items-center gap-1 font-mono font-medium ${
                            probe.has1080p
                              ? 'text-emerald-700 dark:text-emerald-400'
                              : 'text-blue-700 dark:text-blue-400'
                          }`}
                        >
                          <CheckCircle2 className="w-3.5 h-3.5" aria-hidden="true" />
                          <span>
                            {maxVar?.qualityLabel || 'Aktif'}
                            {maxVar?.sizeBytes ? ` · ${formatBytes(maxVar.sizeBytes)}` : ''}
                          </span>
                        </span>
                      ) : probe.status === 'unsupported' ? (
                        <span className="inline-flex items-center gap-1 text-amber-700 dark:text-amber-400">
                          <AlertTriangle className="w-3.5 h-3.5" aria-hidden="true" />
                          <span>{probe.message || 'Harici / yt-dlp'}</span>
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-red-600 dark:text-red-400">
                          <XCircle className="w-3.5 h-3.5" aria-hidden="true" />
                          <span>{probe.message || 'Erişilemiyor'}</span>
                        </span>
                      )}
                    </td>
                    <td className="py-2 px-3 max-w-[280px] truncate font-mono text-[11px] text-slate-500 dark:text-slate-400">
                      <a
                        href={url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="hover:text-blue-600 dark:hover:text-blue-400 hover:underline"
                        title={url}
                      >
                        {url}
                      </a>
                    </td>
                    <td className="py-2 px-3 text-right whitespace-nowrap">
                      <div className="inline-flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => copyUrl(url)}
                          aria-label={`Linki kopyala: ${player}`}
                          className="p-1 rounded text-slate-500 hover:text-slate-900 dark:hover:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-800"
                        >
                          <Copy className="w-3.5 h-3.5" />
                        </button>
                        {copiedUrl === url && (
                          <span className="text-[11px] text-emerald-600 dark:text-emerald-400">
                            Kopyalandı
                          </span>
                        )}
                        <button
                          type="button"
                          onClick={() =>
                            onEnqueueEpisode(anime.slug, currentEp, url, Boolean(recorded))
                          }
                          className="px-2 py-1 rounded text-[11px] font-medium border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800"
                        >
                          {recorded ? 'Tekrar' : 'İndir'}
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
