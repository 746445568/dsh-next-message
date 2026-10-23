import { LlmAdapter } from '../qa-runtime/node_modules/@deepseek-ai/dsh-llm/lib/index.js';
const state = { predictions: 0, replies: 0, seenEffort: null };
class FixtureAdapter extends LlmAdapter {
  providerInfo() { return { id: 'fixture', name: 'Local test fixture' }; }
  async listModels() { return [{ provider: 'fixture', id: 'fixture-flash', name: 'Fixture Flash', inputModalities: ['text'] }]; }
  async resolveModel() { return { provider: 'fixture', id: 'fixture-flash', name: 'Fixture Flash', context: { contextWindow: 32000 }, reasoning: { efforts: [{ id: 'off', name: 'Off' }, { id: 'high', name: 'High' }] } }; }
  async *stream(options) {
    const prediction = options.system?.includes('Predict the ONE');
    if (prediction) { state.predictions++; state.seenEffort = options.reasoningEffort; }
    else state.replies++;
    const text = prediction ? '{"suggestion":"运行一下边界测试，检查空数组的情况。"}' : '快速排序的实现思路已经说明。还没有运行边界测试。';
    await new Promise(r => setTimeout(r, prediction ? 180 : 400));
    yield { type: 'block-start', index: 0, blockType: 'text' };
    yield { type: 'text-delta', index: 0, text };
    yield { type: 'block-end', index: 0, block: { type: 'text', text } };
    yield { type: 'finish', reason: { kind: 'stop' } };
  }
}
export const inject = ['llm', 'connection'];
export function apply(ctx) {
  ctx.llm.registerAdapter(['fixture'], new FixtureAdapter());
  ctx.connection.fetch.register({ path: '/api/next-message-test', methods: ['GET'], requestBody: 'buffered', fetch: () => Response.json(state) });
}
