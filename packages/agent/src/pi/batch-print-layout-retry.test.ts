import { expect, it, vi } from 'vitest';
import { LocalSettingsSchema } from '@solveflow/contracts/local';
import { MAX_DEVICE_PHASE_DURATION_MS } from '@solveflow/contracts/agent';
import { analyzeBatchPrintQuestion, type PrintLayoutDiagnostic } from './batch-print-layout.js';
const settings = LocalSettingsSchema.parse({ schemaVersion: 1, solver: { provider: 'fixture', baseURL: 'https://layout.invalid/v1', model: 'fixture', api: 'openai-completions', contextWindow: 32768, maxTokens: 16384, maxTokensField: 'max_tokens', streaming: false }, verifier: null });
const source = { id: '10000000-0000-4000-8000-000000000001', kind: 'text-only', rotation: 0, regions: [] };
const problem = { text: 'Synthetic problem.', subject: 'math', uncertainties: [] };
const input = { questions: [{ key: 'q1', problem }], sources: [{ id: source.id, image: 'data:image/jpeg;base64,AQID' }] };
const valid = { schemaVersion: 1, questions: [{ key: 'q1', problem, sources: [source], warnings: [], confidence: 1 }] };
const misplaced = { schemaVersion: 1, questions: [{ key: 'q1', problem }], sources: [source], warnings: [], confidence: 1 };
const response = (value: unknown, reason = 'stop') => Response.json({ id: 'fixture', model: 'fixture', choices: [{ index: 0, message: { role: 'assistant', content: typeof value === 'string' ? value : JSON.stringify(value) }, finish_reason: reason }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } });
const keys = { solver: 'synthetic-secret', verifier: null };
it.each([misplaced, 'not json'])('repairs invalid format once with bounded metadata and no previous response', async initial => {
  let calls = 0; const events: PrintLayoutDiagnostic[] = [];
  const value = await analyzeBatchPrintQuestion(input, settings, keys, async (_url, init) => {
    calls++; const payload = JSON.parse(String(init?.body));
    expect(payload.max_tokens).toBe(16384); expect(payload.tools).toBeUndefined();
    if (calls === 2) { expect(payload.messages).toHaveLength(2); expect(payload.messages[0].content).toContain('上次响应未通过格式校验'); expect(payload.messages[0].content).not.toContain('not json'); expect(payload.messages[1].content).toEqual(expect.any(Array)); }
    return response(calls === 1 ? initial : valid);
  }, new AbortController().signal, { retryInvalidFormat: true, onDiagnostic: entry => events.push(entry) });
  expect(value).toEqual(valid); expect(calls).toBe(2); expect(events.map(event => event.status)).toEqual(['request', 'retry', 'request', 'accepted']);
  expect(JSON.stringify(events)).not.toContain(problem.text); expect(JSON.stringify(events)).not.toContain(source.id); expect(JSON.stringify(events)).not.toContain(keys.solver);
});
it('stops after two malformed responses', async () => {
  let calls = 0;
  await expect(analyzeBatchPrintQuestion(input, settings, keys, async () => { calls++; return response(misplaced); }, new AbortController().signal, { retryInvalidFormat: true })).rejects.toMatchObject({ code: 'MODEL_OUTPUT_INVALID' });
  expect(calls).toBe(2);
});
it.each(['foreign', 'truncated', 'large', 'tools'])('never retries %s', async kind => {
  let calls = 0;
  const value = kind === 'foreign' ? { ...valid, questions: [{ ...valid.questions[0], key: 'q2' }] } : kind === 'large' ? 'x'.repeat(65537) : valid;
  await expect(analyzeBatchPrintQuestion(input, settings, keys, async () => { calls++; return response(value, kind === 'truncated' ? 'length' : kind === 'tools' ? 'tool_calls' : 'stop'); }, new AbortController().signal, { retryInvalidFormat: true })).rejects.toMatchObject({ code: 'MODEL_OUTPUT_INVALID' });
  expect(calls).toBe(1);
});
it('honours cancellation before a repair request', async () => {
  const controller = new AbortController(); let calls = 0;
  await expect(analyzeBatchPrintQuestion(input, settings, keys, async () => { calls++; return response(misplaced); }, controller.signal, { retryInvalidFormat: true, onDiagnostic: entry => { if (entry.status === 'retry') controller.abort(); } })).rejects.toMatchObject({ code: 'CANCELLED' });
  expect(calls).toBe(1);
});
it('shares the original deadline across both attempts', async () => {
  vi.useFakeTimers();
  try {
    let calls = 0;
    const pending = analyzeBatchPrintQuestion(input, settings, keys, async (_url, init) => {
      calls++;
      if (calls === 1) { await new Promise(resolve => setTimeout(resolve, 200000)); return response(misplaced); }
      return new Promise<Response>((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true }));
    }, new AbortController().signal, { retryInvalidFormat: true });
    const checked = expect(pending).rejects.toMatchObject({ code: 'MODEL_TIMEOUT' });
    await vi.advanceTimersByTimeAsync(MAX_DEVICE_PHASE_DURATION_MS + 1); await checked;
    expect(calls).toBe(2); expect(vi.getTimerCount()).toBe(0);
  } finally { vi.useRealTimers(); }
});
it('redacts arbitrary schema path names', async () => {
  const events: PrintLayoutDiagnostic[] = [];
  await expect(analyzeBatchPrintQuestion(input, settings, keys, async () => response({ ...valid, questions: [{ ...valid.questions[0], problem: { ...problem, text: null }, 'private-field-secret': true }] }), new AbortController().signal, { onDiagnostic: entry => events.push(entry) })).rejects.toMatchObject({ code: 'MODEL_OUTPUT_INVALID' });
  expect(JSON.stringify(events)).not.toContain('private-field-secret'); expect(events[1]?.issues?.length).toBeGreaterThan(0);
});
