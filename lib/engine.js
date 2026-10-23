// Lifecycle and completed-turn single-flight are derived from Tieboyh/dsh-next-step (MIT).
import { createHash } from 'node:crypto';
import { selectContext, SYSTEM, parseSuggestion } from './context.js';

export function completedRevision(events) {
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i];
    if (e.type === 'turn/start' || (e.type === 'user/message' && (!e.data?.source?.kind || e.data.source.kind === 'user'))) return null;
    if (e.type === 'turn/end') return e.data?.reason?.kind === 'completed' ? `${e.data.turn}:${e.seq}` : null;
  }
  return null;
}
function terminalReason(e) { return e?.reason?.kind; }
function onAbort(signal, fn) { if (!signal) return () => {}; if (signal.aborted) { fn(); return () => {}; } signal.addEventListener('abort', fn, { once: true }); return () => signal.removeEventListener('abort', fn); }
export function untilAbort(promise, signal) {
  if (signal.aborted) return Promise.reject(signal.reason || new Error('cancelled'));
  return new Promise((resolve, reject) => {
    const off = onAbort(signal, () => reject(signal.reason || new Error('cancelled')));
    Promise.resolve(promise).then(resolve, reject).finally(off);
  });
}
export async function resolveSession(ctx, id) {
  const live = ctx.sessions.get(id);
  if (live) return live;
  // Read-only cold-session adapter; it never resumes a task.
  if (!ctx.sessionQuery?.readSession) return null;
  const raw = await ctx.sessionQuery.readSession(id);
  if (!Array.isArray(raw?.events)) return null;
  // Cold reads use the current model surface, not shadowed pre-compaction logs.
  if (!ctx.sessionQuery.readSurface) return null;
  const surface = await ctx.sessionQuery.readSurface(id);
  if (!Array.isArray(surface?.events)) return null;
  let messages;
  try {
    const { deriveEventMessage } = await import('@deepseek-ai/dsh-session/surface');
    messages = surface.events.map(e => deriveEventMessage(e)).filter(Boolean);
  } catch {
    messages = surface.events.flatMap(e => e.type === 'user/message' ? [e.data] : e.type === 'assistant/message' && e.data?.message?.content ? [e.data.message] : []);
  }
  const route = raw.events.findLast(e => e.type === 'request/context')?.data || raw.events.findLast(e => e.type === 'request/header')?.data?.config;
  return { id, snapshotEvents: () => raw.events, deriveMessages: () => messages, requestContext: () => route };
}
export function modelRoute(session, ctx, config) {
  if (config.provider && config.model) return { provider: config.provider, model: config.model };
  const route = session.requestContext?.() || session.requestHeader?.()?.config || ctx.agentDefaultModel?.currentSelection?.();
  return route?.provider && route?.model ? { provider: route.provider, model: route.model } : null;
}
export function createPredictor(ctx, settings) {
  const records = new Map();
  let disposed = false;
  const metrics = { requests: 0, cacheHits: 0, shown: 0, accepted: 0, dismissed: 0, empty: 0, cancelled: 0, failed: 0, totalMs: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, usageReportedCalls: 0, lastReason: 'ready' };
  const stamp = value => createHash('sha256').update(value).digest('hex').slice(0, 20);
  function invalidate(id) { const r = records.get(id); if (r) r.controller.abort(); records.delete(id); }
  async function generate(session, context, route, config, record) {
    const started = Date.now();
    const signal = record.controller.signal;
    const timer = setTimeout(() => record.controller.abort(new Error('timeout')), config.timeoutMs);
    metrics.requests++;
    let result;
    const run = async () => {
      let text = '', finish, usage;
      const base = { ...route, maxTokens: config.maxTokens };
      const content = { system: SYSTEM, messages: [{ role: 'user', content: [{ type: 'text', text: JSON.stringify(context) }] }], signal, sessionId: session.id, purpose: 'next-message' };
      let stream;
      if (typeof ctx.llm.prepareCall === 'function') {
        const prepared = await ctx.llm.prepareCall(base, signal, (controls, model) => {
          const efforts = model?.reasoning?.efforts || [];
          const least = efforts.find(e => /^(off|none|minimal)$/i.test(e.id)) || efforts[0];
          return least ? { ...controls, reasoningEffort: least.id } : controls;
        });
        signal.throwIfAborted();
        stream = prepared.stream({ ...prepared.config, ...content });
      } else {
        // Old adapters can explicitly advertise their cheapest effort in listModels.
        const catalog = typeof ctx.llm.listModels === 'function' ? await ctx.llm.listModels(route.provider) : [];
        const efforts = catalog.find(m => m.id === route.model)?.reasoning?.efforts || [];
        const least = efforts.find(e => /^(off|none|minimal)$/i.test(e.id)) || efforts[0];
        stream = ctx.llm.stream({ ...base, ...content, ...(least ? { reasoningEffort: least.id } : {}) });
      }
      for await (const chunk of stream) {
        signal.throwIfAborted();
        if (chunk.type === 'text-delta') text += chunk.text || '';
        if (/^tool-call/.test(chunk.type)) return { suggestion: '', reason: 'invalid-output' };
        if (chunk.type === 'finish') finish = terminalReason(chunk);
        if (chunk.type === 'usage') usage = chunk.usage;
        if (text.length > 4000) return { suggestion: '', reason: 'invalid-output' };
      }
      signal.throwIfAborted();
      if (usage) {
        metrics.usageReportedCalls++;
        for (const key of ['inputTokens', 'outputTokens', 'cacheReadTokens', 'cacheWriteTokens']) if (Number.isFinite(usage[key]) && usage[key] >= 0) metrics[key] += usage[key];
      }
      if (finish !== 'stop') return { suggestion: '', reason: finish === 'error' ? 'model-error' : 'incomplete-output' };
      const suggestion = parseSuggestion(text, context, config.maxChars);
      return { suggestion, reason: suggestion ? 'ready' : 'no-suggestion' };
    };
    try { result = await untilAbort(run(), signal); }
    catch { result = { suggestion: '', reason: signal.aborted ? signal.reason?.message === 'timeout' ? 'timeout' : 'cancelled' : 'model-error' }; }
    finally { clearTimeout(timer); }
    const elapsedMs = Date.now() - started;
    metrics.totalMs += elapsedMs;
    metrics.lastReason = result.reason;
    if (result.suggestion) metrics.shown++;
    else if (result.reason === 'no-suggestion') metrics.empty++;
    else if (result.reason === 'cancelled') metrics.cancelled++;
    else metrics.failed++;
    return { ...result, revision: record.revision, model: route.model, provider: route.provider, elapsedMs };
  }
  async function predict(id, requestId, callerSignal) {
    const { config, revision: settingsRevision } = settings.snapshot();
    const skip = reason => ({ suggestion: '', revision: null, reason });
    if (disposed || callerSignal?.aborted) return skip('cancelled');
    if (!config.enabled) return skip('disabled');
    const session = await resolveSession(ctx, id);
    if (!session || disposed || callerSignal?.aborted) return skip('no-context');
    const revision = completedRevision(session.snapshotEvents());
    if (!revision) return skip('unfinished-turn');
    const route = modelRoute(session, ctx, config);
    if (!route || !ctx.llm) return skip('missing-model');
    const context = selectContext(session.deriveMessages(), config.contextChars, config.language);
    if (!context) return skip('no-context');
    const key = `${revision}:${settingsRevision}:${route.provider}:${route.model}:${stamp(JSON.stringify(context))}`;
    let record = records.get(id);
    if (!record || record.key !== key) {
      invalidate(id);
      record = { key, revision, controller: new AbortController(), subscribers: new Set(), promise: null, settled: false };
      records.set(id, record);
      record.promise = generate(session, context, route, config, record).then(result => { record.settled = true; return result; });
      while (records.size > 80) invalidate(records.keys().next().value);
    } else metrics.cacheHits++;
    const subscriber = { id: requestId };
    record.subscribers.add(subscriber);
    const leave = () => {
      record.subscribers.delete(subscriber);
      if (!record.subscribers.size && !record.settled) record.controller.abort(new Error('cancelled'));
    };
    const off = onAbort(callerSignal, leave);
    try {
      const value = callerSignal ? await untilAbort(record.promise, callerSignal) : await record.promise;
      // A new turn, settings update, surface change, or unload invalidates old output.
      if (disposed || records.get(id) !== record || callerSignal?.aborted || completedRevision(session.snapshotEvents()) !== revision) return skip('cancelled');
      const currentContext = selectContext(session.deriveMessages(), config.contextChars, config.language);
      if (stamp(JSON.stringify(currentContext)) !== stamp(JSON.stringify(context))) return skip('cancelled');
      return value;
    } catch { return skip('cancelled'); }
    finally { off(); leave(); }
  }
  return {
    predict,
    cancel(id, requestId) {
      const r = records.get(id);
      if (!r || r.settled) return;
      for (const sub of r.subscribers) if (sub.id === requestId) r.subscribers.delete(sub);
      if (!r.subscribers.size) r.controller.abort(new Error('cancelled'));
    },
    observe(session, event) { if (event.type === 'turn/start' || event.type === 'user/message') invalidate(session.id); },
    invalidate,
    reset() { for (const id of records.keys()) invalidate(id); },
    feedback(kind) { if (kind === 'accepted' || kind === 'dismissed') metrics[kind]++; },
    status: () => ({ ...metrics, averageMs: metrics.requests ? Math.round(metrics.totalMs / metrics.requests) : 0 }),
    dispose() { disposed = true; this.reset(); },
  };
}
