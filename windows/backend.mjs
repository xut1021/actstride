import { spawn, execFileSync } from 'node:child_process';
import { createInterface } from 'node:readline';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

export function buildDesktopLab() {
  if (process.platform !== 'win32') throw Error('Windows required');
  const directory = fileURLToPath(new URL('../runs/windows-build/', import.meta.url)); mkdirSync(directory, { recursive: true });
  const framework = `${process.env.WINDIR}\\Microsoft.NET\\Framework64\\v4.0.30319`;
  const executable = resolve(directory, 'ActStrideDesktopLab.exe');
  execFileSync(`${framework}\\csc.exe`, ['/nologo', '/target:exe', `/out:${executable}`,
    '/r:System.Windows.Forms.dll', '/r:System.Drawing.dll', '/r:System.Web.Extensions.dll',
    `/r:${framework}\\WPF\\UIAutomationClient.dll`, `/r:${framework}\\WPF\\UIAutomationTypes.dll`, `/r:${framework}\\WPF\\WindowsBase.dll`,
    fileURLToPath(new URL('DesktopLab.cs', import.meta.url))], { windowsHide: true, encoding: 'utf8' });
  return executable;
}

export class WindowsLab {
  constructor(executable, scenario, receipt) {
    this.app = spawn(executable, ['fixture', scenario, resolve(receipt)], { windowsHide: false, stdio: 'ignore' });
    this.driver = spawn(executable, ['driver', String(this.app.pid)], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    this.pending = null; this.error = '';
    this.driver.stderr.on('data', b => { this.error += b; });
    createInterface({ input: this.driver.stdout }).on('line', line => {
      const pending = this.pending; this.pending = null;
      if (!pending) return;
      clearTimeout(pending.timer);
      try { const result = JSON.parse(line); if (!result.ok) throw Error(result.error); pending.resolve(result); }
      catch (error) { pending.reject(error); }
    });
    this.driver.on('exit', () => { if (this.pending) { clearTimeout(this.pending.timer); this.pending.reject(Error(`UIA driver exited: ${this.error}`)); this.pending = null; } });
    this.app.on('error', error => { this.error = error.message; });
    this.driver.on('error', error => { this.error = error.message; });
  }
  request(input) {
    if (this.pending || this.stopped || this.driver.exitCode !== null) throw Error('UIA driver unavailable or busy');
    return new Promise((resolveRequest, reject) => {
      const timer = setTimeout(() => { this.stopped = true; this.pending = null; reject(Error('UIA operation timeout; no retry')); }, 10000);
      this.pending = { resolve: resolveRequest, reject, timer };
      this.driver.stdin.write(JSON.stringify(input) + '\n');
    });
  }
  observe() { return this.request({ op: 'observe' }); }
  async waitFor(predicate, timeout = 3000) {
    const end = Date.now() + timeout;
    do {
      const state = await this.observe(); if (predicate(state)) return state;
      await new Promise(r => setTimeout(r, 40));
    } while (Date.now() < end);
    throw Error('Expected UI state was not observed');
  }
  async act(state, { action, reference, value }) {
    return this.request({ op: 'act', revision: state.revision, reference, action, ...(value === undefined ? {} : { value }) });
  }
  capture(path) { return this.request({ op: 'capture', path: resolve(path) }); }
  async close() {
    // Only the disposable fixture process and driver launched by this instance.
    this.driver.stdin.end(); this.driver.kill(); this.app.kill();
    await Promise.all([this.driver, this.app].map(child => child.exitCode !== null ? undefined : new Promise(r => child.once('exit', r))));
  }
}

export function control(state, name, type) {
  const matches = state.controls.filter(c => c.name === name && c.type === type && c.enabled);
  if (matches.length !== 1) throw Error(`Expected one enabled ${type} named ${name}, got ${matches.length}`);
  return matches[0];
}

export async function fillField(lab, state, name, value) {
  const target = control(state, name, 'edit');
  if (target.value === value) return state;
  await lab.act(state, { action: 'fill', reference: target.reference, value });
  return lab.waitFor(s => s.controls.some(c => c.name === name && c.type === 'edit' && c.value === value));
}

export async function formSkill(lab, initial, fields, record = () => {}) {
  let state = initial;
  const edits = state.controls.filter(c => c.type === 'edit' && c.enabled);
  if (edits.length !== fields.length || new Set(fields.map(f => f.name)).size !== fields.length) throw Error('Skill field schema changed');
  for (const field of fields) {
    const started = Date.now(); state = await fillField(lab, state, field.name, field.value);
    record({ action: 'fill', name: field.name, elapsed_ms: Date.now() - started });
  }
  await lab.act(state, { action: 'invoke', reference: control(state, 'Review', 'button').reference });
  state = await lab.waitFor(s => s.controls.some(c => c.name === 'Confirm' && c.enabled)); record({ action: 'invoke', name: 'Review' });
  const review = state.controls.filter(c => c.type === 'text' && c.name.startsWith('Review: '));
  const actual = review[0]?.name.slice('Review: '.length).split('; ').sort();
  const expected = fields.map(f => `${f.name}=${f.value}`).sort();
  if (review.length !== 1 || JSON.stringify(actual) !== JSON.stringify(expected)) throw Error('Confirmation content differs from bound fields');
  await lab.act(state, { action: 'invoke', reference: control(state, 'Confirm', 'button').reference });
  state = await lab.waitFor(s => s.controls.some(c => c.name === 'Result: PASS' || c.name === 'Result: FAIL'));
  record({ action: 'invoke', name: 'Confirm' }); return state;
}
