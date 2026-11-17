import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseHlsMasterPlaylist,
  parseMailRuEmbedHtml,
  parseMailRuMetaJson,
  parseMp4uploadHtml,
  parseOkRuHtml,
  parseSendvidHtml,
  parseSibnetHtml,
  parseUqloadHtml,
  parseVkHtml,
  unpackPacker,
} from './extractors.ts';

test('parseOkRuHtml extracts 1080p full and 720p hd variants from data-options', () => {
  const metadata = JSON.stringify({
    videos: [
      { name: 'hd', url: 'https://vd.okcdn.ru/720.mp4' },
      { name: 'full', url: 'https://vd.okcdn.ru/1080.mp4' },
    ],
  });
  const options = JSON.stringify({ flashvars: { metadata } }).replace(/"/g, '&quot;');
  const html = `<div data-options="${options}"></div>`;
  const variants = parseOkRuHtml(html);
  assert.equal(variants.length, 2);
  assert.equal(variants[1].height, 1080);
  assert.equal(variants[1].qualityLabel, '1080p');
  assert.equal(variants[1].url, 'https://vd.okcdn.ru/1080.mp4');
});

test('parseSibnetHtml resolves relative /v/ path to https://video.sibnet.ru', () => {
  const html = `<script>player.src([{src: "/v/abcdef/4209734.mp4", type: "video/mp4"}]);</script>`;
  assert.equal(parseSibnetHtml(html), 'https://video.sibnet.ru/v/abcdef/4209734.mp4');
});

test('parseMailRuEmbedHtml and parseMailRuMetaJson extract 1080p stream', () => {
  const embedHtml = `window.mailru = {"metadataUrl":"//my.mail.ru/+/video/meta/12345"};`;
  assert.equal(parseMailRuEmbedHtml(embedHtml), 'https://my.mail.ru/+/video/meta/12345');

  const metaVariants = parseMailRuMetaJson(
    {
      videos: [
        { key: '720p', url: '//cdn.mail.ru/v/720.mp4' },
        { key: '1080p', url: '//cdn.mail.ru/v/1080.mp4' },
      ],
    },
    'video_key=abc',
  );
  assert.equal(metaVariants.length, 2);
  assert.equal(metaVariants[1].height, 1080);
  assert.equal(metaVariants[1].url, 'https://cdn.mail.ru/v/1080.mp4');
  assert.equal(metaVariants[1].headers?.Cookie, 'video_key=abc');
});

test('parseMp4uploadHtml and unpackPacker extract direct mp4', () => {
  const unpacked = unpackPacker('0.1({2:"3://4/5.6"});', 7, 7, 'player|src|src|https|www.mp4upload.com|video|mp4'.split('|'));
  assert.match(unpacked, /https:\/\/www\.mp4upload\.com\/video\.mp4/);

  const html = `<script>player.src({type: "video/mp4", src: "https://s1.mp4upload.com:282/d/xyz/video.mp4"}); // 1920x1080</script>`;
  const variants = parseMp4uploadHtml(html);
  assert.equal(variants.length, 1);
  assert.equal(variants[0].height, 1080);
});

test('parseSendvidHtml, parseVkHtml, and parseUqloadHtml extract mp4 sources', () => {
  const sendvid = parseSendvidHtml(`<video><source src="//cdn.sendvid.com/abc.mp4"></video>`);
  assert.equal(sendvid[0].url, 'https://cdn.sendvid.com/abc.mp4');

  const vk = parseVkHtml(`{"url720":"https://vk.com/720.mp4","url1080":"https://vk.com/1080.mp4"}`);
  assert.equal(vk.length, 2);
  assert.equal(vk[1].height, 1080);

  const uqload = parseUqloadHtml(`sources: ["https://m1.uqload.com/v.mp4"]`);
  assert.equal(uqload[0].url, 'https://m1.uqload.com/v.mp4');
});

test('parseHlsMasterPlaylist extracts 1080p and 720p stream variants with resolved URLs', () => {
  const m3u8 = [
    '#EXTM3U',
    '#EXT-X-STREAM-INF:BANDWIDTH=1500000,RESOLUTION=1280x720',
    '720/index.m3u8?token=a',
    '#EXT-X-STREAM-INF:BANDWIDTH=3500000,RESOLUTION=1920x1080',
    '1080/index.m3u8?token=b',
  ].join('\n');
  const variants = parseHlsMasterPlaylist(
    m3u8,
    'https://anizmplayer.com/cdn/hls/xyz/master.m3u8?md5=1',
  );
  assert.equal(variants.length, 2);
  assert.equal(variants[1].height, 1080);
  assert.equal(variants[1].qualityLabel, '1080p');
  assert.equal(variants[1].url, 'https://anizmplayer.com/cdn/hls/xyz/1080/index.m3u8?token=b');
  assert.equal(variants[1].format, 'hls');
});
