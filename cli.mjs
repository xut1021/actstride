import { parseArgs } from 'node:util';
import { mkdirSync, writeFileSync, appendFileSync, openSync, closeSync, unlinkSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { Controller, DEFAULT_MODELS } from './controller.mjs';
import { Budget, modelPricing } from './budget.mjs';
import { openLab, observe, execute, verify } from './browser.mjs';
import { Replay } from './replay.mjs';

const { values: args } = parseArgs({ options: {
  replay: { type: 'boolean', default: false }, headless: { type: 'boolean', default: false },
  mode: { type: 'string', default: 'dual' }, budget: { type: 'string', default: '5' },
  steps: { type: 'string', default: '40' }, channel: { type: 'string' },
  fast: { type: 'string', default: DEFAULT_MODELS.s1 }, slow: { type: 'string', default: DEFAULT_MODELS.s2 },
  help: { type: 'boolean', default: false },
} });
if (args.help) {
  console.log('fastercomputeruse\n  npm run demo -- --headless [--channel msedge]\n  npm start -- --mode dual --budget 5 [--channel msedge]\n  npm start -- --mode s2-only --budget 5\nLive runs share runs/budget.json. Set OPENROUTER_API_KEY in the environment. Ctrl+C stops.');
  process.exit(0);
}
const maxSteps = Number(args.steps), limit = Number(args.budget);
if (!Number.isInteger(maxSteps) || maxSteps < 1 || maxSteps > 100) throw Error('steps must be 1..100');
if (!['dual', 's2-only'].includes(args.mode)) throw Error('mode must be dual or s2-only');
if (!Number.isFinite(limit) || limit <= 0) throw Error('budget must be positive');
if (args.channel && !['msedge', 'chrome'].includes(args.channel)) throw Error('channel must be msedge or chrome');
if (!args.replay && !process.env.OPENROUTER_API_KEY) throw Error('Set OPENROUTER_API_KEY before live execution; never put it in arguments');

mkdirSync('runs', { recursive: true });
let lock;
try { lock = openSync('runs/session.lock', 'wx'); }
catch { throw Error('Another run or stale session.lock exists; inspect it before starting'); }
const out = resolve('runs', `${new Date().toISOString().replaceAll(':', '-')}-${args.replay ? 'replay' : args.mode}`);
mkdirSync(out);
const events = [];
function record(event) {
  const row = { ...event, timestamp: new Date().toISOString() };
  events.push(row); appendFileSync(join(out, 'events.jsonl'), JSON.stringify(row) + '\n');
}
const started = Date.now();
const abort = new AbortController();
const stop = () => abort.abort();
process.once('SIGINT', stop);
let lab, controller, budget, failure = null, result = { passed: false }, actions = 0;
try {
  if (!args.replay) {
    budget = new Budget('runs/budget.json', limit);
    const response = await fetch('https://openrouter.ai/api/v1/models', { signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw Error('Could not load current model catalog');
    const catalog = (await response.json()).data;
    const models = { s1: args.fast, s2: args.slow };
    const pricing = { s2: modelPricing(catalog.find(m => m.id === models.s2)) };
    if (args.mode === 'dual') {
      const endpointResponse = await fetch(`https://openrouter.ai/api/v1/models/${models.s1}/endpoints`, { signal: AbortSignal.timeout(15000) });
      if (!endpointResponse.ok) throw Error('Could not load Jev endpoint pricing');
      const endpoints = (await endpointResponse.json()).data?.endpoints;
      if (!Array.isArray(endpoints) || !endpoints.length) throw Error('No Jev endpoint prices');
      const bounds = endpoints.map(e => e.context_length * Number(e.pricing?.prompt) + (e.max_completion_tokens || e.context_length) * Number(e.pricing?.completion));
      if (bounds.some(b => !Number.isFinite(b) || b <= 0)) throw Error('Invalid Jev request cost bound');
      pricing.s1 = { bound: Math.max(...bounds) };
    }
    record({ event: 'start', mode: args.mode, models, request_bounds_usd: Object.fromEntries(Object.entries(pricing).map(([k, v]) => [k, v.bound])), budget_limit: limit });
    controller = new Controller({ apiKey: process.env.OPENROUTER_API_KEY, budget, pricing, models, mode: args.mode, record, signal: abort.signal });
  } else record({ event: 'start', mode: 'scripted-replay', note: 'No AI calls; fixture may use DOM to generate test coordinates' });
  lab = await openLab({ headless: args.headless, channel: args.channel });
  if (args.replay) controller = new Replay(lab.page);
  let before = await observe(lab.page);
  writeFileSync(join(out, '000-before.png'), before.png);
  for (let step = 1; step <= maxSteps; step++) {
    if (abort.signal.aborted) throw Error('Stopped by user');
    const decision = await controller.decide(before);
    if (abort.signal.aborted) throw Error('Stopped by user before action');
    if (args.replay) record({ event: 'decision', ...decision });
    console.log(`${step}/${maxSteps} ${decision.role} ${decision.action.action}: ${decision.action.reason}`);
    let ok = true, detail = '';
    try { await execute(lab.page, decision.action); actions++; }
    catch (error) { ok = false; detail = error.message; }
    const after = await observe(lab.page);
    writeFileSync(join(out, `${String(step).padStart(3, '0')}-after.png`), after.png);
    // Identical pixels twice are a heuristic to trigger replanning, not a success check.
    const changed = !before.png.equals(after.png);
    const expectedNoChange = ['key', 'escalate', 'done'].includes(decision.action.action);
    controller.feedback({ ok: ok && (changed || expectedNoChange), detail: detail || (!changed && !expectedNoChange ? 'No visible change after action' : '') });
    record({ event: 'action_result', step, ok, changed, detail });
    result = await verify(lab.page);
    if (result.passed) break;
    if (decision.action.action === 'done') throw Error('Model said done but independent verifier did not pass');
    before = after;
  }
  if (!result.passed) throw Error('Step limit reached without verified success');
} catch (error) { failure = error.message; console.error(failure); }
finally {
  if (lab) await lab.browser.close();
  const usage = events.filter(e => e.event === 'usage');
  const report = {
    mode: args.replay ? 'scripted-replay' : args.mode, passed: result.passed,
    ai_verified: !args.replay && result.passed, failure, actions,
    duration_ms: Date.now() - started, api_duration_ms: usage.reduce((s, e) => s + e.elapsed_ms, 0),
    api_calls: usage.length, cost_usd: usage.reduce((s, e) => s + e.cost, 0),
    role_calls: Object.fromEntries(['s1', 's2'].map(role => [role, usage.filter(e => e.role === role).length])),
    escalations: events.filter(e => e.event === 'decision' && e.action.action === 'escalate').length,
    budget: budget?.state, verifier: result.result,
  };
  writeFileSync(join(out, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2)); console.log(`Artifacts: ${out}`);
  process.removeListener('SIGINT', stop);
  closeSync(lock); unlinkSync('runs/session.lock');
  if (!result.passed) process.exitCode = 1;
}
