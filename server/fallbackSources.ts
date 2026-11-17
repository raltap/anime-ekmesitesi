import type { AnimeEntry, FallbackSiteReport, PlayerLink } from '../src/shared/types.ts';

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

export interface SearchCandidate {
  title: string;
  url: string;
  year?: string;
}

export interface TranslatorOption {
  name: string;
  sourcesUrl: string;
}

export interface AnimeIzleProPart {
  pageUrl: string;
  playerName: string;
}

export function decodeBasicHtmlEntities(text: string): string {
  return text
    .replace(/&#8211;|&ndash;/gi, '–')
    .replace(/&#8212;|&mdash;/gi, '—')
    .replace(/&#8217;|&#039;|&#39;/gi, "'")
    .replace(/&#8220;|&#8221;|&quot;/gi, '"')
    .replace(/&#038;|&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&nbsp;/gi, ' ');
}

export function normalizeSearchQueries(title: string, slug: string, altTitle?: string): string[] {
  const queries = new Set<string>();
  const addClean = (raw: string) => {
    const trimmed = raw.trim();
    if (!trimmed) return;
    queries.add(trimmed);
    const clean = trimmed
      .replace(/\((?:TV|OVA|ONA|Special|Movie|Recap|Recaps|\d{4})\)/gi, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (clean && clean !== trimmed) queries.add(clean);
    const beforeColon = clean.split(/[:\-–]/)[0]?.trim();
    if (beforeColon && beforeColon.length >= 3) {
      queries.add(beforeColon);
    }
  };

  addClean(title);
  if (altTitle && altTitle.trim() && altTitle.trim() !== title.trim()) {
    addClean(altTitle);
  }

  const slugWords = slug
    .replace(/-(?:tv|ova|ona|specials?|recaps?)$/i, '')
    .replace(/-/g, ' ')
    .trim();
  if (slugWords && slugWords.length >= 3) {
    queries.add(slugWords);
  }

  return Array.from(queries).slice(0, 5);
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

const FORMAT_AND_TAG_WORDS = new Set([
  'tv',
  'ova',
  'ona',
  'movie',
  'special',
  'specials',
  'recap',
  'recaps',
  '2nd',
  '3rd',
  'final',
  'season',
]);

export function scoreTitleMatch(
  queryTitle: string,
  candidateTitle: string,
  candidateUrl: string,
  querySlug: string,
  yr?: string | number,
): number {
  const urlSlug = candidateUrl.replace(/\/+$/, '').split('/').pop()?.toLowerCase() || '';
  const qSlug = querySlug.toLowerCase();
  if (urlSlug === qSlug) return 1000;

  const qNorm = tokenize(queryTitle).join(' ');
  const cNorm = tokenize(candidateTitle).join(' ');
  if (qNorm && cNorm === qNorm) return 900;

  const qTokens = new Set(tokenize(queryTitle));
  const cTokens = new Set(tokenize(candidateTitle));
  if (!qTokens.size || !cTokens.size) return 0;

  let overlap = 0;
  for (const t of qTokens) {
    if (cTokens.has(t)) overlap++;
  }
  if (overlap === 0) return 0;

  const unionSize = new Set([...qTokens, ...cTokens]).size;
  let score = Math.round((overlap / unionSize) * 500);

  // Count non-tag tokens missing from either side to avoid false matches like "Air" -> "Air Gear"
  const extraNonTagInCandidate = [...cTokens].filter(
    (t) => !qTokens.has(t) && !FORMAT_AND_TAG_WORDS.has(t) && !/^\d{4}$/.test(t),
  );
  const extraNonTagInQuery = [...qTokens].filter(
    (t) => !cTokens.has(t) && !FORMAT_AND_TAG_WORDS.has(t) && !/^\d{4}$/.test(t),
  );

  // Only grant substring inclusion bonus when query is multi-word OR candidate doesn't introduce unrelated core words
  if (qNorm && cNorm.includes(qNorm) && (qTokens.size >= 2 || extraNonTagInCandidate.length === 0)) {
    score += 120;
  }

  // Strongly penalize short single-word queries matching longer multi-word titles (e.g. "Air" vs "Air Gear")
  if (qTokens.size === 1 && extraNonTagInCandidate.length > 0) {
    score -= extraNonTagInCandidate.length * 180;
  }

  // Mild penalty when both sides have extra non-tag tokens (different subtitle/arc)
  if (extraNonTagInQuery.length > 0 && extraNonTagInCandidate.length > 0) {
    score -= Math.min(160, extraNonTagInCandidate.length * 60);
  }

  const yrStr = yr ? String(yr).trim() : '';
  if (yrStr) {
    if (candidateTitle.includes(yrStr) || urlSlug.includes(yrStr)) {
      score += 80;
    } else {
      const otherYear = candidateTitle.match(/\b(19\d{2}|20\d{2})\b/)?.[1];
      if (otherYear && otherYear !== yrStr) {
        score -= 120;
      }
    }
  }

  // Penalize mismatch on special keywords like OVA/Movie/2nd Season if not in query
  for (const tag of ['ova', 'movie', 'special', 'recap', '2nd', '3rd', 'final']) {
    const inQ = qTokens.has(tag);
    const inC = cTokens.has(tag);
    if (inQ !== inC) score -= 90;
  }

  return score;
}

export function parseTurkAnimeIzleSearchSuggestions(json: unknown): SearchCandidate[] {
  if (!json || typeof json !== 'object') return [];
  const results = (json as { results?: unknown }).results;
  if (!Array.isArray(results)) return [];

  const out: SearchCandidate[] = [];
  for (const item of results) {
    if (!item || typeof item !== 'object') continue;
    const obj = item as { title?: unknown; url?: unknown; year?: unknown };
    if (typeof obj.title === 'string' && typeof obj.url === 'string' && obj.url.startsWith('http')) {
      const title = decodeBasicHtmlEntities(obj.title.trim());
      if (/^\d+(?:[.,]\d+)?$/.test(title)) continue;
      out.push({
        title,
        url: obj.url.trim(),
        year: obj.year ? String(obj.year) : undefined,
      });
    }
  }
  return out;
}

export function parseTurkAnimeIzleSearchHtml(html: string): SearchCandidate[] {
  const candidates = new Map<string, SearchCandidate>();
  const regex =
    /<a[^>]+href="(https:\/\/turkanimeizle\.com\/([a-z0-9-]+))"[^>]*>([\s\S]*?)<\/a>/gi;
  const ignoreSlugs = new Set([
    'arama',
    'yeniler',
    'takvim',
    'magaza',
    'girisyap',
    'uyeol',
    'kategoriler',
    'temalar',
  ]);

  let m: RegExpExecArray | null;
  while ((m = regex.exec(html)) !== null) {
    const url = m[1];
    const slugPart = m[2];
    if (ignoreSlugs.has(slugPart) || slugPart.includes('bolum-izle')) continue;

    const rawText = decodeBasicHtmlEntities(
      m[3].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(),
    );
    const titleAttr = m[0].match(/title="([^"]+)"/i)?.[1]?.trim();
    const cleanedAttr = titleAttr ? decodeBasicHtmlEntities(titleAttr) : '';

    // Ignore numeric rating badges like "5.4", "7.5", "8.1"
    const usableText = /^\d+(?:[.,]\d+)?$/.test(rawText) ? '' : rawText;
    const title = cleanedAttr || usableText;
    if (!title || title.length < 2 || /^\d+(?:[.,]\d+)?$/.test(title)) continue;

    if (!candidates.has(url)) {
      candidates.set(url, { title, url });
    }
  }

  return Array.from(candidates.values());
}

export function parseTurkAnimeIzleEpisodeLinks(html: string): string[] {
  const links = new Set<string>();
  const regex = /href="(https:\/\/turkanimeizle\.com\/[^"]*-bolum[^"]*)"/gi;
  let m: RegExpExecArray | null;
  while ((m = regex.exec(html)) !== null) {
    links.add(m[1]);
  }
  return Array.from(links);
}

export function parseAnimeIzleProSearchHtml(html: string): SearchCandidate[] {
  const candidates = new Map<string, SearchCandidate>();
  const regex =
    /<a[^>]+href="(https?:\/\/(?:www\.)?animeizle\.pro\/dizi\/([^"/?#]+)\/?)"[^>]*>([\s\S]*?)<\/a>/gi;

  let m: RegExpExecArray | null;
  while ((m = regex.exec(html)) !== null) {
    const url = m[1].replace(/^http:/i, 'https:');
    const rawInner = m[3];
    const titleAttr = m[0].match(/title="([^"]+)"/i)?.[1]?.trim();
    const imgAlt = rawInner.match(/<img[^>]+alt="([^"]+)"/i)?.[1]?.trim();
    const textInner = decodeBasicHtmlEntities(
      rawInner.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(),
    );
    const chosen =
      (textInner && !/^\d+(?:[.,]\d+)?$/.test(textInner) ? textInner : '') ||
      (titleAttr ? decodeBasicHtmlEntities(titleAttr) : '') ||
      (imgAlt ? decodeBasicHtmlEntities(imgAlt) : '');

    if (!chosen || chosen.length < 2) continue;

    const existing = candidates.get(url);
    if (!existing || (textInner && textInner.length > existing.title.length)) {
      candidates.set(url, { title: chosen, url });
    }
  }

  return Array.from(candidates.values());
}

export function parseAnimeIzleProEpisodeLinks(html: string): string[] {
  const links = new Set<string>();
  const regex = /href="(https?:\/\/(?:www\.)?animeizle\.pro\/bolum\/[^"#?]+\/?)"/gi;
  let m: RegExpExecArray | null;
  while ((m = regex.exec(html)) !== null) {
    links.add(m[1].replace(/^http:/i, 'https:'));
  }
  return Array.from(links);
}

export function parseAnimeIzleProEpisodeParts(html: string): AnimeIzleProPart[] {
  const section = html.match(/id="action-parts"[\s\S]*?<\/ul>/i)?.[0] || '';
  if (!section) return [];

  const parts: AnimeIzleProPart[] = [];
  const seen = new Set<string>();
  const linkRegex = /<li[^>]*>\s*<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = linkRegex.exec(section)) !== null) {
    const pageUrl = m[1].trim().replace(/^http:/i, 'https:');
    if (!pageUrl.startsWith('http') || seen.has(pageUrl)) continue;
    seen.add(pageUrl);
    const nameMatch = m[2].match(/class="part-name"[^>]*>([^<]+)/i);
    const playerName = decodeBasicHtmlEntities((nameMatch?.[1] || '').trim());
    parts.push({ pageUrl, playerName });
  }
  return parts;
}

export function findMatchingEpisodeUrl(episodeLinks: string[], episode: string): string | null {
  const epClean = episode.trim();
  const isNumeric = /^\d+$/.test(epClean);
  const epNum = isNumeric ? Number(epClean) : NaN;
  const epUnpadded = isNumeric ? String(epNum) : epClean;
  const epPadded = isNumeric ? epUnpadded.padStart(2, '0') : epClean;

  const patterns = [
    new RegExp(`(?<!-\\d+)-(?:${epUnpadded}|${epPadded})-bolum(?:-final)?-izle(?:$|\\?|#|/)`, 'i'),
    new RegExp(`(?<!-\\d+)-(?:ova-|special-)?(?:${epUnpadded}|${epPadded})-bolum`, 'i'),
    new RegExp(`(?<!-\\d+)-(?:ova|special)-(?:0*${epUnpadded})(?:-|/|$|\\?|#)`, 'i'),
    new RegExp(`(?<!-\\d+)(?:bolum-|episode-|/)0*${epUnpadded}(?:-|/|$|\\?|#)`, 'i'),
  ];

  for (const pattern of patterns) {
    const found = episodeLinks.find((u) => pattern.test(u));
    if (found) return found;
  }

  // Fallback for combined OVA/multi-episode pages such as "...-ova-1-2-bolum-izle"
  if (isNumeric) {
    for (const url of episodeLinks) {
      const rangeMatch = url.match(/-(?:ova-|special-)?(\d+)-(\d+)-(?:bolum|izle)/i);
      if (rangeMatch) {
        const start = Number(rangeMatch[1]);
        const end = Number(rangeMatch[2]);
        if (start <= end && end - start <= 6 && epNum >= start && epNum <= end) {
          return url;
        }
      }
    }
  }

  return null;
}

export function parseTurkAnimeIzleTranslators(html: string): TranslatorOption[] {
  const options: TranslatorOption[] = [];
  const seen = new Set<string>();
  const btnRegex = /<button[^>]*data-v3-translator[^>]*>/gi;
  let m: RegExpExecArray | null;

  while ((m = btnRegex.exec(html)) !== null) {
    const tag = m[0];
    const sourcesUrl = tag.match(/data-sources="([^"]+)"/i)?.[1];
    if (!sourcesUrl || seen.has(sourcesUrl)) continue;
    seen.add(sourcesUrl);

    const title = tag.match(/title="([^"]+)"/i)?.[1]?.trim();
    options.push({
      name: title || 'TürkAnime İzle',
      sourcesUrl,
    });
  }

  return options;
}

export function canonicalizeFallbackPlayerName(playerName: string, resolvedUrl: string): string {
  const lowerUrl = resolvedUrl.toLowerCase();
  const lowerName = playerName.toLowerCase();

  if (lowerUrl.includes('ok.ru') || lowerUrl.includes('odnoklassniki') || lowerName.includes('odnoklassniki')) {
    return 'ODNOKLASSNIKI';
  }
  if (lowerUrl.includes('anizmplayer.com') || lowerName.includes('aincrad') || lowerName.includes('anizm')) {
    return 'ANIZMPLAYER';
  }
  if (lowerUrl.includes('sibnet.ru') || lowerName.includes('sibnet')) {
    return 'SIBNET';
  }
  if (lowerUrl.includes('mail.ru') || lowerName.includes('mail')) {
    return 'MAIL';
  }
  if (lowerUrl.includes('mp4upload.com') || lowerName.includes('mp4upload')) {
    return 'MP4UPLOAD';
  }
  if (lowerUrl.includes('sendvid.com') || lowerName.includes('sendvid')) {
    return 'SENDVID';
  }
  if (lowerUrl.includes('voe.sx') || lowerName.includes('voe')) {
    return 'VOE';
  }
  if (lowerUrl.includes('vk.com') || lowerUrl.includes('vkvideo.ru') || lowerName === 'vk') {
    return 'VK';
  }
  if (lowerUrl.includes('uqload.') || lowerName.includes('uqload')) {
    return 'UQLOAD';
  }
  if (lowerUrl.includes('vidmoly.') || lowerName.includes('vidmoly')) {
    return 'VIDMOLY';
  }
  if (lowerUrl.includes('drive.google.com') || lowerName.includes('gdrive')) {
    return 'GDRIVE';
  }
  if (lowerUrl.includes('dood') || lowerName.includes('dood')) {
    return 'DOODSTREAM';
  }

  return playerName.trim().toUpperCase().replace(/[^A-Z0-9._-]+/g, '_') || 'HARICI';
}

export function extractIframeEmbedsFromHtml(
  html: string,
  fansubLabel = 'TrAnimeİzle',
  hintedPlayerName = '',
): PlayerLink[] {
  const links: PlayerLink[] = [];
  const seen = new Set<string>();
  const iframeRegex = /<iframe[^>]+src=["']([^"']+)["'][^>]*>/gi;
  let m: RegExpExecArray | null;

  while ((m = iframeRegex.exec(html)) !== null) {
    let url = m[1].trim();
    if (url.startsWith('//')) url = `https:${url}`;
    if (!url.startsWith('http')) continue;
    if (/google\.com\/recaptcha|googlesyndication|doubleclick|facebook|twitter|yandex|chatango|disqus|youtube\.com\/subscribe/i.test(url)) {
      continue;
    }
    if (seen.has(url)) continue;
    seen.add(url);

    const player = canonicalizeFallbackPlayerName(hintedPlayerName, url);
    links.push([fansubLabel, player, url]);
  }
  return links;
}

async function fetchPage(
  url: string,
  extraHeaders: Record<string, string> = {},
  timeoutMs = 8000,
): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, {
      signal: ctrl.signal,
      redirect: 'follow',
      headers: {
        'User-Agent': USER_AGENT,
        'Accept-Language': 'tr-TR,tr;q=0.9,en-US;q=0.8,en;q=0.7',
        ...extraHeaders,
      },
    });
  } finally {
    clearTimeout(timer);
  }
}

interface ResolvedAnimePage {
  site: FallbackSiteReport['site'];
  searchUrl: string;
  matchedCandidate?: SearchCandidate;
  episodeLinks: string[];
  blocked?: boolean;
  error?: string;
}

export async function resolveTurkAnimeIzleAnimePage(anime: AnimeEntry): Promise<ResolvedAnimePage> {
  const queries = normalizeSearchQueries(anime.t, anime.slug, anime.at);
  const primaryQuery = queries[0] || anime.t;
  const searchUrl = `https://turkanimeizle.com/arama?q=${encodeURIComponent(primaryQuery)}`;

  try {
    const candidates: SearchCandidate[] = [];
    for (const q of queries) {
      const sugRes = await fetchPage(
        `https://turkanimeizle.com/arama-onerileri?q=${encodeURIComponent(q)}`,
        { Accept: 'application/json' },
      );
      if (sugRes.ok) {
        const json = await sugRes.json().catch(() => null);
        candidates.push(...parseTurkAnimeIzleSearchSuggestions(json));
      }
      if (candidates.length >= 3) break;
    }

    const bestSugScore = candidates.reduce(
      (max, c) =>
        Math.max(
          max,
          scoreTitleMatch(anime.t, c.title, c.url, anime.slug, anime.yr),
          anime.at ? scoreTitleMatch(anime.at, c.title, c.url, anime.slug, anime.yr) : 0,
        ),
      0,
    );

    // Search HTML page if autocomplete returned too few or low-confidence results
    if (candidates.length < 2 || bestSugScore < 250) {
      for (const q of queries.slice(0, 2)) {
        const htmlRes = await fetchPage(
          `https://turkanimeizle.com/arama?q=${encodeURIComponent(q)}`,
        );
        if (htmlRes.status === 403 || htmlRes.status === 429) {
          return {
            site: 'TürkAnime İzle',
            searchUrl,
            episodeLinks: [],
            blocked: true,
            error: `Sunucu IP erişimi kısıtlandı (HTTP ${htmlRes.status}). Tarayıcıda doğrudan açabilirsiniz.`,
          };
        }
        if (htmlRes.ok) {
          const html = await htmlRes.text();
          const parsedHtml = parseTurkAnimeIzleSearchHtml(html);
          candidates.push(...parsedHtml);
          if (parsedHtml.length > 0) break;
        }
      }
    }

    const directSlugUrl = `https://turkanimeizle.com/${encodeURIComponent(anime.slug)}`;
    if (!candidates.some((c) => c.url === directSlugUrl)) {
      candidates.push({ title: anime.t, url: directSlugUrl, year: anime.yr ? String(anime.yr) : undefined });
    }

    const deduped = Array.from(new Map(candidates.map((c) => [c.url, c])).values());
    const scored = deduped
      .map((c) => ({
        candidate: c,
        score: Math.max(
          scoreTitleMatch(anime.t, c.title, c.url, anime.slug, anime.yr),
          anime.at ? scoreTitleMatch(anime.at, c.title, c.url, anime.slug, anime.yr) : 0,
        ),
      }))
      .filter((item) => item.score >= 160)
      .sort((a, b) => b.score - a.score);

    for (const item of scored.slice(0, 3)) {
      const animeRes = await fetchPage(item.candidate.url);
      if (!animeRes.ok) continue;
      const animeHtml = await animeRes.text();
      const epLinks = parseTurkAnimeIzleEpisodeLinks(animeHtml);
      if (epLinks.length > 0) {
        return {
          site: 'TürkAnime İzle',
          searchUrl,
          matchedCandidate: item.candidate,
          episodeLinks: epLinks,
        };
      }
    }

    return {
      site: 'TürkAnime İzle',
      searchUrl,
      matchedCandidate: scored[0]?.candidate,
      episodeLinks: [],
    };
  } catch (err) {
    return {
      site: 'TürkAnime İzle',
      searchUrl,
      episodeLinks: [],
      error: err instanceof Error ? err.message : 'Bağlantı hatası',
    };
  }
}

async function fetchTurkAnimeIzleEpisodeLinks(
  resolved: ResolvedAnimePage,
  episode: string,
): Promise<{ report: FallbackSiteReport; links: PlayerLink[] }> {
  if (resolved.blocked) {
    return {
      links: [],
      report: {
        site: 'TürkAnime İzle',
        status: 'blocked',
        message: resolved.error || 'Erişim kısıtlandı.',
        searchUrl: resolved.searchUrl,
        foundCount: 0,
      },
    };
  }

  if (resolved.error) {
    return {
      links: [],
      report: {
        site: 'TürkAnime İzle',
        status: 'error',
        message: resolved.error,
        searchUrl: resolved.searchUrl,
        foundCount: 0,
      },
    };
  }

  if (!resolved.matchedCandidate) {
    return {
      links: [],
      report: {
        site: 'TürkAnime İzle',
        status: 'not_found',
        message: 'Eşleşen anime sayfası bulunamadı.',
        searchUrl: resolved.searchUrl,
        foundCount: 0,
      },
    };
  }

  const animeUrl = resolved.matchedCandidate.url;
  const episodeUrl = findMatchingEpisodeUrl(resolved.episodeLinks, episode);
  if (!episodeUrl) {
    return {
      links: [],
      report: {
        site: 'TürkAnime İzle',
        status: 'not_found',
        message: `${resolved.matchedCandidate.title} içinde Bölüm ${episode} bulunamadı (${resolved.episodeLinks.length} bölüm mevcut).`,
        searchUrl: resolved.searchUrl,
        animeUrl,
        foundCount: 0,
      },
    };
  }

  try {
    const epRes = await fetchPage(episodeUrl);
    if (!epRes.ok) {
      return {
        links: [],
        report: {
          site: 'TürkAnime İzle',
          status: 'error',
          message: `Bölüm sayfası açılamadı (HTTP ${epRes.status}).`,
          searchUrl: resolved.searchUrl,
          animeUrl,
          episodeUrl,
          foundCount: 0,
        },
      };
    }

    const setCookies = epRes.headers.getSetCookie?.() ?? [];
    const cookieHeader = setCookies.map((c) => c.split(';')[0]).join('; ');
    const epHtml = await epRes.text();
    const csrf = epHtml.match(/<meta\s+name="csrf-token"\s+content="([^"]+)"/i)?.[1] || '';
    const translators = parseTurkAnimeIzleTranslators(epHtml);

    if (!translators.length) {
      return {
        links: [],
        report: {
          site: 'TürkAnime İzle',
          status: 'not_found',
          message: `Bölüm ${episode} sayfasında çeviri/oynatıcı kaydı bulunamadı.`,
          searchUrl: resolved.searchUrl,
          animeUrl,
          episodeUrl,
          foundCount: 0,
        },
      };
    }

    const discovered: PlayerLink[] = [];
    const seenUrls = new Set<string>();

    const priorityScore = (name: string) => {
      const lower = name.toLowerCase();
      if (lower.includes('odnoklassniki')) return 0;
      if (lower.includes('aincrad') || lower.includes('anizm')) return 1;
      if (lower.includes('mail')) return 2;
      if (lower.includes('sibnet')) return 3;
      if (lower.includes('mp4upload')) return 4;
      if (lower.includes('sendvid')) return 5;
      if (lower.includes('voe')) return 6;
      if (lower.includes('vk')) return 7;
      if (lower.includes('uqload')) return 8;
      return 20;
    };

    for (const tr of translators) {
      const cevirmenRes = await fetchPage(tr.sourcesUrl, {
        Accept: 'application/json',
        'X-Requested-With': 'XMLHttpRequest',
        'X-CSRF-TOKEN': csrf,
        Cookie: cookieHeader,
        Referer: episodeUrl,
      });
      if (!cevirmenRes.ok) continue;

      const cJson = (await cevirmenRes.json().catch(() => null)) as {
        success?: boolean;
        videos?: Array<{ id?: number | string; name?: string }>;
      } | null;
      const videos = Array.isArray(cJson?.videos) ? cJson.videos : [];
      const sortedVideos = [...videos]
        .filter((v) => v?.id)
        .sort((a, b) => priorityScore(String(a.name || '')) - priorityScore(String(b.name || '')))
        .slice(0, 14);

      const resolvedBatch = await Promise.all(
        sortedVideos.map(async (v) => {
          const ctrl = new AbortController();
          const timer = setTimeout(() => ctrl.abort(), 5000);
          try {
            const pr = await fetch(`https://turkanimeizle.com/player/${v.id}`, {
              signal: ctrl.signal,
              redirect: 'manual',
              headers: {
                'User-Agent': USER_AGENT,
                Referer: episodeUrl,
                Cookie: cookieHeader,
              },
            });
            const loc = pr.headers.get('location');
            if (!loc || !loc.startsWith('http')) return null;
            const player = canonicalizeFallbackPlayerName(String(v.name || ''), loc);
            const fansubLabel =
              tr.name && tr.name !== 'Güncellenecek'
                ? `${tr.name} (TürkAnime İzle)`
                : 'TürkAnime İzle';
            return [fansubLabel, player, loc] as PlayerLink;
          } catch {
            return null;
          } finally {
            clearTimeout(timer);
          }
        }),
      );

      for (const item of resolvedBatch) {
        if (item && !seenUrls.has(item[2])) {
          seenUrls.add(item[2]);
          discovered.push(item);
        }
      }
    }

    return {
      links: discovered,
      report: {
        site: 'TürkAnime İzle',
        status: discovered.length > 0 ? 'found' : 'not_found',
        message:
          discovered.length > 0
            ? `${translators.length} fansub taranıp ${discovered.length} oynatıcı kaynağı bulundu (${resolved.matchedCandidate.title}).`
            : `Bölüm sayfası bulundu ancak çözümlenebilir video linki alınamadı.`,
        searchUrl: resolved.searchUrl,
        animeUrl,
        episodeUrl,
        foundCount: discovered.length,
      },
    };
  } catch (err) {
    return {
      links: [],
      report: {
        site: 'TürkAnime İzle',
        status: 'error',
        message: err instanceof Error ? err.message : 'Bağlantı hatası',
        searchUrl: resolved.searchUrl,
        animeUrl,
        episodeUrl,
        foundCount: 0,
      },
    };
  }
}

async function resolveAnimeIzleProAnimePage(anime: AnimeEntry): Promise<ResolvedAnimePage> {
  const queries = normalizeSearchQueries(anime.t, anime.slug, anime.at);
  const primaryQuery = queries[0] || anime.t;
  const searchUrl = `https://www.animeizle.pro/?s=${encodeURIComponent(primaryQuery)}`;

  try {
    const candidates: SearchCandidate[] = [];
    for (const q of queries.slice(0, 2)) {
      const res = await fetchPage(`https://www.animeizle.pro/?s=${encodeURIComponent(q)}`);
      if (res.status === 403 || res.status === 429) {
        return {
          site: 'Animeİzle.pro',
          searchUrl,
          episodeLinks: [],
          blocked: true,
          error: `Animeİzle.pro erişimi kısıtlı (HTTP ${res.status}).`,
        };
      }
      if (res.ok) {
        const html = await res.text();
        candidates.push(...parseAnimeIzleProSearchHtml(html));
      }
      if (candidates.length >= 3) break;
    }

    const directSlugUrl = `https://www.animeizle.pro/dizi/${encodeURIComponent(anime.slug)}/`;
    if (!candidates.some((c) => c.url === directSlugUrl)) {
      candidates.push({ title: anime.t, url: directSlugUrl, year: anime.yr ? String(anime.yr) : undefined });
    }

    const deduped = Array.from(new Map(candidates.map((c) => [c.url, c])).values());
    const scored = deduped
      .map((c) => ({
        candidate: c,
        score: Math.max(
          scoreTitleMatch(anime.t, c.title, c.url, anime.slug, anime.yr),
          anime.at ? scoreTitleMatch(anime.at, c.title, c.url, anime.slug, anime.yr) : 0,
        ),
      }))
      .filter((item) => item.score >= 160)
      .sort((a, b) => b.score - a.score);

    for (const item of scored.slice(0, 3)) {
      const animeRes = await fetchPage(item.candidate.url);
      if (!animeRes.ok) continue;
      const animeHtml = await animeRes.text();
      const epLinks = parseAnimeIzleProEpisodeLinks(animeHtml);
      if (epLinks.length > 0) {
        return {
          site: 'Animeİzle.pro',
          searchUrl,
          matchedCandidate: item.candidate,
          episodeLinks: epLinks,
        };
      }
    }

    return {
      site: 'Animeİzle.pro',
      searchUrl,
      matchedCandidate: scored[0]?.candidate,
      episodeLinks: [],
    };
  } catch (err) {
    return {
      site: 'Animeİzle.pro',
      searchUrl,
      episodeLinks: [],
      error: err instanceof Error ? err.message : 'Bağlantı hatası',
    };
  }
}

async function fetchAnimeIzleProEpisodeLinks(
  resolved: ResolvedAnimePage,
  episode: string,
): Promise<{ report: FallbackSiteReport; links: PlayerLink[] }> {
  if (resolved.blocked) {
    return {
      links: [],
      report: {
        site: 'Animeİzle.pro',
        status: 'blocked',
        message: resolved.error || 'Erişim kısıtlı.',
        searchUrl: resolved.searchUrl,
        foundCount: 0,
      },
    };
  }

  if (resolved.error) {
    return {
      links: [],
      report: {
        site: 'Animeİzle.pro',
        status: 'error',
        message: resolved.error,
        searchUrl: resolved.searchUrl,
        foundCount: 0,
      },
    };
  }

  if (!resolved.matchedCandidate) {
    return {
      links: [],
      report: {
        site: 'Animeİzle.pro',
        status: 'not_found',
        message: 'Eşleşen anime sayfası bulunamadı.',
        searchUrl: resolved.searchUrl,
        foundCount: 0,
      },
    };
  }

  const animeUrl = resolved.matchedCandidate.url;
  const episodeUrl = findMatchingEpisodeUrl(resolved.episodeLinks, episode);
  if (!episodeUrl) {
    return {
      links: [],
      report: {
        site: 'Animeİzle.pro',
        status: 'not_found',
        message: `${resolved.matchedCandidate.title} içinde Bölüm ${episode} bulunamadı (${resolved.episodeLinks.length} bölüm listelendi).`,
        searchUrl: resolved.searchUrl,
        animeUrl,
        foundCount: 0,
      },
    };
  }

  try {
    const epRes = await fetchPage(episodeUrl);
    if (!epRes.ok) {
      return {
        links: [],
        report: {
          site: 'Animeİzle.pro',
          status: 'error',
          message: `Bölüm sayfası açılamadı (HTTP ${epRes.status}).`,
          searchUrl: resolved.searchUrl,
          animeUrl,
          episodeUrl,
          foundCount: 0,
        },
      };
    }

    const firstHtml = await epRes.text();
    const discovered: PlayerLink[] = [];
    const seenUrls = new Set<string>();

    const firstPartName =
      firstHtml.match(/<li[^>]*class="part active"[^>]*>[\s\S]*?class="part-name"[^>]*>([^<]+)/i)?.[1]?.trim() || '';
    for (const item of extractIframeEmbedsFromHtml(firstHtml, 'Animeİzle.pro', firstPartName)) {
      if (!seenUrls.has(item[2])) {
        seenUrls.add(item[2]);
        discovered.push(item);
      }
    }

    const parts = parseAnimeIzleProEpisodeParts(firstHtml);
    const partPriority = (name: string) => {
      const lower = name.toLowerCase();
      if (lower.includes('odnoklassniki') || lower.includes('ok')) return 0;
      if (lower.includes('mail')) return 1;
      if (lower.includes('mp4upload')) return 2;
      if (lower.includes('sendvid')) return 3;
      if (lower.includes('vk')) return 4;
      if (lower.includes('uqload')) return 5;
      if (lower.includes('voe')) return 6;
      if (lower.includes('sibnet')) return 7;
      if (lower.includes('gdrive')) return 8;
      return 15;
    };

    const prioritizedParts = [...parts]
      .sort((a, b) => partPriority(a.playerName) - partPriority(b.playerName))
      .slice(0, 8);

    const partResults = await Promise.all(
      prioritizedParts.map(async (part) => {
        try {
          const r = await fetchPage(part.pageUrl, { Referer: episodeUrl }, 6000);
          if (!r.ok) return [] as PlayerLink[];
          const html = await r.text();
          return extractIframeEmbedsFromHtml(html, 'Animeİzle.pro', part.playerName);
        } catch {
          return [] as PlayerLink[];
        }
      }),
    );

    for (const list of partResults) {
      for (const item of list) {
        if (!seenUrls.has(item[2])) {
          seenUrls.add(item[2]);
          discovered.push(item);
        }
      }
    }

    return {
      links: discovered,
      report: {
        site: 'Animeİzle.pro',
        status: discovered.length > 0 ? 'found' : 'not_found',
        message:
          discovered.length > 0
            ? `${parts.length + 1} oynatıcı sekmesi kontrol edilip ${discovered.length} kaynak bulundu (${resolved.matchedCandidate.title}).`
            : 'Bölüm sayfasında indirilebilir oynatıcı embedi bulunamadı.',
        searchUrl: resolved.searchUrl,
        animeUrl,
        episodeUrl,
        foundCount: discovered.length,
      },
    };
  } catch (err) {
    return {
      links: [],
      report: {
        site: 'Animeİzle.pro',
        status: 'error',
        message: err instanceof Error ? err.message : 'Bağlantı hatası',
        searchUrl: resolved.searchUrl,
        animeUrl,
        episodeUrl,
        foundCount: 0,
      },
    };
  }
}

async function searchTrAnimeIzleEpisode(
  anime: AnimeEntry,
  episode: string,
): Promise<{ report: FallbackSiteReport; links: PlayerLink[] }> {
  const query = normalizeSearchQueries(anime.t, anime.slug)[0] || anime.t;
  const searchUrl = `https://www.tranimeizle.io/arama?q=${encodeURIComponent(query)}`;

  try {
    const res = await fetchPage(searchUrl, {}, 5000);
    if (res.status === 403 || res.status === 429) {
      return {
        links: [],
        report: {
          site: 'TrAnimeİzle',
          status: 'blocked',
          message: `TrAnimeİzle bu sunucu IP adresinden erişimi kısıtlıyor (HTTP ${res.status}). Sağdaki bağlantıyla tarayıcınızda açabilirsiniz.`,
          searchUrl,
          foundCount: 0,
        },
      };
    }

    if (!res.ok) {
      return {
        links: [],
        report: {
          site: 'TrAnimeİzle',
          status: 'error',
          message: `TrAnimeİzle yanıt vermedi (HTTP ${res.status}).`,
          searchUrl,
          foundCount: 0,
        },
      };
    }

    const html = await res.text();
    const animeLinkMatch = html.match(
      new RegExp(`href="(https://(?:www\\.)?tranimeizle\\.io/anime/[^"]+)"`, 'i'),
    );
    const animeUrl = animeLinkMatch?.[1];
    if (!animeUrl) {
      return {
        links: [],
        report: {
          site: 'TrAnimeİzle',
          status: 'not_found',
          message: `"${query}" için anime sayfası bulunamadı.`,
          searchUrl,
          foundCount: 0,
        },
      };
    }

    const animeRes = await fetchPage(animeUrl, {}, 5000);
    if (!animeRes.ok) {
      return {
        links: [],
        report: {
          site: 'TrAnimeİzle',
          status: 'error',
          message: `Anime sayfası açılamadı (HTTP ${animeRes.status}).`,
          searchUrl,
          animeUrl,
          foundCount: 0,
        },
      };
    }

    const animeHtml = await animeRes.text();
    const epUrls = Array.from(
      new Set(
        Array.from(
          animeHtml.matchAll(/href="(https:\/\/(?:www\.)?tranimeizle\.io\/[^"]*-bolum[^"]*)"/gi),
        ).map((m) => m[1]),
      ),
    );
    const episodeUrl = findMatchingEpisodeUrl(epUrls, episode);
    if (!episodeUrl) {
      return {
        links: [],
        report: {
          site: 'TrAnimeİzle',
          status: 'not_found',
          message: `Bölüm ${episode} bulunamadı.`,
          searchUrl,
          animeUrl,
          foundCount: 0,
        },
      };
    }

    const epRes = await fetchPage(episodeUrl, {}, 5000);
    if (!epRes.ok) {
      return {
        links: [],
        report: {
          site: 'TrAnimeİzle',
          status: 'error',
          message: `Bölüm sayfası açılamadı (HTTP ${epRes.status}).`,
          searchUrl,
          animeUrl,
          episodeUrl,
          foundCount: 0,
        },
      };
    }

    const epHtml = await epRes.text();
    const links = extractIframeEmbedsFromHtml(epHtml, 'TrAnimeİzle');
    return {
      links,
      report: {
        site: 'TrAnimeİzle',
        status: links.length > 0 ? 'found' : 'not_found',
        message:
          links.length > 0
            ? `${links.length} oynatıcı embed bağlantısı bulundu.`
            : `Bölüm sayfasında doğrudan embed bulunamadı.`,
        searchUrl,
        animeUrl,
        episodeUrl,
        foundCount: links.length,
      },
    };
  } catch (err) {
    return {
      links: [],
      report: {
        site: 'TrAnimeİzle',
        status: 'error',
        message: err instanceof Error ? err.message : 'Bağlantı hatası',
        searchUrl,
        foundCount: 0,
      },
    };
  }
}

export async function searchFallbackEpisodeSources(
  anime: AnimeEntry,
  episode: string,
): Promise<{
  links: PlayerLink[];
  reports: FallbackSiteReport[];
}> {
  const [resolvedTurk, resolvedPro, trAnimeIzle] = await Promise.all([
    resolveTurkAnimeIzleAnimePage(anime),
    resolveAnimeIzleProAnimePage(anime),
    searchTrAnimeIzleEpisode(anime, episode),
  ]);

  const [turkAnimeIzle, animeIzlePro] = await Promise.all([
    fetchTurkAnimeIzleEpisodeLinks(resolvedTurk, episode),
    fetchAnimeIzleProEpisodeLinks(resolvedPro, episode),
  ]);

  const seen = new Set<string>();
  const merged: PlayerLink[] = [];
  for (const link of [...turkAnimeIzle.links, ...animeIzlePro.links, ...trAnimeIzle.links]) {
    if (!seen.has(link[2])) {
      seen.add(link[2]);
      merged.push(link);
    }
  }

  return {
    links: merged,
    reports: [turkAnimeIzle.report, animeIzlePro.report, trAnimeIzle.report],
  };
}

export async function searchFallbackAnimeBatch(
  anime: AnimeEntry,
  episodes: string[],
): Promise<Map<string, { links: PlayerLink[]; reports: FallbackSiteReport[] }>> {
  const out = new Map<string, { links: PlayerLink[]; reports: FallbackSiteReport[] }>();
  if (!episodes.length) return out;

  const [resolvedTurk, resolvedPro] = await Promise.all([
    resolveTurkAnimeIzleAnimePage(anime),
    resolveAnimeIzleProAnimePage(anime),
  ]);

  for (const ep of episodes) {
    const [turkRes, proRes] = await Promise.all([
      fetchTurkAnimeIzleEpisodeLinks(resolvedTurk, ep),
      fetchAnimeIzleProEpisodeLinks(resolvedPro, ep),
    ]);

    const seen = new Set<string>();
    const merged: PlayerLink[] = [];
    for (const link of [...turkRes.links, ...proRes.links]) {
      if (!seen.has(link[2])) {
        seen.add(link[2]);
        merged.push(link);
      }
    }

    out.set(ep, {
      links: merged,
      reports: [turkRes.report, proRes.report],
    });
  }

  return out;
}
