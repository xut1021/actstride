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

test('judgment fixture independently accepts correct choices and rejects wrong choices', { skip: !enabled }, async () => {
  const executable = buildDesktopLab();
  const directory = mkdtempSync(join(tmpdir(), 'actstride-judgment-'));
  for (const [scenario, selected, passed] of [
    ['judgment_1', 'Hardware', true], ['judgment_2', 'Hardware', false],
    ['judgment_3', 'Supplier B', true], ['judgment_4', 'Supplier C', true],
    ['judgment_5', 'Manual review', true], ['judgment_6', 'Approve', true],
  ]) {
    const receipt = join(directory, scenario + '.json');
    const lab = new WindowsLab(executable, scenario, receipt);
    try {
      const state = await lab.waitFor(s => s.controls.some(c => c.name.startsWith('Choose: ')));
      assert.equal(existsSync(receipt), false);
      assert.equal(JSON.stringify(state).includes('expected'), false);
      assert.equal(JSON.stringify(state).includes(scenario), false);
      await lab.act(state, { action: 'invoke', reference: control(state, 'Choose: ' + selected, 'button').reference });
      await lab.waitFor(s => s.controls.some(c => c.name === 'Result: ' + (passed ? 'PASS' : 'FAIL')));
      assert.deepEqual(JSON.parse(readFileSync(receipt, 'utf8')), { scenario, selected, passed });
      assert.equal((await lab.observe()).controls.filter(c => c.name.startsWith('Choose: ')).every(c => !c.enabled), true);
    } finally { await lab.close(); }
  }
});
