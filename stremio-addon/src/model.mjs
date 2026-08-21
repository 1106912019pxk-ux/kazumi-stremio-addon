export const ADDON_VERSION = '0.3.0-dev.2';

export const IDS = Object.freeze({
  catalog: 'kazumi-network-test',
  series: 'kazumi-test-apple-hls',
  episode: 'kazumi-test-apple-hls-1',
  ruleCatalog: 'kazumi-rule-search',
  ruleLibrary: 'kazumi-rule-library',
});

export const APPLE_HLS_URL =
  'https://devstreaming-cdn.apple.com/videos/streaming/examples/bipbop_adv_example_hevc/master.m3u8';

export const APPLE_COMPAT_HLS_URL =
  'https://devstreaming-cdn.apple.com/videos/streaming/examples/bipbop_4x3/bipbop_4x3_variant.m3u8';

export function createManifest(
  origin,
  { enableRuleBridge = false, enableRuleLibrary = false } = {},
) {
  const manifest = {
    id: 'org.kazumi.bridge.test',
    version: ADDON_VERSION,
    name: 'Kazumi Bridge',
    description: enableRuleBridge
      ? 'Kazumi JSON 规则到 Stremio/KDTIVI 的兼容桥接器'
      : 'Kazumi 规则桥接器的公网 HLS 协议验证插件',
    types: ['series'],
    resources: [
      'catalog',
      { name: 'meta', types: ['series'], idPrefixes: ['kazumi-'] },
      { name: 'stream', types: ['series'], idPrefixes: ['kazumi-'] },
    ],
    catalogs: [
      {
        type: 'series',
        id: IDS.catalog,
        name: 'Kazumi 网络源验证',
      },
      ...(enableRuleBridge
        ? [
            ...(enableRuleLibrary
              ? [
                  {
                    type: 'series',
                    id: IDS.ruleLibrary,
                    name: 'Kazumi 动态规则验收',
                  },
                ]
              : []),
            {
              type: 'series',
              id: IDS.ruleCatalog,
              name: 'Kazumi 规则搜索',
              extra: [{ name: 'search', isRequired: true }],
            },
          ]
        : []),
    ],
    idPrefixes: ['kazumi-'],
    behaviorHints: {
      configurable: false,
      p2p: false,
    },
  };

  if (origin) {
    manifest.logo = `${origin}/assets/icon.svg`;
  }

  return manifest;
}

export function createCatalog(origin) {
  const item = {
    id: IDS.series,
    type: 'series',
    name: 'Apple HLS 网络源验证',
    description: '仅用于验证 KDTIVI/Stremio 插件和公网播放链路。',
  };

  if (origin) {
    item.poster = `${origin}/assets/poster.svg`;
  }

  return { metas: [item] };
}

export function createMeta(origin) {
  const meta = {
    id: IDS.series,
    type: 'series',
    name: 'Apple HLS 网络源验证',
    description:
      'Apple 官方 Bip Bop HLS 测试流。此条目不来自 Kazumi 规则，也不包含第三方影视内容。',
    releaseInfo: 'Protocol Test',
    genres: ['Test'],
    videos: [
      {
        id: IDS.episode,
        title: '第 1 集 · Bip Bop HLS',
        released: '2024-01-01T00:00:00.000Z',
        season: 1,
        episode: 1,
        overview: '验证远程目录、剧集和 HLS 播放。',
      },
    ],
  };

  if (origin) {
    meta.poster = `${origin}/assets/poster.svg`;
    meta.background = `${origin}/assets/background.svg`;
  }

  return { meta };
}

export function createStreams() {
  return {
    streams: [
      {
        name: 'Apple HLS',
        title: 'Apple 官方公网测试流',
        description: 'HTTPS · HLS · AVC/HEVC · 测试内容',
        url: APPLE_HLS_URL,
        behaviorHints: {
          bingeGroup: 'kazumi-bridge-network-test',
          notWebReady: false,
        },
      },
    ],
  };
}
