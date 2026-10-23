import { createConfigStore } from './config.js';
import { createPredictor } from './engine.js';
export const name = 'dsh-next-message';
export const inject = ['connection', 'sessions', 'llm'];
export const VERSION = '0.1.0';
const success = value => ({ ok: true, value });
const failure = code => ({ ok: false, error: { code: 'bad-request', message: code, details: {} } });
const knownErrors = new Set(['invalid-config', 'model-pair-required', 'settings-conflict']);

export function createApi(ctx, { settings = createConfigStore(), predictor = createPredictor(ctx, settings) } = {}) {
  return {
    predictor,
    async handle(payload = {}, signal) {
      const { action = 'predict', sessionId, requestId } = payload;
      if (action === 'config.get') return success(settings.snapshot());
      if (action === 'config.set') {
        try { const state = settings.update(payload.config, payload.expectedRevision); predictor.reset(); return success(state); }
        catch (error) { return failure(knownErrors.has(error.message) ? error.message : 'settings-write-failed'); }
      }
      if (action === 'status') return success({ version: VERSION, ...predictor.status() });
      if (action === 'catalog') {
        try {
          const providers = ctx.llm.listProviders().slice(0, 30);
          const rows = await Promise.all(providers.map(async p => {
            try { return { id: p.id, name: p.name || p.id, models: (await ctx.llm.listModels(p.id)).slice(0, 150).map(m => ({ id: m.id, name: m.name || m.id })) }; }
            catch { return { id: p.id, name: p.name || p.id, models: [] }; }
          }));
          return success(rows);
        } catch { return failure('catalog-unavailable'); }
      }
      if (action === 'feedback') { predictor.feedback(payload.kind); return success({}); }
      if (typeof sessionId !== 'string' || !sessionId || sessionId.length > 256 || typeof requestId !== 'string' || !requestId || requestId.length > 150) return failure('invalid-request');
      if (action === 'cancel') { predictor.cancel(sessionId, requestId); return success({}); }
      if (action !== 'predict') return failure('invalid-action');
      try { return success(await predictor.predict(sessionId, requestId, signal)); }
      catch { return success({ suggestion: '', revision: null, reason: 'host-error' }); }
    },
  };
}
export function apply(ctx, options = {}) {
  const settings = createConfigStore({ initial: options });
  const api = createApi(ctx, { settings });
  ctx.on('session/event', (session, event) => api.predictor.observe(session, event));
  ctx.on('session/disposed', session => api.predictor.invalidate(session.id));
  ctx.effect(() => () => api.predictor.dispose());
  ctx.effect(() => ctx.connection.fetch.register({
    path: '/api/dsh-next-message', methods: ['POST'], requestBody: 'buffered',
    async fetch(request) {
      let body;
      try { const text = await request.text(); if (text.length > 32768) return new Response('Request too large', { status: 413 }); body = JSON.parse(text); }
      catch { return new Response('Invalid JSON', { status: 400 }); }
      if (body?.type !== 'client-request' || body.method !== 'dsh-next-message' || typeof body.rpcId !== 'string' || !body.payload || typeof body.payload !== 'object' || Array.isArray(body.payload)) return new Response('Invalid request', { status: 400 });
      const result = await api.handle(body.payload, request.signal);
      return Response.json({ type: 'server-response', rpcId: body.rpcId, result }, { headers: { 'cache-control': 'no-store' } });
    },
  }));
}
