import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { buildStatic } from '../scripts/build-static.mjs';
import { ADDON_VERSION, IDS } from '../src/model.mjs';

test('builds a static HTTPS-hostable add-on bundle', async () => {
  const temporaryRoot = await mkdtemp(join(tmpdir(), 'kazumi-addon-'));
  const output = join(temporaryRoot, 'static');

  try {
    await buildStatic(output, 'https://example.test/kazumi-addon');
    const manifest = JSON.parse(await readFile(join(output, 'manifest.json'), 'utf8'));
    const catalog = JSON.parse(
      await readFile(join(output, 'catalog', 'series', `${IDS.catalog}.json`), 'utf8'),
    );
    const streams = JSON.parse(
      await readFile(join(output, 'stream', 'series', `${IDS.episode}.json`), 'utf8'),
    );

    assert.equal(manifest.id, 'org.kazumi.bridge.test');
    assert.equal(manifest.version, ADDON_VERSION);
    assert.equal(
      catalog.metas[0].poster,
      'https://example.test/kazumi-addon/assets/poster.svg',
    );
    assert.equal(streams.streams.length, 1);
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});
