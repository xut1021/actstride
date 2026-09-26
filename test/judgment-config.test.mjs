import { test } from 'node:test';
import assert from 'node:assert/strict';
import { judgmentConfig, judgmentPrice, fastCredentials } from '../windows/judgment-config.mjs';
import { FastDecider } from '../fast-decider.mjs';

test('desktop defaults preserve the tested model and allow explicit version/threshold changes', () => {
  assert.deepEqual(judgmentConfig([]), { provider: 'openrouter', model: 'typesafe/jev-1.13', endpoint: undefined, threshold: 0.55, repeats: 2, compare: 'judgments' });
  const c = judgmentConfig(['--fast', 'vendor/test-version', '--threshold', '0.8', '--repeats', '1']);
  assert.equal(c.model, 'vendor/test-version'); assert.equal(c.threshold, 0.8); assert.equal(c.repeats, 1);
  assert.equal(judgmentConfig(['--compare', 'planning']).compare, 'planning');
  assert.throws(() => judgmentConfig(['--compare', 'invalid']));
  for (const args of [['--threshold', 'NaN'], ['--threshold', ''], ['--threshold', '1.1'], ['--repeats', '0'], ['--fast', '../escape'], ['--fast-provider', 'unknown'], ['--fast-images']]) {
    assert.throws(() => judgmentConfig(args));
  }
});

test('local desktop configuration isolates credentials and leaves model selection to the server', async () => {
  const c = judgmentConfig(['--fast-provider', 'systemone', '--fast-endpoint', 'http://127.0.0.1:8000/v1/systemone']);
  assert.equal(c.model, undefined);
  assert.equal(fastCredentials(c.provider, { OPENROUTER_API_KEY: 'must-not-send' }), undefined);
  assert.equal(fastCredentials(c.provider, { OPENROUTER_API_KEY: 'must-not-send', FAST_API_KEY: 'local-key' }), 'local-key');
  assert.throws(() => judgmentConfig(['--fast-provider', 'systemone', '--fast-endpoint', 'https://example.com']));
  assert.throws(() => judgmentConfig(['--fast-endpoint', 'http://localhost:8000']));
  const events = [];
  const fast = new FastDecider({ ...c, apiKey: fastCredentials(c.provider, { OPENROUTER_API_KEY: 'must-not-send' }),
    budget: { reserve() { throw Error('Local model touched paid budget'); } },
    record: e => events.push(e), fetchImpl: async (url, request) => {
      assert.equal(url, c.endpoint); assert.equal(request.headers.Authorization, undefined);
      assert.equal(Object.hasOwn(JSON.parse(request.body), 'model'), false);
      return { ok: true, json: async () => ({ model: 'actual-local-version', answers: { next: { choice: 'c0', probabilities: { c0: 0.8 }, confidence: 0.2 } } }) };
    } });
  const result = await fast.decide({ state: { evidence: 'synthetic' }, criteria: { c0: 'A', c1: 'B' } });
  assert.equal(result.model, 'actual-local-version'); assert.equal(result.confidence, 0.8);
  assert.equal(events[0].billing, 'self-hosted'); assert.equal(events[0].cost, null);
});

test('price reservation follows the selected model and conservatively covers every endpoint', async () => {
  const p = await judgmentPrice('vendor/test-version', async url => {
    assert.equal(url, 'https://openrouter.ai/api/v1/models/vendor/test-version/endpoints');
    return { ok: true, json: async () => ({ data: { endpoints: [
      { context_length: 100, max_completion_tokens: 20, pricing: { prompt: '0.001', completion: '0.002' } },
      { context_length: 200, pricing: { prompt: '0.001', completion: '0.002' } },
    ] } }) };
  });
  assert.ok(Math.abs(p.bound - 0.6) < 1e-10);
  for (const endpoint of [
    { context_length: 100, pricing: { prompt: null, completion: '0.002' } },
    { context_length: 100, pricing: { prompt: '-1', completion: '2' } },
    { context_length: 100, max_completion_tokens: -1, pricing: { prompt: '1', completion: '2' } },
  ]) await assert.rejects(judgmentPrice('vendor/test', async () => ({ ok: true, json: async () => ({ data: { endpoints: [endpoint] } }) })), /Invalid pricing/);
  await assert.rejects(judgmentPrice('vendor/test', async () => ({ ok: false, status: 404 })), /Pricing HTTP 404/);
});
