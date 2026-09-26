import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildDesktopLab, WindowsLab } from '../windows/backend.mjs';
import { validateBinding, executeFormSkill } from '../windows/form-skills.mjs';
const fields = destination => [{ name: 'Item', value: 'Cable' }, { name: 'Quantity', value: '3' }, { name: 'Destination', value: destination }];
test('skill bindings reject invented skills, duplicate and unavailable fields', () => {
  const state = { controls: fields('East').map(f => ({ name: f.name, type: 'edit' })) };
  const b = { skill: 'submit_form', fields: fields('East') };
  assert.equal(validateBinding(b, state), b);
  assert.throws(() => validateBinding({ ...b, skill: 'execute_script' }, state));
  assert.throws(() => validateBinding({ ...b, fields: [b.fields[0], b.fields[0], b.fields[2]] }, state));
  assert.throws(() => validateBinding(b, { controls: [] }));
});
test('real multi-step skills complete normal form and suspend/resume routing change', { skip: process.platform !== 'win32' || process.env.ACTSTRIDE_WINDOWS_TEST !== '1' }, async () => {
  const exe = buildDesktopLab(), out = mkdtempSync(join(tmpdir(), 'actstride-form-skills-'));
  for (const scenario of ['inventory_a', 'inventory_change']) {
    const receipt = join(out, scenario + '.json'), lab = new WindowsLab(exe, scenario, receipt), actions = [];
    try {
      const state = await lab.waitFor(s => s.controls.filter(c => c.type === 'edit').length === 3);
      let result = await executeFormSkill(lab, state, { skill: 'submit_form', fields: fields('East') }, e => actions.push(e));
      if (scenario === 'inventory_change') {
        assert.equal(result.status, 'suspended'); assert.equal(actions.length, 4); assert.equal(existsSync(receipt), false);
        assert.equal(actions.some(s => s.name === 'Confirm'), false);
        result = await executeFormSkill(lab, result.state, { skill: 'acknowledge_update_and_submit', fields: fields('West') }, e => actions.push(e));
        assert.equal(actions.length, 8);
      } else assert.equal(actions.length, 5);
      assert.equal(result.status, 'completed'); assert.equal(JSON.parse(readFileSync(receipt, 'utf8')).passed, true);
    } finally { await lab.close(); }
  }
});
