import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { ProbeResult, StreamVariant } from '../src/shared/types.ts';

const execFileAsync = promisify(execFile);

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const OKRU_QUALITY_MAP: Record<string, { label: string; height: number }> = {
  ultra: { label: '2160p', height: 2160 },
  quad: { label: '1440p', height: 1440 },
  full: { label: '1080p', height: 1080 },
  hd: { label: '720p', height: 720 },
  sd: { label: '480p', height: 480 },
  low: { label: '360p', height: 360 },
  lowest: { label: '240p', height: 240 },
  mobile: { label: '144p', height: 144 },
};

function decodeHtmlEntities(str: string): string {
  return str
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#39;/g, "'")
    .replace(/\\u0026/g, '&')
    .replace(/\\\//g, '/');
}

export function qualityLabelToHeight(label: string): number {
  const lower = label.toLowerCase();
  const numMatch = lower.match(/(\d{3,4})p?/);
  if (numMatch) {
    const val = Number(numMatch[1]);
    if (val >= 144 && val <= 4320) return val;
  }
  if (lower.includes('full')) return 1080;
  if (lower.includes('hd')) return 720;
  if (lower.includes('sd')) return 480;
  if (lower.includes('low')) return 360;
  return 0;
}

export function parseOkRuHtml(html: string): StreamVariant[] {
  const variants: StreamVariant[] = [];
  const dataOptionsMatch = html.match(/data-options="([^"]+)"/);
  if (!dataOptionsMatch) {
    return variants;
  }
  try {
    const options = JSON.parse(decodeHtmlEntities(dataOptionsMatch[1]));
    const metadataRaw = options?.flashvars?.metadata;
    if (!metadataRaw) return variants;
    const metadata = typeof metadataRaw === 'string' ? JSON.parse(metadataRaw) : metadataRaw;

    if (Array.isArray(metadata.videos)) {
      for (const v of metadata.videos) {
        if (!v?.url) continue;
        const mapped = OKRU_QUALITY_MAP[String(v.name || '').toLowerCase()] ?? {
          label: String(v.name || 'Bilinmiyor'),
          height: qualityLabelToHeight(String(v.name || '')),
        };
        variants.push({
          qualityLabel: mapped.label,
          height: mapped.height,
          url: String(v.url),
          format: String(v.url).includes('.m3u8') ? 'hls' : 'mp4',
          headers: {
            Referer: 'https://ok.ru/',
            'User-Agent': USER_AGENT,
          },
        });
      }
    }

    if (metadata.ondemandHls && variants.length === 0) {
      variants.push({
        qualityLabel: 'HLS',
        height: 1080,
        url: String(metadata.ondemandHls),
        format: 'hls',
        headers: { Referer: 'https://ok.ru/', 'User-Agent': USER_AGENT },
      });
    }
  } catch {
    return [];
  }
  return variants;
}

export function parseSibnetHtml(html: string): string | null {
  const srcMatch =
    html.match(/player\.src\(\s*\[\s*\{\s*src:\s*["']([^"']+)["']/) ||
    html.match(/src:\s*["'](\/v\/[^"']+\.mp4[^"']*)["']/) ||
    html.match(/<source[^>]+src=["']([^"']+\.mp4[^"']*)["']/i);
  if (!srcMatch) return null;
  const raw = srcMatch[1];
  if (raw.startsWith('//')) return `https:${raw}`;
  if (raw.startsWith('/')) return `https://video.sibnet.ru${raw}`;
  return raw;
}

export function parseMailRuEmbedHtml(html: string): string | null {
  const metaMatch =
    html.match(/"metadataUrl"\s*:\s*"([^"]+)"/) ||
    html.match(/metadataUrl\s*:\s*['"]([^'"]+)['"]/);
  if (!metaMatch) return null;
  const raw = decodeHtmlEntities(metaMatch[1]);
  if (raw.startsWith('//')) return `https:${raw}`;
  if (raw.startsWith('/')) return `https://my.mail.ru${raw}`;
  return raw;
}

export function parseMailRuMetaJson(json: unknown, cookieHeader?: string): StreamVariant[] {
  if (!json || typeof json !== 'object') return [];
  const data = json as { videos?: Array<{ key?: string; url?: string }> };
  if (!Array.isArray(data.videos)) return [];
  const variants: StreamVariant[] = [];
  for (const v of data.videos) {
    if (!v?.url) continue;
    const rawUrl = v.url.startsWith('//') ? `https:${v.url}` : v.url;
    const key = String(v.key || 'sd');
    const height = qualityLabelToHeight(key);
    variants.push({
      qualityLabel: height ? `${height}p` : key,
      height,
      url: rawUrl,
      format: rawUrl.includes('.m3u8') ? 'hls' : 'mp4',
      headers: {
        Referer: 'https://my.mail.ru/',
        'User-Agent': USER_AGENT,
        ...(cookieHeader ? { Cookie: cookieHeader } : {}),
      },
    });
  }
  return variants;
}

export function unpackPacker(p: string, a: number, c: number, k: string[]): string {
  const encode = (num: number): string => {
    const first = num < a ? '' : encode(Math.floor(num / a));
    const rem = num % a;
    return first + (rem > 35 ? String.fromCharCode(rem + 29) : rem.toString(36));
  };
  let result = p;
  let count = c;
  while (count--) {
    if (k[count]) {
      const token = encode(count);
      result = result.replace(new RegExp(`\\b${token}\\b`, 'g'), k[count]);
    }
  }
  return result;
}

export function parseMp4uploadHtml(html: string): StreamVariant[] {
  let target = html;
  const packed = html.match(
    /eval\(function\(p,a,c,k,e,d\)\{[\s\S]*?\}\('([\s\S]*?)',(\d+),(\d+),'([^']+)'\.split\('\|'\)/,
  );
  if (packed) {
    try {
      target += '\n' + unpackPacker(packed[1], Number(packed[2]), Number(packed[3]), packed[4].split('|'));
    } catch {
      // ignore unpack errors
    }
  }

  const srcMatch =
    target.match(/player\.src\(\s*\{\s*(?:type:\s*["']video\/mp4["'],\s*)?src:\s*["']([^"']+)["']/) ||
    target.match(/src:\s*["'](https?:\/\/[^"']+\.mp4[^"']*)["']/i) ||
    target.match(/<source[^>]+src=["'](https?:\/\/[^"']+\.mp4[^"']*)["']/i);

  if (!srcMatch) return [];

  let height = 0;
  const resMatch = target.match(/(\d{3,4})\s*x\s*(\d{3,4})/i);
  if (resMatch) {
    height = Number(resMatch[2]);
  }
  return [
    {
      qualityLabel: height ? `${height}p` : 'MP4',
      height,
      url: srcMatch[1],
      format: 'mp4',
      headers: {
        Referer: 'https://www.mp4upload.com/',
        'User-Agent': USER_AGENT,
      },
    },
  ];
}

export function parseSendvidHtml(html: string): StreamVariant[] {
  const match =
    html.match(/<source[^>]+src=["']([^"']+)["']/i) ||
    html.match(/var\s+video_source\s*=\s*["']([^"']+)["']/i) ||
    html.match(/https?:\/\/[^"'\s]+\.mp4[^"'\s]*/i);
  if (!match) return [];
  const raw = match[1] ?? match[0];
  const url = raw.startsWith('//') ? `https:${raw}` : raw;
  return [
    {
      qualityLabel: 'MP4',
      height: 0,
      url,
      format: url.includes('.m3u8') ? 'hls' : 'mp4',
      headers: { Referer: 'https://sendvid.com/', 'User-Agent': USER_AGENT },
    },
  ];
}

export function parseVkHtml(html: string): StreamVariant[] {
  const variants: StreamVariant[] = [];
  const regex = /"(?:url|mp4_)(\d{3,4})"\s*:\s*"([^"]+)"/g;
  let m: RegExpExecArray | null;
  while ((m = regex.exec(html)) !== null) {
    const height = Number(m[1]);
    const url = decodeHtmlEntities(m[2]);
    if (url.startsWith('http')) {
      variants.push({
        qualityLabel: `${height}p`,
        height,
        url,
        format: 'mp4',
        headers: { Referer: 'https://vk.com/', 'User-Agent': USER_AGENT },
      });
    }
  }
  if (!variants.length) {
    const hlsMatch = html.match(/"hls"\s*:\s*"([^"]+)"/);
    if (hlsMatch) {
      variants.push({
        qualityLabel: 'HLS',
        height: 1080,
        url: decodeHtmlEntities(hlsMatch[1]),
        format: 'hls',
        headers: { Referer: 'https://vk.com/', 'User-Agent': USER_AGENT },
      });
    }
  }
  return variants;
}

export function parseUqloadHtml(html: string): StreamVariant[] {
  const match = html.match(/sources\s*:\s*\[\s*["']([^"']+\.mp4[^"']*)["']/i);
  if (!match) return [];
  return [
    {
      qualityLabel: 'MP4',
      height: 0,
      url: match[1],
      format: 'mp4',
      headers: { Referer: 'https://uqload.com/', 'User-Agent': USER_AGENT },
    },
  ];
}

export function parseVoeHtml(html: string): StreamVariant[] {
  const variants: StreamVariant[] = [];
  const mp4B64 = html.match(/['"]mp4['"]\s*:\s*['"]([A-Za-z0-9+/=]+)['"]/);
  const hlsB64 = html.match(/['"]hls['"]\s*:\s*['"]([A-Za-z0-9+/=]+)['"]/);
  const tryDecode = (val: string) => {
    try {
      const decoded = Buffer.from(val, 'base64').toString('utf8');
      return decoded.startsWith('http') ? decoded : null;
    } catch {
      return null;
    }
  };
  if (mp4B64) {
    const u = tryDecode(mp4B64[1]);
    if (u) variants.push({ qualityLabel: 'MP4', height: 1080, url: u, format: 'mp4' });
  }
  if (hlsB64) {
    const u = tryDecode(hlsB64[1]);
    if (u) variants.push({ qualityLabel: 'HLS', height: 1080, url: u, format: 'hls' });
  }
  const direct = html.match(/https?:\/\/[^"'\s]+\.(?:mp4|m3u8)[^"'\s]*/i);
  if (!variants.length && direct) {
    variants.push({
      qualityLabel: direct[0].includes('.m3u8') ? 'HLS' : 'MP4',
      height: 0,
      url: direct[0],
      format: direct[0].includes('.m3u8') ? 'hls' : 'mp4',
    });
  }
  return variants;
}

export function parseHlsMasterPlaylist(
  m3u8Text: string,
  baseUrl: string,
  headers?: Record<string, string>,
): StreamVariant[] {
  const lines = m3u8Text.split(/\r?\n/).map((l) => l.trim());
  const variants: StreamVariant[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.startsWith('#EXT-X-STREAM-INF:')) continue;
    const nextUrl = lines.slice(i + 1).find((l) => l && !l.startsWith('#'));
    if (!nextUrl) continue;

    let resolvedUrl = nextUrl;
    try {
      resolvedUrl = new URL(nextUrl, baseUrl).toString();
    } catch {
      resolvedUrl = nextUrl;
    }

    const resMatch = line.match(/RESOLUTION=\s*\d+x(\d+)/i);
    const nameMatch = line.match(/NAME="([^"]+)"/i);
    const height = resMatch ? Number(resMatch[1]) : qualityLabelToHeight(nameMatch?.[1] || '');
    variants.push({
      qualityLabel: height ? `${height}p` : nameMatch?.[1] || 'HLS',
      height,
      url: resolvedUrl,
      format: 'hls',
      headers,
    });
  }

  return variants;
}

async function fetchWithTimeout(
  url: string,
  options: RequestInit & { timeoutMs?: number } = {},
): Promise<Response> {
  const { timeoutMs = 10000, ...init } = options;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
      headers: {
        'User-Agent': USER_AGENT,
        'Accept-Language': 'tr-TR,tr;q=0.9,en-US;q=0.8,en;q=0.7,ru;q=0.6',
        Accept: 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8',
        'Sec-Fetch-Dest': 'iframe',
        'Sec-Fetch-Mode': 'navigate',
        ...(init.headers || {}),
      },
    });
  } finally {
    clearTimeout(timer);
  }
}

export async function probeVideoResolutionWithFfprobe(
  streamUrl: string,
  headers?: Record<string, string>,
): Promise<{ height: number; width: number } | null> {
  try {
    const headerLines = headers
      ? Object.entries(headers)
          .map(([k, v]) => `${k}: ${v}`)
          .join('\r\n') + '\r\n'
      : '';
    const args = [
      '-v',
      'error',
      ...(headerLines ? ['-headers', headerLines] : []),
      '-select_streams',
      'v:0',
      '-show_entries',
      'stream=width,height',
      '-of',
      'json',
      streamUrl,
    ];
    const { stdout } = await execFileAsync('ffprobe', args, { timeout: 9000 });
    const parsed = JSON.parse(stdout);
    const stream = parsed?.streams?.[0];
    if (stream?.height) {
      return { width: Number(stream.width) || 0, height: Number(stream.height) || 0 };
    }
    return null;
  } catch {
    return null;
  }
}

async function headFileSize(
  url: string,
  headers?: Record<string, string>,
): Promise<number | undefined> {
  try {
    const res = await fetchWithTimeout(url, {
      method: 'HEAD',
      headers,
      timeoutMs: 5000,
    });
    const len = res.headers.get('content-length');
    return len ? Number(len) : undefined;
  } catch {
    return undefined;
  }
}

export async function probePlayerUrl(
  fansub: string,
  player: string,
  embedUrl: string,
  options?: { skipHeadSize?: boolean },
): Promise<ProbeResult> {
  const skipHeadSize = Boolean(options?.skipHeadSize);
  const normPlayer = player.trim().toUpperCase();
  const baseResult: ProbeResult = {
    embedUrl,
    player: normPlayer,
    fansub,
    status: 'error',
    variants: [],
    bestHeight: 0,
    has1080p: false,
    probedAt: Date.now(),
  };

  try {
    if (normPlayer === 'ODNOKLASSNIKI' || normPlayer === 'OK.RU') {
      const res = await fetchWithTimeout(embedUrl.replace('odnoklassniki.ru', 'ok.ru'));
      if (!res.ok) {
        return { ...baseResult, status: 'dead', message: `HTTP ${res.status}` };
      }
      const html = await res.text();
      if (/video not found|deleted|blocked/i.test(html) && !html.includes('data-options')) {
        return { ...baseResult, status: 'dead', message: 'Video silinmiş veya kaldırılmış' };
      }
      const variants = parseOkRuHtml(html);
      if (!variants.length) {
        return { ...baseResult, status: 'dead', message: 'Oynatıcı akışı bulunamadı' };
      }
      const top = variants.reduce((a, b) => (b.height > a.height ? b : a), variants[0]);
      if (top && !skipHeadSize) {
        top.sizeBytes = await headFileSize(top.url, top.headers);
      }
      const bestHeight = Math.max(...variants.map((v) => v.height), 0);
      return {
        ...baseResult,
        status: 'ok',
        variants,
        bestHeight,
        has1080p: bestHeight >= 1080,
      };
    }

    if (normPlayer === 'SIBNET') {
      let res = await fetchWithTimeout(embedUrl, {
        headers: { Referer: 'https://video.sibnet.ru/' },
      });
      if (res.status === 403) {
        const idMatch = embedUrl.match(/videoid=(\d+)/);
        if (idMatch) {
          res = await fetchWithTimeout(`https://video.sibnet.ru/video${idMatch[1]}/`, {
            headers: { Referer: 'https://video.sibnet.ru/' },
          });
        }
      }
      if (!res.ok) {
        return {
          ...baseResult,
          status: 'dead',
          message: res.status === 403 ? 'HTTP 403 (Sunucu IP engelli olabilir)' : `HTTP ${res.status}`,
        };
      }
      const html = await res.text();
      const rawSrc = parseSibnetHtml(html);
      if (!rawSrc) {
        return { ...baseResult, status: 'dead', message: 'Sibnet MP4 yolu bulunamadı' };
      }
      const headers = { Referer: embedUrl, 'User-Agent': USER_AGENT };
      const sizeBytes = skipHeadSize ? undefined : await headFileSize(rawSrc, headers);
      const dims = await probeVideoResolutionWithFfprobe(rawSrc, headers);
      const height = dims?.height ?? 0;
      const variant: StreamVariant = {
        qualityLabel: height ? `${height}p` : 'MP4',
        height,
        url: rawSrc,
        format: 'mp4',
        sizeBytes,
        headers,
      };
      return {
        ...baseResult,
        status: 'ok',
        variants: [variant],
        bestHeight: height,
        has1080p: height >= 1080,
        message: height ? undefined : 'MP4 bulundu (çözünürlük indirirken doğrulanacak)',
      };
    }

    if (normPlayer === 'MAIL') {
      const res = await fetchWithTimeout(embedUrl);
      if (!res.ok) {
        return { ...baseResult, status: 'dead', message: `HTTP ${res.status}` };
      }
      const html = await res.text();
      const metaUrl = parseMailRuEmbedHtml(html);
      if (!metaUrl) {
        return { ...baseResult, status: 'dead', message: 'Mail.ru metadataUrl bulunamadı' };
      }
      const setCookies = res.headers.getSetCookie?.() ?? [];
      const cookieHeader = setCookies.map((c) => c.split(';')[0]).join('; ');
      const metaRes = await fetchWithTimeout(metaUrl, {
        headers: { Referer: embedUrl, ...(cookieHeader ? { Cookie: cookieHeader } : {}) },
      });
      if (!metaRes.ok) {
        return { ...baseResult, status: 'dead', message: `Metadata HTTP ${metaRes.status}` };
      }
      const metaCookies = metaRes.headers.getSetCookie?.() ?? [];
      const allCookies = [...setCookies, ...metaCookies].map((c) => c.split(';')[0]).join('; ');
      const json = await metaRes.json();
      const variants = parseMailRuMetaJson(json, allCookies);
      if (!variants.length) {
        return { ...baseResult, status: 'dead', message: 'Video akışı boş' };
      }
      const top = variants.reduce((a, b) => (b.height > a.height ? b : a), variants[0]);
      if (top && !skipHeadSize) {
        top.sizeBytes = await headFileSize(top.url, top.headers);
      }
      const bestHeight = Math.max(...variants.map((v) => v.height), 0);
      return {
        ...baseResult,
        status: 'ok',
        variants,
        bestHeight,
        has1080p: bestHeight >= 1080,
      };
    }

    if (normPlayer === 'MP4UPLOAD') {
      const res = await fetchWithTimeout(embedUrl, {
        headers: { Referer: 'https://www.mp4upload.com/' },
      });
      if (!res.ok) return { ...baseResult, status: 'dead', message: `HTTP ${res.status}` };
      const html = await res.text();
      const variants = parseMp4uploadHtml(html);
      if (!variants.length) {
        return { ...baseResult, status: 'dead', message: 'MP4 kaynağı çözümlenemedi' };
      }
      if (!variants[0].height) {
        const dims = await probeVideoResolutionWithFfprobe(variants[0].url, variants[0].headers);
        if (dims?.height) {
          variants[0].height = dims.height;
          variants[0].qualityLabel = `${dims.height}p`;
        }
      }
      const bestHeight = Math.max(...variants.map((v) => v.height), 0);
      return {
        ...baseResult,
        status: 'ok',
        variants,
        bestHeight,
        has1080p: bestHeight >= 1080,
      };
    }

    if (normPlayer === 'SENDVID') {
      const res = await fetchWithTimeout(embedUrl);
      if (!res.ok) return { ...baseResult, status: 'dead', message: `HTTP ${res.status}` };
      const html = await res.text();
      const variants = parseSendvidHtml(html);
      if (!variants.length) return { ...baseResult, status: 'dead', message: 'Video kaynağı bulunamadı' };
      const dims = await probeVideoResolutionWithFfprobe(variants[0].url, variants[0].headers);
      if (dims?.height) {
        variants[0].height = dims.height;
        variants[0].qualityLabel = `${dims.height}p`;
      }
      const bestHeight = variants[0].height;
      return {
        ...baseResult,
        status: 'ok',
        variants,
        bestHeight,
        has1080p: bestHeight >= 1080,
      };
    }

    if (normPlayer === 'SAVEFILEWAY') {
      if (embedUrl.endsWith('.mp4')) {
        const res = await fetchWithTimeout(embedUrl);
        const html = res.ok ? await res.text() : '';
        const directMatch = html.match(/<source[^>]+src=["']([^"']+)["']|file:\s*["']([^"']+\.mp4[^"']*)["']/i);
        const targetUrl = directMatch?.[1] || directMatch?.[2] || embedUrl;
        const sizeBytes = skipHeadSize ? undefined : await headFileSize(targetUrl);
        const dims = await probeVideoResolutionWithFfprobe(targetUrl);
        const height = dims?.height ?? (embedUrl.includes('1080p') ? 1080 : embedUrl.includes('720p') ? 720 : 0);
        return {
          ...baseResult,
          status: res.ok ? 'ok' : 'dead',
          variants: res.ok
            ? [
                {
                  qualityLabel: height ? `${height}p` : 'MP4',
                  height,
                  url: targetUrl,
                  format: 'mp4',
                  sizeBytes,
                },
              ]
            : [],
          bestHeight: height,
          has1080p: height >= 1080,
          message: res.ok ? undefined : `HTTP ${res.status}`,
        };
      }
    }

    if (normPlayer === 'VK') {
      const res = await fetchWithTimeout(embedUrl);
      if (!res.ok) return { ...baseResult, status: 'dead', message: `HTTP ${res.status}` };
      const html = await res.text();
      const variants = parseVkHtml(html);
      if (!variants.length) return { ...baseResult, status: 'dead', message: 'VK akışı bulunamadı' };
      const bestHeight = Math.max(...variants.map((v) => v.height), 0);
      return {
        ...baseResult,
        status: 'ok',
        variants,
        bestHeight,
        has1080p: bestHeight >= 1080,
      };
    }

    if (normPlayer === 'UQLOAD') {
      const res = await fetchWithTimeout(embedUrl);
      if (!res.ok) return { ...baseResult, status: 'dead', message: `HTTP ${res.status}` };
      const html = await res.text();
      const variants = parseUqloadHtml(html);
      if (!variants.length) return { ...baseResult, status: 'dead', message: 'Uqload kaynağı bulunamadı' };
      const dims = await probeVideoResolutionWithFfprobe(variants[0].url, variants[0].headers);
      if (dims?.height) {
        variants[0].height = dims.height;
        variants[0].qualityLabel = `${dims.height}p`;
      }
      return {
        ...baseResult,
        status: 'ok',
        variants,
        bestHeight: variants[0].height,
        has1080p: variants[0].height >= 1080,
      };
    }

    if (normPlayer === 'VOE') {
      const res = await fetchWithTimeout(embedUrl);
      if (!res.ok) return { ...baseResult, status: 'dead', message: `HTTP ${res.status}` };
      const html = await res.text();
      const variants = parseVoeHtml(html);
      if (!variants.length) {
        return { ...baseResult, status: 'unsupported', message: 'VOE korumalı / yönlendirme gerektiriyor' };
      }
      const bestHeight = Math.max(...variants.map((v) => v.height), 0);
      return {
        ...baseResult,
        status: 'ok',
        variants,
        bestHeight,
        has1080p: bestHeight >= 1080,
      };
    }

    if (normPlayer === 'ANIZMPLAYER' || embedUrl.includes('anizmplayer.com/video/')) {
      const idMatch = embedUrl.match(/anizmplayer\.com\/video\/([a-zA-Z0-9]+)/);
      if (!idMatch) {
        return { ...baseResult, status: 'dead', message: 'AnizmPlayer video ID çözümlenemedi' };
      }
      const videoId = idMatch[1];
      const apiRes = await fetchWithTimeout(
        `https://anizmplayer.com/player/index.php?data=${videoId}&do=getVideo`,
        {
          method: 'POST',
          headers: {
            Accept: 'application/json, text/javascript, */*; q=0.01',
            Origin: 'https://anizmplayer.com',
            Referer: embedUrl,
            'Sec-Fetch-Dest': 'empty',
            'Sec-Fetch-Mode': 'cors',
            'X-Requested-With': 'XMLHttpRequest',
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: `hash=${encodeURIComponent(videoId)}&r=${encodeURIComponent('https://turkanimeizle.com/')}`,
        },
      );
      if (!apiRes.ok) {
        return { ...baseResult, status: 'dead', message: `AnizmPlayer HTTP ${apiRes.status}` };
      }
      const data = (await apiRes.json()) as {
        securedLink?: string;
        videoSource?: string;
        downloadLinks?: Array<{ file?: string; label?: string }>;
      };

      const streamHeaders = {
        Accept: '*/*',
        Origin: 'https://anizmplayer.com',
        Referer: 'https://anizmplayer.com/',
        'Sec-Fetch-Dest': 'empty',
        'Sec-Fetch-Mode': 'cors',
        'User-Agent': USER_AGENT,
      };
      const ffprobeHeaders = {
        Referer: 'https://anizmplayer.com/',
        'User-Agent': USER_AGENT,
      };
      const variants: StreamVariant[] = [];

      if (Array.isArray(data.downloadLinks)) {
        for (const dl of data.downloadLinks) {
          if (!dl?.file) continue;
          const h = qualityLabelToHeight(dl.label || '');
          variants.push({
            qualityLabel: h ? `${h}p` : dl.label || 'MP4',
            height: h,
            url: dl.file,
            format: 'mp4',
            headers: ffprobeHeaders,
          });
        }
      }

      const hlsCandidates = [data.videoSource, data.securedLink].filter(
        (u): u is string => typeof u === 'string' && u.length > 0,
      );

      for (const hlsUrl of hlsCandidates) {
        try {
          const m3u8Res = await fetchWithTimeout(hlsUrl, { headers: streamHeaders });
          if (!m3u8Res.ok) continue;
          const m3u8Text = await m3u8Res.text();
          if (!m3u8Text.includes('#EXTM3U')) continue;
          const parsedHls = parseHlsMasterPlaylist(m3u8Text, hlsUrl, ffprobeHeaders);
          if (parsedHls.length > 0) {
            variants.push(...parsedHls);
            break;
          }
          const dims = await probeVideoResolutionWithFfprobe(hlsUrl, ffprobeHeaders);
          const h = dims?.height ?? 0;
          variants.push({
            qualityLabel: h ? `${h}p` : 'HLS',
            height: h,
            url: hlsUrl,
            format: 'hls',
            headers: ffprobeHeaders,
          });
          break;
        } catch {
          // try next candidate
        }
      }

      if (!variants.length) {
        return { ...baseResult, status: 'dead', message: 'AnizmPlayer video akışı boş' };
      }

      const bestHeight = Math.max(...variants.map((v) => v.height), 0);
      return {
        ...baseResult,
        status: 'ok',
        variants,
        bestHeight,
        has1080p: bestHeight >= 1080,
      };
    }

    // Fallback check for other hosts
    const res = await fetchWithTimeout(embedUrl);
    if (!res.ok) {
      return { ...baseResult, status: 'dead', message: `HTTP ${res.status}` };
    }
    return {
      ...baseResult,
      status: 'unsupported',
      message: `${normPlayer} taraması için yt-dlp betiği önerilir`,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Bağlantı zaman aşımı';
    return { ...baseResult, status: 'error', message: msg };
  }
}
