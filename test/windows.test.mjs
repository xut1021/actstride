import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildDesktopLab, WindowsLab, control, fillField, formSkill } from '../windows/backend.mjs';

const enabled = process.platform === 'win32' && process.env.ACTSTRIDE_WINDOWS_TEST === '1';
test('real UIA rejects stale actions, executes reordered fields and independently verifies submission', { skip: !enabled }, async () => {
  const directory = mkdtempSync(join(tmpdir(), 'actstride-uia-'));
  const receipt = join(directory, 'receipt.json');
  const lab = new WindowsLab(buildDesktopLab(), 'inventory_b', receipt);
  try {
    const before = await lab.waitFor(s => s.controls.some(c => c.name === 'Item' && c.type === 'edit'));
    const state = await lab.observe();
    await assert.rejects(lab.act(before, { action: 'fill', reference: control(before, 'Item', 'edit').reference, value: 'wrong' }), /Stale revision/);
    const events = [];
    const after = await formSkill(lab, state, [{ name: 'Destination', value: 'West' }, { name: 'Quantity', value: '7' }, { name: 'Item', value: 'Adapter' }], event => events.push(event));
    assert.equal(JSON.parse(readFileSync(receipt, 'utf8')).passed, true);
    assert.equal(events.length, 5);
    await fillField(lab, after, 'Quantity', '999');
    assert.equal(existsSync(receipt), false, 'later changes invalidate the old pass receipt');
    const changed = await lab.observe();
    assert.equal(changed.controls.some(c => c.name === 'Result: PASS'), false);
    await lab.capture(join(directory, 'final.png'));
    console.log(`Native UIA evidence: ${directory}`);
  } finally { await lab.close(); }
});

test('ambiguous or disabled semantic targets are rejected before execution', () => {
  assert.throws(() => control({ controls: [{ name: 'Review', type: 'button', enabled: false }] }, 'Review', 'button'), /got 0/);
  assert.throws(() => control({ controls: Array(2).fill({ name: 'Review', type: 'button', enabled: true }) }, 'Review', 'button'), /got 2/);
});
