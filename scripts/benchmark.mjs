// Matched synthetic evaluation. Never retries a failed inference request.
import { parseArgs } from 'node:util';
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { systemOneEndpoint } from '../fast-decider.mjs';
import { scenarios } from '../scenarios.mjs';
import { Budget, reconciliationCost } from '../budget.mjs';
const { values } = parseArgs({ options: { channel: { type: 'string', default: 'msedge' }, skills: { type: 'boolean', default: false },
  compare: { type: 'string', default: 'modes' }, repeats: { type: 'string', default: '1' }, cases: { type: 'string' }, budget: { type: 'string', default: '5' },
  'reconcile-usage': { type: 'boolean', default: false },
  'fast-provider': { type: 'string', default: 'openrouter' }, 'fast-endpoint': { type: 'string' }, fast: { type: 'string' }, 'fast-images': { type: 'boolean', default: false } } });
const repeats = Number(values.repeats), budgetLimit = Number(values.budget);
if (!['modes', 'skills'].includes(values.compare)) throw Error('compare must be modes or skills');
if (!Number.isInteger(repeats) || repeats < 1 || repeats > 10) throw Error('repeats must be 1..10');
if (!Number.isFinite(budgetLimit) || budgetLimit <= 0) throw Error('budget must be positive');
if (!['openrouter', 'systemone'].includes(values['fast-provider'])) throw Error('fast-provider must be openrouter or systemone');
if (values['fast-provider'] === 'systemone') systemOneEndpoint(values['fast-endpoint']);
else if (values['fast-endpoint'] !== undefined || values['fast-images']) throw Error('fast-endpoint and fast-images require SystemOne');
const fastArgs = ['--fast-provider', values['fast-provider'], ...(values['fast-endpoint'] ? ['--fast-endpoint', values['fast-endpoint']] : []),
  ...(values.fast ? ['--fast', values.fast] : []), ...(values['fast-images'] ? ['--fast-images'] : [])];
const cases = values.cases ? values.cases.split(',') : ['tickets_a', 'tickets_b', 'booking_a', 'booking_b', 'settings_a', 'settings_b'];
if (new Set(cases).size !== cases.length || cases.some(name => !Object.hasOwn(scenarios, name))) throw Error('cases must name distinct known scenarios');
if (values['fast-provider'] === 'openrouter' && existsSync('runs/budget.json') && JSON.parse(readFileSync('runs/budget.json', 'utf8')).limit !== budgetLimit) throw Error('Use the authorized limit in the existing budget ledger');
const directory = resolve('runs', 'benchmark-' + new Date().toISOString().replaceAll(':', '-'));
mkdirSync(directory, { recursive: true });
const files = ['browser.mjs', 'controller.mjs', 'fast-decider.mjs', 'candidates.mjs', 'codex-planner.mjs', 'index.html', 'extended.html', 'scenarios.mjs', 'progress.mjs', 'cli.mjs', 'skills.mjs', 'skill-runner.mjs', 'budget.mjs', 'scripts/benchmark.mjs'];
const groups = values.compare === 'skills' ? [{ mode: 'dual', skills: false }, { mode: 'dual', skills: true }]
  : [{ mode: 's2-only', skills: false }, { mode: 'dual', skills: false }, ...(values.skills ? [{ mode: 'dual', skills: true }] : [])];
const sourceHashes = () => Object.fromEntries(files.map(f => [f, createHash('sha256').update(readFileSync(f)).digest('hex')]));
const manifest = { started: new Date().toISOString(), design: 'Matched cases with rotating group order, one attempt per repetition/group/case, 24 outer decisions maximum. Same executor and fresh-session planner for all groups; skill inner actions are counted separately. No automatic inference retries.',
  compare: values.compare, repeats, cases, planned_runs: repeats * cases.length * groups.length, budget_limit: budgetLimit,
  primary_metrics: ['success per started run, including transport failures', 'median paired end-to-end baseline/skills ratio, both-success pairs only'],
  groups, sources: sourceHashes(), cells: [] };
const save = () => writeFileSync(resolve(directory, 'manifest.json'), JSON.stringify(manifest, null, 2));
manifest.fast_backend = { provider: values['fast-provider'], endpoint: values['fast-endpoint'] ?? null, requested_model: values.fast ?? null, images: values['fast-images'] };
manifest.network = { node_use_env_proxy: process.env.NODE_USE_ENV_PROXY === '1' };
async function keyUsage() {
  const response = await fetch('https://openrouter.ai/api/v1/key', { headers: { Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}` }, signal: AbortSignal.timeout(20000) });
  if (!response.ok) throw Error(`Provider usage lookup HTTP ${response.status}`);
  const usage = (await response.json()).data?.usage;
  if (!Number.isFinite(usage) || usage < 0) throw Error('Invalid provider aggregate usage');
  return usage;
}
if (values['reconcile-usage']) {
  if (values['fast-provider'] !== 'openrouter' || !process.env.OPENROUTER_API_KEY) throw Error('Usage reconciliation requires the OpenRouter fast backend and key');
  const ledger = JSON.parse(readFileSync('runs/budget.json', 'utf8'));
  if (ledger.pending > 0) throw Error('Reconcile the existing reservation before creating a new usage baseline');
  manifest.usage_baseline = { provider_usage: await keyUsage(), charged: ledger.charged };
  manifest.reconciliations = [];
}
save(); console.log('BENCHMARK ' + directory);
runs: for (let repeat = 1; repeat <= repeats; repeat++) for (const [i, scenario] of cases.entries()) for (const offset of groups.keys()) {
  if (JSON.stringify(sourceHashes()) !== JSON.stringify(manifest.sources)) throw Error('Experiment sources changed; stop before the next run');
  const { mode, skills } = groups[(i + repeat - 1 + offset) % groups.length];
  const cell = { repeat, scenario, mode, skills }; manifest.cells.push(cell);
  const ledger = existsSync('runs/budget.json') ? JSON.parse(readFileSync('runs/budget.json', 'utf8')) : null;
  if (mode === 'dual' && values['fast-provider'] === 'openrouter' && ledger?.pending > 0) { cell.status = 'skipped'; cell.reason = 'Unsettled API request; no additional paid calls'; save(); continue; }
  const prior = new Set(readdirSync('runs'));
  cell.status = 'running'; cell.started_at = new Date().toISOString(); save();
  const child = spawnSync(process.execPath, ['cli.mjs', '--mode', mode, '--scenario', scenario, '--planner-provider', 'codex', '--headless', '--channel', values.channel, '--steps', '24', '--budget', String(budgetLimit), ...(mode === 'dual' ? fastArgs : []), ...(skills ? ['--skills'] : [])], { stdio: 'inherit', windowsHide: true });
  const created = readdirSync('runs').filter(n => !prior.has(n) && n.endsWith('-codex-' + mode));
  if (created.length === 1) cell.run = created[0];
  if (created.length !== 1 || !existsSync(resolve('runs', created[0], 'report.json'))) { cell.status = 'interrupted'; save(); throw Error('Missing final report; stop benchmark'); }
  cell.run = created[0]; cell.report = JSON.parse(readFileSync(resolve('runs', cell.run, 'report.json'), 'utf8'));
  cell.status = cell.report.passed ? 'passed' : 'failed'; cell.exit_code = child.status;
  const failure = cell.report.failure || '';
  cell.failure_category = cell.report.passed ? null : /HTTP (401|403)/.test(failure) ? 'access_denied'
    : /HTTP 402|Budget cannot cover/.test(failure) ? 'budget_or_credit'
    : /fetch failed|HTTP 5\d\d|network|timed out|timeout/i.test(failure) ? 'transport_or_timeout' : 'task_or_runtime';
  save();
  if (values['reconcile-usage'] && cell.report.budget?.pending > 0) {
    const current = JSON.parse(readFileSync('runs/budget.json', 'utf8'));
    const receipt = { repeat, scenario, skills, timestamp: new Date().toISOString(), budget_before: current };
    manifest.reconciliations.push(receipt);
    try {
      receipt.provider_usage = await keyUsage();
      receipt.settled_usd = reconciliationCost(current, manifest.usage_baseline, receipt.provider_usage);
      receipt.basis = 'Conservatively attribute all unmatched aggregate billed usage to the reservation; not a per-request invoice. Failed run remains failed; no inference retry.';
      save();
      const budget = new Budget('runs/budget.json', budgetLimit); budget.settle(receipt.settled_usd);
      receipt.budget_after = budget.state;
    } catch (error) { receipt.failure = error.message; }
    save();
  }
  if (['access_denied', 'budget_or_credit'].includes(cell.failure_category)) {
    manifest.stopped_reason = cell.failure_category; save(); break runs;
  }
}
manifest.sources_unchanged = JSON.stringify(sourceHashes()) === JSON.stringify(manifest.sources);
manifest.finished = new Date().toISOString(); save();
if (!manifest.sources_unchanged) throw Error('Experiment sources changed during the final run');
console.log('BENCHMARK COMPLETE ' + directory);
