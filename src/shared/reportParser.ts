import type { AnimeEntry, ArchiveStatus, CatalogStats, PlayerLink } from './types.ts';

function normalizeArchiveStatus(val: unknown): ArchiveStatus {
  if (val === 'tam' || val === 'kismi' || val === 'yok') {
    return val;
  }
  return 'yok';
}

function normalizePlayerLinks(raw: unknown): Record<string, PlayerLink[]> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return {};
  }
  const result: Record<string, PlayerLink[]> = {};
  for (const [ep, links] of Object.entries(raw as Record<string, unknown>)) {
    if (!Array.isArray(links)) continue;
    const validLinks: PlayerLink[] = [];
    for (const item of links) {
      if (
        Array.isArray(item) &&
        item.length >= 3 &&
        typeof item[0] === 'string' &&
        typeof item[1] === 'string' &&
        typeof item[2] === 'string'
      ) {
        validLinks.push([item[0].trim(), item[1].trim().toUpperCase(), item[2].trim()]);
      }
    }
    result[String(ep)] = validLinks;
  }
  return result;
}

export function normalizeAnimeEntry(raw: unknown): AnimeEntry | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return null;
  }
  const obj = raw as Record<string, unknown>;
  const title = typeof obj.t === 'string' ? obj.t.trim() : '';
  const slug = typeof obj.slug === 'string' ? obj.slug.trim() : '';
  if (!title || !slug) {
    return null;
  }
  const miss = Array.isArray(obj.miss)
    ? obj.miss.map((m) => String(m).trim()).filter(Boolean)
    : [];

  return {
    t: title,
    fmt: typeof obj.fmt === 'string' ? obj.fmt.trim() : 'TV',
    yr: typeof obj.yr === 'number' || typeof obj.yr === 'string' ? obj.yr : '',
    ec: typeof obj.ec === 'number' ? obj.ec : Number(obj.ec) || 0,
    E: typeof obj.E === 'number' ? obj.E : Number(obj.E) || 0,
    miss,
    slug,
    at: typeof obj.at === 'string' && obj.at.trim() ? obj.at.trim() : title,
    d: normalizeArchiveStatus(obj.d),
    f: normalizePlayerLinks(obj.f),
  };
}

/**
 * Extracts `const R=[...];` array from an HTML report or parses a direct JSON array.
 * Uses bracket-depth scanning so semicolons/strings inside JSON do not prematurely terminate extraction.
 */
export function extractJsonArrayFromText(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) {
    throw new Error('İçe aktarılacak içerik boş.');
  }

  if (trimmed.startsWith('[')) {
    return trimmed;
  }

  const markerMatch = trimmed.match(/(?:const|let|var)\s+R\s*=\s*\[/);
  if (!markerMatch || markerMatch.index === undefined) {
    throw new Error('HTML içinde "const R=[...]" veri dizisi veya geçerli bir JSON dizisi bulunamadı.');
  }

  const startIdx = trimmed.indexOf('[', markerMatch.index);
  if (startIdx === -1) {
    throw new Error('Veri dizisinin başlangıcı bulunamadı.');
  }

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = startIdx; i < trimmed.length; i++) {
    const ch = trimmed[i];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }

    if (ch === '"') {
      inString = true;
    } else if (ch === '[') {
      depth++;
    } else if (ch === ']') {
      depth--;
      if (depth === 0) {
        return trimmed.slice(startIdx, i + 1);
      }
    }
  }

  throw new Error('Veri dizisi eksik veya kesilmiş görünüyor (kapanış parantezi bulunamadı).');
}

export function parseReportInput(input: string): {
  entries: AnimeEntry[];
  skippedCount: number;
} {
  const jsonSlice = extractJsonArrayFromText(input);
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonSlice);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Bilinmeyen JSON hatası';
    throw new Error(`Rapor JSON formatı çözümlenemedi: ${msg}`);
  }

  if (!Array.isArray(parsed)) {
    throw new Error('Rapor verisi bir dizi (array) olmalıdır.');
  }

  const seen = new Map<string, AnimeEntry>();
  let skippedCount = 0;

  for (const item of parsed) {
    const normalized = normalizeAnimeEntry(item);
    if (!normalized) {
      skippedCount++;
      continue;
    }
    seen.set(normalized.slug, normalized);
  }

  if (seen.size === 0) {
    throw new Error('Geçerli anime kaydı bulunamadı.');
  }

  return {
    entries: Array.from(seen.values()),
    skippedCount,
  };
}

export function computeCatalogStats(entries: AnimeEntry[]): CatalogStats {
  let missing1 = 0;
  let missing2 = 0;
  let missing3 = 0;
  let tamCount = 0;
  let kismiCount = 0;
  let yokCount = 0;
  let totalMissingEpisodes = 0;

  for (const entry of entries) {
    const missLen = entry.miss.length;
    totalMissingEpisodes += missLen;
    if (missLen === 1) missing1++;
    else if (missLen === 2) missing2++;
    else if (missLen === 3) missing3++;

    if (entry.d === 'tam') tamCount++;
    else if (entry.d === 'kismi') kismiCount++;
    else yokCount++;
  }

  return {
    totalAnime: entries.length,
    missing1,
    missing2,
    missing3,
    tamCount,
    kismiCount,
    yokCount,
    totalMissingEpisodes,
  };
}

export function collectAvailableFormats(entries: AnimeEntry[]): string[] {
  const set = new Set<string>();
  for (const entry of entries) {
    if (entry.fmt) set.add(entry.fmt);
  }
  return Array.from(set).sort();
}

export function collectAvailablePlayers(entries: AnimeEntry[]): string[] {
  const counts = new Map<string, number>();
  for (const entry of entries) {
    for (const links of Object.values(entry.f)) {
      for (const [, player] of links) {
        counts.set(player, (counts.get(player) ?? 0) + 1);
      }
    }
  }
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([player]) => player);
}
