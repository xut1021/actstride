import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildDesktopLab, WindowsLab, control, fillField, formSkill } from '../windows/backend.mjs';
import { validateSteps, boundary, candidates } from '../windows/multistep-policy.mjs';

test('multi-step choices omit completed and disabled fields and detect unplanned popup', () => {
  const plan = validateSteps([{ action: 'fill', name: 'Item', value: 'Cable' }, { action: 'invoke', name: 'Review', value: null }, { action: 'invoke', name: 'Confirm', value: null }]);
  const state = { controls: [
    { name: 'Item', type: 'edit', enabled: true, value: 'Cable', reference: 'r1' },
    { name: 'Review', type: 'button', enabled: false, reference: 'r2' },
    { name: 'Acknowledge', type: 'button', enabled: true, reference: 'r3' },
  ] };
  assert.equal(candidates(state, plan).length, 0);
  assert.match(boundary(state, plan), /Acknowledge/);
  const revised = [{ action: 'invoke', name: 'Acknowledge', value: null }, ...plan];
  assert.equal(boundary(state, revised), null);
  assert.equal(candidates(state, revised)[0].reference, 'r3');
  assert.throws(() => validateSteps([{ action: 'invoke', name: 'Close', value: null }]));
});

test('real routing change interrupts review and requires revised destination before PASS', { skip: process.env.ACTSTRIDE_WINDOWS_TEST !== '1' || process.platform !== 'win32' }, async () => {
  const out = mkdtempSync(join(tmpdir(), 'actstride-multistep-')), receipt = join(out, 'receipt.json');
  const lab = new WindowsLab(buildDesktopLab(), 'inventory_change', receipt);
  try {
    let state = await lab.waitFor(s => s.controls.some(c => c.name === 'Item'));
    for (const [name, value] of [['Item', 'Cable'], ['Quantity', '3'], ['Destination', 'East']]) state = await fillField(lab, state, name, value);
    await lab.act(state, { action: 'invoke', reference: control(state, 'Review', 'button').reference });
    state = await lab.waitFor(s => s.controls.some(c => c.name === 'Acknowledge' && c.enabled));
    assert.equal(existsSync(receipt), false);
    assert.match(boundary(state, [{ action: 'invoke', name: 'Confirm', value: null }]), /Acknowledge/);
    await lab.act(state, { action: 'invoke', reference: control(state, 'Acknowledge', 'button').reference });
    state = await lab.waitFor(s => s.controls.some(c => c.name === 'Destination' && c.enabled));
    assert.ok(state.controls.some(c => c.name.includes('Destination = West')));
    state = await formSkill(lab, state, [{ name: 'Item', value: 'Cable' }, { name: 'Quantity', value: '3' }, { name: 'Destination', value: 'West' }]);
    assert.equal(JSON.parse(readFileSync(receipt, 'utf8')).passed, true);
    await lab.capture(join(out, 'final.png'));
    console.log('Real UIA fixture checked: ' + out);
  } finally { await lab.close(); }
});
