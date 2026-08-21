import { APPLE_COMPAT_HLS_URL, APPLE_HLS_URL, MDN_MP4_URL } from './model.mjs';

export const DEMO_RULE_ID = 'authorized-dynamic-demo';

export function createDemoRuleDocument(origin) {
  return {
    api: '5',
    type: 'anime',
    name: 'Kazumi 动态桥接验收',
    version: '1.0',
    muliSources: true,
    useWebview: true,
    useNativePlayer: true,
    baseURL: `${origin}/`,
    searchURL: `${origin}/demo/search?wd=@keyword`,
    searchList: '//article[@class="result"]',
    searchName: './/h2',
    searchResult: './/a',
    chapterRoads: '//div[@class="road"]',
    chapterResult: './/a',
  };
}

export function createDemoSearchHtml(keyword) {
  const matches = /kazumi|hls|测试|验收/i.test(keyword.trim());
  const result = matches
    ? `<article class="result">
        <h2>Kazumi 动态规则播放演示</h2>
        <a href="/demo/title/kazumi-dynamic">查看详情</a>
      </article>`
    : '';
  return `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><body>${result}</body></html>`;
}

export function createDemoTitleHtml() {
  return `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><body>
    <h1>Kazumi 动态规则播放演示</h1>
    <div class="road" data-name="最简 MP4 线路">
      <a href="/demo/play/mp4-1">第 1 集 · HTTPS MP4</a>
      <a href="/demo/play/mp4-2">第 2 集 · HTTPS MP4</a>
    </div>
    <div class="road" data-name="HLS 兼容线路">
      <a href="/demo/play/compat-1">第 1 集 · HLS 兼容流</a>
      <a href="/demo/play/compat-2">第 2 集 · HLS 兼容流</a>
    </div>
    <div class="road" data-name="HEVC HLS 线路">
      <a href="/demo/play/hevc-1">第 1 集 · HEVC 多码率</a>
      <a href="/demo/play/hevc-2">第 2 集 · HEVC 多码率</a>
    </div>
  </body></html>`;
}

export function createDemoPlaybackHtml(kind) {
  if (kind.startsWith('mp4-')) {
    return `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><body>
      <video controls src="${MDN_MP4_URL}"></video>
    </body></html>`;
  }
  if (kind.startsWith('hevc-')) {
    return `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><body>
      <video controls src="${APPLE_HLS_URL}"></video>
    </body></html>`;
  }
  if (kind.startsWith('compat-')) {
    return `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><body>
      <div id="player"></div>
      <script>window.__KAZUMI_PLAYER__ = { url: "${APPLE_COMPAT_HLS_URL}" };</script>
    </body></html>`;
  }
  return '';
}
