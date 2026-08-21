import { normalizeKazumiRule } from './kazumi-rule-bridge.mjs';

export const OFFICIAL_KAZUMI_RULES = Object.freeze({
  indexUrl: 'https://raw.githubusercontent.com/Predidit/KazumiRules/main/index.json',
  baseUrl: 'https://raw.githubusercontent.com/Predidit/KazumiRules/main/',
});

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_RULES = 32;
const DEFAULT_MAX_BODY_BYTES = 512 * 1024;
const REGISTRY_USER_AGENT =
  'Kazumi-Stremio-Bridge rule registry (https://github.com/1106912019pxk-ux/kazumi-stremio-addon)';

function safeHttpsUrl(value, field) {
  const url = new URL(value);
  if (url.protocol !== 'https:') throw new Error(`${field} 必须使用 HTTPS`);
  return url;
}

export function parseRuleAllowlist(value) {
  const entries = Array.isArray(value) ? value : String(value ?? '').split(',');
  return [...new Set(entries.map((entry) => entry.trim()).filter(Boolean))];
}

async function fetchText(fetchImpl, url, { timeoutMs, maxBodyBytes }) {
  const response = await fetchImpl(url, {
    headers: {
      accept: 'application/json',
      'user-agent': REGISTRY_USER_AGENT,
    },
    redirect: 'follow',
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const declaredSize = Number.parseInt(response.headers.get('content-length') ?? '', 10);
  if (Number.isFinite(declaredSize) && declaredSize > maxBodyBytes) {
    throw new Error('响应超过大小限制');
  }
  const body = await response.text();
  if (Buffer.byteLength(body, 'utf8') > maxBodyBytes) {
    throw new Error('响应超过大小限制');
  }
  return body;
}

function safeRuleName(value) {
  return typeof value === 'string' && /^[A-Za-z0-9._-]{1,64}$/.test(value);
}

export async function loadKazumiRulesFromRegistry({
  indexUrl,
  baseUrl,
  allowlist,
  fetchImpl = globalThis.fetch,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  maxRules = DEFAULT_MAX_RULES,
  maxBodyBytes = DEFAULT_MAX_BODY_BYTES,
} = {}) {
  const requestedNames = parseRuleAllowlist(allowlist);
  const report = {
    enabled: Boolean(indexUrl || baseUrl),
    requested: requestedNames.length,
    loaded: 0,
    rules: [],
    warnings: [],
  };
  if (!report.enabled) return report;
  if (requestedNames.length === 0) {
    report.warnings.push('远程规则仓库已配置，但 KAZUMI_RULES_ALLOWLIST 为空；未下载任何规则');
    return report;
  }
  if (typeof fetchImpl !== 'function') throw new TypeError('fetchImpl must be a function');

  let registryIndexUrl;
  let registryBaseUrl;
  try {
    registryIndexUrl = safeHttpsUrl(indexUrl, '规则索引地址');
    registryBaseUrl = safeHttpsUrl(baseUrl, '规则文件基础地址');
  } catch (error) {
    report.warnings.push(error instanceof Error ? error.message : '远程规则仓库地址无效');
    return report;
  }

  let index;
  try {
    index = JSON.parse(
      await fetchText(fetchImpl, registryIndexUrl, { timeoutMs, maxBodyBytes }),
    );
  } catch (error) {
    report.warnings.push(`无法读取远程规则索引：${error instanceof Error ? error.message : error}`);
    return report;
  }
  if (!Array.isArray(index)) {
    report.warnings.push('远程规则索引不是数组');
    return report;
  }

  const indexedNames = new Map(
    index
      .map((entry) => entry?.name)
      .filter(safeRuleName)
      .map((name) => [name.toLowerCase(), name]),
  );
  const selected = [];
  for (const requestedName of requestedNames.slice(0, maxRules)) {
    const indexedName = indexedNames.get(requestedName.toLowerCase());
    if (!indexedName) {
      report.warnings.push(`规则不在远程索引中：${requestedName}`);
      continue;
    }
    selected.push(indexedName);
  }
  if (requestedNames.length > maxRules) {
    report.warnings.push(`远程规则数量超过上限 ${maxRules}，其余规则已忽略`);
  }

  const settled = await Promise.allSettled(
    selected.map(async (name) => {
      const ruleUrl = new URL(`${encodeURIComponent(name)}.json`, registryBaseUrl);
      if (ruleUrl.origin !== registryBaseUrl.origin) throw new Error('规则地址越过仓库源站');
      const document = JSON.parse(
        await fetchText(fetchImpl, ruleUrl, { timeoutMs, maxBodyBytes }),
      );
      return normalizeKazumiRule(document, { id: name });
    }),
  );
  for (let indexPosition = 0; indexPosition < settled.length; indexPosition += 1) {
    const result = settled[indexPosition];
    const name = selected[indexPosition];
    if (result.status === 'fulfilled') {
      report.rules.push(result.value);
    } else {
      report.warnings.push(
        `无法加载规则 ${name}：${result.reason instanceof Error ? result.reason.message : result.reason}`,
      );
    }
  }
  report.loaded = report.rules.length;
  return report;
}
