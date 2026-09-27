import { chromium } from 'playwright';
import { readFileSync, writeFileSync } from 'node:fs';

// DOM backend for this synthetic stream only. Models receive visible controls,
// never script source, future arrivals or the private answer list.
export async function openStreamLab(receipt) {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 1200, height: 1000 }, serviceWorkers: 'block' });
    await context.route('**/*', route => route.request().url() === 'http://stream.test/'
      ? route.fulfill({ contentType: 'text/html', body: readFileSync(new URL('../stream.html', import.meta.url), 'utf8') }) : route.abort());
    await context.routeWebSocket('**/*', ws => ws.close());
    const page = await context.newPage(); await page.goto('http://stream.test/');
    let revision = 0, leased = null;
    const snapshot = () => page.locator('p,button').evaluateAll(elements => elements.filter(e => e.checkVisibility()).map(e => ({
      name: e.textContent, type: e.tagName === 'BUTTON' ? 'button' : 'text',
      enabled: !e.disabled && (!document.querySelector('dialog[open]') || !!e.closest('dialog[open]')),
    })));
    return {
      async observe() {
        const controls = await snapshot(); revision++;
        leased = controls.map((c, i) => ({ ...c, reference: `r${revision}_${i}` }));
        return { ok: true, revision, controls: structuredClone(leased) };
      },
      async waitFor(predicate, timeout = 3000) {
        const end = Date.now() + timeout;
        do { const s = await this.observe(); if (predicate(s)) return s; await new Promise(r => setTimeout(r, 40)); } while (Date.now() < end);
        throw Error('Expected stream UI not observed');
      },
      async act(state, { action, reference }) {
        if (!leased || state.revision !== revision || action !== 'invoke') throw Error('Stale or unsupported action');
        const target = leased.find(c => c.reference === reference);
        if (!target || !target.enabled || target.type !== 'button') throw Error('Invalid current button');
        if (JSON.stringify((await snapshot())) !== JSON.stringify(leased.map(({reference,...c})=>c))) throw Error('Stream changed before input');
        leased = null;
        await page.getByRole('button', { name: target.name, exact: true }).click();
        if (await page.getByText('Stream: complete', { exact: true }).isVisible()) {
          const result = await page.evaluate(() => window.streamReceipt);
          writeFileSync(receipt, JSON.stringify(result));
        }
      },
      capture: path => page.screenshot({ path }),
      close: () => browser.close(),
    };
  } catch (error) { await browser.close(); throw error; }
}
