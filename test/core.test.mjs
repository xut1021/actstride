import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Budget } from '../budget.mjs';
import { Controller, validateAction } from '../controller.mjs';
import { candidatesFor } from '../candidates.mjs';
const screenshot = { image: 'data:image/png;base64,AA==', width: 1280, height: 960, task: 'test', ui: { controls: [] } };
function setup(t, response) {
  const dir = mkdtempSync(join(tmpdir(), 'fcu-test-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const budget = new Budget(join(dir, 'budget.json'), 5);
  const controller = new Controller({ apiKey: 'test-fixture', budget, pricing: { s1: { bound: 1 }, s2: { bound: 1 } }, fetchImpl: response });
  return { budget, controller, dir };
}
const reply = action => ({ ok: true, json: async () => ({ usage: { cost: 0.01 }, choices: [{ message: { tool_calls: [{ function: { name: 'next_action', arguments: JSON.stringify(action) } }] } }] }) });
test('planner -> operator -> escalation -> planner', async t => {
  let i = 0;
  const { controller } = setup(t, async (url, options) => {
    if (url.endsWith('/decisions')) {
      assert.equal(JSON.parse(options.body).model, 'typesafe/jev-1.13');
      assert.ok(!options.body.includes('data:image'));
      return { ok: true, json: async () => ({ usage: { cost: 0.001 }, answers: { next: { choice: 'escalate', confidence: 0.9 } } }) };
    }
    return reply([{ action: 'click', x: 1, y: 1, reason: 'start', plan: 'test plan', text_values: ['hello'] }, { action: 'done', reason: 'finish' }][i++]);
  });
  assert.equal((await controller.decide(screenshot)).role, 's2');
  assert.equal((await controller.decide(screenshot)).role, 's1');
  assert.equal((await controller.decide(screenshot)).role, 's2');
});
test('uncertain billing survives process restart and blocks spending', async t => {
  const { controller, dir } = setup(t, async () => ({ ok: false, status: 500 }));
  await assert.rejects(controller.decide(screenshot), /reservation retained/);
  const recovered = new Budget(join(dir, 'budget.json'), 5);
  assert.equal(recovered.state.pending, 1);
  assert.throws(() => recovered.reserve(1), /Unsettled/);
});
test('unknown usage.cost stops; no automatic retry', async t => {
  let calls = 0;
  const { controller } = setup(t, async () => { calls++; return { ok: true, json: async () => ({ usage: {} }) }; });
  await assert.rejects(controller.decide(screenshot), /usage.cost/);
  await assert.rejects(controller.decide(screenshot), /stopped/);
  assert.equal(calls, 1);
});
test('budget checks before network, settled cost persists', async t => {
  const { budget, dir } = setup(t);
  budget.reserve(1); budget.settle(0.5);
  const recovered = new Budget(join(dir, 'budget.json'), 5);
  assert.equal(recovered.state.charged, 0.5);
  assert.throws(() => recovered.reserve(4.6), /Budget/);
});
test('invalid mouse/key/text cannot reach execution', () => {
  assert.throws(() => validateAction({ action: 'click', reason: 'bad', x: 1280, y: 1 }, 1280, 960));
  assert.throws(() => validateAction({ action: 'key', reason: 'bad', key: 'Meta+R' }, 1280, 960));
  assert.throws(() => validateAction({ action: 'type', reason: 'bad', text: 'x\n' }, 1280, 960));
});
test('two failed observations force replanning', t => {
  const { controller } = setup(t);
  controller.role = 's1'; controller.feedback({ ok: false }); controller.feedback({ ok: false });
  assert.equal(controller.role, 's2');
});

test('fast choices use fresh controls and planner text, not fixture answers', () => {
  const choices = candidatesFor({ controls: [{ index: 7, tag: 'input', label: 'City', x: 45, y: 50 }], focused: { tag: 'input', label: 'City', value: 'Paris' } }, ['Paris', 'Oslo']);
  assert.deepEqual(choices.click_7.action, { action: 'click', x: 45, y: 50, reason: 'Click City' });
  assert.equal(choices.type_0, undefined);
  assert.equal(choices.type_1.action.text, 'Oslo');
  assert.equal(candidatesFor({ controls: [] }, ['Oslo']).type_0, undefined);
});

test('low-confidence Jev escalates; stale choice is rejected after billing', async t => {
  let choice = 'done';
  const { controller, budget } = setup(t, async () => ({ ok: true, json: async () => ({ usage: { cost: 0.001 }, answers: { next: { choice, confidence: 0.4 } } }) }));
  controller.role = 's1';
  assert.equal((await controller.decide(screenshot)).action.action, 'escalate');
  controller.role = 's1'; choice = 'click_obsolete';
  await assert.rejects(controller.decide(screenshot), /Invalid Jev/);
  assert.equal(budget.state.charged, 0.002);
  assert.equal(budget.state.pending, 0);
});

test('s2-only baseline never calls Jev', async t => {
  const { controller } = setup(t, async url => {
    assert.ok(url.endsWith('/chat/completions'));
    return reply({ action: 'click', x: 1, y: 1, reason: 'baseline' });
  });
  controller.mode = 's2-only';
  assert.equal((await controller.decide(screenshot)).role, 's2');
  assert.equal((await controller.decide(screenshot)).role, 's2');
});
