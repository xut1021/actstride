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
