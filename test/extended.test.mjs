import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scenarios } from '../scenarios.mjs';
import { openLab, observe, verify } from '../browser.mjs';

for (const [scenario, config] of Object.entries(scenarios).filter(([, s]) => s.kind)) test(`extended ${scenario}: wrong state rejected, correct confirmation passes, edits invalidate`, async () => {
  const { browser, page } = await openLab({ headless: true, channel: process.env.FCU_TEST_CHANNEL, scenario });
  try {
    assert.equal((await observe(page)).task, config.task);
    assert.equal((await verify(page)).passed, false);
    assert.ok(!(await observe(page)).ui.text.includes('"kind"'));
    let correct, wrong, mutate;
    if (config.kind === 'tickets') {
      await page.locator('tr').filter({ hasText: config.department }).filter({ hasText: config.priority }).getByRole('button').click();
      correct = () => page.locator('#owner').selectOption(config.owner);
      wrong = () => page.locator('#owner').selectOption('陈青'); mutate = wrong;
    } else if (config.kind === 'booking') {
      await page.getByRole('button', { name: config.day === '周二' ? '选择 北楼 202' : '选择 南楼 310', exact: true }).click();
      correct = () => page.locator('#name').fill(config.name);
      wrong = () => page.locator('#name').fill('错误申请人'); mutate = wrong;
    } else {
      await page.locator('#notifications').click();
      if (config.email) await page.locator('#email').click();
      if (!config.sms) await page.locator('#sms').click();
      correct = () => page.locator('#zone').selectOption(config.zone);
      wrong = () => page.locator('#zone').selectOption('纽约'); mutate = wrong;
    }
    await wrong(); await page.locator('#submit').click(); await page.locator('#approve').click();
    assert.equal((await verify(page)).passed, false);
    await correct(); await page.locator('#submit').click();
    assert.equal((await verify(page)).passed, false);
    await page.locator('#cancel').click(); assert.equal((await verify(page)).passed, false);
    await page.locator('#submit').click(); await page.locator('#approve').click();
    assert.equal((await verify(page)).passed, true);
    await mutate(); assert.equal((await verify(page)).passed, false);
  } finally { await browser.close(); }
});
