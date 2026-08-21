import {
  IDS,
  createCatalog,
  createManifest,
  createMeta,
  createStreams,
} from './model.mjs';
import { KazumiRuleError } from './kazumi-rule-bridge.mjs';
import {
  createDemoPlaybackHtml,
  createDemoSearchHtml,
  createDemoTitleHtml,
} from './demo-source.mjs';

export const ICON_SVG = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  <rect width="512" height="512" rx="112" fill="#7c3aed"/>
  <path d="M160 128v256l224-128z" fill="#fff"/>
</svg>`;

export const POSTER_SVG = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="600" height="900" viewBox="0 0 600 900">
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#111827"/><stop offset="1" stop-color="#7c3aed"/></linearGradient></defs>
  <rect width="600" height="900" fill="url(#g)"/>
  <circle cx="300" cy="390" r="120" fill="#fff" opacity=".96"/>
  <path d="M265 315v150l130-75z" fill="#7c3aed"/>
  <text x="300" y="610" text-anchor="middle" fill="#fff" font-family="sans-serif" font-size="48" font-weight="700">Kazumi Bridge</text>
  <text x="300" y="670" text-anchor="middle" fill="#ddd6fe" font-family="sans-serif" font-size="30">Network Test</text>
</svg>`;

export const BACKGROUND_SVG = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080" viewBox="0 0 1920 1080">
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#111827"/><stop offset="1" stop-color="#6d28d9"/></linearGradient></defs>
  <rect width="1920" height="1080" fill="url(#g)"/>
  <text x="960" y="540" text-anchor="middle" fill="#fff" font-family="sans-serif" font-size="112" font-weight="700">Kazumi Bridge</text>
</svg>`;

function commonHeaders(contentType) {
  return {
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET, OPTIONS',
    'access-control-allow-headers': 'Content-Type',
    'cache-control': 'public, max-age=300',
    'content-type': contentType,
  };
}

function sendJson(response, statusCode, body) {
  response.writeHead(statusCode, commonHeaders('application/json; charset=utf-8'));
  response.end(`${JSON.stringify(body, null, 2)}\n`);
}

function sendText(response, statusCode, body, contentType = 'text/plain; charset=utf-8') {
  response.writeHead(statusCode, commonHeaders(contentType));
  response.end(body);
}

function getOrigin(request) {
  const forwardedProto = request.headers['x-forwarded-proto'];
  const protocol = typeof forwardedProto === 'string' ? forwardedProto.split(',')[0].trim() : 'http';
  const host = request.headers.host ?? '127.0.0.1:7000';
  return `${protocol}://${host}`;
}

async function handleRequestCore(request, response, ruleBridge) {
  if (request.method === 'OPTIONS') {
    response.writeHead(204, commonHeaders('text/plain; charset=utf-8'));
    response.end();
    return;
  }

  if (request.method !== 'GET') {
    sendJson(response, 405, { error: 'Method not allowed' });
    return;
  }

  const origin = getOrigin(request);
  const url = new URL(request.url ?? '/', origin);
  let pathname;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {
    sendJson(response, 400, { error: 'Invalid URL encoding' });
    return;
  }

  if (pathname === '/') {
    sendText(
      response,
      200,
      `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>Kazumi Bridge Test</title><body><h1>Kazumi Bridge Test</h1><p>将以下地址粘贴到支持 Stremio 插件的客户端：</p><code>${origin}/manifest.json</code></body></html>`,
      'text/html; charset=utf-8',
    );
    return;
  }

  if (pathname === '/healthz' || pathname === '/healthz.json') {
    sendJson(response, 200, {
      status: 'ok',
      ruleBridge: {
        enabled: ruleBridge?.enabled ?? false,
        rules: ruleBridge?.engine.size ?? 0,
      },
    });
    return;
  }

  if (pathname === '/manifest.json') {
    sendJson(
      response,
      200,
      createManifest(origin, { enableRuleBridge: ruleBridge?.enabled ?? false }),
    );
    return;
  }

  if (pathname === '/demo/search') {
    sendText(
      response,
      200,
      createDemoSearchHtml(url.searchParams.get('wd') ?? ''),
      'text/html; charset=utf-8',
    );
    return;
  }

  if (pathname === '/demo/title/kazumi-dynamic') {
    sendText(response, 200, createDemoTitleHtml(), 'text/html; charset=utf-8');
    return;
  }

  const demoPlaybackMatch = pathname.match(/^\/demo\/play\/([a-z0-9-]+)$/);
  if (demoPlaybackMatch) {
    const html = createDemoPlaybackHtml(demoPlaybackMatch[1]);
    if (html) {
      sendText(response, 200, html, 'text/html; charset=utf-8');
      return;
    }
  }

  if (pathname === `/catalog/series/${IDS.catalog}.json`) {
    sendJson(response, 200, createCatalog(origin));
    return;
  }

  if (pathname === `/meta/series/${IDS.series}.json`) {
    sendJson(response, 200, createMeta(origin));
    return;
  }

  if (pathname === `/stream/series/${IDS.episode}.json`) {
    sendJson(response, 200, createStreams());
    return;
  }

  if (ruleBridge?.enabled) {
    const searchPrefix = `/catalog/series/${IDS.ruleCatalog}/`;
    if (pathname.startsWith(searchPrefix) && pathname.endsWith('.json')) {
      const extra = pathname.slice(searchPrefix.length, -'.json'.length);
      const keyword = new URLSearchParams(extra).get('search') ?? '';
      sendJson(response, 200, await ruleBridge.createCatalog(origin, keyword));
      return;
    }

    const ruleMetaMatch = pathname.match(/^\/meta\/series\/(kazumi-rule-item-[A-Za-z0-9_-]+)\.json$/);
    if (ruleMetaMatch) {
      sendJson(response, 200, await ruleBridge.createMeta(origin, ruleMetaMatch[1]));
      return;
    }

    const ruleStreamMatch = pathname.match(
      /^\/stream\/series\/(kazumi-rule-video-[A-Za-z0-9_-]+)\.json$/,
    );
    if (ruleStreamMatch) {
      sendJson(response, 200, await ruleBridge.createStreams(ruleStreamMatch[1]));
      return;
    }
  }

  if (pathname === '/assets/icon.svg') {
    sendText(response, 200, ICON_SVG, 'image/svg+xml; charset=utf-8');
    return;
  }

  if (pathname === '/assets/poster.svg') {
    sendText(response, 200, POSTER_SVG, 'image/svg+xml; charset=utf-8');
    return;
  }

  if (pathname === '/assets/background.svg') {
    sendText(response, 200, BACKGROUND_SVG, 'image/svg+xml; charset=utf-8');
    return;
  }

  sendJson(response, 404, { error: 'Not found' });
}

function errorStatus(error) {
  if (!(error instanceof KazumiRuleError)) return 500;
  if (error.code === 'RULE_NOT_FOUND') return 404;
  if (error.code.startsWith('UPSTREAM_')) return 502;
  return 400;
}

export function createRequestHandler({ ruleBridge } = {}) {
  return (request, response) => {
    handleRequestCore(request, response, ruleBridge).catch((error) => {
      if (response.headersSent) {
        response.destroy(error);
        return;
      }
      sendJson(response, errorStatus(error), {
        error: error instanceof Error ? error.message : 'Internal server error',
        ...(error instanceof KazumiRuleError ? { code: error.code } : {}),
      });
    });
  };
}

export const handleRequest = createRequestHandler();
