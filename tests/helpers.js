export const user = text => ({ role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text }] });
export const assistant = text => ({ role: 'assistant', content: [{ type: 'text', text }] });
export const completed = (turn = 1) => ({ type: 'turn/end', seq: turn * 4, data: { turn, reason: { kind: 'completed' } } });
export function fixture(stream) {
  const calls = [];
  let events = [completed()], messages = [user('请修复问题并运行测试。'), assistant('修复完成，尚未运行测试。')];
  const session = { id: 's', snapshotEvents: () => events, deriveMessages: () => messages, requestContext: () => ({ provider: 'account', model: 'current-chat' }) };
  const ctx = { sessions: { get: id => id === 's' ? session : undefined }, llm: { async *stream(options) { calls.push(options); if (stream) yield* stream(options); else { yield { type: 'text-delta', text: '{"suggestion":"运行一下测试。"}' }; yield { type: 'finish', reason: { kind: 'stop' } }; } } } };
  return { ctx, session, calls, setEvents: next => { events = next; }, setMessages: next => { messages = next; } };
}
export const tick = () => new Promise(resolve => setTimeout(resolve, 0));
