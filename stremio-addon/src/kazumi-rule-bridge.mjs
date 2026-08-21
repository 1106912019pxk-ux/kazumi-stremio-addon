import { readFile, readdir } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';
import fontoxpath from 'fontoxpath';
import { parseHTML } from 'linkedom';

const { evaluateXPathToNodes } = fontoxpath;

const ITEM_ID_PREFIX = 'kazumi-rule-item-';
const VIDEO_ID_PREFIX = 'kazumi-rule-video-';
const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_BODY_BYTES = 2 * 1024 * 1024;
const DEFAULT_USER_AGENT = 'Kazumi-Stremio-Bridge/0.2';

export class KazumiRuleError extends Error {
  constructor(message, { code = 'RULE_ERROR', cause } = {}) {
    super(message, { cause });
    this.name = 'KazumiRuleError';
    this.code = code;
  }
}

function requiredString(value, field, ruleName) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new KazumiRuleError(`${ruleName} 缺少必填字段 ${field}`, {
      code: 'INVALID_RULE',
    });
  }
  return value.trim();
}

function httpUrl(value, field, ruleName) {
  const text = requiredString(value, field, ruleName);
  let url;
  try {
    url = new URL(text.replaceAll('@keyword', 'test'));
  } catch (error) {
    throw new KazumiRuleError(`${ruleName} 的 ${field} 不是有效 URL`, {
      code: 'INVALID_RULE',
      cause: error,
    });
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new KazumiRuleError(`${ruleName} 的 ${field} 仅支持 HTTP(S)`, {
      code: 'INVALID_RULE',
    });
  }
  return text;
}

function slug(value) {
  const normalized = value
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return normalized || 'rule';
}

export function normalizeKazumiRule(input, { id } = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new KazumiRuleError('Kazumi 规则必须是 JSON 对象', {
      code: 'INVALID_RULE',
    });
  }

  const name = requiredString(input.name, 'name', '未命名规则');
  const rule = {
    id: slug(id ?? name),
    api: String(input.api ?? '1'),
    type: typeof input.type === 'string' ? input.type : 'anime',
    name,
    version: String(input.version ?? ''),
    multiSources: input.muliSources !== false,
    useWebview: input.useWebview !== false,
    useNativePlayer: input.useNativePlayer !== false,
    usePost: input.usePost === true,
    adBlocker: input.adBlocker === true,
    userAgent:
      typeof input.userAgent === 'string' && input.userAgent.trim() !== ''
        ? input.userAgent.trim()
        : DEFAULT_USER_AGENT,
    referer: typeof input.referer === 'string' ? input.referer.trim() : '',
    baseUrl: httpUrl(input.baseURL, 'baseURL', name),
    searchUrl: httpUrl(input.searchURL, 'searchURL', name),
    searchList: requiredString(input.searchList, 'searchList', name),
    searchName: requiredString(input.searchName, 'searchName', name),
    searchResult: requiredString(input.searchResult, 'searchResult', name),
    chapterRoads: requiredString(input.chapterRoads, 'chapterRoads', name),
    chapterResult: requiredString(input.chapterResult, 'chapterResult', name),
  };

  // Catch selector syntax errors at load time instead of after a client query.
  const { document } = parseHTML('<html><body><div><a>test</a></div></body></html>');
  for (const selector of [
    rule.searchList,
    rule.searchName,
    rule.searchResult,
    rule.chapterRoads,
    rule.chapterResult,
  ]) {
    evaluateNodes(selector, document.documentElement);
  }

  return Object.freeze(rule);
}

export async function loadKazumiRules(directory) {
  if (!directory) return [];

  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error?.code === 'ENOENT') return [];
    throw error;
  }

  const rules = [];
  const ids = new Set();
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    if (!entry.isFile() || extname(entry.name).toLowerCase() !== '.json') continue;
    const path = join(directory, entry.name);
    let document;
    try {
      document = JSON.parse(await readFile(path, 'utf8'));
    } catch (error) {
      throw new KazumiRuleError(`无法读取规则 ${entry.name}`, {
        code: 'INVALID_RULE',
        cause: error,
      });
    }
    const rule = normalizeKazumiRule(document, { id: basename(entry.name, '.json') });
    if (ids.has(rule.id)) {
      throw new KazumiRuleError(`规则 ID 重复: ${rule.id}`, {
        code: 'INVALID_RULE',
      });
    }
    ids.add(rule.id);
    rules.push(rule);
  }
  return rules;
}

function xpathForHtml(expression) {
  let value = expression.trim();
  // Kazumi's node.queryXPath treats a leading // as relative to the supplied
  // node. FontoXPath follows the XPath spec and would otherwise restart at
  // the document root, so preserve Kazumi's established rule semantics.
  if (value.startsWith('//')) value = `.${value}`;
  return value.replace(
    /(^|\/)(?![\/.@*])([A-Za-z_][A-Za-z0-9_-]*)(?=(?:\[|\/|$))/g,
    '$1*:$2',
  );
}

function evaluateNodes(expression, contextNode) {
  try {
    return evaluateXPathToNodes(xpathForHtml(expression), contextNode);
  } catch (error) {
    throw new KazumiRuleError(`不支持的 XPath: ${expression}`, {
      code: 'INVALID_XPATH',
      cause: error,
    });
  }
}

function normalizedText(node) {
  return (node?.textContent ?? '').replace(/\s+/g, ' ').trim();
}

function firstHref(node) {
  return typeof node?.getAttribute === 'function' ? node.getAttribute('href')?.trim() ?? '' : '';
}

function resolveHttpUrl(baseUrl, value, field) {
  let url;
  try {
    url = new URL(value, baseUrl);
  } catch (error) {
    throw new KazumiRuleError(`${field} 不是有效 URL`, {
      code: 'INVALID_UPSTREAM_DATA',
      cause: error,
    });
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new KazumiRuleError(`${field} 仅支持 HTTP(S)`, {
      code: 'INVALID_UPSTREAM_DATA',
    });
  }
  return url.toString();
}

function assertSameOrigin(rule, value) {
  const base = new URL(rule.baseUrl);
  const candidate = new URL(value);
  if (candidate.origin !== base.origin) {
    throw new KazumiRuleError(`规则条目越过 baseURL 同源边界: ${candidate.origin}`, {
      code: 'SOURCE_ORIGIN_MISMATCH',
    });
  }
}

function encodeId(prefix, value) {
  return `${prefix}${Buffer.from(JSON.stringify(value), 'utf8').toString('base64url')}`;
}

function decodeId(prefix, value) {
  if (!value.startsWith(prefix)) {
    throw new KazumiRuleError('无法识别的桥接 ID', { code: 'INVALID_ID' });
  }
  try {
    return JSON.parse(Buffer.from(value.slice(prefix.length), 'base64url').toString('utf8'));
  } catch (error) {
    throw new KazumiRuleError('桥接 ID 已损坏', {
      code: 'INVALID_ID',
      cause: error,
    });
  }
}

function requestHeaders(rule) {
  return {
    'user-agent': rule.userAgent,
    ...(rule.referer ? { referer: rule.referer } : {}),
  };
}

export class KazumiRuleEngine {
  constructor(
    rules,
    {
      fetchImpl = globalThis.fetch,
      timeoutMs = DEFAULT_TIMEOUT_MS,
      maxBodyBytes = DEFAULT_MAX_BODY_BYTES,
    } = {},
  ) {
    if (typeof fetchImpl !== 'function') throw new TypeError('fetchImpl must be a function');
    this.rules = new Map(rules.map((rule) => [rule.id, rule]));
    this.fetchImpl = fetchImpl;
    this.timeoutMs = timeoutMs;
    this.maxBodyBytes = maxBodyBytes;
  }

  get size() {
    return this.rules.size;
  }

  async search(ruleId, keyword) {
    const rule = this.#getRule(ruleId);
    const trimmedKeyword = keyword.trim();
    if (!trimmedKeyword) return [];

    const rendered = rule.searchUrl.replaceAll(
      '@keyword',
      encodeURIComponent(trimmedKeyword),
    );
    const url = new URL(rendered);
    const postBody = rule.usePost ? new URLSearchParams(url.searchParams) : undefined;
    const request = rule.usePost
      ? {
          method: 'POST',
          headers: {
            ...requestHeaders(rule),
            'content-type': 'application/x-www-form-urlencoded; charset=utf-8',
          },
          body: postBody,
        }
      : { method: 'GET', headers: requestHeaders(rule) };
    if (rule.usePost) url.search = '';

    const html = await this.#fetchText(url, request);
    const { document } = parseHTML(html);
    const items = [];
    for (const node of evaluateNodes(rule.searchList, document.documentElement)) {
      const nameNode = evaluateNodes(rule.searchName, node)[0];
      const sourceNode = evaluateNodes(rule.searchResult, node)[0];
      const name = normalizedText(nameNode);
      const href = firstHref(sourceNode);
      if (!name || !href) continue;
      const source = resolveHttpUrl(rule.baseUrl, href, '搜索结果链接');
      assertSameOrigin(rule, source);
      items.push({ ruleId: rule.id, ruleName: rule.name, name, source });
    }
    return items;
  }

  async searchAll(keyword) {
    const settled = await Promise.allSettled(
      [...this.rules.keys()].map((ruleId) => this.search(ruleId, keyword)),
    );
    const successful = settled.filter((result) => result.status === 'fulfilled');
    if (settled.length > 0 && successful.length === 0) {
      throw settled[0].reason;
    }
    return successful.flatMap((result) => result.value);
  }

  async chapters(ruleId, source) {
    const rule = this.#getRule(ruleId);
    const sourceUrl = resolveHttpUrl(rule.baseUrl, source, '详情页链接');
    assertSameOrigin(rule, sourceUrl);
    const html = await this.#fetchText(sourceUrl, {
      method: 'GET',
      headers: requestHeaders(rule),
    });
    const { document } = parseHTML(html);
    const roads = [];
    for (const roadNode of evaluateNodes(rule.chapterRoads, document.documentElement)) {
      const episodes = [];
      for (const episodeNode of evaluateNodes(rule.chapterResult, roadNode)) {
        const href = firstHref(episodeNode);
        if (!href) continue;
        episodes.push({
          name: normalizedText(episodeNode) || `第 ${episodes.length + 1} 集`,
          url: resolveHttpUrl(rule.baseUrl, href, '剧集链接'),
        });
      }
      if (episodes.length > 0) {
        roads.push({ name: `播放线路${roads.length + 1}`, episodes });
      }
    }
    return roads;
  }

  async resolveEpisode(ruleId, source) {
    const rule = this.#getRule(ruleId);
    const sourceUrl = resolveHttpUrl(rule.baseUrl, source, '播放页链接');
    if (directMediaUrl(sourceUrl)) return [sourceUrl];

    // Arbitrary cross-origin playback pages would turn the bridge into an
    // SSRF proxy. Kazumi rules may still return cross-origin direct media,
    // but HTML probing remains inside the rule's declared base origin.
    assertSameOrigin(rule, sourceUrl);
    const html = await this.#fetchText(sourceUrl, {
      method: 'GET',
      headers: requestHeaders(rule),
    });
    return mediaUrlsFromHtml(html, sourceUrl);
  }

  #getRule(ruleId) {
    const rule = this.rules.get(ruleId);
    if (!rule) {
      throw new KazumiRuleError(`规则不存在: ${ruleId}`, { code: 'RULE_NOT_FOUND' });
    }
    return rule;
  }

  async #fetchText(url, request) {
    let response;
    try {
      response = await this.fetchImpl(url, {
        ...request,
        redirect: 'follow',
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      throw new KazumiRuleError(`上游请求失败: ${url}`, {
        code: 'UPSTREAM_REQUEST_FAILED',
        cause: error,
      });
    }
    if (!response.ok) {
      throw new KazumiRuleError(`上游返回 HTTP ${response.status}: ${url}`, {
        code: 'UPSTREAM_HTTP_ERROR',
      });
    }
    const declaredSize = Number.parseInt(response.headers.get('content-length') ?? '', 10);
    if (Number.isFinite(declaredSize) && declaredSize > this.maxBodyBytes) {
      throw new KazumiRuleError('上游响应超过大小限制', { code: 'UPSTREAM_BODY_TOO_LARGE' });
    }
    const body = await response.text();
    if (Buffer.byteLength(body, 'utf8') > this.maxBodyBytes) {
      throw new KazumiRuleError('上游响应超过大小限制', { code: 'UPSTREAM_BODY_TOO_LARGE' });
    }
    return body;
  }
}

function directMediaUrl(value) {
  try {
    const path = new URL(value).pathname.toLowerCase();
    return ['.m3u8', '.mp4', '.m4v', '.webm'].some((suffix) => path.endsWith(suffix));
  } catch {
    return false;
  }
}

function mediaUrlsFromHtml(html, pageUrl) {
  const values = [];
  const add = (value) => {
    if (typeof value !== 'string' || value.trim() === '') return;
    let resolved;
    try {
      resolved = resolveHttpUrl(pageUrl, value.trim(), '媒体链接');
    } catch {
      return;
    }
    if (directMediaUrl(resolved) && !values.includes(resolved)) values.push(resolved);
  };

  const { document } = parseHTML(html);
  for (const node of document.querySelectorAll('video[src], source[src]')) {
    add(node.getAttribute('src'));
  }

  // Many simple playback pages expose the final media URL in an inline
  // player configuration. This is intentionally passive extraction: no
  // third-party JavaScript is executed on the bridge server.
  const normalizedHtml = html.replaceAll('\\/', '/');
  for (const match of normalizedHtml.matchAll(
    /(?:https?:\/\/|\/)[^\s"'<>]+?\.(?:m3u8|mp4|m4v|webm)(?:\?[^\s"'<>]*)?/gi,
  )) {
    add(match[0]);
  }
  for (const match of normalizedHtml.matchAll(
    /["']([^"']+?\.(?:m3u8|mp4|m4v|webm)(?:\?[^"']*)?)["']/gi,
  )) {
    add(match[1]);
  }
  return values;
}

export class KazumiStremioRuleBridge {
  constructor(engine, { featuredKeyword = '' } = {}) {
    this.engine = engine;
    this.featuredKeyword = featuredKeyword.trim();
  }

  get enabled() {
    return this.engine.size > 0;
  }

  get featuredEnabled() {
    return this.enabled && this.featuredKeyword !== '';
  }

  async createFeaturedCatalog(origin) {
    if (!this.featuredEnabled) return { metas: [] };
    return this.createCatalog(origin, this.featuredKeyword);
  }

  async createCatalog(origin, keyword) {
    const results = await this.engine.searchAll(keyword);
    return {
      metas: results.map((item) => ({
        id: encodeId(ITEM_ID_PREFIX, {
          ruleId: item.ruleId,
          name: item.name,
          source: item.source,
        }),
        type: 'series',
        name: item.name,
        poster: `${origin}/assets/poster.svg`,
        posterShape: 'poster',
        genres: [item.ruleName],
        description: `Kazumi 规则：${item.ruleName}`,
      })),
    };
  }

  async createMeta(origin, id) {
    const item = decodeId(ITEM_ID_PREFIX, id);
    const roads = await this.engine.chapters(item.ruleId, item.source);
    const count = Math.max(0, ...roads.map((road) => road.episodes.length));
    const videos = [];
    for (let index = 0; index < count; index++) {
      const entries = roads.flatMap((road) => {
        const episode = road.episodes[index];
        return episode ? [{ road: road.name, ...episode }] : [];
      });
      if (entries.length === 0) continue;
      videos.push({
        id: encodeId(VIDEO_ID_PREFIX, { ruleId: item.ruleId, entries }),
        title: entries[0].name,
        released: '2000-01-01T00:00:00.000Z',
        season: 1,
        episode: index + 1,
      });
    }
    return {
      meta: {
        id,
        type: 'series',
        name: item.name,
        description: '由 Kazumi JSON 规则实时解析的剧集。',
        poster: `${origin}/assets/poster.svg`,
        background: `${origin}/assets/background.svg`,
        videos,
      },
    };
  }

  async createStreams(id) {
    const payload = decodeId(VIDEO_ID_PREFIX, id);
    const rule = this.engine.rules.get(payload.ruleId);
    if (!rule) {
      throw new KazumiRuleError(`规则不存在: ${payload.ruleId}`, {
        code: 'RULE_NOT_FOUND',
      });
    }
    const groups = await Promise.all(
      payload.entries.map(async (entry) => {
        let mediaUrls = [];
        try {
          mediaUrls = await this.engine.resolveEpisode(payload.ruleId, entry.url);
        } catch {
          // Preserve Kazumi's ability to hand unsupported WebView/JS pages to
          // a capable host instead of failing the whole episode.
        }
        const common = {
          name: entry.road,
          title: entry.name,
          description: directMediaUrl(entry.url) ? 'Kazumi 规则直链' : 'Kazumi 播放页媒体探测',
        };
        if (mediaUrls.length === 0) {
          return [
            {
              ...common,
              description: '需要 WebView/JS Hook 进一步解析',
              externalUrl: entry.url,
            },
          ];
        }
        const proxyRequestHeaders = {
          ...(rule.userAgent ? { 'User-Agent': rule.userAgent } : {}),
          ...(rule.referer ? { Referer: rule.referer } : {}),
        };
        return mediaUrls.map((mediaUrl, mediaIndex) => ({
          ...common,
          ...(mediaUrls.length > 1 ? { title: `${entry.name} · 媒体 ${mediaIndex + 1}` } : {}),
          url: mediaUrl,
          behaviorHints: {
            bingeGroup: `kazumi-rule-${rule.id}-${entry.road}`,
            notWebReady: true,
            ...(Object.keys(proxyRequestHeaders).length > 0
              ? { proxyHeaders: { request: proxyRequestHeaders } }
              : {}),
          },
        }));
      }),
    );
    return { streams: groups.flat() };
  }
}
