import { expect, it, vi } from 'vitest';
import { LocalSettingsSchema, BatchPrintLayoutInputSchema } from '@solveflow/contracts/local';
import { analyzeBatchPrintQuestion } from './batch-print-layout.js';
const settings = LocalSettingsSchema.parse({ schemaVersion: 1, solver: { provider: 'fixture', baseURL: 'https://layout.invalid/v1', model: 'layout-model', api: 'openai-completions', contextWindow: 32768, maxTokens: 8192, maxTokensField: 'max_tokens' }, verifier: null });
const keys = { solver: 'fixture-secret', verifier: null };
const problem = { text: '求 x+1=2 的解。', subject: 'math', uncertainties: [] };
const input = BatchPrintLayoutInputSchema.parse({ questions: [{ key: 'q1', problem }], sources: [{ id: '10000000-0000-4000-8000-000000000001', image: 'data:image/jpeg;base64,AQID' }] });
const result = { schemaVersion: 1, questions: [{ key: 'q1', problem, sources: [{ id: input.sources[0]!.id, kind: 'text-only', rotation: 0, regions: [] }], warnings: [], confidence: .95 }] };
function sse(value: unknown, reason = 'stop') {
  return new Response(`data: ${JSON.stringify({ id: 'fixture', object: 'chat.completion.chunk', created: 1, model: 'layout-model', choices: [{ index: 0, delta: { role: 'assistant', content: typeof value === 'string' ? value : JSON.stringify(value) }, finish_reason: null }] })}\n\ndata: ${JSON.stringify({ id: 'fixture', choices: [{ index: 0, delta: {}, finish_reason: reason }] })}\n\ndata: [DONE]\n\n`, { headers: { 'content-type': 'text/event-stream' } });
}
it('uses one configured no-tool request, isolated prompt and supplied pictures', async () => {
  const requests: Record<string, unknown>[] = [];
  const transport: typeof fetch = async (url, init) => {
    expect(String(url)).toBe('https://layout.invalid/v1/chat/completions');
    expect(init).toMatchObject({ redirect: 'error', credentials: 'omit', cache: 'no-store' });
    expect(new Headers(init?.headers).get('authorization')).toBe('Bearer fixture-secret');
    const body: Record<string, unknown> = JSON.parse(String(init?.body)); requests.push(body);
    expect(body.tools).toBeUndefined(); expect(body.tool_choice).toBe('none');
    expect(String(init?.body)).toContain('data:image/jpeg;base64,AQID');
    expect(String(init?.body)).toContain('补充图');
    expect(String(init?.body)).toContain('相机状态栏');
    expect(String(init?.body)).toContain('不能用文字描述替代源图');
    expect(String(init?.body)).not.toContain('AGENTS.md'); expect(String(init?.body)).not.toContain('/home/');
    return sse(result);
  };
  await expect(analyzeBatchPrintQuestion(input, settings, keys, transport, new AbortController().signal)).resolves.toEqual(result);
  expect(requests).toHaveLength(1);
});
it('transcribes text-only main images and preserves necessary supplementary option diagrams with correction', async () => {
  const reference = { ...problem, options: [{ label: 'A', text: '图 A' }, { label: 'B', text: '图 B' }] };
  const additional = { id: '10000000-0000-4000-8000-000000000002', image: 'data:image/jpeg;base64,BAUG' };
  const combined = BatchPrintLayoutInputSchema.parse({ questions: [{ key: 'q1', problem: reference }], sources: [...input.sources, additional] });
  const output = { schemaVersion: 1, questions: [{ key: 'q1', problem: { ...reference, text: '下列哪一幅图表示 y=x+1？' }, confidence: .98, warnings: [], sources: [
    { id: input.sources[0]!.id, kind: 'text-only', rotation: 0, regions: [] },
    { id: additional.id, kind: 'illustrations', rotation: -4, regions: [
      { id: 'optionA', role: 'option', optionLabel: 'A', alt: '选项 A 的坐标图', x: .1, y: .2, width: .3, height: .4 },
      { id: 'optionB', role: 'option', optionLabel: 'B', alt: '选项 B 的坐标图', x: .6, y: .2, width: .3, height: .4 },
    ] },
  ] }] };
  const parsed = await analyzeBatchPrintQuestion(combined, settings, keys, async (_url, init) => {
    const body = String(init?.body); expect(body).toContain('data:image/jpeg;base64,AQID'); expect(body).toContain('data:image/jpeg;base64,BAUG');
    return sse(output);
  }, new AbortController().signal);
  expect(parsed).toEqual(output);
});
it('keeps original options and emits a visible fallback reason despite an incorrect high-confidence claim', async () => {
  const reference = { ...problem, options: [{ label: 'A', text: '1' }, { label: 'B', text: '2' }] };
  const checked = { ...input, questions: [{ key: 'q1', problem: reference }] };
  const parsed = await analyzeBatchPrintQuestion(checked, settings, keys, async () => sse(result), new AbortController().signal);
  expect(parsed.questions[0]?.problem).toEqual(reference);
  expect(parsed.questions[0]?.sources[0]?.kind).toBe('retain-source');
  expect(parsed.questions[0]?.warnings.join('')).toContain('遗漏已有选项');
});
it.each(['foreign', 'missing', 'invalid-json', 'tools', 'too-large'])('does not retry unsafe %s responses', async kind => {
  let calls = 0;
  const output = kind === 'foreign' ? { ...result, questions: [{ ...result.questions[0], key: 'q2' }] } : kind === 'missing' ? { ...result, questions: [] } : kind === 'invalid-json' ? 'not json' : kind === 'too-large' ? 'x'.repeat(65537) : result;
  await expect(analyzeBatchPrintQuestion(input, settings, keys, async () => { calls++; return sse(output, kind === 'tools' ? 'tool_calls' : 'stop'); }, new AbortController().signal)).rejects.toMatchObject({ code: 'MODEL_OUTPUT_INVALID' });
  expect(calls).toBe(1);
});
it('returns uncertainty as retained originals and preserves four question identities', async () => {
  const questions = Array.from({ length: 4 }, (_, index) => ({ key: `q${index + 1}`, problem }));
  const response = { schemaVersion: 1, questions: questions.map(question => ({ ...result.questions[0], ...question, confidence: .7, warnings: ['不清楚'] })) };
  const parsed = await analyzeBatchPrintQuestion({ ...input, questions }, settings, keys, async () => sse(response), new AbortController().signal);
  expect(parsed.questions.map(question => question.key)).toEqual(questions.map(question => question.key));
  expect(parsed.questions.every(question => question.sources[0]?.kind === 'retain-source')).toBe(true);
});
it('propagates cancellation and never starts an already cancelled request', async () => {
  const controller = new AbortController(); let observed = false;
  const transport: typeof fetch = async (_url, init) => {
    controller.abort(); observed = !!init?.signal?.aborted;
    throw new Error('aborted');
  };
  await expect(analyzeBatchPrintQuestion(input, settings, keys, transport, controller.signal)).rejects.toMatchObject({ code: 'CANCELLED' }); expect(observed).toBe(true);
  await expect(analyzeBatchPrintQuestion(input, settings, keys, async () => { throw new Error('must not call'); }, controller.signal)).rejects.toMatchObject({ code: 'CANCELLED' });
});
it('times out once and releases the transport abort listener', async () => {
  vi.useFakeTimers();
  try {
    let calls = 0; let aborted = false;
    const pending = analyzeBatchPrintQuestion(input, settings, keys, async (_url, init) => {
      calls++; return new Promise<Response>((_resolve, reject) => { init?.signal?.addEventListener('abort', () => { aborted = true; reject(new Error('timeout')); }, { once: true }); });
    }, new AbortController().signal);
    const rejected = expect(pending).rejects.toMatchObject({ code: 'MODEL_TIMEOUT' });
    await vi.advanceTimersByTimeAsync(60_001); await rejected;
    expect(calls).toBe(1); expect(aborted).toBe(true); expect(vi.getTimerCount()).toBe(0);
  } finally { vi.useRealTimers(); }
});
it('blocks invalid source counts before contacting the model', async () => {
  await expect(analyzeBatchPrintQuestion({ ...input, sources: Array.from({ length: 9 }, () => input.sources[0]!) }, settings, keys, async () => { throw new Error('must not call'); }, new AbortController().signal)).rejects.toThrow();
});
it.each(['openai-completions', 'openai-responses'] as const)('honors configured non-stream %s without a tool continuation', async api => {
  const configured = LocalSettingsSchema.parse({ ...settings, solver: { ...settings.solver, api, streaming: false } }); let calls = 0;
  const value = await analyzeBatchPrintQuestion(input, configured, keys, async (url, init) => {
    calls++; expect(String(url)).toBe(`https://layout.invalid/v1/${api === 'openai-responses' ? 'responses' : 'chat/completions'}`);
    const body: unknown = JSON.parse(String(init?.body)); expect(body).toMatchObject({ stream: false });
    return Response.json(api === 'openai-completions'
      ? { id: 'chat_fixture', model: 'layout-model', choices: [{ index: 0, message: { role: 'assistant', content: JSON.stringify(result) }, finish_reason: 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 } }
      : { id: 'resp_fixture', model: 'layout-model', status: 'completed', output: [{ type: 'message', id: 'msg_fixture', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: JSON.stringify(result), annotations: [] }] }], usage: { input_tokens: 10, output_tokens: 20, total_tokens: 30 } });
  }, new AbortController().signal);
  expect(value).toEqual(result); expect(calls).toBe(1);
});
