import { parseArgs } from 'node:util';
import { mkdirSync, writeFileSync, appendFileSync, openSync, closeSync, unlinkSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { Controller, DEFAULT_MODELS } from './controller.mjs';
import { Budget, modelPricing } from './budget.mjs';
import { openLab, observe, execute, verify } from './browser.mjs';
import { assessProgress } from './progress.mjs';
import { scenarios } from './scenarios.mjs';
import { Replay } from './replay.mjs';
import { CodexPlanner, CODEX_MODEL } from './codex-planner.mjs';
import { runSkill } from './skill-runner.mjs';

const { values: args } = parseArgs({ options: {
  replay: { type: 'boolean', default: false }, headless: { type: 'boolean', default: false },
  mode: { type: 'string', default: 'dual' }, budget: { type: 'string', default: '5' },
  steps: { type: 'string', default: '40' }, channel: { type: 'string' },
  fast: { type: 'string', default: DEFAULT_MODELS.s1 }, slow: { type: 'string' },
  'planner-provider': { type: 'string', default: 'codex' },
  scenario: { type: 'string', default: 'baseline' },
  skills: { type: 'boolean', default: false },
  help: { type: 'boolean', default: false },
} });
if (args.help) {
  console.log('fastercomputeruse\n  npm run demo -- --headless [--channel msedge]\n  npm start -- --mode dual --budget 5 [--channel msedge]\n  npm start -- --mode dual --scenario tickets_b --skills\n  npm start -- --mode s2-only\nScenarios: ' + Object.keys(scenarios).join(', ') + '. Default planner: codex.\n--skills enables three hand-authored workflows (dual + codex only).\nOpenRouter spending shares runs/budget.json. Codex requires ChatGPT login. Ctrl+C stops.');
  process.exit(0);
}
if (!Object.hasOwn(scenarios, args.scenario)) throw Error('Unknown scenario: ' + args.scenario);
if (args.skills && (args.replay || args.mode !== 'dual' || args['planner-provider'] !== 'codex')) throw Error('--skills requires dual mode and the Codex planner');
if (args.replay && args.scenario !== 'baseline') throw Error('Scripted replay supports baseline only');
const maxSteps = Number(args.steps), limit = Number(args.budget);
if (!Number.isInteger(maxSteps) || maxSteps < 1 || maxSteps > 100) throw Error('steps must be 1..100');
if (!['dual', 's2-only'].includes(args.mode)) throw Error('mode must be dual or s2-only');
if (!['openrouter', 'codex'].includes(args['planner-provider'])) throw Error('planner-provider must be openrouter or codex');
if (!Number.isFinite(limit) || limit <= 0) throw Error('budget must be positive');
if (args.channel && !['msedge', 'chrome'].includes(args.channel)) throw Error('channel must be msedge or chrome');
const needsOpenRouter = args.mode === 'dual' || args['planner-provider'] === 'openrouter';
if (!args.replay && needsOpenRouter && !process.env.OPENROUTER_API_KEY) throw Error('Set OPENROUTER_API_KEY before live execution; never put it in arguments');

mkdirSync('runs', { recursive: true });
let lock;
try { lock = openSync('runs/session.lock', 'wx'); }
catch { throw Error('Another run or stale session.lock exists; inspect it before starting'); }
const out = resolve('runs', `${new Date().toISOString().replaceAll(':', '-')}-${args.replay ? 'replay' : args['planner-provider'] === 'codex' ? 'codex-' + args.mode : args.mode}`);
mkdirSync(out);
const events = [];
function record(event) {
  const row = { ...event, timestamp: new Date().toISOString() };
  events.push(row); appendFileSync(join(out, 'events.jsonl'), JSON.stringify(row) + '\n');
}
const started = Date.now();
const timings = { setup_ms: 0, browser_ms: 0, observation_ms: 0, execution_ms: 0 };
async function timed(name, action) { const begin = Date.now(); try { return await action(); } finally { timings[name] += Date.now() - begin; } }
const abort = new AbortController();
const stop = () => abort.abort();
process.once('SIGINT', stop);
let lab, controller, budget, failure = null, result = { passed: false }, actions = 0;
try {
  if (!args.replay) {
    if (needsOpenRouter) budget = new Budget('runs/budget.json', limit);
    const models = { s1: args.fast, s2: args.slow || (args['planner-provider'] === 'codex' ? CODEX_MODEL : DEFAULT_MODELS.s2) };
    const pricing = {};
    let planner;
    if (args['planner-provider'] === 'codex') {
      planner = new CodexPlanner({ directory: join(out, 'codex'), model: models.s2, signal: abort.signal });
      await planner.checkAuth();
    } else {
      const response = await fetch('https://openrouter.ai/api/v1/models', { signal: AbortSignal.timeout(15000) });
      if (!response.ok) throw Error('Could not load current model catalog');
      const catalog = (await response.json()).data;
      pricing.s2 = modelPricing(catalog.find(m => m.id === models.s2));
    }
    if (args.mode === 'dual') {
      const endpointResponse = await fetch(`https://openrouter.ai/api/v1/models/${models.s1}/endpoints`, { signal: AbortSignal.timeout(15000) });
      if (!endpointResponse.ok) throw Error('Could not load Jev endpoint pricing');
      const endpoints = (await endpointResponse.json()).data?.endpoints;
      if (!Array.isArray(endpoints) || !endpoints.length) throw Error('No Jev endpoint prices');
      const bounds = endpoints.map(e => e.context_length * Number(e.pricing?.prompt) + (e.max_completion_tokens || e.context_length) * Number(e.pricing?.completion));
      if (bounds.some(b => !Number.isFinite(b) || b <= 0)) throw Error('Invalid Jev request cost bound');
      pricing.s1 = { bound: Math.max(...bounds) };
    }
    console.log(`System 1: ${args.mode === 'dual' ? models.s1 + ' (OpenRouter paid)' : 'disabled'}; System 2: ${models.s2} (${args['planner-provider'] === 'codex' ? 'Codex subscription' : 'OpenRouter paid'})`);
    record({ event: 'start', scenario: args.scenario, mode: args.mode, skills: args.skills, planner_provider: args['planner-provider'], models, request_bounds_usd: Object.fromEntries(Object.entries(pricing).map(([k, v]) => [k, v.bound])), budget_limit: limit });
    controller = new Controller({ apiKey: process.env.OPENROUTER_API_KEY, budget, pricing, models, mode: args.mode, skills: args.skills, record, signal: abort.signal, planner });
  } else record({ event: 'start', mode: 'scripted-replay', note: 'No AI calls; fixture may use DOM to generate test coordinates' });
  timings.setup_ms = Date.now() - started;
  lab = await timed('browser_ms', () => openLab({ headless: args.headless, channel: args.channel, scenario: args.scenario }));
  if (args.replay) controller = new Replay(lab.page);
  let before = await timed('observation_ms', () => observe(lab.page));
  writeFileSync(join(out, '000-before.png'), before.png);
  for (let step = 1; step <= maxSteps; step++) {
    if (abort.signal.aborted) throw Error('Stopped by user');
    const decision = await controller.decide(before);
    if (abort.signal.aborted) throw Error('Stopped by user before action');
    if (args.replay) record({ event: 'decision', ...decision });
    console.log(`${step}/${maxSteps} ${decision.role} ${decision.action.action}: ${decision.action.reason}`);
    let ok = true, detail = '', skillResult;
    try {
      if (decision.action.action === 'skill') {
        skillResult = await timed('execution_ms', () => runSkill(lab.page, decision.action.skill, { record, signal: abort.signal }));
        actions += skillResult.steps;
        ({ ok, detail } = skillResult);
        mkdirSync('runs/skills', { recursive: true });
        appendFileSync('runs/skills/experiences.jsonl', JSON.stringify({ timestamp: new Date().toISOString(), run: out, task: before.task, binding: decision.action.skill, ...skillResult, source: 'hand-authored-v1', promotion: 'none' }) + '\n');
      } else { await timed('execution_ms', () => execute(lab.page, decision.action)); actions++; }
    }
    catch (error) { ok = false; detail = error.message; }
    const after = await timed('observation_ms', () => observe(lab.page));
    writeFileSync(join(out, `${String(step).padStart(3, '0')}-after.png`), after.png);
    const feedback = skillResult || assessProgress(before, after, decision.action, { ok, detail });
    controller.feedback(feedback);
    record({ event: 'action_result', step, ...feedback });
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
    scenario: args.scenario, skills: args.skills, skill_attempts: events.filter(e => e.event === 'skill_result').length, skill_failures: events.filter(e => e.event === 'skill_result' && !e.ok).length, timings, mode: args.replay ? 'scripted-replay' : args.mode, planner_provider: args.replay ? null : args['planner-provider'], passed: result.passed,
    ai_verified: !args.replay && result.passed, failure, actions,
    duration_ms: Date.now() - started, model_duration_ms: usage.reduce((s, e) => s + e.elapsed_ms, 0),
    api_duration_ms: usage.filter(e => e.billing !== 'codex-subscription').reduce((s, e) => s + e.elapsed_ms, 0),
    api_calls: usage.filter(e => e.billing !== 'codex-subscription').length,
    codex_calls: usage.filter(e => e.billing === 'codex-subscription').length,
    cost_usd: usage.reduce((s, e) => s + (e.cost ?? 0), 0), cost_scope: 'OpenRouter only; Codex subscription usage is not priced here',
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
