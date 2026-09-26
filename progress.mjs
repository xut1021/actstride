// Feedback uses observed UI state, never hidden fixture answers or verifier state.
export function assessProgress(before, after, action, execution = { ok: true, detail: '' }) {
  const changed = JSON.stringify(before.ui) !== JSON.stringify(after.ui);
  if (!execution.ok) return { ...execution, changed };
  if (after.ui.error && after.ui.error !== before.ui.error) {
    return { ok: false, changed, replan: true, detail: after.ui.error };
  }
  if (action.action === 'type' && after.ui.focused?.value !== action.text) {
    return { ok: false, changed, detail: 'Focused input does not contain the requested value' };
  }
  const expected = ['key', 'escalate', 'done'].includes(action.action) || (action.action === 'wait' && before.ui.busy);
  return { ok: changed || expected, changed, detail: changed || expected ? '' : 'No observed UI progress after action' };
}
