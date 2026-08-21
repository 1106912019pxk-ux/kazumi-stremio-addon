import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { createRequestHandler } from '../src/addon.mjs';
import {
  KazumiRuleEngine,
  KazumiStremioRuleBridge,
  STREAM_POLICIES,
  isCompatibleHlsMedia,
  loadKazumiRules,
  normalizeKazumiRule,
} from '../src/kazumi-rule-bridge.mjs';
import {
  API_BODY_TYPES,
  normalizeApiChapterConfig,
  parseApiChapters,
  parseRestrictedJsonPath,
  prepareApiRequest,
  readRestrictedJsonPath,
} from '../src/kazumi-api-rule.mjs';
import { createDemoRuleDocument, DEMO_RULE_ID } from '../src/demo-source.mjs';
import {
  APPLE_COMPAT_HLS_URL,
  APPLE_HLS_URL,
  IDS,
  MDN_MP4_URL,
} from '../src/model.mjs';

async function listen(server) {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  return `http://127.0.0.1:${address.port}`;
}

async function close(server) {
  await new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

test('bridges a Kazumi XPath rule from search to direct HLS streams', async (context) => {
  let requestedSearch = '';
  const upstream = createServer((request, response) => {
    const url = new URL(request.url, 'http://fixture.test');
    response.setHeader('content-type', 'text/html; charset=utf-8');
    if (url.pathname === '/search' && url.searchParams.get('q') === 'Apple HLS') {
      requestedSearch = request.url;
      response.end(`<!doctype html><html><body>
        <section><article class="result"><h2>Apple HLS Demo</h2><a href="/shows/apple">详情</a></article></section>
      </body></html>`);
      return;
    }
    if (url.pathname === '/shows/apple') {
      response.end(`<!doctype html><html><body>
        <div class="road"><a href="${APPLE_HLS_URL}">第 1 集</a></div>
        <div class="road"><a href="/watch/apple-1">第 1 集</a></div>
        <div class="road"><a href="/watch/needs-webview">第 1 集</a></div>
      </body></html>`);
      return;
    }
    if (url.pathname === '/watch/apple-1') {
      response.end(`<!doctype html><html><body>
        <script>window.player = { url: "${APPLE_COMPAT_HLS_URL}" };</script>
      </body></html>`);
      return;
    }
    response.statusCode = 404;
    response.end('missing');
  });
  const upstreamUrl = await listen(upstream);
  context.after(() => close(upstream));

  const rule = normalizeKazumiRule(
    {
      api: '5',
      type: 'anime',
      name: 'Authorized Fixture',
      version: '1.0',
      muliSources: true,
      useWebview: true,
      useNativePlayer: true,
      baseURL: `${upstreamUrl}/`,
      searchURL: `${upstreamUrl}/search?q=@keyword`,
      searchList: '//article[@class="result"]',
      searchName: './/h2',
      searchResult: './/a',
      chapterRoads: '//div[@class="road"]',
      chapterResult: './/a',
    },
    { id: 'authorized-fixture' },
  );
  const ruleBridge = new KazumiStremioRuleBridge(new KazumiRuleEngine([rule]));
  const directResults = await ruleBridge.engine.search(rule.id, 'Apple HLS');
  assert.equal(new URL(requestedSearch, upstreamUrl).searchParams.get('q'), 'Apple HLS');
  assert.equal(directResults.length, 1);
  const addon = createServer(createRequestHandler({ ruleBridge }));
  const addonUrl = await listen(addon);
  context.after(() => close(addon));

  const manifest = await fetch(`${addonUrl}/manifest.json`).then((response) => response.json());
  assert.equal(manifest.catalogs.at(-1).id, IDS.ruleCatalog);
  assert.deepEqual(manifest.catalogs.at(-1).extra, [
    { name: 'search', isRequired: true },
  ]);

  const catalog = await fetch(
    `${addonUrl}/catalog/series/${IDS.ruleCatalog}/search=Apple%20HLS.json`,
  ).then((response) => response.json());
  assert.equal(catalog.metas.length, 1);
  assert.equal(catalog.metas[0].name, 'Apple HLS Demo');
  assert.equal(catalog.metas[0].poster, `${addonUrl}/assets/poster.svg`);

  const meta = await fetch(
    `${addonUrl}/meta/series/${catalog.metas[0].id}.json`,
  ).then((response) => response.json());
  assert.equal(meta.meta.videos.length, 1);
  assert.equal(meta.meta.videos[0].title, '第 1 集');

  const streams = await fetch(
    `${addonUrl}/stream/series/${meta.meta.videos[0].id}.json`,
  ).then((response) => response.json());
  assert.equal(streams.streams.length, 3);
  assert.equal(streams.streams[0].url, APPLE_COMPAT_HLS_URL);
  assert.equal(streams.streams[0].description, 'Kazumi 播放页媒体探测');
  assert.equal(streams.streams[1].url, APPLE_HLS_URL);
  assert.equal(streams.streams[2].externalUrl, `${upstreamUrl}/watch/needs-webview`);
  assert.equal(streams.streams[2].description, '需要 WebView/JS Hook 进一步解析');
});

test('serves the authorized demo through dynamic search, episodes and lines', async (context) => {
  let requestHandler = (_request, response) => {
    response.statusCode = 503;
    response.end('starting');
  };
  const addon = createServer((request, response) => requestHandler(request, response));
  const addonUrl = await listen(addon);
  context.after(() => close(addon));

  const demoRule = normalizeKazumiRule(createDemoRuleDocument(addonUrl), {
    id: DEMO_RULE_ID,
  });
  const ruleBridge = new KazumiStremioRuleBridge(new KazumiRuleEngine([demoRule]), {
    featuredKeyword: 'Kazumi',
    streamPolicy: STREAM_POLICIES.HLS_ONLY,
  });
  requestHandler = createRequestHandler({ ruleBridge });

  const manifest = await fetch(`${addonUrl}/manifest.json`).then((response) => response.json());
  assert.equal(manifest.catalogs[0].id, IDS.catalog);
  assert.equal(manifest.catalogs[0].name, 'Kazumi 动态规则验收');

  const featuredCatalog = await fetch(
    `${addonUrl}/catalog/series/${IDS.catalog}.json`,
  ).then((response) => response.json());
  assert.equal(featuredCatalog.metas[0].name, 'Kazumi 动态规则播放演示');

  const catalog = await fetch(
    `${addonUrl}/catalog/series/${IDS.ruleCatalog}/search=Kazumi.json`,
  ).then((response) => response.json());
  assert.equal(catalog.metas.length, 1);
  assert.equal(catalog.metas[0].name, 'Kazumi 动态规则播放演示');

  const meta = await fetch(`${addonUrl}/meta/series/${catalog.metas[0].id}.json`).then(
    (response) => response.json(),
  );
  assert.equal(meta.meta.videos.length, 2);
  assert.equal(meta.meta.videos[0].title, '第 1 集 · HLS 兼容流');

  const firstEpisode = await fetch(
    `${addonUrl}/stream/series/${meta.meta.videos[0].id}.json`,
  ).then((response) => response.json());
  assert.equal(firstEpisode.streams.length, 1);
  assert.deepEqual(
    firstEpisode.streams.map((stream) => stream.url),
    [APPLE_COMPAT_HLS_URL],
  );
  assert.deepEqual(
    firstEpisode.streams.map((stream) => stream.name),
    ['播放线路1'],
  );
  assert.equal(firstEpisode.streams[0].behaviorHints.notWebReady, true);
  assert.equal(firstEpisode.streams[0].behaviorHints.proxyHeaders, undefined);
  assert.match(firstEpisode.streams[0].description, /兼容 HLS/);
  assert.equal(isCompatibleHlsMedia(MDN_MP4_URL), false);
  assert.equal(isCompatibleHlsMedia(APPLE_HLS_URL), false);
  assert.equal(isCompatibleHlsMedia(APPLE_COMPAT_HLS_URL), true);
});

test('supports legacy POST search rules', async (context) => {
  let receivedBody = '';
  const upstream = createServer((request, response) => {
    request.setEncoding('utf8');
    request.on('data', (chunk) => {
      receivedBody += chunk;
    });
    request.on('end', () => {
      response.setHeader('content-type', 'text/html; charset=utf-8');
      response.end(
        '<!doctype html><html><body><article><span>POST Result</span><a href="/shows/post">详情</a></article></body></html>',
      );
    });
  });
  const upstreamUrl = await listen(upstream);
  context.after(() => close(upstream));

  const rule = normalizeKazumiRule(
    {
      name: 'POST Fixture',
      usePost: true,
      baseURL: `${upstreamUrl}/`,
      searchURL: `${upstreamUrl}/search?wd=@keyword`,
      searchList: '//article',
      searchName: './/span',
      searchResult: './/a',
      chapterRoads: '//div',
      chapterResult: './/a',
    },
    { id: 'post-fixture' },
  );
  const engine = new KazumiRuleEngine([rule]);
  const results = await engine.search(rule.id, '中文 测试');
  assert.equal(results[0].name, 'POST Result');
  assert.equal(new URLSearchParams(receivedBody).get('wd'), '中文 测试');
});

test('bridges a current Kazumi API rule without legacy XPath fields', async (context) => {
  let receivedSearchBody;
  const upstream = createServer((request, response) => {
    const url = new URL(request.url, 'http://fixture.test');
    response.setHeader('content-type', 'application/json; charset=utf-8');
    if (request.method === 'POST' && url.pathname === '/api/search') {
      let body = '';
      request.setEncoding('utf8');
      request.on('data', (chunk) => {
        body += chunk;
      });
      request.on('end', () => {
        receivedSearchBody = JSON.parse(body);
        response.end(
          JSON.stringify({ code: 1, list: [{ vod_id: 22639, vod_name: '吞噬星空' }] }),
        );
      });
      return;
    }
    if (request.method === 'GET' && url.pathname === '/api/detail/22639') {
      response.end(
        JSON.stringify({
          list: [
            {
              vod_play_from: '高清线路$$$备用线路',
              vod_play_url: `第01集$${APPLE_COMPAT_HLS_URL}$$$正片$${APPLE_HLS_URL}`,
            },
          ],
        }),
      );
      return;
    }
    response.statusCode = 404;
    response.end(JSON.stringify({ error: 'missing' }));
  });
  const upstreamUrl = await listen(upstream);
  context.after(() => close(upstream));

  const rule = normalizeKazumiRule(
    {
      api: '8',
      type: 'anime',
      name: 'API Fixture',
      version: '1.0',
      baseURL: `${upstreamUrl}/`,
      searchMode: 'api',
      chapterMode: 'api',
      searchApiConfig: {
        request: {
          method: 'POST',
          url: `${upstreamUrl}/api/search`,
          headers: { 'X-Rule-Test': 'api-v8' },
          bodyType: 'json',
          body: { wd: '@keyword', page: 1 },
        },
        listPath: '$.list[*]',
        namePath: '$.vod_name',
        sourcePath: '$.vod_id',
      },
      chapterApiConfig: {
        request: { method: 'GET', url: `${upstreamUrl}/api/detail/@source` },
        format: 'delimited',
        roadNamesPath: '$.list[0].vod_play_from',
        roadEpisodesPath: '$.list[0].vod_play_url',
      },
    },
    { id: 'api-fixture' },
  );
  const ruleBridge = new KazumiStremioRuleBridge(new KazumiRuleEngine([rule]));
  const addon = createServer(createRequestHandler({ ruleBridge }));
  const addonUrl = await listen(addon);
  context.after(() => close(addon));

  const catalog = await fetch(
    `${addonUrl}/catalog/series/${IDS.ruleCatalog}/search=${encodeURIComponent('吞噬星空')}.json`,
  ).then((response) => response.json());
  assert.equal(catalog.error, undefined, JSON.stringify(catalog));
  assert.deepEqual(receivedSearchBody, { wd: '吞噬星空', page: 1 });
  assert.equal(catalog.metas.length, 1);
  assert.equal(catalog.metas[0].name, '吞噬星空');

  const meta = await fetch(`${addonUrl}/meta/series/${catalog.metas[0].id}.json`).then(
    (response) => response.json(),
  );
  assert.equal(meta.meta.videos.length, 1);
  assert.equal(meta.meta.videos[0].title, '第01集');

  const streams = await fetch(
    `${addonUrl}/stream/series/${meta.meta.videos[0].id}.json`,
  ).then((response) => response.json());
  assert.equal(streams.streams.length, 2);
  assert.deepEqual(
    streams.streams.map((stream) => stream.name),
    ['高清线路', '备用线路'],
  );
  assert.equal(streams.streams[0].url, APPLE_COMPAT_HLS_URL);
});

test('adapts the official Sorani API rule to an anonymous signed HLS stream', async () => {
  const hlsUrl =
    'https://www.sorani-vids.xyz/videos/example/index.m3u8?timestamp=1&key=test';
  const requests = [];
  const fetchImpl = async (input, init = {}) => {
    const url = new URL(input);
    requests.push({ url, headers: new Headers(init.headers) });
    const json = (document) =>
      new Response(JSON.stringify(document), {
        status: 200,
        headers: { 'content-type': 'application/json; charset=utf-8' },
      });
    if (url.pathname === '/sorani-cms/api/video' && url.searchParams.has('keyword')) {
      return json({ data: { records: [{ id: 76, title: '航海王' }] } });
    }
    if (url.pathname === '/sorani-cms/api/video/76') {
      return json({
        data: {
          episodes: [
            { episodeId: 61864, episodeLabel: '第0001集', episodeOrder: 1 },
          ],
        },
      });
    }
    if (url.pathname === '/sorani-cms/api/video/episode/61864/play') {
      return json({ data: { canPlay: true, vipRequired: false, playUrl: hlsUrl, hls: true } });
    }
    return new Response('missing', { status: 404 });
  };
  const rule = normalizeKazumiRule(
    {
      api: '8',
      name: 'sorani',
      baseURL: 'https://www.sorani.net/',
      useWebview: true,
      searchMode: 'api',
      chapterMode: 'api',
      searchApiConfig: {
        request: {
          method: 'GET',
          url: 'https://api.sorani.cc/sorani-cms/api/video',
          query: { keyword: '@keyword' },
        },
        listPath: '$.data.records[*]',
        namePath: '$.title',
        sourcePath: '$.id',
      },
      chapterApiConfig: {
        request: {
          method: 'GET',
          url: 'https://api.sorani.cc/sorani-cms/api/video/@source',
        },
        format: 'nested',
        roadsPath: '$.data',
        episodesPath: '$.episodes[*]',
        episodeNamePath: '$.episodeLabel',
        episodeUrlPath: '$.episodeOrder',
        episodePage: {
          url: 'https://www.sorani.net/anime/mal/@source/episode/@episodeUrl',
        },
      },
    },
    { id: 'sorani' },
  );
  assert.equal(rule.playMode, 'api');
  assert.equal(rule.chapterApiConfig.episodeVariables.episodeId, '$.episodeId');

  const bridge = new KazumiStremioRuleBridge(new KazumiRuleEngine([rule], { fetchImpl }));
  const catalog = await bridge.createCatalog('https://addon.test', '海贼王');
  const meta = await bridge.createMeta('https://addon.test', catalog.metas[0].id);
  const result = await bridge.createStreams(meta.meta.videos[0].id);

  assert.equal(result.streams.length, 1);
  assert.equal(result.streams[0].url, hlsUrl);
  assert.deepEqual(result.streams[0].behaviorHints.proxyHeaders.request, {
    Origin: 'https://www.sorani.net',
    Referer: 'https://www.sorani.net/',
  });
  const playRequest = requests.find(({ url }) => url.pathname.endsWith('/61864/play'));
  assert.equal(playRequest.headers.get('origin'), 'https://www.sorani.net');
  assert.equal(playRequest.headers.get('referer'), 'https://www.sorani.net/');
});

test('supports the restricted JSONPath and typed API request templates used by Kazumi v8', () => {
  assert.deepEqual(parseRestrictedJsonPath("$['data']['play-sources'][0].episodes[*]"), [
    { type: 'field', value: 'data' },
    { type: 'field', value: 'play-sources' },
    { type: 'index', value: 0 },
    { type: 'field', value: 'episodes' },
    { type: 'wildcard' },
  ]);
  assert.deepEqual(readRestrictedJsonPath({ data: [{ id: 1 }, { id: 2 }] }, '$.data[*].id'), [
    1,
    2,
  ]);
  assert.throws(() => parseRestrictedJsonPath('$..episodes'), /不支持的 JSONPath/);

  const prepared = prepareApiRequest(
    {
      method: 'POST',
      url: 'https://example.test/videos/@source',
      headers: { 'X-Keyword': '@keyword' },
      query: { q: '@keyword', page: 1 },
      bodyType: API_BODY_TYPES.JSON,
      body: { source: '@source', label: 'video-@source' },
    },
    { source: 'a/b', keyword: '测试' },
  );
  assert.equal(prepared.url, 'https://example.test/videos/a%2Fb?q=%E6%B5%8B%E8%AF%95&page=1');
  assert.equal(prepared.request.headers['X-Keyword'], '测试');
  assert.deepEqual(JSON.parse(prepared.request.body), { source: 'a/b', label: 'video-a/b' });
});

test('constructs playback pages from the documented Kazumi v8 nested API format', () => {
  const config = normalizeApiChapterConfig({
    request: { method: 'GET', url: 'https://example.test/api/videos/@source' },
    format: 'nested',
    roadsPath: '$.data.playSources[*]',
    roadNamePath: '$.name',
    episodesPath: '$.episodes[*]',
    episodeNamePath: '$.name',
    episodeUrlPath: '',
    variables: { slug: '$.data.slug' },
    episodePage: {
      url: 'https://example.test/video/@slug/play',
      query: { source: '@roadIndex', episode: '@episodeIndex' },
    },
  });
  const roads = parseApiChapters(
    JSON.stringify({
      data: {
        slug: '183878',
        playSources: [
          {
            name: '线路B',
            episodes: [
              { name: '第1集', url: 'protected' },
              { name: '第2集', url: 'protected' },
            ],
          },
          { name: '线路C', episodes: [{ name: '第01集', url: 'protected' }] },
        ],
      },
    }),
    config,
    { source: 'internal-id', baseUrl: 'https://example.test/' },
  );
  assert.equal(roads.length, 2);
  assert.equal(
    roads[0].episodes[1].url,
    'https://example.test/video/183878/play?source=0&episode=1',
  );
  assert.equal(
    roads[1].episodes[0].url,
    'https://example.test/video/183878/play?source=1&episode=0',
  );
});

test('loads trusted Kazumi JSON rules from a configured directory', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'kazumi-rules-'));
  try {
    await writeFile(
      join(directory, 'fixture.json'),
      JSON.stringify({
        name: 'Directory Fixture',
        baseURL: 'https://example.test/',
        searchURL: 'https://example.test/search?q=@keyword',
        searchList: '//article',
        searchName: './/span',
        searchResult: './/a',
        chapterRoads: '//div',
        chapterResult: './/a',
      }),
      'utf8',
    );
    const rules = await loadKazumiRules(directory);
    assert.equal(rules.length, 1);
    assert.equal(rules[0].id, 'fixture');
    assert.equal(rules[0].name, 'Directory Fixture');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('caches successful searches and temporarily skips repeatedly failing sources', async () => {
  let timestamp = Date.parse('2026-08-21T00:00:00.000Z');
  let badRequests = 0;
  let goodRequests = 0;
  const makeRule = (name, host) => normalizeKazumiRule(
    {
      name,
      baseURL: `https://${host}/`,
      searchURL: `https://${host}/search?q=@keyword`,
      searchList: '//article',
      searchName: './/span',
      searchResult: './/a',
      chapterRoads: '//div',
      chapterResult: './/a',
    },
    { id: name },
  );
  const engine = new KazumiRuleEngine(
    [makeRule('Bad', 'bad.example'), makeRule('Good', 'good.example')],
    {
      now: () => timestamp,
      cacheTtlMs: 60_000,
      cooldownMs: 5_000,
      failureThreshold: 2,
      fetchImpl: async (input) => {
        timestamp += 10;
        const url = new URL(input);
        if (url.hostname === 'bad.example') {
          badRequests += 1;
          throw new Error('offline');
        }
        goodRequests += 1;
        return new Response(
          '<html><body><article><span>Good Result</span><a href="/show/1">详情</a></article></body></html>',
          { headers: { 'content-type': 'text/html' } },
        );
      },
    },
  );

  assert.equal((await engine.searchAll('测试')).length, 1);
  assert.equal((await engine.searchAll('测试')).length, 1);
  assert.equal((await engine.searchAll('测试')).length, 1);
  assert.equal(badRequests, 2);
  assert.equal(goodRequests, 1);
  const badStatus = engine.status().find((rule) => rule.name === 'Bad');
  assert.equal(badStatus.status, 'cooldown');
  assert.equal(badStatus.lastErrorCode, 'UPSTREAM_REQUEST_FAILED');
});
