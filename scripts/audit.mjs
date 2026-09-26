// Deterministic regression audit: no live model calls, no credentials.
import assert from 'node:assert/strict';
import { writeFileSync, readFileSync, mkdirSync, mkdtempSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { openLab, observe, execute, verify } from '../browser.mjs';
import { Controller, validateAction } from '../controller.mjs';
import { Budget, modelPricing } from '../budget.mjs';

const out = resolve('runs', 'audit'); mkdirSync(out, { recursive: true });
const scratch = join(out, 'scratch'); mkdirSync(scratch, { recursive: true });
const results = [];
async function check(name, fn) {
  try { await fn(); results.push({ name, status: 'pass' }); }
  catch (e) { results.push({ name, status: 'fail', error: e.message }); }
  console.log(`${results.at(-1).status.toUpperCase()} ${name}`);
}
const ledgerPath = new URL('../runs/budget.json', import.meta.url);
const ledgerBefore = existsSync(ledgerPath) ? readFileSync(ledgerPath, 'utf8') : null;
const shot = { image: 'data:image/png;base64,AA==', width: 1280, height: 960, task: 'synthetic test', ui: { controls: [] } };
function fixture(fetchImpl) {
  const dir = mkdtempSync(join(scratch, 'budget-'));
  const budget = new Budget(join(dir, 'ledger.json'), 5);
  const controller = new Controller({ apiKey: 'fake-key-never-sent', budget, pricing: { s1: { bound: 1 }, s2: { bound: 1 } }, fetchImpl });
  return { budget, controller };
}
// Globally prohibit unmocked model/catalog requests in this process.
globalThis.fetch = async () => { throw Error('Network prohibited during no-API audit'); };

for (const role of ['s1', 's2']) {
  for (const failure of ['http429', 'invalid-json', 'network-error', 'missing-cost']) {
    await check(`${role}: ${failure} retains reservation and stops retry`, async () => {
      let count = 0;
      const { controller, budget } = fixture(async () => {
        count++;
        if (failure === 'network-error') throw Error('mock connection lost');
        if (failure === 'http429') return { ok: false, status: 429 };
        return { ok: true, json: async () => { if (failure === 'invalid-json') throw Error('mock invalid JSON'); return { usage: {} }; } };
      });
      controller.role = role;
      await assert.rejects(controller.decide(shot));
      await assert.rejects(controller.decide(shot), /stopped/);
      assert.equal(count, 1); assert.equal(budget.state.pending, 1);
    });
  }
}
await check('concurrent decide calls do not create two paid requests', async () => {
  let release, count = 0;
  const { controller } = fixture(async () => { count++; await new Promise(r => { release = r; }); return { ok: false, status: 500 }; });
  const first = controller.decide(shot); const rejection = assert.rejects(first);
  await assert.rejects(controller.decide(shot), /in flight/);
  release(); await rejection; assert.equal(count, 1);
});
await check('exhausted budget blocks before transport', async () => {
  let count = 0; const { controller, budget } = fixture(async () => { count++; });
  budget.reserve(4.5); budget.settle(4.5);
  await assert.rejects(controller.decide(shot), /Budget/); assert.equal(count, 0);
});
await check('paid invalid action is billed but never returned for execution', async () => {
  const { controller, budget } = fixture(async () => ({ ok: true, json: async () => ({ usage: { cost: 0.02 }, choices: [{ message: { tool_calls: [{ function: { name: 'next_action', arguments: '{"action":"click","x":9000,"y":1,"reason":"invalid"}' } }] } }] }) }));
  await assert.rejects(controller.decide(shot), /Coordinates/);
  assert.equal(budget.state.charged, 0.02); assert.equal(budget.state.pending, 0);
});
await check('invalid billing types retain the reservation', () => {
  for (const value of [null, undefined, '0.1', NaN, Infinity, -1]) {
    const { budget } = fixture(); budget.reserve(1);
    assert.throws(() => budget.settle(value)); assert.equal(budget.state.pending, 1);
  }
});
await check('tiered pricing reserves the most expensive advertised tier', () => {
  const p = modelPricing({ architecture: { input_modalities: ['image'] }, supported_parameters: ['tools'], context_length: 1000,
    pricing: { prompt: '0.001', completion: '0.002', overrides: [{ prompt: '0.003', completion: '0.004' }] } });
  assert.equal(p.bound, 1000 * 0.003 + 2048 * 0.004);
});
await check('invalid action boundaries and text lengths are rejected', () => {
  const cases = [null, { action: 'navigate' }, { action: 'click', x: -1, y: 0 }, { action: 'click', x: 0.5, y: 0 },
    { action: 'scroll', x: 10, y: 10, dy: 601 }, { action: 'key', key: 'ControlOrMeta+L' },
    { action: 'type', text: 'a'.repeat(301) }, { action: 'type', text: 'bad\ntext' }, { action: 'done', text_values: [null] }];
  for (const a of cases) assert.throws(() => validateAction(a && { reason: 'fixture', ...a }, 1280, 960));
});

const lab = await openLab({ headless: true, channel: process.env.FCU_TEST_CHANNEL });
const page = lab.page;
async function prepare({ name = '测试员', qty = '2', sku = 'S-102', filter = true } = {}) {
  await page.reload();
  if (filter) { await page.locator('#search').fill('传感器'); await page.locator('#stock').selectOption('yes'); await page.locator('#filter').click(); }
  await page.getByRole('button', { name: `选择 ${sku}`, exact: true }).click();
  await page.locator('#name').fill(name); await page.locator('#quantity').fill(qty);
}
async function submit() { await page.locator('#submit').click(); await page.locator('#approve').click(); }
try {
  await check('empty initial submission cannot open confirmation', async () => {
    await page.locator('#submit').click(); assert.equal(await page.locator('dialog[open]').count(), 0); assert.equal((await verify(page)).passed, false);
  });
  for (const qty of ['', '0', '10', '1.5']) {
    await check(`invalid quantity ${JSON.stringify(qty)} cannot open confirmation`, async () => {
      await prepare({ qty }); await page.locator('#submit').click(); assert.equal(await page.locator('dialog[open]').count(), 0); assert.equal((await verify(page)).passed, false);
    });
  }
  for (const [name, options] of [['wrong name', { name: '其他人' }], ['wrong valid quantity', { qty: '3' }], ['wrong SKU', { sku: 'S-101' }], ['skipped filter', { filter: false }]]) {
    await check(`${name} produces FAIL after confirmation`, async () => {
      await prepare(options); await submit(); assert.equal((await verify(page)).passed, false); assert.match(await page.locator('#result').innerText(), /^FAIL/);
    });
  }
  await check('cancel confirmation does not complete the task', async () => {
    await prepare(); await page.locator('#submit').click(); await page.locator('#cancel').click(); assert.equal((await verify(page)).passed, false);
  });
  await check('open modal exposes only modal controls to Jev', async () => {
    await prepare(); await page.locator('#submit').click();
    const { ui } = await observe(page); assert.equal(ui.controls.length, 2); assert.ok(ui.controls.every(c => ['返回修改', '确认测试提交'].includes(c.label)));
  });
  await check('correct submission completes the task', async () => {
    await prepare(); await submit(); assert.equal((await verify(page)).passed, true);
  });
  await check('editing quantity after PASS invalidates current completion', async () => {
    await page.locator('#quantity').fill('3');
    const current = { actualQuantity: await page.locator('#quantity').inputValue(), verifier: await verify(page) };
    writeFileSync(join(out, 'stale-quantity.json'), JSON.stringify(current, null, 2));
    assert.equal(current.verifier.passed, false);
  });
  await check('changing selected SKU after PASS invalidates current completion', async () => {
    await prepare(); await submit(); await page.getByRole('button', { name: '选择 S-101', exact: true }).click();
    const current = { visibleSelection: await page.locator('#selected').innerText(), visibleResult: await page.locator('#result').innerText(), verifier: await verify(page) };
    writeFileSync(join(out, 'stale-selection.json'), JSON.stringify(current, null, 2));
    await page.screenshot({ path: join(out, 'stale-selection.png'), fullPage: true });
    assert.equal(current.verifier.passed, false);
  });
  await check('visibility:hidden controls are excluded from observation', async () => {
    await page.reload(); const box = await page.locator('#filter').boundingBox(); await page.addStyleTag({ content: '#filter{visibility:hidden}' });
    const { ui } = await observe(page); assert.ok(!ui.controls.some(c => c.x === Math.round(box.x + box.width / 2) && c.y === Math.round(box.y + box.height / 2)));
  });
  await check('disabled controls are excluded from observation', async () => {
    await page.reload(); const box = await page.locator('#filter').boundingBox(); await page.locator('#filter').evaluate(el => { el.disabled = true; });
    const { ui } = await observe(page); assert.ok(!ui.controls.some(c => c.x === Math.round(box.x + box.width / 2) && c.y === Math.round(box.y + box.height / 2)));
  });
  await check('typing without an editable focus is rejected', async () => {
    await page.reload(); await page.locator('h1').click(); await assert.rejects(execute(page, { action: 'type', text: 'x', reason: 'fixture' }), /focused/);
  });
  await check('fresh control coordinates adapt to shifted layout and scrolling', async () => {
    await page.reload(); await page.addStyleTag({ content: 'header{margin-bottom:180px}' });
    await execute(page, { action: 'scroll', x: 1100, y: 800, dy: 480, reason: 'shift fixture' });
    const { ui } = await observe(page);
    for (const control of ui.controls) {
      const tag = await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.tagName.toLowerCase(), control);
      assert.equal(tag, control.tag);
    }
    assert.ok(ui.controls.length > 0);
  });
} finally { await lab.browser.close(); }

await check('live OpenRouter ledger is byte-for-byte unchanged', () => assert.equal(existsSync(ledgerPath) ? readFileSync(ledgerPath, 'utf8') : null, ledgerBefore));
const runtime = ['browser.mjs', 'controller.mjs', 'codex-planner.mjs', 'candidates.mjs', 'budget.mjs', 'cli.mjs', 'index.html'];
const source_sha256 = Object.fromEntries(runtime.map(f => [f, createHash('sha256').update(readFileSync(new URL(`../${f}`, import.meta.url))).digest('hex')]));
const report = { timestamp: new Date().toISOString(), kind: 'deterministic-no-api-audit', paid_model_calls: 0, source_sha256,
  counts: { passed: results.filter(r => r.status === 'pass').length, failed: results.filter(r => r.status === 'fail').length }, results };
writeFileSync(join(out, 'report.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report.counts));
if (report.counts.failed) process.exitCode = 1;
