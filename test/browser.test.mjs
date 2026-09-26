import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openLab, observe, execute, verify } from '../browser.mjs';
import { Replay } from '../replay.mjs';
test('real browser: local task passes via mouse and keyboard; outside requests blocked', async () => {
  const { browser, page } = await openLab({ headless: true, channel: process.env.FCU_TEST_CHANNEL });
  try {
    assert.equal((await verify(page)).passed, false);
    const replay = new Replay(page);
    for (let i = 0; i < 14; i++) {
      const before = await observe(page);
      assert.ok(before.png.length > 1000);
      const { action } = await replay.decide();
      await execute(page, action);
    }
    assert.equal((await verify(page)).passed, true);
    const blocked = await page.evaluate(async () => { try { await fetch('https://example.com/'); return false; } catch { return true; } });
    assert.equal(blocked, true);
    await page.locator('#quantity').focus();
    await execute(page, { action: 'key', key: 'ControlOrMeta+A', reason: 'negative fixture' });
    await execute(page, { action: 'type', text: '3', reason: 'negative fixture' });
    await page.locator('#submit').click(); await page.locator('#approve').click();
    assert.equal((await verify(page)).passed, false);
  } finally { await browser.close(); }
});

test('a completed result is invalidated when the form or confirmation changes', async t => {
  const { browser, page } = await openLab({ headless: true, channel: process.env.FCU_TEST_CHANNEL });
  try {
    const mutations = {
      quantity: () => page.locator('#quantity').fill('3'),
      name: () => page.locator('#name').fill('其他人'),
      search: () => page.locator('#search').fill('电机'),
      stock: () => page.locator('#stock').selectOption('all'),
      selection: () => page.getByRole('button', { name: '选择 S-101', exact: true }).click(),
      cancellation: async () => { await page.locator('#submit').click(); await page.locator('#cancel').click(); },
    };
    for (const [name, change] of Object.entries(mutations)) await t.test(name, async () => {
      await page.reload();
      await page.locator('#search').fill('传感器'); await page.locator('#stock').selectOption('yes'); await page.locator('#filter').click();
      await page.getByRole('button', { name: '选择 S-102', exact: true }).click();
      await page.locator('#name').fill('测试员'); await page.locator('#quantity').fill('2');
      await page.locator('#submit').click(); await page.locator('#approve').click();
      assert.equal((await verify(page)).passed, true);
      await change();
      assert.equal((await verify(page)).passed, false);
      assert.ok(!(await page.locator('#result').innerText()).startsWith('PASS'));
    });
  } finally { await browser.close(); }
});

test('invisible controls do not become candidate click targets', async () => {
  const { browser, page } = await openLab({ headless: true, channel: process.env.FCU_TEST_CHANNEL });
  try {
    for (const css of ['visibility:hidden', 'opacity:0']) {
      await page.reload();
      const box = await page.locator('#filter').boundingBox();
      await page.addStyleTag({ content: `#filter{${css}}` });
      const { ui } = await observe(page);
      assert.ok(!ui.controls.some(c => c.x === Math.round(box.x + box.width / 2) && c.y === Math.round(box.y + box.height / 2)));
    }
  } finally { await browser.close(); }
});
