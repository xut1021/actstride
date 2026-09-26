import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validatePlan } from '../windows/judgment-plan.mjs';
test('planner guidance must bind a current label without executable fields', () => {
  const candidates = { c0: 'Supplier A', c1: 'Supplier C' };
  const plan = { checks: ['Compare eligible totals'], recommended_target: 'Supplier C', stop_condition: 'Stop if the option is missing' };
  assert.deepEqual(validatePlan(plan, candidates), plan);
  assert.throws(() => validatePlan({ ...plan, recommended_target: 'Supplier B' }, candidates));
  assert.throws(() => validatePlan({ ...plan, recommended_target: 'c1' }, candidates));
  assert.throws(() => validatePlan({ ...plan, checks: [] }, candidates));
  assert.throws(() => validatePlan({ ...plan, code: 'execute' }, candidates));
  assert.equal(validatePlan({ ...plan, recommended_target: 'escalate' }, candidates).recommended_target, 'escalate');
});
