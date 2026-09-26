import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DesktopSession, desktopDecider } from '../desktop.mjs';

const window = { app: 'Microsoft.WindowsNotepad_test!App', id: 7 };
function fixture({ failRefresh = false, document = null, fastDecider } = {}) {
  const inputs = []; let captures = 0;
  const sky = {
    async get_window_state() {
      if (++captures > 1 && failRefresh) throw Error('capture failed');
      return { window, accessibility: document === null ? null : { tree: 'Editor', document_text: document },
        screenshots: [{ id: `s${captures}`, width: 100, height: 100, url: 'data:image/png;base64,AAAA' }] };
    },
    async press_key(args) { inputs.push(['key', args]); },
    async click(args) { inputs.push(['click', args]); },
    async type_text(args) { inputs.push(['type', args]); },
  };
  return { session: new DesktopSession({ sky, window, fastDecider }), inputs };
}
const context = { task: 'Create a synthetic draft', plan: 'New tab, focus, type, verify' };
const candidate = { go: { description: 'New tab', action: { kind: 'key', key: 'Control_L+n' } } };

test('draft uses three separately reviewed inputs, fresh screenshot targeting and explicit verification', async () => {
  const { session: s, inputs } = fixture();
  await s.observe(); s.bindDraft('ActStride test');
  await s.propose({ revision: s.revision, ...context });
  assert.equal(inputs.length, 0);
  await s.execute({ revision: s.revision, review: 'New draft authorized' });
  await assert.rejects(s.propose({ revision: s.revision, ...context,
    skillTarget: { kind: 'click', screenshotId: 's1', x: 10, y: 10 } }), /current screenshot/);
  await s.propose({ revision: s.revision, ...context,
    skillTarget: { kind: 'click', screenshotId: 's2', x: 10, y: 10 } });
  await s.execute({ revision: s.revision, review: 'Empty editable surface inspected' });
  await assert.rejects(s.propose({ revision: s.revision, ...context }), /focus evidence/);
  await s.propose({ revision: s.revision, ...context, focusEvidence: 'Caret visible in empty editor' });
  await s.execute({ revision: s.revision, review: 'Focus and literal text checked' });
  assert.deepEqual(inputs.map(x => x[0]), ['key', 'click', 'type']);
  assert.equal(s.skillPhase, 'verify');
  assert.throws(() => s.verifyDraft({ revision: s.revision }), /verification evidence/);
  assert.equal(s.verifyDraft({ revision: s.revision, visualEvidence: 'Exact synthetic text visible' }).method, 'host_visual_review');
});

test('failed refresh consumes action; retry cannot duplicate typed or clicked input', async () => {
  const { session: s, inputs } = fixture({ failRefresh: true });
  await s.observe();
  await s.propose({ revision: s.revision, ...context, candidates: candidate });
  await assert.rejects(s.execute({ revision: s.revision, review: 'checked' }), /outcome unknown/);
  await assert.rejects(s.execute({ revision: s.revision, review: 'checked' }), /No current proposal/);
  assert.equal(inputs.length, 1);
});

test('reobservation invalidates proposals and host review is required', async () => {
  const { session: s, inputs } = fixture(); await s.observe();
  await s.propose({ revision: s.revision, ...context, candidates: candidate });
  await assert.rejects(s.execute({ revision: s.revision }), /permission review/);
  await s.observe();
  await assert.rejects(s.execute({ revision: s.revision, review: 'checked' }), /No current proposal/);
  assert.equal(inputs.length, 0);
});

test('low confidence and invented choices never reach native input', async () => {
  for (const answer of [{ choice: 'go', confidence: 0.4 }, { choice: 'invented', confidence: 0.99 }]) {
    const { session: s, inputs } = fixture({ fastDecider: { decide: async () => answer } }); await s.observe();
    const call = s.propose({ revision: s.revision, ...context, candidates: candidate, useFast: true });
    if (answer.choice === 'go') assert.equal((await call).role, 's2');
    else await assert.rejects(call, /Invalid fast decision/);
    await assert.rejects(s.execute({ revision: s.revision, review: 'checked' }), /No current proposal/);
    assert.equal(inputs.length, 0);
  }
});

test('desktop fast route uses existing SystemOne adapter and desktop-specific instructions', async () => {
  let body;
  const decider = desktopDecider({ provider: 'systemone', endpoint: 'http://127.0.0.1:8000/v1/systemone',
    fetchImpl: async (_url, request) => {
      body = JSON.parse(request.body);
      return { ok: true, json: async () => ({ model: 'fixture', answers: { next: { choice: 'go', probabilities: { go: 0.9 } } } }) };
    } });
  const { session: s, inputs } = fixture({ fastDecider: decider }); await s.observe();
  const proposal = await s.propose({ revision: s.revision, ...context, candidates: candidate, useFast: true });
  assert.equal(proposal.role, 's1'); assert.equal(inputs.length, 0);
  assert.match(body.questions.next.instructions, /ONE guarded step/);
  assert.equal(body.images, undefined);
  await s.execute({ revision: s.revision, review: 'checked' }); assert.equal(inputs.length, 1);
});

test('concurrent observation cannot race an in-flight fast decision', async () => {
  let resolve;
  const { session: s } = fixture({ fastDecider: { decide: () => new Promise(r => { resolve = r; }) } });
  await s.observe();
  const proposal = s.propose({ revision: s.revision, ...context, candidates: candidate, useFast: true });
  await assert.rejects(s.observe(), /in flight/);
  resolve({ choice: 'go', confidence: 0.9 }); await proposal;
});

test('unsupported keys and absent fast backend fail without fallback', async () => {
  const { session: s } = fixture(); await s.observe();
  await assert.rejects(s.propose({ revision: s.revision, ...context,
    candidates: { win: { description: 'Run', action: { kind: 'key', key: 'Win+r' } } } }), /Unsupported key/);
  await assert.rejects(s.propose({ revision: s.revision, ...context, candidates: candidate, useFast: true }), /not configured/);
});

test('accessible mismatched text cannot be overridden with a claimed visual pass', async () => {
  const { session: s } = fixture({ document: 'wrong text' });
  await s.observe(); s.bindDraft('expected text');
  for (const extra of [{}, { skillTarget: { kind: 'click', screenshotId: 's2', x: 10, y: 10 } }, { focusEvidence: 'Observed caret' }]) {
    await s.propose({ revision: s.revision, ...context, ...extra });
    await s.execute({ revision: s.revision, review: 'inspected' });
  }
  assert.equal(s.verifyDraft({ revision: s.revision, visualEvidence: 'claimed match' }).ok, false);
  assert.equal(s.skillPhase, 'verify');
});
