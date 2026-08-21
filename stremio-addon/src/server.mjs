import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { createRequestHandler } from './addon.mjs';
import { BangumiMetadataClient, KazumiBangumiBridge } from './bangumi-bridge.mjs';
import {
  KazumiRuleEngine,
  KazumiStremioRuleBridge,
  STREAM_POLICIES,
  loadKazumiRules,
  normalizeKazumiRule,
} from './kazumi-rule-bridge.mjs';
import { createDemoRuleDocument, DEMO_RULE_ID } from './demo-source.mjs';
import {
  OFFICIAL_KAZUMI_RULES,
  loadKazumiRulesFromRegistry,
  parseRuleAllowlist,
} from './rule-registry.mjs';

const host = process.env.HOST ?? '0.0.0.0';
const port = Number.parseInt(process.env.PORT ?? '7000', 10);
const rulesDirectory = process.env.KAZUMI_RULES_DIR
  ? resolve(process.env.KAZUMI_RULES_DIR)
  : '';

function positiveIntegerEnvironment(name, fallback) {
  const value = Number.parseInt(process.env[name] ?? '', 10);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error(`Invalid PORT: ${process.env.PORT}`);
}

const configuredRules = await loadKazumiRules(rulesDirectory);
const remoteMode = (process.env.KAZUMI_RULES_REMOTE ?? '').trim().toLowerCase();
const remoteRuleReport = await loadKazumiRulesFromRegistry({
  indexUrl:
    remoteMode === 'official'
      ? OFFICIAL_KAZUMI_RULES.indexUrl
      : process.env.KAZUMI_RULES_INDEX_URL,
  baseUrl:
    remoteMode === 'official'
      ? OFFICIAL_KAZUMI_RULES.baseUrl
      : process.env.KAZUMI_RULES_BASE_URL,
  allowlist: parseRuleAllowlist(process.env.KAZUMI_RULES_ALLOWLIST),
});
if (remoteMode && remoteMode !== 'official') {
  remoteRuleReport.warnings.unshift(
    `不支持的 KAZUMI_RULES_REMOTE 模式：${remoteMode}；自建仓库请使用 INDEX_URL 和 BASE_URL`,
  );
}
const demoEnabled = ['1', 'true', 'yes'].includes(
  (process.env.KAZUMI_DEMO_MODE ?? '').toLowerCase(),
);
const demoRule = demoEnabled
  ? normalizeKazumiRule(createDemoRuleDocument(`http://127.0.0.1:${port}`), {
      id: DEMO_RULE_ID,
    })
  : undefined;
const rulesById = new Map(
  [...remoteRuleReport.rules, ...configuredRules, ...(demoRule ? [demoRule] : [])].map(
    (rule) => [rule.id, rule],
  ),
);
const rules = [...rulesById.values()];
const featuredKeyword =
  process.env.KAZUMI_FEATURED_SEARCH ?? (demoEnabled ? 'Kazumi' : '');
const streamPolicy =
  process.env.KAZUMI_STREAM_POLICY ?? STREAM_POLICIES.ALL;
const ruleBridge = new KazumiStremioRuleBridge(
  new KazumiRuleEngine(rules, {
    cacheTtlMs: positiveIntegerEnvironment('KAZUMI_CACHE_TTL_MS', 60_000),
    cooldownMs: positiveIntegerEnvironment('KAZUMI_RULE_COOLDOWN_MS', 120_000),
    failureThreshold: positiveIntegerEnvironment('KAZUMI_RULE_FAILURE_THRESHOLD', 2),
  }),
  {
    featuredKeyword,
    streamPolicy,
  },
);
const bangumiEnabled = ['1', 'true', 'yes'].includes(
  (process.env.KAZUMI_BANGUMI_MODE ?? '').toLowerCase(),
);
const bangumiBridge = bangumiEnabled
  ? new KazumiBangumiBridge(
      ruleBridge,
      new BangumiMetadataClient({ accessToken: process.env.BANGUMI_ACCESS_TOKEN ?? '' }),
    )
  : undefined;
const server = createServer(
  createRequestHandler({
    ruleBridge,
    bangumiBridge,
    ruleLoadReport: {
      local: configuredRules.length,
      remote: {
        enabled: remoteRuleReport.enabled,
        requested: remoteRuleReport.requested,
        loaded: remoteRuleReport.loaded,
        warnings: remoteRuleReport.warnings,
      },
    },
    onRequest: ({ method, pathname, userAgent }) => {
      const client =
        String(userAgent).replace(/\s+/g, ' ').trim().slice(0, 120) || 'unknown-client';
      console.log(`${new Date().toISOString()} ${method} ${pathname} (${client})`);
    },
  }),
);

server.listen(port, host, () => {
  const publicUrl = process.env.PUBLIC_URL ?? `http://127.0.0.1:${port}`;
  console.log(`Kazumi Bridge: ${publicUrl}/manifest.json`);
  console.log(`Kazumi rules loaded: ${rules.length}`);
  console.log(`Remote Kazumi rules loaded: ${remoteRuleReport.loaded}`);
  for (const warning of remoteRuleReport.warnings) console.warn(`Rule registry: ${warning}`);
  console.log(`Stream policy: ${streamPolicy}`);
  if (demoEnabled) console.log('Authorized dynamic demo: enabled (search keyword: Kazumi)');
  if (ruleBridge.featuredEnabled) {
    console.log(`Featured rule catalog: enabled (keyword: ${featuredKeyword})`);
  }
  if (bangumiEnabled) {
    console.log(`Bangumi native catalog: ${bangumiBridge.enabled ? 'enabled' : 'waiting for rules'}`);
  }
});

function shutdown(signal) {
  console.log(`Received ${signal}; shutting down.`);
  server.close((error) => {
    if (error) {
      console.error(error);
      process.exitCode = 1;
    }
  });
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
