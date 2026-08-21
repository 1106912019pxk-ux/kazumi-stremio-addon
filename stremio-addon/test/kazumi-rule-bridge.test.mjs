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
  loadKazumiRules,
  normalizeKazumiRule,
} from '../src/kazumi-rule-bridge.mjs';
import { createDemoRuleDocument, DEMO_RULE_ID } from '../src/demo-source.mjs';
import { APPLE_COMPAT_HLS_URL, APPLE_HLS_URL, IDS } from '../src/model.mjs';

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
  assert.equal(streams.streams[0].url, APPLE_HLS_URL);
  assert.equal(streams.streams[1].url, APPLE_COMPAT_HLS_URL);
  assert.equal(streams.streams[1].description, 'Kazumi 播放页媒体探测');
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
  assert.equal(meta.meta.videos[0].title, '第 1 集 · HEVC 多码率');

  const firstEpisode = await fetch(
    `${addonUrl}/stream/series/${meta.meta.videos[0].id}.json`,
  ).then((response) => response.json());
  assert.equal(firstEpisode.streams.length, 2);
  assert.deepEqual(
    firstEpisode.streams.map((stream) => stream.url),
    [APPLE_HLS_URL, APPLE_COMPAT_HLS_URL],
  );
  assert.deepEqual(
    firstEpisode.streams.map((stream) => stream.name),
    ['播放线路1', '播放线路2'],
  );
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
