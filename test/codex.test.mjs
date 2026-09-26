import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Controller } from '../controller.mjs';
import { subscriptionEnv, CODEX_MODEL } from '../codex-planner.mjs';

const observation = { image: 'data:image/png;base64,AA==', width: 1280, height: 960, task: 'fixture', ui: { controls: [] } };
test('subscription subprocess receives no API key or API base override', () => {
  const env = subscriptionEnv({ OPENAI_API_KEY: 'not-a-real-key', CODEX_API_KEY: 'fixture', OPENROUTER_API_KEY: 'fixture', FAST_API_KEY: 'fixture-fast', openai_base_url: 'https://invalid.test', PATH: '/bin', CODEX_HOME: '/auth-location' });
  assert.deepEqual(env, { PATH: '/bin', CODEX_HOME: '/auth-location' });
});
test('Codex planner works without OpenRouter key and reports subscription usage separately', async () => {
  const events = [];
  const controller = new Controller({ models: { s1: 'jev-fixture', s2: CODEX_MODEL }, mode: 's2-only', record: e => events.push(e),
    fetchImpl: async () => { throw Error('No OpenRouter call permitted'); },
    planner: { decide: async state => {
      assert.deepEqual(state.ui, observation.ui);
      return { action: { action: 'click', x: 10, y: 20, reason: 'fixture', plan: 'fill input', text_values: ['value'] }, usage: { input_tokens: 100, output_tokens: 50 } };
    } },
  });
  const decision = await controller.decide(observation);
  assert.equal(decision.role, 's2'); assert.equal(controller.plan, 'fill input');
  assert.deepEqual(controller.textValues, ['value']);
  assert.equal(events[0].billing, 'codex-subscription'); assert.equal(events[0].cost, null);
});
test('Codex failure halts instead of falling back to a paid API', async () => {
  let calls = 0;
  const controller = new Controller({ planner: { decide: async () => { calls++; throw Error('fixture quota exhausted'); } },
    fetchImpl: async () => { throw Error('Forbidden fallback'); } });
  await assert.rejects(controller.decide(observation), /quota exhausted/);
  await assert.rejects(controller.decide(observation), /stopped/);
  assert.equal(calls, 1);
});
test('Codex action validation still rejects out-of-viewport coordinates', async () => {
  const controller = new Controller({ planner: { decide: async () => ({ action: { action: 'click', x: 9999, y: 0, reason: 'fixture' } }) } });
  await assert.rejects(controller.decide(observation), /Coordinates/);
});
