import { ADDON_VERSION } from './model.mjs';
import { KazumiRuleError } from './rule-error.mjs';

const BANGUMI_META_PREFIX = 'kazumi-bangumi-';
const DEFAULT_API_URL = 'https://api.bgm.tv';
const DEFAULT_TIMEOUT_MS = 12_000;
const DEFAULT_CACHE_TTL_MS = 5 * 60_000;

function upstreamError(message, cause) {
  return new KazumiRuleError(message, { code: 'UPSTREAM_REQUEST_FAILED', cause });
}

function normalizeImages(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, url]) => typeof url === 'string' && url.trim())
      .flatMap(([key, rawUrl]) => {
        const text = rawUrl.trim();
        const candidate = text.startsWith('//')
          ? `https:${text}`
          : text.replace(/^http:\/\//i, 'https://');
        try {
          const url = new URL(candidate);
          return ['http:', 'https:'].includes(url.protocol) ? [[key, url.toString()]] : [];
        } catch {
          return [];
        }
      }),
  );
}

function normalizeTags(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((tag) => (typeof tag === 'string' ? tag : tag?.name))
    .filter((tag) => typeof tag === 'string' && tag.trim())
    .map((tag) => tag.trim());
}

export function normalizeBangumiSubject(value) {
  if (!value || typeof value !== 'object' || !Number.isInteger(Number(value.id))) {
    return undefined;
  }
  const id = Number(value.id);
  const name = typeof value.name === 'string' ? value.name.trim() : '';
  const nameCn = typeof value.name_cn === 'string'
    ? value.name_cn.trim()
    : typeof value.nameCN === 'string'
      ? value.nameCN.trim()
      : '';
  if (!name && !nameCn) return undefined;
  return {
    id,
    name,
    nameCn: nameCn || name,
    summary: typeof value.summary === 'string' ? value.summary.trim() : '',
    date: typeof value.date === 'string' ? value.date.trim() : '',
    images: normalizeImages(value.images),
    tags: normalizeTags(value.tags),
    rating:
      value.rating && typeof value.rating === 'object'
        ? {
            score: Number(value.rating.score) || 0,
            total: Number(value.rating.total) || 0,
            rank: Number(value.rating.rank) || 0,
          }
        : { score: 0, total: 0, rank: 0 },
  };
}

function preferredImage(subject, fallback = '') {
  return (
    subject.images.large ??
    subject.images.common ??
    subject.images.medium ??
    subject.images.grid ??
    subject.images.small ??
    fallback
  );
}

class ExpiringPromiseCache {
  constructor(ttlMs) {
    this.ttlMs = ttlMs;
    this.entries = new Map();
  }

  async get(key, loader) {
    const existing = this.entries.get(key);
    if (existing && existing.expiresAt > Date.now()) return existing.promise;
    const promise = Promise.resolve().then(loader);
    this.entries.set(key, { expiresAt: Date.now() + this.ttlMs, promise });
    try {
      return await promise;
    } catch (error) {
      if (this.entries.get(key)?.promise === promise) this.entries.delete(key);
      throw error;
    }
  }
}

export class BangumiMetadataClient {
  constructor({
    baseUrl = DEFAULT_API_URL,
    fetchImpl = globalThis.fetch,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    cacheTtlMs = DEFAULT_CACHE_TTL_MS,
    accessToken = '',
    userAgent = `Kazumi-Stremio-Bridge/${ADDON_VERSION} (https://github.com/1106912019pxk-ux/kazumi-stremio-addon)`,
  } = {}) {
    if (typeof fetchImpl !== 'function') throw new TypeError('fetchImpl must be a function');
    this.baseUrl = new URL(baseUrl).origin;
    this.fetchImpl = fetchImpl;
    this.timeoutMs = timeoutMs;
    this.accessToken = accessToken.trim();
    this.userAgent = userAgent;
    this.cache = new ExpiringPromiseCache(cacheTtlMs);
  }

  async calendar() {
    return this.cache.get('calendar', async () => {
      const document = await this.#getJson('/calendar');
      if (!Array.isArray(document)) throw upstreamError('Bangumi 每日放送响应格式无效');
      const subjects = [];
      const seen = new Set();
      for (const group of document) {
        if (!Array.isArray(group?.items)) continue;
        for (const item of group.items) {
          const subject = normalizeBangumiSubject(item);
          if (!subject || seen.has(subject.id)) continue;
          seen.add(subject.id);
          subjects.push(subject);
        }
      }
      return subjects;
    });
  }

  async subject(id) {
    const subjectId = Number(id);
    if (!Number.isInteger(subjectId) || subjectId <= 0) {
      throw new KazumiRuleError(`Bangumi 条目 ID 无效: ${id}`, { code: 'INVALID_ID' });
    }
    return this.cache.get(`subject:${subjectId}`, async () => {
      const document = await this.#getJson(`/v0/subjects/${subjectId}`);
      const subject = normalizeBangumiSubject(document);
      if (!subject) throw upstreamError(`Bangumi 条目响应格式无效: ${subjectId}`);
      return subject;
    });
  }

  async #getJson(path) {
    const url = new URL(path, this.baseUrl);
    let response;
    try {
      response = await this.fetchImpl(url, {
        headers: {
          'user-agent': this.userAgent,
          accept: 'application/json',
          ...(this.accessToken ? { authorization: `Bearer ${this.accessToken}` } : {}),
        },
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      throw upstreamError(`Bangumi 请求失败: ${url}`, error);
    }
    if (!response.ok) throw upstreamError(`Bangumi 返回 HTTP ${response.status}: ${url}`);
    try {
      return await response.json();
    } catch (error) {
      throw upstreamError(`Bangumi 返回了无效 JSON: ${url}`, error);
    }
  }
}

export function bangumiMetaId(subjectId) {
  return `${BANGUMI_META_PREFIX}${subjectId}`;
}

export function isBangumiMetaId(value) {
  return new RegExp(`^${BANGUMI_META_PREFIX}\\d+$`).test(value);
}

function subjectIdFromMetaId(value) {
  if (!isBangumiMetaId(value)) {
    throw new KazumiRuleError('无法识别的 Bangumi 桥接 ID', { code: 'INVALID_ID' });
  }
  return Number.parseInt(value.slice(BANGUMI_META_PREFIX.length), 10);
}

function releaseInfo(subject) {
  const year = /^\d{4}/.exec(subject.date)?.[0];
  return year || (subject.rating.score > 0 ? `${subject.rating.score.toFixed(1)} 分` : 'Bangumi');
}

export class KazumiBangumiBridge {
  constructor(
    ruleBridge,
    metadataClient,
    { maxCatalogItems = 48, cacheTtlMs = DEFAULT_CACHE_TTL_MS } = {},
  ) {
    this.ruleBridge = ruleBridge;
    this.metadataClient = metadataClient;
    this.maxCatalogItems = maxCatalogItems;
    this.metaCache = new ExpiringPromiseCache(cacheTtlMs);
  }

  get enabled() {
    return Boolean(this.ruleBridge?.enabled && this.metadataClient);
  }

  async createCatalog(origin) {
    if (!this.enabled) return { metas: [] };
    const subjects = (await this.metadataClient.calendar()).slice(0, this.maxCatalogItems);
    return {
      metas: subjects.map((subject) => ({
        id: bangumiMetaId(subject.id),
        type: 'series',
        name: subject.nameCn || subject.name,
        ...(preferredImage(subject) ? { poster: preferredImage(subject) } : {}),
        posterShape: 'poster',
        releaseInfo: releaseInfo(subject),
        genres: subject.tags.slice(0, 5),
        description: subject.summary || 'Bangumi 本周放送条目',
      })),
    };
  }

  async createMeta(origin, id) {
    const subjectId = subjectIdFromMetaId(id);
    return this.metaCache.get(`meta:${subjectId}`, async () => {
      const subject = await this.metadataClient.subject(subjectId);
      const poster = preferredImage(subject, `${origin}/assets/poster.svg`);
      return this.ruleBridge.createAggregatedMeta(origin, {
        id,
        name: subject.nameCn || subject.name,
        description: subject.summary || '由 Bangumi 元数据与 Kazumi 规则共同生成。',
        poster,
        background: preferredImage(subject, `${origin}/assets/background.svg`),
        genres: subject.tags.slice(0, 8),
        releaseInfo: releaseInfo(subject),
        searchTerms: [subject.nameCn, subject.name],
      });
    });
  }
}
