import assert from 'node:assert/strict';
import test from 'node:test';
import { loadSeedCatalog } from './catalogStore.ts';
import {
  canonicalizeFallbackPlayerName,
  findMatchingEpisodeUrl,
  normalizeSearchQueries,
  parseAnimeIzleProEpisodeLinks,
  parseAnimeIzleProEpisodeParts,
  parseAnimeIzleProSearchHtml,
  parseTurkAnimeIzleEpisodeLinks,
  parseTurkAnimeIzleSearchHtml,
  parseTurkAnimeIzleSearchSuggestions,
  parseTurkAnimeIzleTranslators,
  scoreTitleMatch,
} from './fallbackSources.ts';

test('loadSeedCatalog loads all 606 entries from the attached report file', () => {
  const entries = loadSeedCatalog();
  assert.equal(entries.length, 606);
  const yok = entries.filter((e) => e.d === 'yok').length;
  const kismi = entries.filter((e) => e.d === 'kismi').length;
  const tam = entries.filter((e) => e.d === 'tam').length;
  assert.equal(tam, 515);
  assert.equal(kismi, 9);
  assert.equal(yok, 82);
});

test('normalizeSearchQueries produces clean queries without format tags and includes altTitle', () => {
  const queries = normalizeSearchQueries(
    'Aa! Megami-sama! (TV) Specials',
    'aa-megami-sama-tv-specials',
    'Ah! My Goddess Specials',
  );
  assert.ok(queries.includes('Aa! Megami-sama! (TV) Specials'));
  assert.ok(queries.some((q) => q === 'Aa! Megami-sama! Specials'));
  assert.ok(queries.some((q) => q === 'Ah! My Goddess Specials'));
});

test('scoreTitleMatch prefers exact slug and avoids single-word false positives like Air -> Air Gear', () => {
  const s1 = scoreTitleMatch(
    'Gintama (2017)',
    'Gintama',
    'https://turkanimeizle.com/gintama',
    'gintama-2017',
    '2017',
  );
  const s2 = scoreTitleMatch(
    'Gintama (2017)',
    'Gintama (2017)',
    'https://turkanimeizle.com/gintama-2017',
    'gintama-2017',
    '2017',
  );
  assert.ok(s2 > s1);
  assert.equal(s2, 1000);

  const airVsAirGear = scoreTitleMatch(
    'Air',
    'Air Gear',
    'https://turkanimeizle.com/air-gear',
    'air-tv',
    2005,
  );
  assert.ok(airVsAirGear < 160, `Expected Air vs Air Gear < 160, got ${airVsAirGear}`);

  const airExact = scoreTitleMatch(
    'Air',
    'Air (2005)',
    'https://turkanimeizle.com/air',
    'air-tv',
    2005,
  );
  assert.ok(airExact >= 250, `Expected Air vs Air (2005) >= 250, got ${airExact}`);
});

test('findMatchingEpisodeUrl matches exact episodes, OVA slugs, and multi-episode ranges', () => {
  const urls = [
    'https://turkanimeizle.com/air-gear-3-bolum-izle',
    'https://turkanimeizle.com/air-gear-13-bolum-izle',
    'https://turkanimeizle.com/air-gear-25-bolum-final-izle',
    'https://turkanimeizle.com/angel-densetsu-ova-1-2-bolum-izle',
    'https://www.animeizle.pro/bolum/air-gear-ova-2/',
  ];
  assert.equal(
    findMatchingEpisodeUrl(urls, '3'),
    'https://turkanimeizle.com/air-gear-3-bolum-izle',
  );
  assert.equal(
    findMatchingEpisodeUrl(urls, '13'),
    'https://turkanimeizle.com/air-gear-13-bolum-izle',
  );
  assert.equal(
    findMatchingEpisodeUrl(urls, '25'),
    'https://turkanimeizle.com/air-gear-25-bolum-final-izle',
  );
  assert.equal(
    findMatchingEpisodeUrl(urls, '2'),
    'https://www.animeizle.pro/bolum/air-gear-ova-2/',
  );
  assert.equal(
    findMatchingEpisodeUrl(['https://turkanimeizle.com/angel-densetsu-ova-1-2-bolum-izle'], '1'),
    'https://turkanimeizle.com/angel-densetsu-ova-1-2-bolum-izle',
  );
  assert.equal(findMatchingEpisodeUrl(urls, '9'), null);
});

test('parseTurkAnimeIzleSearchHtml skips rating badges and picks real anime titles', () => {
  const html = `
    <a href="https://turkanimeizle.com/digimon-adventure">7.5</a>
    <a href="https://turkanimeizle.com/digimon-adventure" title="Digimon Adventure">Digimon Adventure</a>
    <a href="https://turkanimeizle.com/air-gear"><span>8.2</span></a>
  `;
  const parsed = parseTurkAnimeIzleSearchHtml(html);
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].title, 'Digimon Adventure');
  assert.equal(parsed[0].url, 'https://turkanimeizle.com/digimon-adventure');
});

test('parseAnimeIzleProSearchHtml, episode links, and action-parts extract live Keremiya markup', () => {
  const searchHtml = `
    <a href="https://www.animeizle.pro/dizi/air-gear-kuro-no-hane-to-nemuri-no-mori-break-on-the-sky/">
      <div class="poster"><img src="x.jpg" alt="poster"></div>
    </a>
    <a href="https://www.animeizle.pro/dizi/air-gear-kuro-no-hane-to-nemuri-no-mori-break-on-the-sky/">
      Air Gear: Kuro no Hane to Nemuri no Mori &#8211; Break on the Sky
    </a>
  `;
  const candidates = parseAnimeIzleProSearchHtml(searchHtml);
  assert.equal(candidates.length, 1);
  assert.equal(
    candidates[0].title,
    'Air Gear: Kuro no Hane to Nemuri no Mori – Break on the Sky',
  );

  const epHtml = `
    <a href="https://www.animeizle.pro/bolum/air-gear-ova-1-bolum/">1. Bölüm</a>
    <a href="https://www.animeizle.pro/bolum/air-gear-ova-2/">2. Bölüm</a>
  `;
  assert.deepEqual(parseAnimeIzleProEpisodeLinks(epHtml), [
    'https://www.animeizle.pro/bolum/air-gear-ova-1-bolum/',
    'https://www.animeizle.pro/bolum/air-gear-ova-2/',
  ]);

  const actionPartsHtml = `
    <div id="action-parts"><div class="popup"><ul class="parts-middle">
      <li class="part active"><div class="part-name">Sibnet</div></li>
      <li class="part"><a href="https://www.animeizle.pro/bolum/air-gear-ova-1-bolum/7/"><div class="part-name">MAIL</div></a></li>
    </ul></div></div>
  `;
  assert.deepEqual(parseAnimeIzleProEpisodeParts(actionPartsHtml), [
    {
      pageUrl: 'https://www.animeizle.pro/bolum/air-gear-ova-1-bolum/7/',
      playerName: 'MAIL',
    },
  ]);
});

test('parseTurkAnimeIzleSearchSuggestions, episode links, and translators parse live HTML patterns', () => {
  const suggestions = parseTurkAnimeIzleSearchSuggestions({
    results: [
      { title: 'FLCL Alternative', year: '2018', url: 'https://turkanimeizle.com/flcl-alternative' },
    ],
  });
  assert.equal(suggestions.length, 1);
  assert.equal(suggestions[0].url, 'https://turkanimeizle.com/flcl-alternative');

  const epLinks = parseTurkAnimeIzleEpisodeLinks(
    '<a href="https://turkanimeizle.com/flcl-alternative-5-bolum-izle">5. Bölüm</a>',
  );
  assert.deepEqual(epLinks, ['https://turkanimeizle.com/flcl-alternative-5-bolum-izle']);

  const translators = parseTurkAnimeIzleTranslators(
    '<button class="v3-translator-button" data-v3-translator data-sources="https://turkanimeizle.com/bolum/68509/cevirmen/81327" title="AlucardSubs"></button>',
  );
  assert.deepEqual(translators, [
    {
      name: 'AlucardSubs',
      sourcesUrl: 'https://turkanimeizle.com/bolum/68509/cevirmen/81327',
    },
  ]);
});

test('canonicalizeFallbackPlayerName normalizes host names accurately', () => {
  assert.equal(
    canonicalizeFallbackPlayerName('Aincrad (Reklamsız)', 'https://anizmplayer.com/video/abc'),
    'ANIZMPLAYER',
  );
  assert.equal(
    canonicalizeFallbackPlayerName('Odnoklassniki', 'https://ok.ru/videoembed/123'),
    'ODNOKLASSNIKI',
  );
  assert.equal(
    canonicalizeFallbackPlayerName('Sibnet', 'https://video.sibnet.ru/shell.php?videoid=123'),
    'SIBNET',
  );
});
