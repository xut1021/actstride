import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openLab, observe, verify } from '../browser.mjs';
import { scenarios } from '../scenarios.mjs';
import { assessProgress } from '../progress.mjs';
import { Controller } from '../controller.mjs';
import { candidatesFor } from '../candidates.mjs';

test('progress ignores decorative pixels and verifies typing and recovery', () => {
  const before = { ui: { controls: [], focused: { value: '' } }, png: Buffer.from('a') };
  const decorative = { ...before, png: Buffer.from('b') };
  assert.equal(assessProgress(before, decorative, { action: 'click' }).ok, false);
  assert.equal(assessProgress(before, decorative, { action: 'type', text: 'wanted' }).ok, false);
  const error = { ui: { ...before.ui, error: 'Please submit again' } };
  const feedback = assessProgress(before, error, { action: 'click' });
  const controller = new Controller(); controller.role = 's1'; controller.feedback(feedback);
  assert.equal(controller.role, 's2');
  const loading = { ui: { controls: [], busy: true } };
  assert.equal(assessProgress(loading, loading, { action: 'wait' }).ok, true);
  assert.ok(candidatesFor(loading.ui).wait);
  assert.ok(!candidatesFor({ controls: [] }).wait);
});

for (const [scenario, config] of Object.entries(scenarios)) test(`scenario ${scenario}: actual criteria, no disclosed answer, fresh verification`, async () => {
  const { browser, page } = await openLab({ scenario, headless: true, channel: process.env.FCU_TEST_CHANNEL });
  try {
    const first = await observe(page);
    assert.ok(first.task.includes(config.name));
    assert.ok(!(await page.locator('.task').innerText()).includes(config.target));
    assert.ok(!first.ui.text.includes('"target"'));
    await page.locator('#search').fill(config.keyword); await page.locator('#stock').selectOption('yes');
    await page.locator('#filter').click();
    if (config.delay) {
      assert.equal((await observe(page)).ui.busy, true);
      await page.locator('#loading[aria-busy="false"]').waitFor({ state: 'attached' });
    }
    await page.getByRole('button', { name: '选择 ' + config.target, exact: true }).click();
    await page.locator('#name').fill(config.name); await page.locator('#quantity').fill(config.quantity);
    await page.locator('#submit').click(); await page.locator('#approve').click();
    if (config.retry) {
      assert.equal((await verify(page)).passed, false);
      assert.ok((await observe(page)).ui.error);
      await page.locator('#submit').click(); await page.locator('#approve').click();
    }
    assert.equal((await verify(page)).passed, true);
    await page.locator('#quantity').fill('9');
    assert.equal((await verify(page)).passed, false);
    await page.locator('#submit').click(); await page.locator('#approve').click();
    assert.equal((await verify(page)).passed, false);
  } finally { await browser.close(); }
});
