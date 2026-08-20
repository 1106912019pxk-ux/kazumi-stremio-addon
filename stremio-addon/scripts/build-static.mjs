import { mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  IDS,
  createCatalog,
  createManifest,
  createMeta,
  createStreams,
} from '../src/model.mjs';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const addonRoot = resolve(scriptDirectory, '..');

async function writeJson(root, relativePath, value) {
  const target = join(root, relativePath);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

export async function buildStatic(targetDirectory = join(addonRoot, 'dist', 'static')) {
  const resolvedTarget = resolve(targetDirectory);
  const normalizedTarget = `${resolvedTarget.toLowerCase()}${process.platform === 'win32' ? '\\' : '/'}`;
  const allowedRoots = [resolve(addonRoot), resolve(tmpdir())].map(
    (path) => `${path.toLowerCase()}${process.platform === 'win32' ? '\\' : '/'}`,
  );

  if (!allowedRoots.some((root) => normalizedTarget.startsWith(root))) {
    throw new Error(`Refusing to build outside add-on root: ${resolvedTarget}`);
  }

  await rm(resolvedTarget, { recursive: true, force: true });
  await mkdir(resolvedTarget, { recursive: true });

  await writeJson(resolvedTarget, 'manifest.json', createManifest());
  await writeJson(
    resolvedTarget,
    join('catalog', 'series', `${IDS.catalog}.json`),
    createCatalog(),
  );
  await writeJson(
    resolvedTarget,
    join('meta', 'series', `${IDS.series}.json`),
    createMeta(),
  );
  await writeJson(
    resolvedTarget,
    join('stream', 'series', `${IDS.episode}.json`),
    createStreams(),
  );
  await writeJson(resolvedTarget, 'healthz.json', { status: 'ok' });

  await writeFile(
    join(resolvedTarget, 'index.html'),
    '<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>Kazumi Bridge Test</title><body><h1>Kazumi Bridge Test</h1><p>使用当前站点的 <code>/manifest.json</code> 安装插件。</p></body></html>\n',
    'utf8',
  );

  return resolvedTarget;
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : '';
if (import.meta.url === invokedPath) {
  const output = await buildStatic();
  console.log(`Static add-on written to ${output}`);
}
