import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { control } from '../windows/backend.mjs';
import { openStreamLab } from '../windows/stream-browser.mjs';
import { routeSkill, streamState, checkedPolicy } from '../windows/stream-skills.mjs';

test('stream policy rejects empty or oversized planner output', () => {
  for (const bad of [null, '', ' ', 'x'.repeat(6001)]) assert.throws(() => checkedPolicy(bad));
});

test('real stream keeps future tickets hidden and verifies whole batch independently', async () => {
  const out = mkdtempSync(join(tmpdir(), 'actstride-stream-'));
  const answers = ['Security', 'Access', 'ServiceDesk', 'Access', 'Identity', 'ServiceDesk', 'Duplicate', 'ManualReview'];
  for (const wrong of [false, true]) {
    const receipt = join(out, `${wrong}.json`), lab = await openStreamLab(receipt), actions = [];
    try {
      let state = await lab.waitFor(s => s.controls.some(c => c.name === 'Begin stream' && c.enabled));
      assert.equal(state.controls.some(c => c.name.startsWith('Ticket ')), false);
      await lab.act(state, { action: 'invoke', reference: control(state, 'Begin stream', 'button').reference });
      state = await lab.waitFor(s => s.controls.some(c => c.name.startsWith('Ticket 1/8:')));
      for (let i = 0; i < 8; i++) {
        const observed = streamState(state);
        assert.match(observed.ticket, new RegExp(`^Ticket ${i + 1}/8:`));
        assert.match(observed.bulletin, i < 4 ? /^Bulletin v1/ : /^Bulletin v2/);
        assert.equal(existsSync(receipt), false);
        state = await routeSkill(lab, state, wrong && i === 0 ? 'ServiceDesk' : answers[i], a => actions.push(a));
      }
      const result = JSON.parse(readFileSync(receipt, 'utf8'));
      assert.equal(result.passed, !wrong); assert.equal(result.correct, wrong ? 7 : 8);
      assert.equal(actions.length, 16);
      assert.equal(result.selected.length, 8);
    } finally { await lab.close(); }
  }
});
