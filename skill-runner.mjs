import { observe, execute, verify } from './browser.mjs';
import { skillCandidate, validateBinding } from './skills.mjs';

function unique(controls, predicate, purpose) {
  const matches = controls.filter(predicate);
  if (matches.length !== 1) throw Error(`${purpose}: expected one control, found ${matches.length}`);
  return matches[0];
}
const named = (tag, label) => c => c.tag === tag && c.label === label;
const tokens = text => text.trim().split(/\s+/);

// Finite, auditable workflows; no eval, hidden answers, selectors or saved coordinates.
export async function runSkill(page, binding, { record = () => {}, signal } = {}) {
  validateBinding(binding);
  const started = Date.now(), trace = [];
  let title;
  const snapshot = async () => {
    if (signal?.aborted) throw Error('Skill cancelled');
    const { ui } = await observe(page);
    title ??= ui.title;
    if (ui.title !== title) throw Error('Page scope changed; return to planner');
    if (ui.error || ui.busy) throw Error(ui.error || 'Page busy; return to planner');
    return ui;
  };
  const act = async (predicate, action, purpose) => {
    const ui = await snapshot(), c = unique(ui.controls, predicate, purpose);
    const step = { ...action, ref: c.ref, revision: c.revision, reason: purpose };
    await execute(page, step);
    const entry = { step: trace.length + 1, action: step, target: { label: c.label, context: c.context }, elapsed_ms: Date.now() - started };
    trace.push(entry); record({ event: 'skill_step', skill_id: binding.id, ...entry });
    const after = await snapshot();
    if (['fill', 'select'].includes(action.action)) {
      const target = after.controls.find(item => item.ref === c.ref);
      if (!target || target.value !== (action.text ?? action.value)) throw Error(`${purpose}: value did not persist`);
    }
    return after;
  };
  const click = (label, purpose = label) => act(named('button', label), { action: 'click' }, purpose);
  const select = async (label, value) => {
    const ui = await snapshot(), c = unique(ui.controls, named('select', label), label);
    const options = c.options.filter(o => !o.disabled && o.label === value);
    if (options.length !== 1) throw Error(`${label}: requested option is missing or ambiguous`);
    return act(named('select', label), { action: 'select', value: options[0].value }, `Set ${label}=${value}`);
  };
  const confirm = async (expected) => {
    const ui = await snapshot();
    if (!ui.modal || ui.modalControlCount !== 2 || ui.controls.length !== 2 || !ui.controls.every(c => c.tag === 'button' && ['返回修改', '确认保存'].includes(c.label)) || !ui.text.split('\n').some(line => line.trim() === expected)) throw Error('Confirmation changed or summary differs; return to planner');
    await click('确认保存');
  };
  record({ event: 'skill_start', binding, version: 1 });
  try {
    if (!skillCandidate(await snapshot(), binding)) throw Error('Skill precondition does not match current page');
    const p = binding.params;
    if (binding.id === 'assign_ticket') {
      const ui = await snapshot();
      const target = unique(ui.controls, c => c.tag === 'button' && /^打开 /.test(c.label) && [p.department, p.priority].every(t => tokens(c.context).includes(t)), 'Find ticket');
      const ticket = target.label.slice(3);
      await click(target.label);
      await select('负责人', p.owner);
      await click('分派工单');
      await confirm(`${ticket} 分派给 ${p.owner}`);
    } else if (binding.id === 'book_room') {
      const ui = await snapshot();
      const target = unique(ui.controls, c => c.tag === 'button' && /^选择 /.test(c.label) && [p.day, p.period, '可用'].every(t => tokens(c.context).includes(t)) && Number(c.context.match(/容量\s+(\d+)\s+人/)?.[1]) >= p.capacity, 'Find room');
      const room = target.label.slice(3);
      await click(target.label);
      await act(named('input', '申请人'), { action: 'fill', text: p.name }, 'Fill applicant');
      await click('预约并核对');
      await confirm(`已选：${room} · ${p.day} · ${p.period} · 申请人 ${p.name}`);
    } else {
      let ui = await snapshot();
      if (!ui.controls.some(named('button', '邮件通知'))) ui = await click('通知设置');
      for (const [label, value] of [['邮件通知', p.email], ['短信通知', p.sms]]) {
        const c = unique(ui.controls, named('button', label), label);
        if (!['true', 'false'].includes(c.pressed)) throw Error(`${label}: missing toggle state`);
        if (c.pressed !== String(value)) ui = await click(label);
        if (unique(ui.controls, named('button', label), label).pressed !== String(value)) throw Error(`${label}: toggle did not persist`);
      }
      await select('时区', p.zone);
      await click('保存通知设置');
      await confirm(`邮件${p.email ? '开启' : '关闭'}，短信${p.sms ? '开启' : '关闭'}，时区${p.zone}`);
    }
    // Independent verifier is used only after execution, never for skill selection.
    const result = await verify(page);
    if (!result.passed) throw Error('Independent verifier rejected skill result');
    const outcome = { ok: true, replan: false, detail: 'Skill completed and independently verified', steps: trace.length };
    record({ event: 'skill_result', binding, version: 1, ...outcome, elapsed_ms: Date.now() - started });
    return outcome;
  } catch (error) {
    const outcome = { ok: false, replan: true, detail: error.message, steps: trace.length };
    record({ event: 'skill_result', binding, version: 1, ...outcome, elapsed_ms: Date.now() - started });
    return outcome;
  }
}
