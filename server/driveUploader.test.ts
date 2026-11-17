import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildCatalogFolderLookup,
  buildContentRangeHeader,
  buildDriveFileUrl,
  buildDriveFolderUrl,
  createDriveError,
  decodeHtmlEntities,
  escapeDriveQuery,
  isDriveAuthError,
  matchAnimeByFolderName,
  parseEmbeddedDriveFolderHtml,
  parseEpisodeFromDriveFileName,
  parseFansubFromDriveFileName,
  parseQualityFromDriveFileName,
  sanitizeDriveFolderName,
} from './driveUploader.ts';

test('escapeDriveQuery escapes backslashes and single quotes', () => {
  assert.equal(escapeDriveQuery("Re:Zero's \\ Test"), "Re:Zero\\'s \\\\ Test");
});

test('buildDriveFolderUrl and buildDriveFileUrl construct valid Drive links', () => {
  assert.equal(
    buildDriveFolderUrl('13YFkjFla33CLn4Vkvj_eC43I_9lGvaF-'),
    'https://drive.google.com/drive/folders/13YFkjFla33CLn4Vkvj_eC43I_9lGvaF-',
  );
  assert.equal(
    buildDriveFileUrl('file123_abc'),
    'https://drive.google.com/file/d/file123_abc/view',
  );
});

test('buildContentRangeHeader formats Drive resumable byte ranges', () => {
  assert.equal(buildContentRangeHeader(0, 8388607, 25000000), 'bytes 0-8388607/25000000');
});

test('sanitizeDriveFolderName strips illegal path characters cleanly', () => {
  assert.equal(sanitizeDriveFolderName('Fate/stay night: Unlimited?'), 'Fatestay night Unlimited');
  assert.equal(sanitizeDriveFolderName('...'), 'Anime');
});

test('parseEpisodeFromDriveFileName, parseFansubFromDriveFileName, and parseQualityFromDriveFileName parse archived Drive video names', () => {
  assert.equal(
    parseEpisodeFromDriveFileName('Banana Fish - Bolum 01 [AlucardSubs 1080p].mp4'),
    '1',
  );
  assert.equal(
    parseEpisodeFromDriveFileName('Air Gear OVA - Bölüm 03 [720p].mp4'),
    '3',
  );
  assert.equal(
    parseEpisodeFromDriveFileName('Action Heroine_S01E10_1080p.mkv'),
    '10',
  );
  assert.equal(parseEpisodeFromDriveFileName('RandomFileWithoutNumber.mp4'), null);
  assert.equal(parseEpisodeFromDriveFileName('05 [1080p].mp4', true), '5');
  assert.equal(parseEpisodeFromDriveFileName('Anime (2018) 07 [Fansub 1080p].mp4', true), '7');

  assert.equal(
    parseFansubFromDriveFileName('2.43 Seiin Koukou Danshi Volley-bu - Bolum 02 [NepentheSubs 1080p].mp4'),
    'NepentheSubs',
  );
  assert.equal(parseFansubFromDriveFileName('Anime - Bolum 01 [1080p].mp4'), undefined);

  assert.deepEqual(
    parseQualityFromDriveFileName('Banana Fish - Bolum 01 [AlucardSubs 1080p].mp4'),
    { quality: '1080p', height: 1080 },
  );
  assert.deepEqual(
    parseQualityFromDriveFileName('Anime - Bolum 02.mp4'),
    { quality: 'Drive', height: 0 },
  );
});

test('createDriveError attaches HTTP status and isDriveAuthError distinguishes 401/auth errors from transient failures', () => {
  const err401 = createDriveError('Google Drive API hatası (HTTP 401)', 401);
  assert.equal(err401.status, 401);
  assert.equal(isDriveAuthError(err401), true);

  assert.equal(isDriveAuthError(new Error('Invalid Credentials')), true);
  assert.equal(isDriveAuthError(new Error('Request is missing valid authentication credential. UNAUTHENTICATED')), true);
  assert.equal(isDriveAuthError(createDriveError('Klasör izni reddedildi', 403)), false);
  assert.equal(isDriveAuthError(createDriveError('Sunucu geçici hatası', 503)), false);
  assert.equal(isDriveAuthError(new Error('ECONNRESET')), false);
});

test('parseEmbeddedDriveFolderHtml extracts folders, video files, and decodes entities', () => {
  const sampleHtml = `
    <div class="flip-entry" id="entry-folder123">
      <a href="https://drive.google.com/drive/folders/folder123">
        <div class="flip-entry-title">A-Channel +A-Channel &amp; Specials</div>
      </a>
    </div>
    <div class="flip-entry" id="entry-file456">
      <a href="https://drive.google.com/file/d/file456/view?usp=drive_web">
        <div class="flip-entry-title">Re&#39;Zero - Bolum 02 [1080p].mp4</div>
      </a>
    </div>
  `;
  const items = parseEmbeddedDriveFolderHtml(sampleHtml);
  assert.equal(items.length, 2);
  assert.equal(items[0].mimeType, 'application/vnd.google-apps.folder');
  assert.equal(items[0].name, 'A-Channel +A-Channel & Specials');
  assert.equal(items[1].mimeType, 'video/mp4');
  assert.equal(items[1].name, "Re'Zero - Bolum 02 [1080p].mp4");
  assert.equal(decodeHtmlEntities('A &amp; B &#39;C&#39;'), "A & B 'C'");
});

test('buildCatalogFolderLookup and matchAnimeByFolderName handle sanitized and punctuated folder names', () => {
  const lookup = buildCatalogFolderLookup([
    {
      slug: 'a-channel-a-channel',
      t: 'A-Channel: +A-Channel',
      at: 'A-Channel +A-Channel',
      fmt: 'SPECIAL',
      yr: 2011,
      ec: 10,
      E: 11,
      miss: ['10'],
      d: 'tam',
      f: {},
    },
    {
      slug: 'air-gear-kuro',
      t: 'Air Gear: Kuro no Hane to Nemuri no Mori - Break on the Sky',
      at: '',
      fmt: 'OVA',
      yr: 2010,
      ec: 2,
      E: 3,
      miss: ['3'],
      d: 'tam',
      f: {},
    },
  ]);

  assert.equal(matchAnimeByFolderName('A-Channel +A-Channel', lookup)?.slug, 'a-channel-a-channel');
  assert.equal(
    matchAnimeByFolderName('Air Gear Kuro no Hane to Nemuri no Mori - Break on the Sky', lookup)?.slug,
    'air-gear-kuro',
  );
  assert.equal(matchAnimeByFolderName('Unknown Anime Folder', lookup), undefined);
});


