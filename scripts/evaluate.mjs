// Offline replay of context retention and output guards. This is NOT model accuracy.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { selectContext, parseSuggestion } from '../lib/context.js';
const root = new URL('../', import.meta.url);
const cases = readFileSync(new URL('eval/replay.jsonl', root), 'utf8').trim().split('\n').map(JSON.parse);
const results = cases.map(row => {
  const messages = [{ role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: row.user }] }, { role: 'assistant', content: [{ type: 'text', text: row.assistant }] }];
  const context = selectContext(messages);
  const output = parseSuggestion(JSON.stringify({ suggestion: row.candidate }), context);
  return { id: row.id, pass: !!output === row.expected, contextChars: JSON.stringify(context).length };
});
const report = { kind: 'offline-contract-replay', cases: results.length, passed: results.filter(r => r.pass).length, failed: results.filter(r => !r.pass), liveModelCalls: 0, note: 'Measures deterministic context/output behavior only. No claim about live prediction quality or latency.', results };
mkdirSync(new URL('docs/', root), { recursive: true });
writeFileSync(new URL('docs/replay-results.json', root), `${JSON.stringify(report, null, 2)}\n`);
console.log(`${report.passed}/${report.cases} offline replay cases passed; no live inference performed.`);
if (report.failed.length) { console.error(report.failed); process.exitCode = 1; }
