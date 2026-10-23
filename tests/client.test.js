import test from 'node:test';
import assert from 'node:assert/strict';
import { createController } from '../lib/client-state.js';
import { tick } from './helpers.js';
function mount() {
  let readState = { sessionId: 's', running: false, phase: 'plain', draft: '', draftRev: 1 }, resolve;
  let id = 0; const calls = [], changes = [];
  const c = createController({ read: () => readState, makeId: () => `r${++id}`, changed: s => changes.push(s), rpc: (payload, signal) => {
    calls.push({ payload, signal });
    if (payload.action !== 'predict') return Promise.resolve({ ok: true });
    return new Promise(r => { resolve = r; });
  } });
  c.configure({ enabled: true }, 0);
  return { c, calls, changes, read: () => readState, change(next, update = true) { readState = { ...readState, ...next }; if (update) c.update(); }, offer: () => resolve({ ok: true, value: { suggestion: '运行一下测试。', revision: '1:4' } }) };
}
test('Tab acceptance only writes through a caller-provided guarded insertion', async () => {
  const m = mount(); await tick(); m.offer(); await tick(); let inserted;
  assert.equal(m.c.accept(text => { inserted = text; return true; }), true); assert.equal(inserted, '运行一下测试。');
  assert.equal(m.c.snapshot().text, ''); assert.equal(m.calls.filter(c => c.payload.action === 'feedback').length, 1); m.c.dispose();
});
test('rejected insertion preserves the gesture and does not claim success', async () => {
  const m = mount(); await tick(); m.offer(); await tick(); assert.equal(m.c.accept(() => false), false); m.c.dispose();
});
test('an edit returning to an empty draft before rendering still invalidates the offer', async () => {
  const m = mount(); await tick(); m.offer(); await tick(); m.change({ draftRev: 3 }, false); let inserted = false;
  assert.equal(m.c.accept(() => { inserted = true; return true; }), false); assert.equal(inserted, false); m.c.dispose();
});
test('late text cannot overwrite a new draft', async () => {
  const m = mount(); await tick(); m.change({ draft: '我的内容', draftRev: 2 }); m.offer(); await tick(); assert.equal(m.c.snapshot().text, '');
  assert.equal(m.calls[0].signal.aborted, true); assert.equal(m.read().draft, '我的内容'); m.c.dispose();
});
test('switching sessions rejects an older pending response', async () => {
  const m = mount(); await tick(); const old = m.offer; m.change({ sessionId: 'other' }); old(); await tick(); assert.equal(m.c.snapshot().text, ''); m.c.dispose();
});
test('Esc stays dismissed across draft edits within the same turn', async () => {
  const m = mount(); await tick(); m.offer(); await tick(); assert.equal(m.c.dismiss(), true);
  m.change({ draft: 'x', draftRev: 2 }); m.change({ draft: '', draftRev: 3 }); await tick(); assert.equal(m.calls.filter(c => c.payload.action === 'predict').length, 1); m.c.dispose();
});
for (const [title, changed] of Object.entries({ 'IME': { composing: true }, 'slash or reference menu': { menu: true }, 'foreign ghost plugin': { conflict: true }, 'attachments': { attachments: 1 }, 'references': { references: 1 }, 'queued message': { queue: 1 }, 'running turn': { running: true }, 'pending interaction': { pending: true }, 'locked phase': { phase: 'submitting' } })) test(`no offer or acceptance during ${title}`, async () => {
  const m = mount(); await tick(); m.offer(); await tick(); m.change(changed); assert.equal(m.c.snapshot().text, ''); assert.equal(m.c.accept(() => true), false); m.c.dispose();
});
test('new completed turn can request a fresh prediction', async () => {
  const m = mount(); await tick(); m.offer(); await tick(); m.change({ running: true }); m.change({ running: false }); await tick();
  assert.equal(m.calls.filter(c => c.payload.action === 'predict').length, 2); m.c.dispose();
});
test('disabling cancels pending inference and cannot resurrect a late offer', async () => {
  const m = mount(); await tick(); m.c.configure({ enabled: false }, 1); m.offer(); await tick(); assert.equal(m.c.snapshot().text, ''); assert.equal(m.c.snapshot().reason, 'disabled'); m.c.dispose();
});
