// Matched synthetic evaluation. Never retries a failed inference request.
import { parseArgs } from 'node:util';
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { systemOneEndpoint } from '../fast-decider.mjs';
const { values } = parseArgs({ options: { channel: { type: 'string', default: 'msedge' }, skills: { type: 'boolean', default: false },
  'fast-provider': { type: 'string', default: 'openrouter' }, 'fast-endpoint': { type: 'string' }, fast: { type: 'string' }, 'fast-images': { type: 'boolean', default: false } } });
if (!['openrouter', 'systemone'].includes(values['fast-provider'])) throw Error('fast-provider must be openrouter or systemone');
if (values['fast-provider'] === 'systemone') systemOneEndpoint(values['fast-endpoint']);
else if (values['fast-endpoint'] !== undefined || values['fast-images']) throw Error('fast-endpoint and fast-images require SystemOne');
const fastArgs = ['--fast-provider', values['fast-provider'], ...(values['fast-endpoint'] ? ['--fast-endpoint', values['fast-endpoint']] : []),
  ...(values.fast ? ['--fast', values.fast] : []), ...(values['fast-images'] ? ['--fast-images'] : [])];
const cases = ['tickets_a', 'tickets_b', 'booking_a', 'booking_b', 'settings_a', 'settings_b'];
const directory = resolve('runs', 'benchmark-' + new Date().toISOString().replaceAll(':', '-'));
mkdirSync(directory, { recursive: true });
const files = ['browser.mjs', 'controller.mjs', 'fast-decider.mjs', 'candidates.mjs', 'codex-planner.mjs', 'extended.html', 'scenarios.mjs', 'progress.mjs', 'cli.mjs', 'skills.mjs', 'skill-runner.mjs'];
const groups = [{ mode: 's2-only', skills: false }, { mode: 'dual', skills: false }, ...(values.skills ? [{ mode: 'dual', skills: true }] : [])];
const manifest = { started: new Date().toISOString(), design: 'Six cases, rotating group order, one attempt per cell, 24 outer decisions maximum. Same executor and fresh-session planner for all groups; skill inner actions are counted separately.', groups, sources: Object.fromEntries(files.map(f => [f, createHash('sha256').update(readFileSync(f)).digest('hex')])), cells: [] };
const save = () => writeFileSync(resolve(directory, 'manifest.json'), JSON.stringify(manifest, null, 2));
manifest.fast_backend = { provider: values['fast-provider'], endpoint: values['fast-endpoint'] ?? null, requested_model: values.fast ?? null, images: values['fast-images'] };
save(); console.log('BENCHMARK ' + directory);
for (const [i, scenario] of cases.entries()) for (const offset of groups.keys()) {
  const { mode, skills } = groups[(i + offset) % groups.length];
  const cell = { scenario, mode, skills }; manifest.cells.push(cell);
  const ledger = existsSync('runs/budget.json') ? JSON.parse(readFileSync('runs/budget.json', 'utf8')) : null;
  if (mode === 'dual' && values['fast-provider'] === 'openrouter' && ledger?.pending > 0) { cell.status = 'skipped'; cell.reason = 'Unsettled API request; no additional paid calls'; save(); continue; }
  const prior = new Set(readdirSync('runs'));
  const child = spawnSync(process.execPath, ['cli.mjs', '--mode', mode, '--scenario', scenario, '--planner-provider', 'codex', '--headless', '--channel', values.channel, '--steps', '24', '--budget', '5', ...(mode === 'dual' ? fastArgs : []), ...(skills ? ['--skills'] : [])], { stdio: 'inherit', windowsHide: true });
  const created = readdirSync('runs').filter(n => !prior.has(n) && n.endsWith('-codex-' + mode));
  if (created.length !== 1 || !existsSync(resolve('runs', created[0], 'report.json'))) { cell.status = 'interrupted'; save(); throw Error('Missing final report; stop benchmark'); }
  cell.run = created[0]; cell.report = JSON.parse(readFileSync(resolve('runs', cell.run, 'report.json'), 'utf8'));
  cell.status = cell.report.passed ? 'passed' : 'failed'; cell.exit_code = child.status;
  cell.failure_category = cell.report.passed ? null : /fetch failed|HTTP \d|network|timed out/i.test(cell.report.failure || '') ? 'transport_or_timeout' : 'task_or_runtime';
  save();
}
manifest.finished = new Date().toISOString(); save();
console.log('BENCHMARK COMPLETE ' + directory);
