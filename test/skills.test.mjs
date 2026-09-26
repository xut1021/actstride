import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openLab, observe, execute, verify } from '../browser.mjs';
import { runSkill } from '../skill-runner.mjs';
import { skillCandidate, skillCatalog, validateBinding } from '../skills.mjs';
import { Controller, validateAction } from '../controller.mjs';
import { scenarios } from '../scenarios.mjs';

const bindingFor = s => s.kind === 'tickets' ? { id: 'assign_ticket', params: { department: s.department, priority: s.priority, owner: s.owner } }
  : s.kind === 'booking' ? { id: 'book_room', params: { day: s.day, period: s.period, capacity: s.capacity, name: s.name } }
  : { id: 'notification_preferences', params: { email: s.email, sms: s.sms, zone: s.zone } };
// Test inputs only. The runtime skill modules never import scenarios or this file.
const holdouts = {
  skill_ticket_holdout: { kind: 'tickets', department: '研发', priority: '普通', owner: '陈青', task: '将研发普通工单分派给陈青并确认。' },
  skill_booking_holdout: { kind: 'booking', day: '周三', period: '下午', capacity: 11, name: '顾岚', task: '预约周三下午至少11人的房间，申请人顾岚，核对并确认。' },
  skill_settings_holdout: { kind: 'settings', email: true, sms: true, zone: '纽约', task: '开启邮件与短信通知，时区纽约，保存并确认。' },
};
Object.assign(scenarios, holdouts);
const options = scenario => ({ scenario, headless: true, channel: process.env.FCU_TEST_CHANNEL });

for (const [scenario, s] of Object.entries(scenarios).filter(([, s]) => s.kind)) test(`skill workflow ${scenario}: independent browser verification`, async () => {
  const { browser, page } = await openLab(options(scenario));
  try {
    if (holdouts[scenario]) {
      await page.addStyleTag({ content: 'header{margin-bottom:250px}.cards{grid-template-columns:1fr}' });
      await page.evaluate(() => {
        for (const root of document.querySelectorAll('tbody,.cards')) [...root.children].reverse().forEach(el => root.append(el));
      });
    }
    const events = [];
    const result = await runSkill(page, bindingFor(s), { record: e => events.push(e) });
    assert.equal(result.ok, true, result.detail);
    assert.equal((await verify(page)).passed, true);
    assert.ok(events.some(e => e.event === 'skill_step'));
    assert.equal(events.at(-1).event, 'skill_result');
    assert.equal(events.at(-1).ok, true);
  } finally { await browser.close(); }
});

test('control refs survive reordering, reject changed/replaced targets and old revisions', async () => {
  const { browser, page } = await openLab(options('tickets_a'));
  try {
    const initial = (await observe(page)).ui.controls.find(c => c.label === '打开 T-19');
    await page.evaluate(() => document.querySelector('tbody').prepend(document.querySelector('tbody').lastElementChild));
    const reordered = (await observe(page)).ui.controls.find(c => c.label === initial.label);
    assert.equal(reordered.ref, initial.ref);
    await execute(page, { action: 'click', ref: initial.ref, revision: initial.revision, reason: 'stable ref' });
    let owner = (await observe(page)).ui.controls.find(c => c.label === '负责人');
    const old = { action: 'select', ref: owner.ref, revision: owner.revision, value: '周宁', reason: 'stale' };
    await page.locator('#owner').selectOption('林禾');
    await assert.rejects(execute(page, old), /Stale/);
    await observe(page); // A fresh snapshot must not make an old action current again.
    await assert.rejects(execute(page, old), /Stale/);
    owner = (await observe(page)).ui.controls.find(c => c.label === '负责人');
    await page.locator('#owner').evaluate(el => el.replaceWith(el.cloneNode(true)));
    await assert.rejects(execute(page, { ...old, revision: owner.revision }), /Stale/);
    await page.reload(); await observe(page);
    await assert.rejects(execute(page, { action: 'click', ref: initial.ref, revision: initial.revision, reason: 'old document' }), /Stale/);
  } finally { await browser.close(); }
});

test('select rejects unavailable options; coordinate-free scroll and offscreen refs work', async () => {
  const { browser, page } = await openLab(options('settings_a'));
  try {
    await page.locator('#notifications').click();
    const zone = (await observe(page)).ui.controls.find(c => c.label === '时区');
    await assert.rejects(execute(page, { action: 'select', ref: zone.ref, revision: zone.revision, value: '不存在', reason: 'negative' }), /unavailable/);
    assert.equal(await page.locator('#zone').inputValue(), '纽约');
    await page.addStyleTag({ content: 'header{margin-bottom:1200px}' });
    validateAction({ action: 'scroll', dy: 480, reason: 'no coordinates' }, 1280, 960);
    await execute(page, { action: 'scroll', dy: 480, reason: 'no coordinates' });
    assert.ok(await page.evaluate(() => scrollY > 0));
    const shifted = (await observe(page)).ui.controls.find(c => c.label === '时区');
    await execute(page, { action: 'select', ref: shifted.ref, revision: shifted.revision, value: '上海', reason: 'offscreen' });
    assert.equal(await page.locator('#zone').inputValue(), '上海');
  } finally { await browser.close(); }
});

test('ambiguous target does not activate any step; unknown page offers no skills', async () => {
  const { browser, page } = await openLab(options('tickets_a'));
  try {
    await page.locator('tbody').evaluate(el => el.append(el.lastElementChild.cloneNode(true)));
    const result = await runSkill(page, bindingFor(scenarios.tickets_a));
    assert.equal(result.ok, false); assert.equal(result.replan, true); assert.equal(result.steps, 0);
    assert.match(result.detail, /found 2/);
    assert.equal((await verify(page)).passed, false);
    assert.deepEqual(skillCatalog({ title: '陌生页面', controls: [] }), []);
    assert.equal(skillCandidate({ title: '陌生页面', controls: [] }, bindingFor(scenarios.tickets_a)), null);
  } finally { await browser.close(); }
});

for (const change of ['extra-control', 'extra-password', 'extra-textarea', 'wrong-summary', 'occluded-confirm']) test(`changed dialog ${change} stops before confirmation`, async () => {
  const { browser, page } = await openLab(options('tickets_a'));
  try {
    await page.evaluate(change => {
      document.querySelector('#confirm').addEventListener('beforetoggle', event => {
        if (event.newState !== 'open') return;
        if (change === 'extra-control') document.querySelector('#summary').insertAdjacentHTML('afterend', '<input aria-label="新增必填项">');
        if (change === 'extra-password') document.querySelector('#summary').insertAdjacentHTML('afterend', '<input type="password" aria-label="新密码">');
        if (change === 'extra-textarea') document.querySelector('#summary').insertAdjacentHTML('afterend', '<textarea aria-label="新增备注"></textarea>');
        if (change === 'wrong-summary') document.querySelector('#summary').textContent = '错误的分派对象';
        if (change === 'occluded-confirm') document.querySelector('#confirm').insertAdjacentHTML('beforeend', '<div style="position:absolute;inset:0;background:white;z-index:99">遮挡</div>');
      });
    }, change);
    const result = await runSkill(page, bindingFor(scenarios.tickets_a));
    assert.equal(result.ok, false); assert.equal(result.replan, true);
    assert.equal((await verify(page)).passed, false);
    assert.equal(await page.locator('dialog[open]').count(), 1);
    if (change === 'extra-password') {
      await page.locator('input[type=password]').focus();
      assert.equal((await observe(page)).ui.focused, null);
    }
  } finally { await browser.close(); }
});

test('correct existing preferences are not toggled; wrong parameters fail independent verification', async () => {
  const { browser, page } = await openLab(options('settings_b'));
  try {
    await page.locator('#notifications').click();
    const events = [];
    assert.equal((await runSkill(page, bindingFor(scenarios.settings_b), { record: e => events.push(e) })).ok, true);
    assert.ok(!events.some(e => e.event === 'skill_step' && ['邮件通知', '短信通知'].includes(e.target.label)));
    await page.reload();
    const wrong = bindingFor(scenarios.settings_b); wrong.params.zone = '上海';
    assert.equal((await runSkill(page, wrong)).ok, false);
    assert.equal((await verify(page)).passed, false);
  } finally { await browser.close(); }
});

test('planner binding -> bounded Jev choice -> browser skill; failure feedback hands back to planner', async () => {
  const { browser, page } = await openLab(options('tickets_b'));
  try {
    let plannerCalls = 0, fastCalls = 0;
    const binding = bindingFor(scenarios.tickets_b);
    const controller = new Controller({ skills: true, apiKey: 'mock-not-sent', budget: { reserve() {}, settle() {} }, pricing: { s1: { bound: 1 } },
      planner: { decide: async observation => {
        plannerCalls++; assert.equal(observation.skills[0].id, binding.id);
        return { action: { action: 'wait', reason: 'bind', skill: binding } };
      } },
      fetchImpl: async (url, init) => {
        fastCalls++; assert.ok(JSON.parse(init.body).questions.next.criteria.use_skill);
        return { ok: true, json: async () => ({ usage: { cost: 0 }, answers: { next: { choice: 'use_skill', confidence: 0.99 } } }) };
      },
    });
    await controller.decide(await observe(page));
    const decision = await controller.decide(await observe(page));
    assert.equal(decision.role, 's1'); assert.equal(decision.action.action, 'skill');
    assert.equal((await runSkill(page, decision.action.skill)).ok, true);
    assert.equal(plannerCalls, 1); assert.equal(fastCalls, 1);
    controller.feedback({ ok: false, replan: true, detail: 'changed page' });
    assert.equal(controller.role, 's2'); assert.equal(controller.skill, null);
    await page.reload(); await controller.decide(await observe(page)); assert.equal(plannerCalls, 2);
  } finally { await browser.close(); }
});

test('disabled skills cannot leak planner binding into fast candidates; malformed parameters rejected', async () => {
  assert.throws(() => validateBinding({ id: 'assign_ticket', params: { owner: '林禾' } }), /parameters/);
  assert.throws(() => validateAction({ action: 'skill', reason: 'missing binding' }, 1280, 960), /binding/);
  let offered;
  const controller = new Controller({ apiKey: 'mock', budget: { reserve() {}, settle() {} }, pricing: { s1: { bound: 1 } },
    planner: { decide: async observation => {
      assert.deepEqual(observation.skills, []);
      return { action: { action: 'wait', reason: 'mock', skill: bindingFor(scenarios.tickets_a) } };
    } }, fetchImpl: async (url, init) => { offered = JSON.parse(init.body).questions.next.criteria; return { ok: true, json: async () => ({ usage: { cost: 0 }, answers: { next: { choice: 'escalate', confidence: 1 } } }) }; },
  });
  const state = { image: 'data:image/png;base64,AA==', task: 'mock', width: 1280, height: 960, ui: { title: '工单分派', controls: [] } };
  await controller.decide(state); await controller.decide(state);
  assert.equal(offered.use_skill, undefined);
});
