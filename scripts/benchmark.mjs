// Matched synthetic evaluation. Never retries a failed inference request.
import { parseArgs } from 'node:util';
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
const { values } = parseArgs({ options: { channel: { type: 'string', default: 'msedge' } } });
const cases = ['tickets_a', 'tickets_b', 'booking_a', 'booking_b', 'settings_a', 'settings_b'];
const directory = resolve('runs', 'benchmark-' + new Date().toISOString().replaceAll(':', '-'));
mkdirSync(directory, { recursive: true });
const files = ['browser.mjs', 'controller.mjs', 'candidates.mjs', 'codex-planner.mjs', 'extended.html', 'scenarios.mjs', 'progress.mjs', 'cli.mjs'];
const manifest = { started: new Date().toISOString(), design: 'Six cases, two modes, alternating mode order, one attempt per cell, 24 steps maximum. Same fresh-session planner in both modes.', sources: Object.fromEntries(files.map(f => [f, createHash('sha256').update(readFileSync(f)).digest('hex')])), cells: [] };
const save = () => writeFileSync(resolve(directory, 'manifest.json'), JSON.stringify(manifest, null, 2));
save(); console.log('BENCHMARK ' + directory);
for (const [i, scenario] of cases.entries()) for (const mode of (i % 2 ? ['s2-only', 'dual'] : ['dual', 's2-only'])) {
  const cell = { scenario, mode }; manifest.cells.push(cell);
  const ledger = existsSync('runs/budget.json') ? JSON.parse(readFileSync('runs/budget.json', 'utf8')) : null;
  if (mode === 'dual' && ledger?.pending > 0) { cell.status = 'skipped'; cell.reason = 'Unsettled API request; no additional paid calls'; save(); continue; }
  const prior = new Set(readdirSync('runs'));
  const child = spawnSync(process.execPath, ['cli.mjs', '--mode', mode, '--scenario', scenario, '--planner-provider', 'codex', '--headless', '--channel', values.channel, '--steps', '24', '--budget', '5'], { stdio: 'inherit', windowsHide: true });
  const created = readdirSync('runs').filter(n => !prior.has(n) && n.endsWith('-codex-' + mode));
  if (created.length !== 1 || !existsSync(resolve('runs', created[0], 'report.json'))) { cell.status = 'interrupted'; save(); throw Error('Missing final report; stop benchmark'); }
  cell.run = created[0]; cell.report = JSON.parse(readFileSync(resolve('runs', cell.run, 'report.json'), 'utf8'));
  cell.status = cell.report.passed ? 'passed' : 'failed'; cell.exit_code = child.status;
  cell.failure_category = cell.report.passed ? null : /fetch failed|HTTP \d|network|timed out/i.test(cell.report.failure || '') ? 'transport_or_timeout' : 'task_or_runtime';
  save();
}
manifest.finished = new Date().toISOString(); save();
console.log('BENCHMARK COMPLETE ' + directory);
