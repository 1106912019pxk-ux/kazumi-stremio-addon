import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { after, before, test } from 'node:test';
import { handleRequest } from '../src/addon.mjs';
import { APPLE_HLS_URL } from '../src/model.mjs';

let server;
let baseUrl;

before(async () => {
  server = createServer(handleRequest);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  baseUrl = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  await new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
});

test('serves a complete catalog-to-stream flow', async () => {
  const manifestResponse = await fetch(`${baseUrl}/manifest.json`);
  assert.equal(manifestResponse.status, 200);
  assert.equal(manifestResponse.headers.get('access-control-allow-origin'), '*');
  const manifest = await manifestResponse.json();
  assert.equal(manifest.id, 'org.kazumi.bridge.test');

  const catalogId = manifest.catalogs[0].id;
  const catalog = await fetch(`${baseUrl}/catalog/series/${catalogId}.json`).then((response) =>
    response.json(),
  );
  assert.equal(catalog.metas.length, 1);

  const seriesId = catalog.metas[0].id;
  const meta = await fetch(`${baseUrl}/meta/series/${seriesId}.json`).then((response) =>
    response.json(),
  );
  assert.equal(meta.meta.videos.length, 1);

  const episodeId = meta.meta.videos[0].id;
  const streams = await fetch(`${baseUrl}/stream/series/${episodeId}.json`).then((response) =>
    response.json(),
  );
  assert.equal(streams.streams[0].url, APPLE_HLS_URL);
});

test('supports health checks and CORS preflight', async () => {
  const health = await fetch(`${baseUrl}/healthz`).then((response) => response.json());
  assert.deepEqual(health, { status: 'ok' });

  const preflight = await fetch(`${baseUrl}/manifest.json`, { method: 'OPTIONS' });
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get('access-control-allow-origin'), '*');
});

test('returns JSON errors for unknown routes', async () => {
  const response = await fetch(`${baseUrl}/missing.json`);
  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), { error: 'Not found' });
});
