import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chatChoice } from '../windows/chat-choice.mjs';

function setup(content = '{"choice":"c0"}', cost = 0.001) {
  const calls = [], state = { pending: 0, charged: 0 };
  const budget = {
    reserve(n) { if (state.pending) throw Error('Unsettled'); state.pending = n; },
    settle(n) { if (!Number.isFinite(n)) throw Error('Unknown cost'); state.charged += n; state.pending = 0; },
  };
  const args = { model: 'test/model', state: { policy: 'synthetic' }, criteria: { c0: 'A', escalate: 'Ask planner' }, apiKey: 'test-only', budget,
    price: { bound: 0.01, maxPrice: { prompt: 1, completion: 1 } },
    fetchImpl: async (_url, request) => { calls.push(JSON.parse(request.body)); return { ok: true,
      json: async () => ({ model: 'test/actual', usage: { cost }, choices: [{ finish_reason: 'stop', message: { content } }] }) }; } };
  return { args, calls, state };
}
test('generative choice is bounded, billed, and does not invent a confidence score', async () => {
  const { args, calls, state } = setup();
  const result = await chatChoice(args);
  assert.equal(result.choice, 'c0'); assert.equal(result.confidence, null); assert.equal(result.model, 'test/actual');
  assert.deepEqual(calls[0].response_format.json_schema.schema.properties.choice.enum, ['c0', 'escalate']);
  assert.equal(calls[0].provider.allow_fallbacks, false); assert.equal(calls[0].provider.require_parameters, true);
  assert.equal(state.pending, 0); assert.equal(state.charged, 0.001);
});
test('invalid generated choices are rejected after accounting, never executed', async () => {
  for (const content of ['{"choice":"invented"}', '{"choice":"c0","script":"bad"}', 'not JSON']) {
    const { args, state } = setup(content);
    await assert.rejects(chatChoice(args)); assert.equal(state.charged, 0.001); assert.equal(state.pending, 0);
  }
});
test('missing cost preserves reservation and prevents another request', async () => {
  const { args, state, calls } = setup('{"choice":"c0"}', null);
  await assert.rejects(chatChoice(args), /Unknown cost/);
  await assert.rejects(chatChoice(args), /Unsettled/);
  assert.equal(calls.length, 1); assert.equal(state.pending, 0.01);
});
