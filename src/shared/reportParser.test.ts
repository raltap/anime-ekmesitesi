import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeCatalogStats,
  extractJsonArrayFromText,
  parseReportInput,
} from './reportParser.ts';

test('extractJsonArrayFromText extracts const R array from full HTML document', () => {
  const html = `
    <!doctype html><html><body><script>
    const R=[{"t":"Test Anime; Part 1","fmt":"TV","yr":2020,"ec":11,"E":12,"miss":["12"],"slug":"test-anime","at":"Test Anime","d":"tam","f":{"12":[["Subs","SIBNET","https://video.sibnet.ru/shell.php?videoid=123"]]}}];
    console.log("done");
    </script></body></html>
  `;
  const json = extractJsonArrayFromText(html);
  const parsed = JSON.parse(json);
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].slug, 'test-anime');
});

test('parseReportInput handles direct JSON and normalizes player names', () => {
  const raw = JSON.stringify([
    {
      t: 'Anime One',
      fmt: 'OVA',
      yr: 2021,
      ec: 1,
      E: 2,
      miss: ['2'],
      slug: 'anime-one',
      at: 'Anime One',
      d: 'tam',
      f: {
        '2': [['LGI', 'ok.ru', 'https://ok.ru/videoembed/999']],
      },
    },
    { invalid: true },
  ]);

  const { entries, skippedCount } = parseReportInput(raw);
  assert.equal(entries.length, 1);
  assert.equal(skippedCount, 1);
  assert.equal(entries[0].f['2'][0][1], 'OK.RU');
});

test('computeCatalogStats counts missing episodes and archive statuses accurately', () => {
  const { entries } = parseReportInput(
    JSON.stringify([
      { t: 'A', fmt: 'TV', yr: 2020, ec: 11, E: 12, miss: ['1'], slug: 'a', at: 'A', d: 'tam', f: {} },
      { t: 'B', fmt: 'OVA', yr: 2021, ec: 1, E: 3, miss: ['2', '3'], slug: 'b', at: 'B', d: 'kismi', f: {} },
      { t: 'C', fmt: 'TV', yr: 2022, ec: 9, E: 12, miss: ['10', '11', '12'], slug: 'c', at: 'C', d: 'yok', f: {} },
    ]),
  );

  const stats = computeCatalogStats(entries);
  assert.deepEqual(stats, {
    totalAnime: 3,
    missing1: 1,
    missing2: 1,
    missing3: 1,
    tamCount: 1,
    kismiCount: 1,
    yokCount: 1,
    totalMissingEpisodes: 6,
  });
});
