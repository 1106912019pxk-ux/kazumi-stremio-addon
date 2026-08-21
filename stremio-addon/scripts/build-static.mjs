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
import { BACKGROUND_SVG, ICON_SVG, POSTER_SVG } from '../src/addon.mjs';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const addonRoot = resolve(scriptDirectory, '..');

async function writeJson(root, relativePath, value) {
  const target = join(root, relativePath);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

export async function buildStatic(
  targetDirectory = join(addonRoot, 'dist', 'static'),
  publicBaseUrl = process.env.PUBLIC_URL ?? '',
) {
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

  const origin = publicBaseUrl.replace(/\/$/, '');
  if (origin) {
    const parsedOrigin = new URL(origin);
    if (parsedOrigin.protocol !== 'https:') {
      throw new Error(`Static public URL must use HTTPS: ${origin}`);
    }
  }

  await writeJson(resolvedTarget, 'manifest.json', createManifest(origin));
  await writeJson(
    resolvedTarget,
    join('catalog', 'series', `${IDS.catalog}.json`),
    createCatalog(origin),
  );
  await writeJson(
    resolvedTarget,
    join('meta', 'series', `${IDS.series}.json`),
    createMeta(origin),
  );
  await writeJson(
    resolvedTarget,
    join('stream', 'series', `${IDS.episode}.json`),
    createStreams(),
  );
  await writeJson(resolvedTarget, 'healthz.json', { status: 'ok' });

  await mkdir(join(resolvedTarget, 'assets'), { recursive: true });
  await writeFile(join(resolvedTarget, 'assets', 'icon.svg'), ICON_SVG, 'utf8');
  await writeFile(join(resolvedTarget, 'assets', 'poster.svg'), POSTER_SVG, 'utf8');
  await writeFile(join(resolvedTarget, 'assets', 'background.svg'), BACKGROUND_SVG, 'utf8');

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
