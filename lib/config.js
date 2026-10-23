import { readFileSync, mkdirSync, writeFileSync, renameSync, unlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import { randomUUID } from 'node:crypto';

export const DEFAULTS = Object.freeze({ enabled: true, provider: '', model: '', timeoutMs: 3000, maxTokens: 160, maxChars: 80, contextChars: 12000, language: 'auto' });
const clamp = (n, min, max, fallback) => Number.isFinite(n) ? Math.round(Math.max(min, Math.min(max, n))) : fallback;
export function normalizeConfig(raw = {}) {
  return {
    enabled: typeof raw.enabled === 'boolean' ? raw.enabled : true,
    provider: typeof raw.provider === 'string' ? raw.provider.trim().slice(0, 150) : '',
    model: typeof raw.model === 'string' ? raw.model.trim().slice(0, 150) : '',
    timeoutMs: clamp(raw.timeoutMs, 1000, 10000, DEFAULTS.timeoutMs),
    maxTokens: clamp(raw.maxTokens, 64, 384, DEFAULTS.maxTokens),
    maxChars: clamp(raw.maxChars, 24, 160, DEFAULTS.maxChars),
    contextChars: clamp(raw.contextChars, 3000, 24000, DEFAULTS.contextChars),
    language: ['auto', 'zh', 'en'].includes(raw.language) ? raw.language : 'auto',
  };
}
export function mergeConfig(current, patch) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new Error('invalid-config');
  const clean = Object.fromEntries(Object.entries(patch).filter(([key]) => Object.hasOwn(DEFAULTS, key)));
  for (const [key, value] of Object.entries(clean)) {
    if (typeof value !== typeof DEFAULTS[key]) throw new Error('invalid-config');
  }
  const next = normalizeConfig({ ...current, ...clean });
  if (!!next.provider !== !!next.model) throw new Error('model-pair-required');
  return next;
}
export function createConfigStore({ file = join(process.env.DSH_HOME || join(homedir(), '.dsh'), 'next-message.json'), initial = {}, memory = false } = {}) {
  let stored = {};
  if (!memory) { try { stored = JSON.parse(readFileSync(file, 'utf8')); } catch { /* first run */ } }
  let config = normalizeConfig({ ...initial, ...(stored && typeof stored === 'object' ? stored : {}) });
  if (!!config.provider !== !!config.model) config = { ...config, provider: '', model: '' };
  let revision = 0;
  return {
    snapshot: () => ({ config: { ...config }, revision }),
    update(patch, expectedRevision) {
      if (expectedRevision !== undefined && expectedRevision !== revision) throw new Error('settings-conflict');
      const next = mergeConfig(config, patch);
      if (!memory) {
        mkdirSync(dirname(file), { recursive: true });
        const temporary = `${file}.${randomUUID()}.tmp`;
        try { writeFileSync(temporary, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 }); renameSync(temporary, file); }
        catch (error) { try { unlinkSync(temporary); } catch {} throw error; }
      }
      config = next; revision++;
      return this.snapshot();
    },
  };
}
