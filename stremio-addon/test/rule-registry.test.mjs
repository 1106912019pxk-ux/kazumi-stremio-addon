import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  loadKazumiRulesFromRegistry,
  parseRuleAllowlist,
} from '../src/rule-registry.mjs';

function ruleDocument(name) {
  return {
    name,
    baseURL: 'https://source.example/',
    searchURL: 'https://source.example/search?q=@keyword',
    searchList: '//article',
    searchName: './/span',
    searchResult: './/a',
    chapterRoads: '//div',
    chapterResult: './/a',
  };
}

test('loads only explicitly allowlisted rules from an HTTPS registry', async () => {
  const requests = [];
  const fetchImpl = async (input) => {
    const url = String(input);
    requests.push(url);
    if (url === 'https://registry.example/index.json') {
      return Response.json([
        { name: 'Allowed', version: '1.0' },
        { name: 'NotSelected', version: '1.0' },
      ]);
    }
    if (url === 'https://registry.example/rules/Allowed.json') {
      return Response.json(ruleDocument('Allowed'));
    }
    return new Response('missing', { status: 404 });
  };

  const report = await loadKazumiRulesFromRegistry({
    indexUrl: 'https://registry.example/index.json',
    baseUrl: 'https://registry.example/rules/',
    allowlist: 'Allowed, Missing, Allowed',
    fetchImpl,
  });
  assert.equal(report.enabled, true);
  assert.equal(report.requested, 2);
  assert.equal(report.loaded, 1);
  assert.equal(report.rules[0].id, 'allowed');
  assert.match(report.warnings[0], /Missing/);
  assert.deepEqual(requests, [
    'https://registry.example/index.json',
    'https://registry.example/rules/Allowed.json',
  ]);
});

test('does not contact a configured registry without a rule allowlist', async () => {
  let requests = 0;
  const report = await loadKazumiRulesFromRegistry({
    indexUrl: 'https://registry.example/index.json',
    baseUrl: 'https://registry.example/rules/',
    allowlist: '',
    fetchImpl: async () => {
      requests += 1;
      return Response.json([]);
    },
  });
  assert.equal(report.loaded, 0);
  assert.equal(requests, 0);
  assert.match(report.warnings[0], /ALLOWLIST/);
  assert.deepEqual(parseRuleAllowlist(' A, B, A ,, '), ['A', 'B']);
});

test('rejects non-HTTPS registry endpoints before making a request', async () => {
  let requests = 0;
  const report = await loadKazumiRulesFromRegistry({
    indexUrl: 'http://registry.example/index.json',
    baseUrl: 'https://registry.example/rules/',
    allowlist: 'Allowed',
    fetchImpl: async () => {
      requests += 1;
      return Response.json([]);
    },
  });
  assert.equal(report.loaded, 0);
  assert.equal(requests, 0);
  assert.match(report.warnings[0], /HTTPS/);
});
