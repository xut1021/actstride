import { mkdirSync, writeFileSync, readFileSync, appendFileSync, openSync, closeSync, unlinkSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
import { Budget, modelPricing } from '../budget.mjs';
import { buildDesktopLab, WindowsLab, control } from './backend.mjs';
import { chatChoice } from './chat-choice.mjs';

const models = ['google/gemini-3.5-flash-lite', 'openai/gpt-4.1-nano'];
const directory = resolve(`runs/chat-comparison-${new Date().toISOString().replaceAll(':', '-')}`);
mkdirSync(directory, { recursive: true });
const files = ['windows/chat-comparison.mjs', 'windows/chat-choice.mjs', 'windows/backend.mjs', 'windows/DesktopLab.cs', 'budget.mjs'];
const hashes = () => Object.fromEntries(files.map(p => [p, createHash('sha256').update(readFileSync(p)).digest('hex')]));
const manifest = { started: new Date().toISOString(), models, repeats: 2, input_modality: 'uia-text', source_hashes: hashes(), runs: [] };
const save = () => writeFileSync(join(directory, 'manifest.json'), JSON.stringify(manifest, null, 2));
const lock = openSync('runs/session.lock', 'wx');
let halted;
try {
  if (!process.env.OPENROUTER_API_KEY) throw Error('Authorized key required');
  const budget = new Budget('runs/budget.json', 20);
  if (budget.state.pending) throw Error('Unsettled usage');
  manifest.initial_budget = { ...budget.state }; save();
  const response = await fetch('https://openrouter.ai/api/v1/models', { signal: AbortSignal.timeout(20000) });
  if (!response.ok) throw Error(`Catalog HTTP ${response.status}`);
  const catalog = (await response.json()).data;
  const prices = Object.fromEntries(models.map(id => {
    const model = catalog.find(m => m.id === id);
    if (!model?.supported_parameters?.includes('structured_outputs')) throw Error('No structured output support: ' + id);
    return [id, modelPricing(model)];
  }));
  manifest.prices = prices; save();
  const exe = buildDesktopLab();
  for (let repeat = 1; repeat <= 2; repeat++) for (let index = 1; index <= 6; index++) {
    const order = (repeat + index) % 2 ? [...models].reverse() : models;
    for (const model of order) {
      const run = { cell: manifest.runs.length + 1, scenario: `judgment_${index}`, repeat, model, status: halted ? 'skipped' : 'running', cost_usd: 0 };
      manifest.runs.push(run); save(); if (halted) { run.reason = halted; save(); continue; }
      if (JSON.stringify(hashes()) !== JSON.stringify(manifest.source_hashes)) throw Error('Source changed');
      const out = join(directory, String(run.cell).padStart(2, '0')); mkdirSync(out);
      const record = e => appendFileSync(join(out, 'events.jsonl'), JSON.stringify(e) + '\n');
      const receipt = join(out, 'receipt.json');
      const lab = new WindowsLab(exe, run.scenario, receipt);
      const wall = Date.now(); let start;
      try {
        const initial = await lab.waitFor(s => s.controls.some(c => c.name.startsWith('Choose: ')));
        run.setup_ms = Date.now() - wall; start = Date.now();
        const policy = initial.controls.find(c => c.type === 'text' && c.name.startsWith('Policy: '))?.name;
        const evidence = initial.controls.find(c => c.type === 'text' && c.name.startsWith('Evidence: '))?.name;
        if (!policy || !evidence) throw Error('Missing visible task');
        const buttons = initial.controls.filter(c => c.type === 'button' && c.enabled && c.name.startsWith('Choose: '));
        const candidates = Object.fromEntries(buttons.map((b, i) => ['c' + i, b.name.slice(8)]));
        const state = { policy, evidence, candidates }; record({ event: 'input', ...state });
        const t = Date.now();
        const decision = await chatChoice({ model, state, criteria: { ...candidates, escalate: 'Ask the reasoning model to decide; no UI action yet' },
          apiKey: process.env.OPENROUTER_API_KEY, budget, price: prices[model], record: e => { record(e); if (e.event === 'usage') run.cost_usd += e.cost; } });
        run.model_ms = Date.now() - t; run.actual_model = decision.model; record({ event: 'choice', ...decision });
        if (decision.choice === 'escalate') { run.status = 'abstained'; run.passed = false; run.task_ms = Date.now() - start; continue; }
        run.choice = candidates[decision.choice];
        const uiStart = Date.now(), live = await lab.observe();
        record({ event: 'pre_action_ui', state: live });
        for (const name of [policy, evidence, ...buttons.map(b => b.name)]) if (!live.controls.some(c => c.name === name && c.enabled)) throw Error('Task changed during decision');
        await lab.act(live, { action: 'invoke', reference: control(live, 'Choose: ' + run.choice, 'button').reference });
        await lab.waitFor(s => s.controls.some(c => ['Result: PASS', 'Result: FAIL'].includes(c.name)));
        const result = JSON.parse(readFileSync(receipt, 'utf8')); record({ event: 'receipt', ...result });
        run.passed = result.passed === true && result.selected === run.choice && result.scenario === run.scenario;
        run.status = run.passed ? 'passed' : 'wrong'; run.ui_ms = Date.now() - uiStart; run.task_ms = Date.now() - start;
        await lab.capture(join(out, 'final.png'));
      } catch (e) {
        run.status = 'failed'; run.reason = e.message; run.passed = false; run.task_ms = start ? Date.now() - start : null; halted = e.message;
      } finally {
        await lab.close(); run.wall_ms = Date.now() - wall; manifest.final_budget = { ...budget.state }; save(); console.log(JSON.stringify(run));
      }
    }
  }
} catch (e) { manifest.error = e.message; process.exitCode = 1; }
finally { manifest.finished = new Date().toISOString(); manifest.final_source_hashes = hashes(); save(); closeSync(lock); unlinkSync('runs/session.lock'); }
console.log('Evidence: ' + directory);
