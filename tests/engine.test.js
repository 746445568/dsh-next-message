import test from 'node:test';
import assert from 'node:assert/strict';
import { createConfigStore } from '../lib/config.js';
import { createPredictor, completedRevision, resolveSession } from '../lib/engine.js';
import { fixture, completed, user, assistant, tick } from './helpers.js';
const settings = initial => createConfigStore({ memory: true, initial });
test('single-flight and cached completed turns make only one model call', async () => {
  const f = fixture(), p = createPredictor(f.ctx, settings());
  const [a, b] = await Promise.all([p.predict('s', 'a'), p.predict('s', 'b')]);
  assert.equal(a.suggestion, '运行一下测试。'); assert.deepEqual(a, b); await p.predict('s', 'c'); assert.equal(f.calls.length, 1); p.dispose();
});
test('explicit route overrides the session; otherwise use this conversation, not global default', async () => {
  for (const override of [false, true]) {
    const f = fixture(); f.ctx.agentDefaultModel = { currentSelection: () => ({ provider: 'wrong', model: 'wrong' }) };
    const p = createPredictor(f.ctx, settings(override ? { provider: 'separate', model: 'fast' } : {})); await p.predict('s', 'a');
    assert.equal(f.calls[0].model, override ? 'fast' : 'current-chat'); p.dispose();
  }
});
test('prepareCall selects an advertised minimum reasoning effort', async () => {
  const f = fixture(); let selected;
  f.ctx.llm.prepareCall = async (base, signal, configure) => {
    selected = configure(base, { reasoning: { efforts: [{ id: 'high' }, { id: 'off' }] } });
    return { config: selected, stream: f.ctx.llm.stream.bind(f.ctx.llm) };
  };
  const p = createPredictor(f.ctx, settings()); await p.predict('s', 'a'); assert.equal(selected.reasoningEffort, 'off'); assert.equal(f.calls[0].tools, undefined); p.dispose();
});
for (const kind of ['error', 'aborted', 'max-tokens', 'tool-calls', undefined]) test(`partial text is never accepted after ${kind || 'missing finish'}`, async () => {
  const f = fixture(async function* () { yield { type: 'text-delta', text: '{"suggestion":"运行一下测试。"}' }; if (kind) yield { type: 'finish', reason: { kind } }; });
  const p = createPredictor(f.ctx, settings()); assert.equal((await p.predict('s', 'a')).suggestion, ''); p.dispose();
});
test('a new turn invalidates an already pending response', async () => {
  let resolve;
  const f = fixture(async function* () { await new Promise(r => { resolve = r; }); yield { type: 'text-delta', text: '{"suggestion":"运行一下测试。"}' }; yield { type: 'finish', reason: { kind: 'stop' } }; });
  const p = createPredictor(f.ctx, settings()); const pending = p.predict('s', 'a'); await tick();
  p.observe(f.session, { type: 'turn/start' }); assert.equal((await pending).suggestion, ''); resolve(); p.dispose();
});
test('client cancellation reaches inference and does not retry this turn', async () => {
  let observed = false;
  const f = fixture(async function* (o) { await new Promise(r => o.signal.addEventListener('abort', () => { observed = true; r(); }, { once: true })); yield { type: 'finish', reason: { kind: 'aborted' } }; });
  const p = createPredictor(f.ctx, settings()), abort = new AbortController(); const pending = p.predict('s', 'a', abort.signal); await tick(); abort.abort();
  await pending; await p.predict('s', 'b'); assert.equal(f.calls.length, 1); assert.equal(observed, true); p.dispose();
});
test('one disconnected subscriber does not cancel another subscriber', async () => {
  let release;
  const f = fixture(async function* () { await new Promise(r => { release = r; }); yield { type: 'text-delta', text: '{"suggestion":"运行一下测试。"}' }; yield { type: 'finish', reason: { kind: 'stop' } }; });
  const p = createPredictor(f.ctx, settings()), abort = new AbortController();
  const a = p.predict('s', 'a', abort.signal), b = p.predict('s', 'b'); await tick(); abort.abort(); release();
  assert.equal((await a).suggestion, ''); assert.equal((await b).suggestion, '运行一下测试。'); assert.equal(f.calls.length, 1); p.dispose();
});
test('timeout settles even if a provider ignores cancellation', async () => {
  const f = fixture(async function* () { await new Promise(() => {}); });
  const p = createPredictor(f.ctx, settings({ timeoutMs: 1000 })), start = Date.now();
  const result = await p.predict('s', 'a'); assert.equal(result.suggestion, ''); assert.equal(result.reason, 'timeout'); assert.ok(Date.now() - start < 1500); p.dispose();
});
test('failed, active and not-yet-started user turns are ineligible', () => {
  assert.equal(completedRevision([completed(), { type: 'turn/start' }]), null);
  assert.equal(completedRevision([completed(), { type: 'user/message', data: user('新任务') }]), null);
  assert.equal(completedRevision([{ ...completed(), data: { turn: 1, reason: { kind: 'error' } } }]), null);
});
test('changed transcript invalidates a cached surface', async () => {
  const f = fixture(), p = createPredictor(f.ctx, settings()); await p.predict('s', 'a');
  f.setMessages([user('只解释，不运行。'), assistant('好的，解释如下。')]); await p.predict('s', 'b'); assert.equal(f.calls.length, 2); p.dispose();
});
test('missing model, missing session and disabled setting never call inference', async () => {
  const f = fixture(); f.session.requestContext = () => undefined;
  for (const config of [{}, { enabled: false }]) {
    const p = createPredictor(f.ctx, settings(config)); assert.equal((await p.predict('s', 'a')).suggestion, ''); await p.predict('unknown', 'b'); p.dispose();
  }
  assert.equal(f.calls.length, 0);
});
test('cold session uses its current surface and logged route, excluding replaced raw history', async () => {
  const ctx = { sessions: { get: () => undefined }, sessionQuery: {
    readSession: async () => ({ events: [{ type: 'request/context', data: { provider: 'cold', model: 'logged' } }, { type: 'user/message', data: user('obsolete raw instruction') }, completed()] }),
    readSurface: async () => ({ events: [{ type: 'user/message', data: user('current surface') }, { type: 'assistant/message', data: { message: assistant('surface answer') } }] }),
  } };
  const session = await resolveSession(ctx, 'cold');
  assert.doesNotMatch(JSON.stringify(session.deriveMessages()), /obsolete/);
  assert.match(JSON.stringify(session.deriveMessages()), /current surface/);
  assert.equal(session.requestContext().model, 'logged');
});
test('a changed surface while inference is pending cannot produce a stale offer', async () => {
  let release;
  const f = fixture(async function* () { await new Promise(r => { release = r; }); yield { type: 'text-delta', text: '{"suggestion":"运行一下测试。"}' }; yield { type: 'finish', reason: { kind: 'stop' } }; });
  const p = createPredictor(f.ctx, settings()), result = p.predict('s', 'a'); await tick();
  f.setMessages([user('现在只解释，不运行。'), assistant('已经改为解释。')]); release();
  assert.equal((await result).suggestion, ''); p.dispose();
});
test('provider token usage is accounted without retaining transcript text', async () => {
  const f = fixture(async function* () { yield { type: 'usage', usage: { inputTokens: 100, outputTokens: 12, cacheReadTokens: 40 } }; yield { type: 'text-delta', text: '{"suggestion":null}' }; yield { type: 'finish', reason: { kind: 'stop' } }; });
  const p = createPredictor(f.ctx, settings()); await p.predict('s', 'a');
  assert.equal(p.status().inputTokens, 100); assert.equal(p.status().cacheReadTokens, 40); assert.equal(p.status().usageReportedCalls, 1); p.dispose();
});
