import { chromium } from 'playwright';
import { readFile } from 'node:fs/promises';
import { validateAction } from './controller.mjs';

import { scenarios, taskFor } from './scenarios.mjs';
const tasks = new WeakMap();

export const LAB_URL = 'http://fastercomputeruse.test/';
export const VIEWPORT = { width: 1280, height: 960 };
export const TASK = '搜索“传感器”，筛选“有库存”，选择价格不超过 100 元的型号；填写姓名“测试员”、数量“2”，核对确认弹窗并提交。以页面显示 PASS 为完成。';

export async function openLab({ headless = false, channel, scenario = 'baseline' } = {}) {
  const config = scenarios[scenario];
  if (!config) throw Error('Unknown scenario');
  const browser = await chromium.launch({ headless, ...(channel ? { channel } : {}) });
  try {
    const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 1, serviceWorkers: 'block', acceptDownloads: false });
    const html = (await readFile(new URL('./index.html', import.meta.url), 'utf8')).replace(/(<script type="application\/json" id="scenario">)[\s\S]*?(<\/script>)/, (_, start, end) => start + JSON.stringify(config) + end);
    // The test domain is fulfilled from this file; every other request is blocked.
    await context.route('**/*', route => route.request().url() === LAB_URL && route.request().method() === 'GET'
      ? route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: html }) : route.abort());
    await context.routeWebSocket(/.*/, socket => socket.close());
    const page = await context.newPage();
    page.setDefaultTimeout(3000);
    context.on('page', popup => { if (popup !== page) void popup.close(); });
    page.on('dialog', dialog => void dialog.dismiss());
    tasks.set(page, taskFor(config));
    await page.goto(LAB_URL);
    return { browser, page, context };
  } catch (error) { await browser.close(); throw error; }
}

export async function observe(page) {
  if (page.url() !== LAB_URL) throw Error('Page left the local lab');
  const png = await page.screenshot({ type: 'png', animations: 'disabled', caret: 'hide', scale: 'css' });
  const ui = await page.evaluate(() => {
    const root = document.querySelector('dialog[open]') || document.body;
    const describe = (el, index) => {
      const r = el.getBoundingClientRect();
      return { index, tag: el.tagName.toLowerCase(), label: (el.getAttribute('aria-label') || el.labels?.[0]?.innerText || el.innerText || el.placeholder || el.tagName).slice(0, 200),
        value: el.value || '', context: el.closest('tr')?.innerText?.slice(0, 300) || '',
        x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2),
        ...(el.tagName === 'SELECT' ? { options: [...el.options].map(o => ({ label: o.label, value: o.value })) } : {}) };
    };
    const controls = [...root.querySelectorAll('input:not([type=password]),button,select')].filter(el => {
      const r = el.getBoundingClientRect();
      return !el.disabled && el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }) && r.width > 0 && r.height > 0 && r.x >= 0 && r.y >= 0 && r.right < innerWidth && r.bottom < innerHeight;
    }).slice(0, 40).map(describe);
    const active = document.activeElement;
    return { busy: !!document.querySelector('[aria-busy="true"]'), error: root.querySelector('[data-error="true"]')?.innerText || '', controls, focused: root.contains(active) && ['INPUT', 'SELECT'].includes(active.tagName) ? describe(active, -1) : null,
      text: root.innerText.slice(0, 4000), canScrollUp: scrollY > 0, canScrollDown: scrollY + innerHeight < document.documentElement.scrollHeight };
  });
  return { image: `data:image/png;base64,${png.toString('base64')}`, ...VIEWPORT, task: tasks.get(page) || TASK, png, ui };
}

export async function execute(page, action) {
  validateAction(action, VIEWPORT.width, VIEWPORT.height);
  if (page.url() !== LAB_URL) throw Error('Page left the local lab');
  switch (action.action) {
    case 'click': await page.mouse.click(action.x, action.y); break;
    case 'type': {
      // Guard the real input target; typing always replaces its current value.
      const editable = await page.evaluate(() => {
        const el = document.activeElement;
        return el instanceof HTMLInputElement && !el.disabled && !el.readOnly && el.type !== 'password';
      });
      if (!editable) throw Error('Type requires a focused editable input');
      await page.keyboard.press('ControlOrMeta+A');
      await page.keyboard.insertText(action.text); break;
    }
    case 'key': await page.keyboard.press(action.key); break;
    case 'scroll': await page.mouse.move(action.x, action.y); await page.mouse.wheel(0, action.dy); break;
    case 'wait': await page.waitForTimeout(500); break;
    case 'escalate': case 'done': break;
  }
  // Let rendering and scroll settle before the next fresh screenshot.
  await page.waitForTimeout(120);
}

// Verifier-only state. It is never included in a live model request.
export async function verify(page) {
  const result = await page.evaluate(() => window.labResult || null);
  return { passed: result?.passed === true, result };
}
