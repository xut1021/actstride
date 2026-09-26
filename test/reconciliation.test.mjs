import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { Budget, reconciliationCost } from '../budget.mjs';

test('aggregate reconciliation counts known costs once and retains unmatched billed usage', t => {
  const directory = mkdtempSync(join(tmpdir(), 'actstride-reconciliation-'));
  t.after(() => { assert.equal(dirname(directory), resolve(tmpdir())); rmSync(directory, { recursive: true, force: true }); });
  const budget = new Budget(join(directory, 'ledger.json'), 20);
  const baseline = { provider_usage: 2, charged: 0 };
  budget.reserve(1); budget.settle(0.2); budget.reserve(0.5);
  const cost = reconciliationCost(budget.state, baseline, 2.3);
  assert.ok(Math.abs(cost - 0.1) < 1e-10);
  budget.settle(cost);
  assert.ok(Math.abs(budget.state.charged - 0.3) < 1e-10);
  assert.equal(budget.state.pending, 0);
  budget.reserve(0.5);
  assert.equal(reconciliationCost(budget.state, baseline, 2.3), 0);
});

test('missing, lagging, decreasing or excessive provider usage never clears a reservation', t => {
  const directory = mkdtempSync(join(tmpdir(), 'actstride-reconciliation-'));
  t.after(() => { assert.equal(dirname(directory), resolve(tmpdir())); rmSync(directory, { recursive: true, force: true }); });
  const budget = new Budget(join(directory, 'ledger.json'), 20);
  budget.reserve(1); budget.settle(0.2); budget.reserve(0.5);
  const before = readFileSync(budget.path, 'utf8');
  for (const usage of [undefined, null, '2.3', NaN, Infinity, -1, 1.9, 2.1, 3]) {
    assert.throws(() => reconciliationCost(budget.state, { provider_usage: 2, charged: 0 }, usage), /reconciliation|reconcile/);
    assert.equal(readFileSync(budget.path, 'utf8'), before);
  }
  assert.throws(() => reconciliationCost(budget.state, { provider_usage: 2, charged: 0.3 }, 2.3), /Invalid/);
  assert.throws(() => reconciliationCost({ charged: 0.2, pending: 0 }, { provider_usage: 2, charged: 0 }, 2.2), /Invalid/);
});
