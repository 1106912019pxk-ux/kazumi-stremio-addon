import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { test } from 'node:test';
import { createRequestHandler } from '../src/addon.mjs';
import {
  BangumiMetadataClient,
  KazumiBangumiBridge,
  bangumiMetaId,
} from '../src/bangumi-bridge.mjs';
import {
  KazumiRuleEngine,
  KazumiStremioRuleBridge,
  normalizeKazumiRule,
} from '../src/kazumi-rule-bridge.mjs';
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

function bangumiFixture(id = 4242) {
  return {
    id,
    name: 'Native Bridge Anime',
    name_cn: '原生桥接动画',
    summary: 'Bangumi 元数据与 Kazumi 多源线路聚合测试。',
    date: '2026-07-01',
    images: { large: 'https://lain.bgm.tv/pic/cover/l/test.jpg' },
    tags: [{ name: '动画' }, { name: '测试' }],
    rating: { score: 8.2, total: 100, rank: 88 },
  };
}

test('loads and caches public Bangumi calendar and subject metadata', async () => {
  const calls = [];
  const client = new BangumiMetadataClient({
    baseUrl: 'https://api.example.test',
    fetchImpl: async (input, init) => {
      const url = new URL(input);
      calls.push({ path: url.pathname, userAgent: init.headers['user-agent'] });
      if (url.pathname === '/calendar') {
        return Response.json([{ weekday: { id: 1 }, items: [bangumiFixture()] }]);
      }
      if (url.pathname === '/v0/subjects/4242') return Response.json(bangumiFixture());
      return Response.json({ error: 'missing' }, { status: 404 });
    },
  });

  assert.equal((await client.calendar())[0].nameCn, '原生桥接动画');
  assert.equal((await client.calendar())[0].id, 4242);
  assert.equal((await client.subject(4242)).rating.score, 8.2);
  assert.equal((await client.subject(4242)).id, 4242);
  assert.deepEqual(
    calls.map((call) => call.path),
    ['/calendar', '/v0/subjects/4242'],
  );
  assert.match(calls[0].userAgent, /Kazumi-Stremio-Bridge/);
});

test('serves a Bangumi-native catalog that aggregates Kazumi sources into episodes', async (context) => {
  const rule = normalizeKazumiRule(
    {
      api: '5',
      type: 'anime',
      name: '授权来源',
      version: '1.0',
      baseURL: 'https://source.example.test/',
      searchURL: 'https://source.example.test/search?q=@keyword',
      searchList: '//article',
      searchName: './/h2',
      searchResult: './/a',
      chapterRoads: '//div[@class="road"]',
      chapterResult: './/a',
    },
    { id: 'native-fixture' },
  );
  const fetchImpl = async (input) => {
    const url = new URL(input);
    if (url.pathname === '/search' && url.searchParams.get('q') === '原生桥接动画') {
      return new Response(
        '<html><body><article><h2>原生桥接动画</h2><a href="/title/4242">详情</a></article></body></html>',
        { headers: { 'content-type': 'text/html' } },
      );
    }
    if (url.pathname === '/title/4242') {
      return new Response(`<html><body>
        <div class="road"><a href="${APPLE_COMPAT_HLS_URL}">第 1 集</a><a href="${APPLE_COMPAT_HLS_URL}">第 2 集</a></div>
        <div class="road"><a href="${APPLE_HLS_URL}">第 1 集</a><a href="${APPLE_HLS_URL}">第 2 集</a></div>
      </body></html>`);
    }
    return new Response('missing', { status: 404 });
  };
  const ruleBridge = new KazumiStremioRuleBridge(
    new KazumiRuleEngine([rule], { fetchImpl }),
  );
  const metadataClient = {
    calendar: async () => [
      {
        id: 4242,
        name: 'Native Bridge Anime',
        nameCn: '原生桥接动画',
        summary: 'Bangumi 元数据与 Kazumi 多源线路聚合测试。',
        date: '2026-07-01',
        images: { large: 'https://lain.bgm.tv/pic/cover/l/test.jpg' },
        tags: ['动画', '测试'],
        rating: { score: 8.2, total: 100, rank: 88 },
      },
    ],
    subject: async () => ({
      id: 4242,
      name: 'Native Bridge Anime',
      nameCn: '原生桥接动画',
      summary: 'Bangumi 元数据与 Kazumi 多源线路聚合测试。',
      date: '2026-07-01',
      images: { large: 'https://lain.bgm.tv/pic/cover/l/test.jpg' },
      tags: ['动画', '测试'],
      rating: { score: 8.2, total: 100, rank: 88 },
    }),
  };
  const bangumiBridge = new KazumiBangumiBridge(ruleBridge, metadataClient);
  const server = createServer(createRequestHandler({ ruleBridge, bangumiBridge }));
  const baseUrl = await listen(server);
  context.after(() => close(server));

  const manifest = await fetch(`${baseUrl}/manifest.json`).then((response) => response.json());
  assert.equal(manifest.catalogs[0].id, IDS.catalog);
  assert.equal(manifest.catalogs[0].name, 'Kazumi 本周放送');

  const catalog = await fetch(`${baseUrl}/catalog/series/${IDS.catalog}.json`).then((response) =>
    response.json(),
  );
  assert.equal(catalog.metas[0].id, bangumiMetaId(4242));
  assert.equal(catalog.metas[0].name, '原生桥接动画');
  assert.equal(catalog.metas[0].poster, 'https://lain.bgm.tv/pic/cover/l/test.jpg');

  const meta = await fetch(`${baseUrl}/meta/series/${bangumiMetaId(4242)}.json`).then(
    (response) => response.json(),
  );
  assert.equal(meta.meta.name, '原生桥接动画');
  assert.equal(meta.meta.videos.length, 2);

  const streams = await fetch(
    `${baseUrl}/stream/series/${meta.meta.videos[0].id}.json`,
  ).then((response) => response.json());
  assert.equal(streams.streams.length, 2);
  assert.deepEqual(
    streams.streams.map((stream) => stream.name),
    ['授权来源 · 播放线路1', '授权来源 · 播放线路2'],
  );
});
