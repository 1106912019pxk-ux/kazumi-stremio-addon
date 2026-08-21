const DEFAULT_CACHE_TTL_MS = 60_000;
const DEFAULT_CACHE_MAX_ENTRIES = 256;
const DEFAULT_FAILURE_THRESHOLD = 2;
const DEFAULT_COOLDOWN_MS = 2 * 60_000;

function positiveInteger(value, fallback) {
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

export class ExpiringPromiseCache {
  constructor({
    ttlMs = DEFAULT_CACHE_TTL_MS,
    maxEntries = DEFAULT_CACHE_MAX_ENTRIES,
    now = Date.now,
  } = {}) {
    this.ttlMs = Math.max(0, Number(ttlMs) || 0);
    this.maxEntries = positiveInteger(maxEntries, DEFAULT_CACHE_MAX_ENTRIES);
    this.now = now;
    this.entries = new Map();
  }

  async get(key, loader) {
    if (this.ttlMs === 0) return loader();
    const timestamp = this.now();
    const existing = this.entries.get(key);
    if (existing && existing.expiresAt > timestamp) return existing.promise;
    if (existing) this.entries.delete(key);

    this.#prune(timestamp);
    const promise = Promise.resolve().then(loader);
    this.entries.set(key, { expiresAt: timestamp + this.ttlMs, promise });
    try {
      return await promise;
    } catch (error) {
      if (this.entries.get(key)?.promise === promise) this.entries.delete(key);
      throw error;
    }
  }

  #prune(timestamp) {
    for (const [key, entry] of this.entries) {
      if (entry.expiresAt <= timestamp) this.entries.delete(key);
    }
    while (this.entries.size >= this.maxEntries) {
      this.entries.delete(this.entries.keys().next().value);
    }
  }
}

function initialRuleState() {
  return {
    successes: 0,
    failures: 0,
    consecutiveFailures: 0,
    averageLatencyMs: 0,
    lastSuccessAt: 0,
    lastFailureAt: 0,
    lastErrorCode: '',
    cooldownUntil: 0,
  };
}

function isoTimestamp(value) {
  return value > 0 ? new Date(value).toISOString() : undefined;
}

export class RuleHealthRegistry {
  constructor(ruleIds = [], {
    failureThreshold = DEFAULT_FAILURE_THRESHOLD,
    cooldownMs = DEFAULT_COOLDOWN_MS,
    now = Date.now,
  } = {}) {
    this.failureThreshold = positiveInteger(failureThreshold, DEFAULT_FAILURE_THRESHOLD);
    this.cooldownMs = positiveInteger(cooldownMs, DEFAULT_COOLDOWN_MS);
    this.now = now;
    this.states = new Map(ruleIds.map((ruleId) => [ruleId, initialRuleState()]));
  }

  async observe(ruleId, operation, task) {
    const startedAt = this.now();
    try {
      const value = await task();
      this.#recordSuccess(ruleId, this.now() - startedAt);
      return value;
    } catch (error) {
      this.#recordFailure(ruleId, error, this.now() - startedAt);
      throw error;
    }
  }

  isCoolingDown(ruleId) {
    return this.#state(ruleId).cooldownUntil > this.now();
  }

  rank(ruleIds) {
    const timestamp = this.now();
    return [...ruleIds].sort((leftId, rightId) => {
      const left = this.#state(leftId);
      const right = this.#state(rightId);
      const leftCooling = left.cooldownUntil > timestamp ? 1 : 0;
      const rightCooling = right.cooldownUntil > timestamp ? 1 : 0;
      if (leftCooling !== rightCooling) return leftCooling - rightCooling;
      if (left.consecutiveFailures !== right.consecutiveFailures) {
        return left.consecutiveFailures - right.consecutiveFailures;
      }
      const leftLatency = left.averageLatencyMs || Number.MAX_SAFE_INTEGER;
      const rightLatency = right.averageLatencyMs || Number.MAX_SAFE_INTEGER;
      return leftLatency - rightLatency;
    });
  }

  snapshot(rules = []) {
    const timestamp = this.now();
    return rules.map((rule) => {
      const state = this.#state(rule.id);
      const cooling = state.cooldownUntil > timestamp;
      const status = cooling
        ? 'cooldown'
        : state.consecutiveFailures > 0
          ? 'degraded'
          : state.successes > 0
            ? 'healthy'
            : 'unknown';
      return {
        id: rule.id,
        name: rule.name,
        status,
        successes: state.successes,
        failures: state.failures,
        consecutiveFailures: state.consecutiveFailures,
        averageLatencyMs: Math.round(state.averageLatencyMs),
        ...(isoTimestamp(state.lastSuccessAt)
          ? { lastSuccessAt: isoTimestamp(state.lastSuccessAt) }
          : {}),
        ...(isoTimestamp(state.lastFailureAt)
          ? { lastFailureAt: isoTimestamp(state.lastFailureAt) }
          : {}),
        ...(state.lastErrorCode ? { lastErrorCode: state.lastErrorCode } : {}),
        ...(cooling ? { retryAt: isoTimestamp(state.cooldownUntil) } : {}),
      };
    });
  }

  #state(ruleId) {
    if (!this.states.has(ruleId)) this.states.set(ruleId, initialRuleState());
    return this.states.get(ruleId);
  }

  #recordSuccess(ruleId, latencyMs) {
    const state = this.#state(ruleId);
    state.successes += 1;
    state.consecutiveFailures = 0;
    state.lastSuccessAt = this.now();
    state.lastErrorCode = '';
    state.cooldownUntil = 0;
    state.averageLatencyMs = state.averageLatencyMs === 0
      ? Math.max(0, latencyMs)
      : state.averageLatencyMs * 0.75 + Math.max(0, latencyMs) * 0.25;
  }

  #recordFailure(ruleId, error, latencyMs) {
    const state = this.#state(ruleId);
    state.failures += 1;
    state.consecutiveFailures += 1;
    state.lastFailureAt = this.now();
    state.lastErrorCode = typeof error?.code === 'string' ? error.code : 'UNEXPECTED_ERROR';
    state.averageLatencyMs = state.averageLatencyMs === 0
      ? Math.max(0, latencyMs)
      : state.averageLatencyMs * 0.75 + Math.max(0, latencyMs) * 0.25;
    if (state.consecutiveFailures >= this.failureThreshold) {
      state.cooldownUntil = this.now() + this.cooldownMs;
    }
  }
}
