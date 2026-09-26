import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';

const root = resolve(import.meta.dirname, '..');
function runFixture(t, kind, repeats = '1') {
  const directory = mkdtempSync(join(tmpdir(), 'actstride-benchmark-'));
  t.after(() => { assert.equal(dirname(directory), resolve(tmpdir())); rmSync(directory, { recursive: true, force: true }); });
  for (const file of ['browser.mjs', 'controller.mjs', 'fast-decider.mjs', 'candidates.mjs', 'codex-planner.mjs', 'index.html', 'extended.html', 'scenarios.mjs', 'progress.mjs', 'cli.mjs', 'skills.mjs', 'skill-runner.mjs', 'budget.mjs', 'scripts/benchmark.mjs']) {
    mkdirSync(dirname(join(directory, file)), { recursive: true }); copyFileSync(join(root, file), join(directory, file));
  }
  mkdirSync(join(directory, 'runs'));
  writeFileSync(join(directory, 'runs/budget.json'), JSON.stringify({ limit: 20, charged: 0, pending: 0 }));
  const preload = join(directory, 'preload.mjs');
  writeFileSync(preload, `
import assert from 'node:assert/strict';
import cp from 'node:child_process';
import {syncBuiltinESMExports} from 'node:module';
import {readFileSync,writeFileSync,readdirSync,mkdirSync} from 'node:fs';
const kind=${JSON.stringify(kind)};
let calls=0, lookups=0;
globalThis.fetch=async(url,options)=>{
  assert.equal(url,'https://openrouter.ai/api/v1/key');
  assert.equal(options.headers.Authorization,'Bearer fixture-key-never-sent');
  return {ok:true,json:async()=>({data:{usage:++lookups===1?0:kind==='unmatched'?1:0.00005}})};
};
cp.spawnSync=(file,args)=>{
  const manifestPath='runs/'+readdirSync('runs').find(n=>n.startsWith('benchmark-'))+'/manifest.json';
  const manifest=JSON.parse(readFileSync(manifestPath,'utf8'));
  assert.equal(manifest.cells.at(-1).status,'running');
  assert.ok(manifest.cells.at(-1).started_at);
  assert.equal(args[args.indexOf('--budget')+1],'20');
  const run=String(++calls).padStart(3,'0')+'-codex-dual';mkdirSync('runs/'+run);
  if(kind==='interrupted')return {status:1};
  const failed=calls===1&&kind!=='success';
  const ledger={limit:20,charged:failed?0:JSON.parse(readFileSync('runs/budget.json','utf8')).charged,pending:failed?0.001344:0};
  writeFileSync('runs/budget.json',JSON.stringify(ledger));
  const report={passed:!failed,ai_verified:!failed,duration_ms:10,cost_usd:0,budget:ledger,failure:failed?(kind==='denied'?'OpenRouter HTTP 403; no retry':'The operation was aborted due to timeout'):null};
  writeFileSync('runs/'+run+'/report.json',JSON.stringify(report));return {status:failed?1:0};
};
syncBuiltinESMExports();
`);
  const result = spawnSync(process.execPath, ['--import', pathToFileURL(preload).href, join(root, 'scripts/benchmark.mjs'), '--compare', 'skills', '--cases', 'tickets_a,booking_a', '--repeats', repeats, '--budget', '20', '--reconcile-usage'], {
    cwd: directory, env: { ...process.env, OPENROUTER_API_KEY: 'fixture-key-never-sent', NODE_OPTIONS: '' }, encoding: 'utf8', windowsHide: true, timeout: 10000,
  });
  const batch = readdirSync(join(directory, 'runs')).find(n => n.startsWith('benchmark-'));
  assert.ok(batch, result.stderr);
  return { result, manifest: JSON.parse(readFileSync(join(directory, 'runs', batch, 'manifest.json'), 'utf8')),
    ledger: JSON.parse(readFileSync(join(directory, 'runs/budget.json'), 'utf8')) };
}

test('paired runner persists attempts, alternates order and forwards the authorized budget', t => {
  const { result, manifest } = runFixture(t, 'success', '2');
  assert.equal(result.status, 0, result.stderr);
  assert.equal(manifest.planned_runs, 8); assert.equal(manifest.cells.length, 8);
  assert.deepEqual(manifest.cells.map(c => c.skills), [false, true, true, false, true, false, false, true]);
  assert.ok(manifest.cells.every(c => c.status === 'passed' && c.run));
  assert.equal(manifest.sources_unchanged, true);
});
test('a reconciled timeout stays failed and only subsequent cells run', t => {
  const { result, manifest, ledger } = runFixture(t, 'timeout');
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(manifest.cells.map(c => c.status), ['failed', 'passed', 'passed', 'passed']);
  assert.equal(manifest.cells[0].failure_category, 'transport_or_timeout');
  assert.equal(manifest.reconciliations[0].settled_usd, 0.00005);
  assert.equal(ledger.charged, 0.00005); assert.equal(ledger.pending, 0);
});
test('unmatched aggregate usage preserves the reservation and skips later paid cells', t => {
  const { manifest, ledger } = runFixture(t, 'unmatched');
  assert.deepEqual(manifest.cells.map(c => c.status), ['failed', 'skipped', 'skipped', 'skipped']);
  assert.match(manifest.reconciliations[0].failure, /reserved bound/);
  assert.equal(ledger.pending, 0.001344); assert.equal(ledger.charged, 0);
});
test('access denial stops the batch without trying other task content', t => {
  const { manifest } = runFixture(t, 'denied');
  assert.equal(manifest.stopped_reason, 'access_denied');
  assert.equal(manifest.cells.length, 1); assert.equal(manifest.cells[0].status, 'failed');
});
test('interrupted attempt retains its discovered run directory and failure status', t => {
  const { result, manifest } = runFixture(t, 'interrupted');
  assert.notEqual(result.status, 0); assert.equal(manifest.cells.length, 1);
  assert.equal(manifest.cells[0].status, 'interrupted');
  assert.equal(manifest.cells[0].run, '001-codex-dual');
});
