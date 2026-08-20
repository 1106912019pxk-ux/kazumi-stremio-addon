import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { buildStatic } from '../scripts/build-static.mjs';
import { IDS } from '../src/model.mjs';

test('builds a static HTTPS-hostable add-on bundle', async () => {
  const temporaryRoot = await mkdtemp(join(tmpdir(), 'kazumi-addon-'));
  const output = join(temporaryRoot, 'static');

  try {
    await buildStatic(output);
    const manifest = JSON.parse(await readFile(join(output, 'manifest.json'), 'utf8'));
    const streams = JSON.parse(
      await readFile(join(output, 'stream', 'series', `${IDS.episode}.json`), 'utf8'),
    );

    assert.equal(manifest.id, 'org.kazumi.bridge.test');
    assert.equal(streams.streams.length, 1);
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});
