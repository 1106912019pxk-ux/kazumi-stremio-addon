import { KazumiRuleError } from './rule-error.mjs';

export const RULE_MODES = Object.freeze({
  XPATH: 'xpath',
  API: 'api',
});

export const API_BODY_TYPES = Object.freeze({
  NONE: 'none',
  JSON: 'json',
  FORM: 'form',
});

export const API_CHAPTER_FORMATS = Object.freeze({
  NESTED: 'nested',
  DELIMITED: 'delimited',
});

const ALLOWED_MEDIA_HEADER_NAMES = new Set(['origin', 'referer', 'user-agent']);

function ruleError(message, cause) {
  return new KazumiRuleError(message, { code: 'INVALID_RULE', cause });
}

function upstreamError(message, cause) {
  return new KazumiRuleError(message, { code: 'INVALID_UPSTREAM_DATA', cause });
}

function objectValue(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function stringMap(value) {
  return Object.fromEntries(
    Object.entries(objectValue(value)).map(([key, item]) => [String(key), item]),
  );
}

function normalizedMode(value) {
  return value === RULE_MODES.API ? RULE_MODES.API : RULE_MODES.XPATH;
}

function normalizedBodyType(value) {
  return Object.values(API_BODY_TYPES).includes(value) ? value : API_BODY_TYPES.NONE;
}

function normalizedChapterFormat(value) {
  return value === API_CHAPTER_FORMATS.DELIMITED
    ? API_CHAPTER_FORMATS.DELIMITED
    : API_CHAPTER_FORMATS.NESTED;
}

export function normalizeRuleMode(value) {
  return normalizedMode(value);
}

export function normalizeApiRequestConfig(value) {
  const input = objectValue(value);
  return {
    method: String(input.method ?? 'GET').toUpperCase(),
    url: String(input.url ?? ''),
    headers: stringMap(input.headers),
    query: stringMap(input.query),
    bodyType: normalizedBodyType(input.bodyType),
    body: input.body,
  };
}

export function normalizeApiSearchConfig(value) {
  const input = objectValue(value);
  return {
    request: normalizeApiRequestConfig(input.request),
    listPath: String(input.listPath ?? '$.data[*]'),
    namePath: String(input.namePath ?? '$.name'),
    sourcePath: String(input.sourcePath ?? '$.url'),
  };
}

export function normalizeApiChapterConfig(value) {
  const input = objectValue(value);
  const page = objectValue(input.episodePage);
  const variables = Object.fromEntries(
    Object.entries(stringMap(input.variables)).map(([key, item]) => [key, String(item)]),
  );
  const episodeVariables = Object.fromEntries(
    Object.entries(stringMap(input.episodeVariables)).map(([key, item]) => [key, String(item)]),
  );
  return {
    request: normalizeApiRequestConfig(input.request),
    format: normalizedChapterFormat(input.format),
    roadsPath: String(input.roadsPath ?? '$.data.roads[*]'),
    roadNamePath: String(input.roadNamePath ?? '$.name'),
    episodesPath: String(input.episodesPath ?? '$.episodes[*]'),
    episodeNamePath: String(input.episodeNamePath ?? '$.name'),
    episodeUrlPath: String(input.episodeUrlPath ?? '$.url'),
    roadNamesPath: String(input.roadNamesPath ?? ''),
    roadEpisodesPath: String(input.roadEpisodesPath ?? ''),
    roadSeparator: String(input.roadSeparator ?? '$$$'),
    episodeSeparator: String(input.episodeSeparator ?? '#'),
    fieldSeparator: String(input.fieldSeparator ?? '$'),
    variables,
    episodeVariables,
    episodePage:
      input.episodePage && typeof input.episodePage === 'object'
        ? { url: String(page.url ?? ''), query: stringMap(page.query) }
        : undefined,
  };
}

export function normalizeApiPlayConfig(value) {
  const input = objectValue(value);
  return {
    request: normalizeApiRequestConfig(input.request),
    urlPath: String(input.urlPath ?? '$.data.playUrl'),
    canPlayPath: String(input.canPlayPath ?? ''),
    mediaHeaders: Object.fromEntries(
      Object.entries(stringMap(input.mediaHeaders)).map(([key, item]) => [key, String(item)]),
    ),
  };
}

function bracketEnd(expression, start) {
  let quote = '';
  let escaped = false;
  for (let index = start + 1; index < expression.length; index++) {
    const character = expression[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (character === '\\') {
      escaped = true;
      continue;
    }
    if (quote) {
      if (character === quote) quote = '';
      continue;
    }
    if (character === "'" || character === '"') {
      quote = character;
      continue;
    }
    if (character === ']') return index;
  }
  throw ruleError(`JSONPath 缺少 ]: ${expression}`);
}

function unquoteJsonPathField(content, expression) {
  const quote = content[0];
  let value = '';
  let escaped = false;
  for (let index = 1; index < content.length - 1; index++) {
    const character = content[index];
    if (escaped) {
      value += character;
      escaped = false;
    } else if (character === '\\') {
      escaped = true;
    } else {
      value += character;
    }
  }
  if (escaped || content.at(-1) !== quote) {
    throw ruleError(`不支持的 JSONPath: ${expression}`);
  }
  return value;
}

export function parseRestrictedJsonPath(expression) {
  if (typeof expression !== 'string' || !expression.startsWith('$')) {
    throw ruleError(`JSONPath 必须以 $ 开头: ${expression}`);
  }
  const tokens = [];
  let index = 1;
  while (index < expression.length) {
    const character = expression[index];
    if (character === '.') {
      index++;
      const start = index;
      while (index < expression.length && /[A-Za-z0-9_$-]/.test(expression[index])) {
        index++;
      }
      if (index === start) throw ruleError(`不支持的 JSONPath: ${expression}`);
      tokens.push({ type: 'field', value: expression.slice(start, index) });
      continue;
    }
    if (character === '[') {
      const end = bracketEnd(expression, index);
      const content = expression.slice(index + 1, end).trim();
      if (/^\d+$/.test(content)) {
        tokens.push({ type: 'index', value: Number.parseInt(content, 10) });
      } else if (content === '*') {
        tokens.push({ type: 'wildcard' });
      } else if (
        content.length >= 2 &&
        ((content.startsWith("'") && content.endsWith("'")) ||
          (content.startsWith('"') && content.endsWith('"')))
      ) {
        tokens.push({ type: 'field', value: unquoteJsonPathField(content, expression) });
      } else {
        throw ruleError(`不支持的 JSONPath 片段: [${content}]`);
      }
      index = end + 1;
      continue;
    }
    throw ruleError(`不支持的 JSONPath: ${expression}`);
  }
  return tokens;
}

export function readRestrictedJsonPath(document, expression) {
  const tokens = parseRestrictedJsonPath(expression);
  let values = [document];
  for (const token of tokens) {
    const next = [];
    for (const value of values) {
      if (token.type === 'wildcard') {
        if (Array.isArray(value)) next.push(...value);
        else if (value && typeof value === 'object') next.push(...Object.values(value));
      } else if (token.type === 'index') {
        if (Array.isArray(value) && token.value < value.length) next.push(value[token.value]);
      } else if (value && typeof value === 'object' && token.value in value) {
        next.push(value[token.value]);
      }
    }
    values = next;
  }
  return values;
}

function readFirst(document, expression) {
  return readRestrictedJsonPath(document, expression)[0];
}

function stringValue(value) {
  if (value === undefined || value === null) return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function renderTemplate(template, variables, { encode = false } = {}) {
  return String(template).replace(
    /(^|[^A-Za-z0-9_])@([A-Za-z_][A-Za-z0-9_]*)/g,
    (match, prefix, name) => {
      if (!(name in variables)) throw ruleError(`缺少模板变量 @${name}`);
      const value = variables[name] === undefined || variables[name] === null
        ? ''
        : String(variables[name]);
      return `${prefix}${encode ? encodeURIComponent(value) : value}`;
    },
  );
}

function renderValue(value, variables) {
  if (typeof value === 'string') {
    const exact = value.match(/^@([A-Za-z_][A-Za-z0-9_]*)$/);
    if (exact) {
      if (!(exact[1] in variables)) throw ruleError(`缺少模板变量 @${exact[1]}`);
      return variables[exact[1]];
    }
    return renderTemplate(value, variables);
  }
  if (Array.isArray(value)) return value.map((item) => renderValue(item, variables));
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        renderTemplate(key, variables),
        renderValue(item, variables),
      ]),
    );
  }
  return value;
}

function renderMap(value, variables) {
  return Object.fromEntries(
    Object.entries(stringMap(value)).map(([key, item]) => [
      renderTemplate(key, variables),
      renderValue(item, variables),
    ]),
  );
}

function validateApiUrlTemplate(template, field) {
  if (!template.trim()) throw ruleError(`${field}不能为空`);
  let parsed;
  try {
    parsed = new URL(template.replace(/@([A-Za-z_][A-Za-z0-9_]*)/g, 'test'));
  } catch (error) {
    throw ruleError(`${field}不是有效 URL`, error);
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw ruleError(`${field}仅支持 HTTP(S)`);
  }
}

export function validateApiRequestConfig(config) {
  if (!['GET', 'POST'].includes(config.method)) {
    throw ruleError(`API 请求仅支持 GET/POST，当前为 ${config.method}`);
  }
  validateApiUrlTemplate(config.url, 'API 请求 URL');
}

export function validateApiSearchConfig(config) {
  validateApiRequestConfig(config.request);
  parseRestrictedJsonPath(config.listPath);
  parseRestrictedJsonPath(config.namePath);
  parseRestrictedJsonPath(config.sourcePath);
}

export function validateApiChapterConfig(config) {
  validateApiRequestConfig(config.request);
  for (const path of Object.values(config.variables)) parseRestrictedJsonPath(path);
  for (const path of Object.values(config.episodeVariables)) parseRestrictedJsonPath(path);
  if (config.format === API_CHAPTER_FORMATS.DELIMITED) {
    parseRestrictedJsonPath(config.roadNamesPath);
    parseRestrictedJsonPath(config.roadEpisodesPath);
    if (!config.roadSeparator || !config.episodeSeparator || !config.fieldSeparator) {
      throw ruleError('章节分隔符不能为空');
    }
    return;
  }
  if (config.roadsPath.trim()) parseRestrictedJsonPath(config.roadsPath);
  if (config.roadNamePath.trim()) parseRestrictedJsonPath(config.roadNamePath);
  parseRestrictedJsonPath(config.episodesPath);
  parseRestrictedJsonPath(config.episodeNamePath);
  if (config.episodeUrlPath.trim()) parseRestrictedJsonPath(config.episodeUrlPath);
  else if (!config.episodePage) throw ruleError('必须配置播放入口地址路径或播放页地址模板');
  if (config.episodePage && !config.episodePage.url.trim()) {
    throw ruleError('播放页地址模板不能为空');
  }
}

export function validateApiPlayConfig(config) {
  validateApiRequestConfig(config.request);
  parseRestrictedJsonPath(config.urlPath);
  if (config.canPlayPath.trim()) parseRestrictedJsonPath(config.canPlayPath);
  for (const name of Object.keys(config.mediaHeaders)) {
    if (!ALLOWED_MEDIA_HEADER_NAMES.has(name.toLowerCase())) {
      throw ruleError(`播放媒体请求头不受支持: ${name}`);
    }
  }
}

function appendQuery(url, query) {
  for (const [key, rawValue] of Object.entries(query)) {
    const values = Array.isArray(rawValue) ? rawValue : [rawValue];
    for (const value of values) {
      url.searchParams.append(key, value === null || value === undefined ? '' : String(value));
    }
  }
}

export function prepareApiRequest(config, variables) {
  validateApiRequestConfig(config);
  const renderedUrl = renderTemplate(config.url.trim(), variables, { encode: true });
  let url;
  try {
    url = new URL(renderedUrl);
  } catch (error) {
    throw ruleError(`API 请求 URL 无效: ${renderedUrl}`, error);
  }
  if (!['http:', 'https:'].includes(url.protocol)) throw ruleError('API 请求仅支持 HTTP(S)');
  appendQuery(url, renderMap(config.query, variables));

  const headers = Object.fromEntries(
    Object.entries(renderMap(config.headers, variables)).map(([key, value]) => [key, String(value)]),
  );
  let body;
  if (config.method === 'POST' && config.bodyType !== API_BODY_TYPES.NONE) {
    const renderedBody = renderValue(config.body, variables);
    if (config.bodyType === API_BODY_TYPES.JSON) {
      body = JSON.stringify(renderedBody);
      if (!Object.keys(headers).some((key) => key.toLowerCase() === 'content-type')) {
        headers['content-type'] = 'application/json; charset=utf-8';
      }
    } else if (config.bodyType === API_BODY_TYPES.FORM) {
      const form = new URLSearchParams();
      for (const [key, value] of Object.entries(stringMap(renderedBody))) {
        form.append(key, value === null || value === undefined ? '' : String(value));
      }
      body = form;
      if (!Object.keys(headers).some((key) => key.toLowerCase() === 'content-type')) {
        headers['content-type'] = 'application/x-www-form-urlencoded; charset=utf-8';
      }
    }
  }
  return { url: url.toString(), request: { method: config.method, headers, body } };
}

function decodeResponse(raw) {
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw upstreamError('API 响应不是有效 JSON', error);
  }
}

export function parseApiSearch(raw, config) {
  validateApiSearchConfig(config);
  const document = decodeResponse(raw);
  const items = [];
  for (const node of readRestrictedJsonPath(document, config.listPath)) {
    const name = stringValue(readFirst(node, config.namePath));
    const source = stringValue(readFirst(node, config.sourcePath));
    if (name && source) items.push({ name, source });
  }
  return items;
}

function normalizeEpisodeUrl(baseUrl, value) {
  if (!value.trim()) return '';
  let url;
  try {
    url = new URL(value, baseUrl);
  } catch (error) {
    throw upstreamError(`剧集页面 URL 无效: ${value}`, error);
  }
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw upstreamError('剧集页面 URL 仅支持 HTTP(S)');
  }
  return url.toString();
}

function resolveEpisodeUrl(config, rootVariables, rawUrl, roadIndex, episodeIndex, baseUrl) {
  if (!config.episodePage) return normalizeEpisodeUrl(baseUrl, rawUrl);
  const variables = {
    ...rootVariables,
    episodeUrl: rawUrl,
    roadIndex,
    roadNumber: roadIndex + 1,
    episodeIndex,
    episodeNumber: episodeIndex + 1,
  };
  const path = renderTemplate(config.episodePage.url, variables, { encode: true });
  let url;
  try {
    url = new URL(path, baseUrl);
  } catch (error) {
    throw upstreamError(`剧集页面 URL 无效: ${path}`, error);
  }
  appendQuery(url, renderMap(config.episodePage.query, variables));
  return normalizeEpisodeUrl(baseUrl, url.toString());
}

function parseNestedChapters(document, config, rootVariables, baseUrl) {
  const hasRoads = Boolean(config.roadsPath.trim());
  const roadNodes = hasRoads
    ? readRestrictedJsonPath(document, config.roadsPath)
    : [document];
  const roads = [];
  for (let roadIndex = 0; roadIndex < roadNodes.length; roadIndex++) {
    const roadNode = roadNodes[roadIndex];
    const configuredName = hasRoads && config.roadNamePath.trim()
      ? stringValue(readFirst(roadNode, config.roadNamePath))
      : '';
    const episodes = [];
    const episodeNodes = readRestrictedJsonPath(roadNode, config.episodesPath);
    for (let episodeIndex = 0; episodeIndex < episodeNodes.length; episodeIndex++) {
      const episodeNode = episodeNodes[episodeIndex];
      const name = stringValue(readFirst(episodeNode, config.episodeNamePath));
      const rawUrl = config.episodeUrlPath.trim()
        ? stringValue(readFirst(episodeNode, config.episodeUrlPath))
        : '';
      const url = resolveEpisodeUrl(
        config,
        rootVariables,
        rawUrl,
        roadIndex,
        episodeIndex,
        baseUrl,
      );
      const variables = {};
      for (const [variableName, path] of Object.entries(config.episodeVariables)) {
        const value = readFirst(episodeNode, path);
        if (value === undefined || value === null) {
          throw upstreamError(`剧集变量 ${variableName} 未匹配到值: ${path}`);
        }
        variables[variableName] = value;
      }
      if (url) {
        episodes.push({
          name: name || `第${episodeIndex + 1}集`,
          url,
          ...(Object.keys(variables).length > 0 ? { variables } : {}),
        });
      }
    }
    if (episodes.length > 0) {
      roads.push({ name: configuredName || `播放线路${roads.length + 1}`, episodes });
    }
  }
  return roads;
}

function parseDelimitedChapters(document, config, rootVariables, baseUrl) {
  const namesValue = stringValue(readFirst(document, config.roadNamesPath));
  const episodesValue = stringValue(readFirst(document, config.roadEpisodesPath));
  if (!episodesValue) return [];
  const roadNames = namesValue.split(config.roadSeparator);
  const roadGroups = episodesValue.split(config.roadSeparator);
  const roads = [];
  for (let roadIndex = 0; roadIndex < roadGroups.length; roadIndex++) {
    const episodes = [];
    const entries = roadGroups[roadIndex].split(config.episodeSeparator);
    for (let episodeIndex = 0; episodeIndex < entries.length; episodeIndex++) {
      const entry = entries[episodeIndex].trim();
      if (!entry) continue;
      const separatorIndex = entry.indexOf(config.fieldSeparator);
      if (separatorIndex < 0) continue;
      const name = entry.slice(0, separatorIndex).trim();
      const rawUrl = entry.slice(separatorIndex + config.fieldSeparator.length).trim();
      const url = resolveEpisodeUrl(
        config,
        rootVariables,
        rawUrl,
        roadIndex,
        episodeIndex,
        baseUrl,
      );
      if (url) episodes.push({ name: name || `第${episodeIndex + 1}集`, url });
    }
    if (episodes.length > 0) {
      roads.push({ name: roadNames[roadIndex]?.trim() || `播放线路${roads.length + 1}`, episodes });
    }
  }
  return roads;
}

export function parseApiChapters(raw, config, { source, baseUrl }) {
  validateApiChapterConfig(config);
  const document = decodeResponse(raw);
  const variables = { source };
  for (const [name, path] of Object.entries(config.variables)) {
    const value = readFirst(document, path);
    if (value === undefined || value === null) {
      throw upstreamError(`章节响应变量 ${name} 未匹配到值: ${path}`);
    }
    variables[name] = value;
  }
  return config.format === API_CHAPTER_FORMATS.DELIMITED
    ? parseDelimitedChapters(document, config, variables, baseUrl)
    : parseNestedChapters(document, config, variables, baseUrl);
}

export function parseApiPlay(raw, config) {
  validateApiPlayConfig(config);
  const document = decodeResponse(raw);
  if (config.canPlayPath.trim() && readFirst(document, config.canPlayPath) !== true) {
    return { mediaUrls: [], mediaHeaders: config.mediaHeaders };
  }
  const url = stringValue(readFirst(document, config.urlPath));
  if (!url) return { mediaUrls: [], mediaHeaders: config.mediaHeaders };
  let parsed;
  try {
    parsed = new URL(url);
  } catch (error) {
    throw upstreamError(`播放 API 返回了无效媒体 URL: ${url}`, error);
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw upstreamError('播放 API 返回的媒体 URL 仅支持 HTTP(S)');
  }
  if (!/\.(?:m3u8|mp4|m4v|webm)$/i.test(parsed.pathname)) {
    throw upstreamError('播放 API 未返回受支持的媒体直链');
  }
  return { mediaUrls: [parsed.toString()], mediaHeaders: config.mediaHeaders };
}
