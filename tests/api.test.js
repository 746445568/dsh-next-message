import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createConfigStore } from '../lib/config.js';
import { createApi } from '../lib/index.js';
import { fixture } from './helpers.js';
test('settings persist atomically, reject partial routes, and protect concurrent edits', () => {
  const dir = mkdtempSync(join(tmpdir(), 'next-message-'));
  try {
    const file = join(dir, 'config.json'), s = createConfigStore({ file });
    assert.throws(() => s.update({ provider: 'p' }), /model-pair/);
    s.update({ provider: 'p', model: 'm', timeoutMs: 20000 }, 0);
    assert.equal(JSON.parse(readFileSync(file)).timeoutMs, 10000);
    assert.throws(() => s.update({ enabled: false }, 0), /settings-conflict/);
    assert.equal(createConfigStore({ file }).snapshot().config.model, 'm');
    assert.throws(() => s.update({ enabled: 'yes' }), /invalid-config/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
test('RPC validates input; config and metrics contain no conversation or credentials', async () => {
  const f = fixture(), api = createApi(f.ctx, { settings: createConfigStore({ memory: true }) });
  assert.equal((await api.handle({ sessionId: 's' })).ok, false);
  assert.equal((await api.handle({ action: 'bogus', sessionId: 's', requestId: 'x' })).ok, false);
  const data = await api.handle({ action: 'config.get' }); assert.equal(data.ok, true); assert.equal(data.value.config.apiKey, undefined);
  await api.handle({ sessionId: 's', requestId: 'a' }); const status = await api.handle({ action: 'status' }); assert.equal(status.value.requests, 1); assert.doesNotMatch(JSON.stringify(status), /请修复|运行一下/); api.predictor.dispose();
});
