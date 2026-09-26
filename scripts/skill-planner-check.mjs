// Three real subscription-planner calls; no Jev transport and no OpenRouter key.
// This checks binding + workflow integration, NOT live two-model performance.
import { mkdirSync, writeFileSync, appendFileSync, readFileSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
import { parseArgs } from 'node:util';
import { CodexPlanner } from '../codex-planner.mjs';
import { openLab, observe, execute, verify } from '../browser.mjs';
import { skillCatalog, validateBinding } from '../skills.mjs';
import { runSkill } from '../skill-runner.mjs';
import { validateAction } from '../controller.mjs';

const { values } = parseArgs({ options: { channel: { type: 'string', default: 'msedge' } } });
const directory = resolve('runs', 'skill-planner-' + new Date().toISOString().replaceAll(':', '-'));
mkdirSync(directory, { recursive: true });
const abort = new AbortController();
const stop = () => abort.abort(); process.once('SIGINT', stop);
const ledger = () => existsSync('runs/budget.json') ? readFileSync('runs/budget.json', 'utf8') : null;
const beforeLedger = ledger();
const files = ['browser.mjs', 'skills.mjs', 'skill-runner.mjs', 'codex-planner.mjs', 'controller.mjs', 'extended.html', 'scenarios.mjs'];
const report = { kind: 'subscription-planner-skill-integration-no-jev', live_jev_calls: 0, openrouter_calls: 0, full_dual_validation: false,
  sources: Object.fromEntries(files.map(file => [file, createHash('sha256').update(readFileSync(file)).digest('hex')])), cases: [] };
const save = () => writeFileSync(join(directory, 'report.json'), JSON.stringify(report, null, 2));
console.log(directory);
try {
  const planner = new CodexPlanner({ directory: join(directory, 'codex'), signal: abort.signal });
  await planner.checkAuth();
  for (const scenario of ['tickets_b', 'booking_b', 'settings_b']) {
    if (abort.signal.aborted) break;
    const cell = { scenario, passed: false }; report.cases.push(cell);
    const lab = await openLab({ scenario, channel: values.channel, headless: true });
    try {
      const observation = await observe(lab.page), started = Date.now();
      const response = await planner.decide({ ...observation, skills: skillCatalog(observation.ui), history: [], plan: '' });
      cell.planner_ms = Date.now() - started; cell.usage = response.usage;
      const action = validateAction(response.action, observation.width, observation.height);
      cell.action = action; validateBinding(action.skill);
      if (action.action !== 'wait') throw Error('Planner did not offer a skill with wait');
      await execute(lab.page, action);
      // Intentionally direct: do not pretend a deterministic choice was live Jev.
      cell.workflow = await runSkill(lab.page, action.skill, { signal: abort.signal,
        record: event => appendFileSync(join(directory, 'events.jsonl'), JSON.stringify({ scenario, ...event }) + '\n') });
      cell.passed = cell.workflow.ok && (await verify(lab.page)).passed;
      await lab.page.screenshot({ path: join(directory, `${scenario}-after.png`) });
    } catch (error) { cell.failure = error.message; }
    finally { await lab.browser.close(); save(); }
    console.log(JSON.stringify(cell));
    if (cell.failure) break; // No retry on auth, schema or transport failure.
  }
} catch (error) { report.failure = error.message; }
finally {
  report.ledger_unchanged = ledger() === beforeLedger;
  report.passed = report.cases.length === 3 && report.cases.every(c => c.passed) && report.ledger_unchanged;
  save(); process.removeListener('SIGINT', stop);
  console.log(JSON.stringify({ passed: report.passed, directory, failure: report.failure }));
  if (!report.passed) process.exitCode = 1;
}
