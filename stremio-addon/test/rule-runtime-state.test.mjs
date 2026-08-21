import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ExpiringPromiseCache, RuleHealthRegistry } from '../src/rule-runtime-state.mjs';

test('deduplicates cached work and expires entries on schedule', async () => {
  let timestamp = 1_000;
  let loads = 0;
  const cache = new ExpiringPromiseCache({
    ttlMs: 100,
    maxEntries: 2,
    now: () => timestamp,
  });
  const loader = async () => {
    loads += 1;
    return `value-${loads}`;
  };

  assert.equal(await cache.get('a', loader), 'value-1');
  assert.equal(await cache.get('a', loader), 'value-1');
  assert.equal(loads, 1);
  timestamp += 101;
  assert.equal(await cache.get('a', loader), 'value-2');
  assert.equal(loads, 2);
});

test('cools down repeatedly failing rules and restores them after the interval', async () => {
  let timestamp = Date.parse('2026-08-21T00:00:00.000Z');
  const health = new RuleHealthRegistry(['bad', 'good'], {
    failureThreshold: 2,
    cooldownMs: 5_000,
    now: () => timestamp,
  });
  const failure = Object.assign(new Error('upstream failed'), {
    code: 'UPSTREAM_REQUEST_FAILED',
  });

  await assert.rejects(health.observe('bad', 'search', async () => {
    timestamp += 20;
    throw failure;
  }));
  await assert.rejects(health.observe('bad', 'search', async () => {
    timestamp += 30;
    throw failure;
  }));
  await health.observe('good', 'search', async () => {
    timestamp += 10;
    return [];
  });

  assert.equal(health.isCoolingDown('bad'), true);
  assert.deepEqual(health.rank(['bad', 'good']), ['good', 'bad']);
  const bad = health.snapshot([
    { id: 'bad', name: 'Bad Rule' },
    { id: 'good', name: 'Good Rule' },
  ])[0];
  assert.equal(bad.status, 'cooldown');
  assert.equal(bad.consecutiveFailures, 2);
  assert.equal(bad.lastErrorCode, 'UPSTREAM_REQUEST_FAILED');
  assert.equal(bad.averageLatencyMs, 23);

  timestamp += 5_001;
  assert.equal(health.isCoolingDown('bad'), false);
  await health.observe('bad', 'search', async () => ['recovered']);
  assert.equal(health.snapshot([{ id: 'bad', name: 'Bad Rule' }])[0].status, 'healthy');
});
