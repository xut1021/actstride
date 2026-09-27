import { mkdirSync, readFileSync, writeFileSync, appendFileSync, openSync, closeSync, unlinkSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
import { Budget } from '../budget.mjs';
import { CodexPlanner } from '../codex-planner.mjs';
import { FastDecider } from '../fast-decider.mjs';
import { judgmentPrice } from './judgment-config.mjs';
import { control } from './backend.mjs';
import { openStreamLab } from './stream-browser.mjs';
import { queues, policySchema, choiceSchema, policyInstructions, choiceInstructions, fastInstructions, checkedPolicy, streamState, routeSkill } from './stream-skills.mjs';

const directory = resolve(`runs/stream-${new Date().toISOString().replaceAll(':', '-')}`);
mkdirSync(directory, { recursive: true });
const sources = ['windows/stream-benchmark.mjs', 'windows/stream-skills.mjs', 'stream.html', 'windows/stream-browser.mjs', 'windows/backend.mjs', 'codex-planner.mjs', 'fast-decider.mjs', 'budget.mjs'];
const hashes = () => Object.fromEntries(sources.map(p => [p, createHash('sha256').update(readFileSync(p)).digest('hex')]));
const manifest = { started: new Date().toISOString(), source_hashes: hashes(), scenario: 'ticket_stream', repeats: 2,
  planner: 'gpt-6-astra', effort: 'medium', fast_model: 'typesafe/jev-1.13', threshold: 0.55, input: 'synthetic DOM text', runs: [] };
const save = () => writeFileSync(join(directory, 'manifest.json'), JSON.stringify(manifest, null, 2));
const lock = openSync('runs/session.lock', 'wx');
let halted;
try {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw Error('Authorized OpenRouter key required');
  const budget = new Budget(resolve('runs/budget.json'), 20);
  if (budget.state.pending) throw Error('Unsettled usage');
  manifest.initial_budget = { ...budget.state }; save();
  const price = await judgmentPrice(manifest.fast_model);
  await new CodexPlanner({ directory: join(directory, 'auth') }).checkAuth();
  for (let repeat = 1; repeat <= 2; repeat++) {
    const modes = repeat === 1 ? ['astra-jev', 'astra-only'] : ['astra-only', 'astra-jev'];
    for (const mode of modes) {
      const run = { cell: manifest.runs.length + 1, repeat, mode, status: halted ? 'skipped' : 'running', reason: halted ?? null,
        s2_calls: 0, s1_calls: 0, s2_ms: 0, s1_ms: 0, ui_actions: 0, ui_ms: 0, skill_calls: 0, escalations: 0, cost_usd: 0, tickets: [] };
      manifest.runs.push(run); save(); if (halted) continue;
      if (JSON.stringify(hashes()) !== JSON.stringify(manifest.source_hashes)) throw Error('Source changed');
      const out = join(directory, String(run.cell).padStart(2, '0')); mkdirSync(out);
      const record = e => appendFileSync(join(out, 'events.jsonl'), JSON.stringify(e) + '\n');
      const receipt = join(out, 'receipt.json'), lab = await openStreamLab(receipt);
      const wallStart = Date.now(); let start;
      try {
        let state = await lab.waitFor(s => s.controls.some(c => c.name === 'Begin stream' && c.enabled));
        run.setup_ms = Date.now() - wallStart; start = Date.now();
        const sourcePolicy = state.controls.find(c => c.name.startsWith('Policy v1:')).name;
        const initialBulletin = state.controls.find(c => c.name.startsWith('Bulletin v1:')).name;
        const compiler = new CodexPlanner({ directory: join(out, 'policy'), outputSchema: policySchema, instructions: policyInstructions });
        const planner = new CodexPlanner({ directory: join(out, 'decisions'), outputSchema: choiceSchema, instructions: choiceInstructions });
        const ask = async (client, input, event) => {
          const t = Date.now(); run.s2_calls++;
          const answer = await client.decide(input); run.s2_ms += Date.now() - t;
          record({ event, input, ...answer }); return answer.action;
        };
        let policy = checkedPolicy((await ask(compiler, { source_policy: sourcePolicy, bulletin: initialBulletin, queues }, 'initial_policy')).policy);
        let t = Date.now();
        await lab.act(state, { action: 'invoke', reference: control(state, 'Begin stream', 'button').reference });
        run.ui_actions++; record({ event: 'ui_action', name: 'Begin stream' });
        state = await lab.waitFor(s => s.controls.some(c => c.name.startsWith('Ticket 1/8:'))); run.ui_ms += Date.now() - t;
        const fast = new FastDecider({ apiKey, budget, price, model: manifest.fast_model, decisionInstructions: fastInstructions,
          record: e => { record(e); if (e.event === 'usage') run.cost_usd += e.cost; } });
        for (let ticket = 1; ticket <= 8; ticket++) {
          const observation = streamState(state), item = { ticket, s2_calls: 0, escalated: false };
          record({ event: 'observation', ...observation });
          let choice;
          if (mode === 'astra-jev') {
            const { source_policy, ...localState } = observation;
            t = Date.now(); run.s1_calls++;
            const answer = await fast.decide({ state: { ...localState, policy }, criteria: {
              ...Object.fromEntries(queues.map(q => [q, `Run the two-step route-and-confirm skill for queue ${q}`])),
              escalate: 'Ask Astra to resolve this case and update its reusable policy; do not route yet',
            } });
            run.s1_ms += Date.now() - t; record({ event: 'fast_choice', ticket, ...answer });
            item.fast_choice = answer.choice; item.confidence = answer.confidence;
            if (answer.choice !== 'escalate' && answer.confidence >= manifest.threshold) choice = answer.choice;
            else { run.escalations++; item.escalated = true; }
          }
          if (!choice) {
            const answer = await ask(planner, { ...observation, policy, queues }, 'planner_decision');
            choice = answer.choice; policy = checkedPolicy(answer.policy); item.s2_calls++;
          }
          if (!queues.includes(choice)) throw Error('Invalid queue');
          item.choice = choice; t = Date.now(); run.skill_calls++;
          state = await routeSkill(lab, state, choice, e => { run.ui_actions++; record({ event: 'ui_action', ...e }); });
          run.ui_ms += Date.now() - t; run.tickets.push(item); save();
          console.log(JSON.stringify({ cell: run.cell, mode, ticket, choice, escalated: item.escalated }));
        }
        const result = JSON.parse(readFileSync(receipt, 'utf8'));
        if (result.scenario !== 'ticket_stream' || JSON.stringify(result.selected) !== JSON.stringify(run.tickets.map(t => t.choice))) throw Error('Receipt mismatch');
        run.correct = result.correct; run.total = 8; run.passed = result.passed === true;
        run.status = run.passed ? 'passed' : 'failed'; run.task_ms = Date.now() - start;
        record({ event: 'receipt', ...result }); await lab.capture(join(out, 'final.png'));
      } catch (error) {
        run.status = 'failed'; run.reason = error.message; run.passed = false; halted = error.message;
        run.task_ms = start ? Date.now() - start : null;
        try { await lab.capture(join(out, 'error.png')); } catch {}
      } finally {
        await lab.close(); run.wall_ms = Date.now() - wallStart; manifest.final_budget = { ...budget.state }; save();
        console.log(JSON.stringify(run));
      }
    }
  }
} catch (error) { manifest.error = error.message; process.exitCode = 1; }
finally { manifest.finished = new Date().toISOString(); manifest.final_source_hashes = hashes(); save(); closeSync(lock); unlinkSync('runs/session.lock'); }
console.log(`Evidence: ${directory}`);
