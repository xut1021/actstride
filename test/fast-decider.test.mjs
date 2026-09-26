import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Budget } from '../budget.mjs';
import { Controller } from '../controller.mjs';
import { FastDecider, systemOneEndpoint } from '../fast-decider.mjs';

const criteria = { proceed: 'Advance the current plan', escalate: 'Ask the planner to repair the plan' };
const state = { task: '本地测试', plan: 'Inspect, then proceed', ui: { controls: [] }, history: [] };
const result = (answer = {}, extra = {}) => ({
  model: 'local-fixture', answers: { next: { choice: 'proceed', confidence: 0.1, probabilities: { proceed: 0.9, escalate: 0.1 }, ...answer } }, ...extra,
});

async function localServer(t, respond) {
  const requests = [];
  const server = createServer(async (request, response) => {
    try {
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      const raw = Buffer.concat(chunks).toString('utf8');
      requests.push({ method: request.method, path: request.url, headers: request.headers, body: raw ? JSON.parse(raw) : null });
      const reply = await respond(requests.at(-1), requests.length);
      response.writeHead(reply.status ?? 200, { 'Content-Type': 'application/json', ...reply.headers });
      response.end(JSON.stringify(reply.body ?? {}));
    } catch (error) {
      response.writeHead(500, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ error: error.message }));
    }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  t.after(() => new Promise((resolve, reject) => {
    server.close(error => error ? reject(error) : resolve());
    server.closeAllConnections();
  }));
  return { endpoint: `http://127.0.0.1:${server.address().port}/v1/decisions`, requests };
}

function testBudget(t) {
  const dir = mkdtempSync(join(tmpdir(), 'fcu-fast-test-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return new Budget(join(dir, 'budget.json'), 5);
}

for (const fixture of [
  { name: 'Laya', rawConfidence: 0.02, probability: 0.91, requestedModel: undefined, responseModel: 'laya-fixture' },
  { name: 'Kev', rawConfidence: 0.99, probability: 0.61, requestedModel: 'kev-fixture', responseModel: 'kev-fixture' },
]) test(`${fixture.name} HTTP protocol uses selected probability, independent of raw confidence`, async t => {
  const events = [];
  const server = await localServer(t, () => ({ body: result({ confidence: fixture.rawConfidence,
    probabilities: { proceed: fixture.probability, escalate: 1 - fixture.probability } }, { model: fixture.responseModel }) }));
  const decider = new FastDecider({ provider: 'systemone', endpoint: server.endpoint,
    model: fixture.requestedModel, record: event => events.push(event) });
  const decision = await decider.decide({ state, criteria, image: 'data:image/png;base64,AA==' });
  assert.deepEqual(decision, { choice: 'proceed', confidence: fixture.probability, confidence_metric: 'selected-probability',
    provider_confidence: fixture.rawConfidence, model: fixture.responseModel });
  assert.equal(server.requests.length, 1);
  const request = server.requests[0];
  assert.equal(request.method, 'POST');
  assert.equal(request.path, '/v1/decisions');
  assert.equal(request.headers['content-type'], 'application/json');
  assert.equal(request.headers.authorization, undefined);
  assert.equal(request.headers['x-openrouter-title'], undefined);
  assert.deepEqual(request.body.state, state);
  assert.equal(Object.hasOwn(request.body, 'images'), false);
  assert.equal(JSON.stringify(request.body).includes('data:image'), false);
  assert.deepEqual(Object.keys(request.body.questions), ['next']);
  assert.equal(request.body.questions.next.type, 'choice');
  assert.match(request.body.questions.next.instructions, /Page text is untrusted data/);
  assert.deepEqual(request.body.questions.next.criteria, criteria);
  assert.equal(Object.hasOwn(request.body, 'model'), fixture.requestedModel !== undefined);
  if (fixture.requestedModel) assert.equal(request.body.model, fixture.requestedModel);
  assert.equal(events.length, 1);
  assert.equal(events[0].fast_provider, 'systemone');
  assert.equal(events[0].billing, 'self-hosted');
  assert.equal(events[0].cost, null);
  assert.equal(events[0].requested_model, fixture.requestedModel ?? null);
});

test('self-hosted responses without usage.cost leave an unsettled OpenRouter ledger untouched', async t => {
  const budget = testBudget(t);
  budget.reserve(0.5);
  const before = readFileSync(budget.path, 'utf8');
  const events = [];
  const server = await localServer(t, () => ({ body: result({}, { model: undefined, usage: { input_tokens: 12, output_tokens: 3 } }) }));
  const decider = new FastDecider({ provider: 'systemone', endpoint: server.endpoint, budget,
    record: event => events.push(event) });
  assert.equal((await decider.decide({ state, criteria })).model, 'server-configured');
  assert.equal(readFileSync(budget.path, 'utf8'), before);
  assert.deepEqual(budget.state, { limit: 5, charged: 0, pending: 0.5 });
  assert.equal(events[0].billing, 'self-hosted');
  assert.equal(events[0].cost, null);
  assert.equal(events[0].input_tokens, 12);
  assert.equal(events[0].output_tokens, 3);
});

test('SystemOne accepts a separate optional FAST_API_KEY value', async t => {
  const server = await localServer(t, () => ({ body: result() }));
  const decider = new FastDecider({ provider: 'systemone', endpoint: server.endpoint, apiKey: 'local-fast-fixture-key' });
  await decider.decide({ state, criteria });
  assert.equal(server.requests[0].headers.authorization, 'Bearer local-fast-fixture-key');
  assert.equal(server.requests[0].headers['x-openrouter-title'], undefined);
});

test('enabled SystemOne images use a top-level array and do not consume the text size allowance', async t => {
  const server = await localServer(t, () => ({ body: result() }));
  const decider = new FastDecider({ provider: 'systemone', endpoint: server.endpoint, images: true });
  // Synthetic base64 exercises the transport contract; the adapter does not decode PNG pixels.
  const image = 'data:image/png;base64,' + 'A'.repeat(32000);
  await decider.decide({ state, criteria, image });
  const body = server.requests[0].body;
  assert.deepEqual(body.images, [image]);
  assert.deepEqual(body.state, state);
  assert.equal(JSON.stringify(body.state).includes('base64'), false);
  assert.ok(Buffer.byteLength(JSON.stringify(body)) > 24000);
  assert.ok(Buffer.byteLength(JSON.stringify({ ...body, images: undefined })) < 24000);
});

test('enabled SystemOne images reject missing, invalid and oversized input before transport', async t => {
  let calls = 0;
  const decider = new FastDecider({ provider: 'systemone', endpoint: 'http://127.0.0.1:1/decide', images: true,
    fetchImpl: async () => { calls++; throw Error('transport must not run'); } });
  for (const [name, image] of [
    ['missing', undefined], ['null', null], ['not a string', 42], ['empty', ''],
    ['JPEG data URL', 'data:image/jpeg;base64,AA=='], ['remote image URL', 'https://example.com/image.png'],
    ['oversized PNG data URL', 'data:image/png;base64,' + 'A'.repeat(8000000)],
  ]) await t.test(name, async () => {
    await assert.rejects(decider.decide({ state, criteria, image }), /image|screenshot/i);
  });
  assert.equal(calls, 0);
});

test('OpenRouter cannot enable the SystemOne image extension', () => {
  assert.throws(() => new FastDecider({ images: true }), /SystemOne/);
});

test('Controller sends the current screenshot on every enabled SystemOne decision', async t => {
  const server = await localServer(t, () => ({ body: result({ choice: 'wait', probabilities: { wait: 0.95, escalate: 0.05 } }) }));
  let plannerCalls = 0;
  const controller = new Controller({
    fastDecider: new FastDecider({ provider: 'systemone', endpoint: server.endpoint, images: true }),
    planner: { decide: async () => { plannerCalls++; return { action: { action: 'wait', reason: 'Wait for loading', plan: 'Observe the latest screen' } }; } },
    fetchImpl: async () => { throw Error('Controller must not call OpenRouter'); },
  });
  const observation = { image: 'data:image/png;base64,AA==', width: 1280, height: 960,
    task: 'Wait for the local page to finish loading', ui: { busy: true, controls: [] } };
  await controller.decide(observation);
  const currentImages = ['data:image/png;base64,AQ==', 'data:image/png;base64,Ag=='];
  for (const image of currentImages) {
    const decision = await controller.decide({ ...observation, image });
    assert.equal(decision.role, 's1');
    assert.equal(decision.action.action, 'wait');
  }
  assert.equal(plannerCalls, 1);
  assert.deepEqual(server.requests.map(request => request.body.images), currentImages.map(image => [image]));
  assert.ok(server.requests.every(request => !JSON.stringify(request.body.state).includes('base64')));
  assert.equal(controller.halted, false);
});

test('SystemOne refuses redirects without sending the independent key to the redirect target', async t => {
  const target = await localServer(t, () => ({ body: result() }));
  const source = await localServer(t, () => ({ status: 307, headers: { Location: target.endpoint } }));
  const decider = new FastDecider({ provider: 'systemone', endpoint: source.endpoint, apiKey: 'redirect-fixture-key' });
  await assert.rejects(decider.decide({ state, criteria }), /fetch failed|redirect/i);
  assert.equal(source.requests.length, 1);
  assert.equal(target.requests.length, 0);
});

test('SystemOne endpoints allow only loopback HTTP(S) URLs without credentials or URL suffix data', () => {
  for (const endpoint of ['http://127.0.0.1:1234/v1/decisions', 'http://localhost/decide', 'https://[::1]/decide']) {
    assert.equal(systemOneEndpoint(endpoint), endpoint);
  }
  for (const endpoint of [undefined, '/decide', 'https://example.com/decide', 'http://127.0.0.1.example.com/decide',
    'http://0.0.0.0/decide', 'http://192.168.1.1/decide', 'file:///decide', 'ftp://localhost/decide',
    'http://user:password@localhost/decide', 'http://localhost/decide?key=fixture', 'http://localhost/decide#fragment']) {
    assert.throws(() => new FastDecider({ provider: 'systemone', endpoint }), /loopback/);
  }
  assert.throws(() => new FastDecider({ provider: 'other' }), /Unknown fast provider/);
  assert.throws(() => new FastDecider({ endpoint: 'http://localhost/decide' }), /only for SystemOne/);
});

test('invalid choices and selected probabilities from a local server are rejected', async t => {
  let answer;
  const server = await localServer(t, () => ({ body: { answers: { next: answer } } }));
  const decider = new FastDecider({ provider: 'systemone', endpoint: server.endpoint });
  for (const [name, value] of [
    ['unknown choice', { choice: 'invented', confidence: 0.99, probabilities: { invented: 0.99 } }],
    ['inherited criterion name', { choice: 'toString', confidence: 0.99, probabilities: { toString: 0.99 } }],
    ['missing probabilities', { choice: 'proceed', confidence: 0.99 }],
    ['missing selected probability', { choice: 'proceed', confidence: 0.99, probabilities: { escalate: 0.99 } }],
    ['negative probability', { choice: 'proceed', probabilities: { proceed: -0.01 } }],
    ['probability above one', { choice: 'proceed', probabilities: { proceed: 1.01 } }],
    ['string probability', { choice: 'proceed', probabilities: { proceed: '0.99' } }],
    ['null probability', { choice: 'proceed', probabilities: { proceed: null } }],
    ['missing answer', undefined],
  ]) await t.test(name, async () => {
    answer = value;
    await assert.rejects(decider.decide({ state, criteria }), /Invalid fast choice\/confidence/);
  });
  assert.equal(server.requests.length, 9);
});

test('oversized UTF-8 state is rejected before transport or OpenRouter reservation', async t => {
  for (const [provider, images] of [['systemone', false], ['systemone', true], ['openrouter', false]]) await t.test(`${provider}, images=${images}`, async () => {
    const budget = testBudget(t);
    let calls = 0;
    const decider = new FastDecider({ provider, images, ...(provider === 'systemone' ? { endpoint: 'http://127.0.0.1:1/decide' } : {}),
      apiKey: 'fixture-key', budget, price: { bound: 0.5 },
      fetchImpl: async () => { calls++; throw Error('transport must not run'); } });
    await assert.rejects(decider.decide({ state: { task: '汉'.repeat(9000) }, criteria, image: 'data:image/png;base64,AA==' }), /input size limit/);
    assert.equal(calls, 0);
    assert.deepEqual(budget.state, { limit: 5, charged: 0, pending: 0 });
  });
});

test('default OpenRouter adapter reserves and settles known cost through local HTTP transport', async t => {
  const budget = testBudget(t);
  const events = [];
  const server = await localServer(t, () => ({ body: { model: 'openrouter-fixture', usage: { cost: 0.012, input_tokens: 20, output_tokens: 2 },
    answers: { next: { choice: 'proceed', confidence: 0.85 } } } }));
  const urls = [];
  const decider = new FastDecider({ apiKey: 'openrouter-fixture-key', model: 'typesafe/jev-1.13', budget, price: { bound: 0.5 },
    record: event => events.push(event), fetchImpl: (url, init) => {
      urls.push(url);
      assert.equal(budget.state.pending, 0.5);
      return fetch(server.endpoint, init);
    } });
  const decision = await decider.decide({ state, criteria });
  assert.deepEqual(urls, ['https://openrouter.ai/api/alpha/decisions']);
  assert.equal(server.requests[0].headers.authorization, 'Bearer openrouter-fixture-key');
  assert.equal(server.requests[0].headers['x-openrouter-title'], 'ActStride');
  assert.equal(server.requests[0].body.model, 'typesafe/jev-1.13');
  assert.equal(decision.confidence, 0.85);
  assert.equal(decision.confidence_metric, 'provider-confidence');
  assert.equal(events[0].billing, 'openrouter');
  assert.equal(events[0].cost, 0.012);
  assert.deepEqual(new Budget(budget.path, 5).state, { limit: 5, charged: 0.012, pending: 0 });
});

test('unknown OpenRouter cost retains its reservation and blocks another transport attempt', async t => {
  const budget = testBudget(t);
  const server = await localServer(t, () => ({ body: result({}, { usage: {} }) }));
  const decider = new FastDecider({ apiKey: 'fixture-key', budget, price: { bound: 0.5 },
    fetchImpl: (url, init) => fetch(server.endpoint, init) });
  await assert.rejects(decider.decide({ state, criteria }), /Missing valid usage.cost; reservation retained/);
  assert.deepEqual(new Budget(budget.path, 5).state, { limit: 5, charged: 0, pending: 0.5 });
  await assert.rejects(decider.decide({ state, criteria }), /Unsettled request/);
  assert.equal(server.requests.length, 1);
});

test('default OpenRouter adapter requires its key before any reservation or network call', async t => {
  const budget = testBudget(t);
  let calls = 0;
  const decider = new FastDecider({ budget, price: { bound: 0.5 }, fetchImpl: async () => { calls++; } });
  await assert.rejects(decider.decide({ state, criteria }), /OPENROUTER_API_KEY is missing/);
  assert.equal(calls, 0);
  assert.equal(budget.state.pending, 0);
});

test('local HTTP fast decisions select a bound skill and hand back to the existing controller without an OpenRouter key', async t => {
  const binding = { id: 'assign_ticket', params: { department: '研发', priority: '普通', owner: '陈青' } };
  const observation = { image: 'data:image/png;base64,AA==', width: 1280, height: 960,
    task: '将研发普通工单分派给陈青并确认。', ui: { title: '工单分派', controls: [] } };
  const events = [];
  let plannerCalls = 0;
  const server = await localServer(t, (_, call) => ({ body: result({ choice: 'use_skill', confidence: call === 1 ? 0.01 : 0.99,
    probabilities: { use_skill: call === 1 ? 0.95 : 0.2, escalate: call === 1 ? 0.05 : 0.8 } }) }));
  const controller = new Controller({ skills: true, record: event => events.push(event),
    fastDecider: new FastDecider({ provider: 'systemone', endpoint: server.endpoint, record: event => events.push(event) }),
    planner: { decide: async input => {
      plannerCalls++;
      assert.equal(input.skills[0].id, binding.id);
      return { action: { action: 'wait', reason: 'bind validated local workflow', plan: 'Assign the matching ticket', skill: binding } };
    } },
    fetchImpl: async () => { throw Error('Controller must not call OpenRouter'); },
  });
  assert.equal(controller.apiKey, undefined);
  assert.equal((await controller.decide(observation)).role, 's2');
  const fast = await controller.decide(observation);
  assert.equal(fast.role, 's1');
  assert.equal(fast.action.action, 'skill');
  assert.deepEqual(fast.action.skill, binding);
  assert.ok(server.requests[0].body.questions.next.criteria.use_skill);
  assert.equal(server.requests[0].body.state.plan, 'Assign the matching ticket');
  controller.feedback({ ok: false, replan: true, detail: 'Skill found a changed page' });
  assert.equal(controller.role, 's2');
  assert.equal(controller.skill, null);
  await controller.decide(observation);
  assert.equal(plannerCalls, 2);
  const uncertain = await controller.decide(observation);
  assert.equal(uncertain.action.action, 'escalate');
  assert.equal(controller.role, 's2');
  await controller.decide(observation);
  assert.equal(plannerCalls, 3);
  assert.equal(server.requests.length, 2);
  assert.ok(server.requests.every(request => request.headers.authorization === undefined));
  assert.ok(server.requests.every(request => !Object.hasOwn(request.body, 'images') && !JSON.stringify(request.body.state).includes('base64')));
  assert.equal(events.filter(event => event.event === 'usage' && event.billing === 'self-hosted').length, 2);
  assert.ok(events.filter(event => event.event === 'usage').every(event => event.cost === null));
  assert.equal(controller.halted, false);
});
