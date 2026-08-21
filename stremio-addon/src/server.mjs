import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { createRequestHandler } from './addon.mjs';
import {
  KazumiRuleEngine,
  KazumiStremioRuleBridge,
  loadKazumiRules,
} from './kazumi-rule-bridge.mjs';

const host = process.env.HOST ?? '0.0.0.0';
const port = Number.parseInt(process.env.PORT ?? '7000', 10);
const rulesDirectory = process.env.KAZUMI_RULES_DIR
  ? resolve(process.env.KAZUMI_RULES_DIR)
  : '';

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error(`Invalid PORT: ${process.env.PORT}`);
}

const rules = await loadKazumiRules(rulesDirectory);
const ruleBridge = new KazumiStremioRuleBridge(new KazumiRuleEngine(rules));
const server = createServer(createRequestHandler({ ruleBridge }));

server.listen(port, host, () => {
  const publicUrl = process.env.PUBLIC_URL ?? `http://127.0.0.1:${port}`;
  console.log(`Kazumi Bridge: ${publicUrl}/manifest.json`);
  console.log(`Kazumi rules loaded: ${rules.length}`);
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
