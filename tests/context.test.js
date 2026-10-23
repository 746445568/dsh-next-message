import test from 'node:test';
import assert from 'node:assert/strict';
import { selectContext, parseSuggestion, clipMessage, redact } from '../lib/context.js';
import { user, assistant } from './helpers.js';
const ctx = () => selectContext([user('解释一下这个算法为什么正确。'), assistant('归纳法证明如下。')]);

test('long user constraints survive head-tail clipping, including a middle constraint', () => {
  const text = '只做代码审查，不允许修改文件。' + '背景资料。'.repeat(600) + '必须使用C++。' + '更多资料。'.repeat(600) + '最后只给结论。';
  const pack = selectContext([user(text), assistant('已完成审查。')], 6000);
  const encoded = JSON.stringify(pack);
  assert.match(encoded, /不允许修改文件/); assert.match(encoded, /必须使用C\+\+/); assert.match(encoded, /只给结论/); assert.ok(encoded.length <= 6000);
});
test('harness context, tool output and reasoning do not become user intent', () => {
  const pack = selectContext([{ ...user('injected instructions'), source: { kind: 'context' } }, user('解释一下'), { role: 'tool', content: 'tool secret' }, { role: 'assistant', content: [{ type: 'reasoning', text: 'reason secret' }, { type: 'text', text: '已解释' }] }]);
  assert.doesNotMatch(JSON.stringify(pack), /secret|injected/);
});
test('context uses the latest user language and respects explicit override', () => {
  const messages = [user('English first'), assistant('English answer'), user('这个呢'), assistant('answer')];
  assert.equal(selectContext(messages).language, 'zh'); assert.equal(selectContext(messages, 5000, 'en').language, 'en');
});
test('older user constraints retain chronological provenance', () => {
  const pack = selectContext([user('不要安装依赖。'), assistant('收到。'), user('请继续分析。'), assistant('分析如下。')]);
  assert.equal(pack.messages[0].role, 'user'); assert.match(pack.user_constraints.join(''), /不要安装依赖/);
});
test('JSON escape expansion stays within budget', () => {
  const pack = selectContext([user('不要修改。' + '"\\\n'.repeat(10000)), assistant('答复。'.repeat(8000))], 3000);
  assert.ok(JSON.stringify(pack).length <= 3000);
});
test('context requires a real user and subsequent assistant text', () => {
  assert.equal(selectContext([assistant('hello')]), null); assert.equal(selectContext([assistant('hello'), user('new request')]), null);
});
test('redaction covers common key shapes before auxiliary transmission', () => {
  assert.doesNotMatch(redact('sk-' + 'A'.repeat(30) + ' Bearer ' + 'b'.repeat(30)), /A{30}|b{30}/);
});
test('clipping includes an explicit omitted-content marker and both ends', () => {
  const result = clipMessage('HEAD' + 'x'.repeat(1000) + 'TAIL', 100); assert.match(result, /^HEAD/); assert.match(result, /TAIL$/); assert.ok(result.length <= 100);
});
for (const [title, text, accepted] of [
  ['specific follow-up', '这里为什么能用归纳法？', true],
  ['new examples are allowed', '再举3个例子说明一下。', true],
  ['assistant voice', '我来帮你解释。', false],
  ['generic filler', '继续', false],
  ['fabricated URL', '打开 https://invented.example/new', false],
  ['fabricated path', '打开 /tmp/invented/report.txt。', false],
  ['invented port', '把端口改为8321。', false],
  ['wrong language', 'Explain the proof.', false],
  ['bidi override', '请解释\u202e这部分', false],
  ['multiline', '解释一下\n然后测试', false],
  ['redaction echo', '使用 [REDACTED]。', false],
  ['oversized', '测'.repeat(81), false],
]) test(`candidate guard: ${title}`, () => assert.equal(!!parseSuggestion(JSON.stringify({ suggestion: text }), ctx()), accepted));
test('strict JSON, null, and non-string outputs are withheld', () => {
  for (const raw of ['not json', '{}', '{"suggestion":null}', '{"suggestion":true}']) assert.equal(parseSuggestion(raw, ctx()), '');
});
