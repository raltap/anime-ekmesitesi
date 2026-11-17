import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildEpisodeFileName,
  buildYtDlpBatchScript,
  filterAndSortCatalog,
  isAnimeCompleted,
  parseDriveFolderId,
  pickBestProbeResult,
  pickBestVariant,
  planByteRanges,
  rankCandidateLinks,
} from './playerPriority.ts';
import type { AnimeEntry, DownloadedRecord, ProbeResult } from './types.ts';

const sampleEntries: AnimeEntry[] = [
  {
    t: 'Zeta Anime',
    fmt: 'TV',
    yr: 2023,
    ec: 11,
    E: 12,
    miss: ['12'],
    slug: 'zeta-anime',
    at: 'Zeta Anime',
    d: 'tam',
    f: {
      '12': [
        ['FansubA', 'VOE', 'https://voe.sx/e/abc'],
        ['FansubA', 'ODNOKLASSNIKI', 'https://odnoklassniki.ru/videoembed/123'],
      ],
    },
  },
  {
    t: 'Alpha OVA',
    fmt: 'OVA',
    yr: 2019,
    ec: 1,
    E: 3,
    miss: ['2', '3'],
    slug: 'alpha-ova',
    at: 'Alpha OVA',
    d: 'kismi',
    f: {
      '2': [['FansubB', 'SIBNET', 'https://video.sibnet.ru/shell.php?videoid=555']],
    },
  },
];

test('filterAndSortCatalog filters by missingCount and player alias OK.RU/ODNOKLASSNIKI', () => {
  const res = filterAndSortCatalog(sampleEntries, {
    search: '',
    missingCount: '1',
    archiveStatus: 'all',
    format: '',
    player: 'OK.RU',
    sortBy: 'title',
  });
  assert.equal(res.length, 1);
  assert.equal(res[0].slug, 'zeta-anime');
});

test('filterAndSortCatalog hides completed anime by default unless showCompleted is true', () => {
  const history: Record<string, DownloadedRecord> = {
    'zeta-anime:12': {
      key: 'zeta-anime:12',
      slug: 'zeta-anime',
      animeTitle: 'Zeta Anime',
      episode: '12',
      quality: '1080p',
      resolutionHeight: 1080,
      player: 'ODNOKLASSNIKI',
      fansub: 'FansubA',
      fileName: 'Zeta.mp4',
      totalBytes: 1000,
      downloadedAt: 1,
    },
  };
  assert.equal(isAnimeCompleted(sampleEntries[0], history), true);
  assert.equal(isAnimeCompleted(sampleEntries[1], history), false);

  const hidden = filterAndSortCatalog(
    sampleEntries,
    {
      search: '',
      missingCount: 'all',
      archiveStatus: 'all',
      format: '',
      player: '',
      sortBy: 'title',
      showCompleted: false,
    },
    history,
  );
  assert.deepEqual(hidden.map((e) => e.slug), ['alpha-ova']);

  const shown = filterAndSortCatalog(
    sampleEntries,
    {
      search: '',
      missingCount: 'all',
      archiveStatus: 'all',
      format: '',
      player: '',
      sortBy: 'title',
      showCompleted: true,
    },
    history,
  );
  assert.deepEqual(shown.map((e) => e.slug), ['alpha-ova', 'zeta-anime']);
});

test('planByteRanges splits large files cleanly across connections', () => {
  assert.deepEqual(planByteRanges(500_000, 4), [{ start: 0, end: 499_999 }]);
  const ranges = planByteRanges(40_000_000, 4);
  assert.equal(ranges.length, 4);
  assert.equal(ranges[0].start, 0);
  assert.equal(ranges[3].end, 39_999_999);
  for (let i = 1; i < ranges.length; i++) {
    assert.equal(ranges[i].start, ranges[i - 1].end + 1);
  }
});

test('filterAndSortCatalog supports 2-3 combined missingCount filter', () => {
  const threeMissing: AnimeEntry = {
    ...sampleEntries[1],
    slug: 'beta-three',
    t: 'Beta Three',
    miss: ['1', '2', '3'],
  };
  const res = filterAndSortCatalog([...sampleEntries, threeMissing], {
    search: '',
    missingCount: '2-3',
    archiveStatus: 'all',
    format: '',
    player: '',
    sortBy: 'title',
  });
  assert.deepEqual(
    res.map((e) => e.slug),
    ['alpha-ova', 'beta-three'],
  );
});

test('rankCandidateLinks orders by preferred player list', () => {
  const ranked = rankCandidateLinks(sampleEntries[0].f['12'], ['ODNOKLASSNIKI', 'VOE']);
  assert.equal(ranked[0][1], 'ODNOKLASSNIKI');
  assert.equal(ranked[1][1], 'VOE');
});

test('pickBestVariant enforces strict 1080p vs 720p minHeight vs any quality', () => {
  const variants720and480 = [
    { qualityLabel: '720p', height: 720, url: 'https://a/720.mp4', format: 'mp4' as const },
    { qualityLabel: '480p', height: 480, url: 'https://a/480.mp4', format: 'mp4' as const },
  ];
  assert.equal(pickBestVariant(variants720and480, true), null);
  assert.equal(pickBestVariant(variants720and480, 1080), null);
  assert.equal(pickBestVariant(variants720and480, 720)?.height, 720);
  assert.equal(pickBestVariant(variants720and480, false)?.height, 720);

  const variantsOnly480 = [
    { qualityLabel: '480p', height: 480, url: 'https://a/480.mp4', format: 'mp4' as const },
  ];
  assert.equal(pickBestVariant(variantsOnly480, 720), null);
  assert.equal(pickBestVariant(variantsOnly480, 0)?.height, 480);

  const variants1080and720 = [
    { qualityLabel: '720p', height: 720, url: 'https://a/720.mp4', format: 'mp4' as const },
    { qualityLabel: '1080p', height: 1080, url: 'https://a/1080.mp4', format: 'mp4' as const },
  ];
  assert.equal(pickBestVariant(variants1080and720, 720)?.height, 1080);
});

test('pickBestProbeResult selects 1080p MP4 over 720p and falls back to 720p when minHeight=720', () => {
  const probes: ProbeResult[] = [
    {
      embedUrl: 'https://sibnet/1',
      player: 'SIBNET',
      fansub: 'A',
      status: 'ok',
      variants: [{ qualityLabel: '720p', height: 720, url: 'https://sibnet/720.mp4', format: 'mp4' }],
      bestHeight: 720,
      has1080p: false,
      probedAt: 1,
    },
    {
      embedUrl: 'https://ok/1',
      player: 'ODNOKLASSNIKI',
      fansub: 'B',
      status: 'ok',
      variants: [
        { qualityLabel: '1080p', height: 1080, url: 'https://ok/1080.mp4', format: 'mp4' },
        { qualityLabel: '720p', height: 720, url: 'https://ok/720.mp4', format: 'mp4' },
      ],
      bestHeight: 1080,
      has1080p: true,
      probedAt: 1,
    },
  ];
  const best = pickBestProbeResult(probes, 720);
  assert.equal(best?.probe.player, 'ODNOKLASSNIKI');
  assert.equal(best?.variant.height, 1080);

  const only720 = pickBestProbeResult([probes[0]], 720);
  assert.equal(only720?.variant.height, 720);
  assert.equal(pickBestProbeResult([probes[0]], 1080), null);
});

test('parseDriveFolderId extracts folder IDs from Drive URLs and plain IDs', () => {
  assert.equal(
    parseDriveFolderId(
      'https://drive.google.com/drive/folders/13YFkjFla33CLn4Vkvj_eC43I_9lGvaF-?usp=sharing',
    ),
    '13YFkjFla33CLn4Vkvj_eC43I_9lGvaF-',
  );
  assert.equal(
    parseDriveFolderId('https://drive.google.com/drive/u/0/folders/abcDEF_12345'),
    'abcDEF_12345',
  );
  assert.equal(
    parseDriveFolderId('https://drive.google.com/open?id=xyz9876543210'),
    'xyz9876543210',
  );
  assert.equal(parseDriveFolderId('13YFkjFla33CLn4Vkvj_eC43I_9lGvaF-'), '13YFkjFla33CLn4Vkvj_eC43I_9lGvaF-');
  assert.equal(parseDriveFolderId('  '), '');
});

test('buildEpisodeFileName and buildYtDlpBatchScript sanitize paths and respect quality mode', () => {
  assert.equal(
    buildEpisodeFileName('Black★★Rock: Shooter?', '7', 'Eksen/Subs', '1080p'),
    'Black★★Rock Shooter - Bolum 07 [EksenSubs 1080p].mp4',
  );
  const script720 = buildYtDlpBatchScript([
    {
      animeTitle: 'Zeta Anime',
      slug: 'zeta-anime',
      episode: '12',
      links: sampleEntries[0].f['12'],
    },
  ]);
  assert.match(script720, /height>=720/);
  assert.match(script720, /odnoklassniki\.ru\/videoembed\/123/);

  const script1080 = buildYtDlpBatchScript(
    [
      {
        animeTitle: 'Zeta Anime',
        slug: 'zeta-anime',
        episode: '12',
        links: sampleEntries[0].f['12'],
      },
    ],
    undefined,
    1080,
  );
  assert.match(script1080, /height>=1080/);
});
