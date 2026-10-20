import { expect, it, vi } from 'vitest';
import { LocalSettingsSchema } from '@solveflow/contracts/local';
import { MAX_DEVICE_PHASE_DURATION_MS } from '@solveflow/contracts/agent';
import { analyzeBatchPrintQuestion, type PrintLayoutDiagnostic } from './batch-print-layout.js';

const settings = LocalSettingsSchema.parse({ schemaVersion: 1, solver: { provider: 'fixture', baseURL: 'https://layout.invalid/v1', model: 'fixture', api: 'openai-completions', contextWindow: 32768, maxTokens: 16384, maxTokensField: 'max_tokens', streaming: false }, verifier: null });
const source = { id: '10000000-0000-4000-8000-000000000001', kind: 'text-only', rotation: 0, regions: [] };
const problem = { text: 'Synthetic problem.', subject: 'math', uncertainties: [] };
const input = { questions: [{ key: 'q1', problem }], sources: [{ id: source.id, image: 'data:image/jpeg;base64,AQID' }] };
const valid = { schemaVersion: 1, questions: [{ key: 'q1', problem, sources: [source], warnings: [], confidence: 1 }] };
const keys = { solver: 'synthetic-secret', verifier: null };
const options = { retryInvalidFormat: true, retryInvalidOwnership: true, retryTransientErrors: true, maxAttempts: 3 as const };
const response = (value: unknown) => Response.json({ id: 'fixture', model: 'fixture', choices: [{ index: 0, message: { role: 'assistant', content: typeof value === 'string' ? value : JSON.stringify(value) }, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } });

it.each(['format', 'ownership', 'network', 'rate-limit'])('can recover on attempt three after %s failures', async kind => {
  vi.useFakeTimers();
  try {
    let calls = 0; const events: PrintLayoutDiagnostic[] = [];
    const pending = analyzeBatchPrintQuestion(input, settings, keys, async (_url, init) => {
      calls++; const payload = JSON.parse(String(init?.body));
      expect(payload.messages).toHaveLength(2); expect(payload.max_tokens).toBe(16384); expect(payload.tools).toBeUndefined();
      if (calls === 3) return response(valid);
      if (kind === 'network') throw new TypeError('private transport detail');
      if (kind === 'rate-limit') return new Response('', { status: 429 });
      return response(kind === 'ownership' ? { ...valid, questions: [{ ...valid.questions[0], key: 'foreign-key' }] } : 'private malformed response');
    }, new AbortController().signal, { ...options, onDiagnostic: entry => events.push(entry) });
    const checked = expect(pending).resolves.toEqual(valid);
    await vi.advanceTimersByTimeAsync(5000); await checked;
    expect(calls).toBe(3); expect(events.map(entry => entry.status)).toEqual(['request', 'retry', 'request', 'retry', 'request', 'accepted']);
    expect(events.filter(entry => entry.status === 'request').map(entry => entry.maxAttempts)).toEqual([3, 3, 3]);
    expect(JSON.stringify(events)).not.toMatch(/private|foreign-key|synthetic-secret/); expect(vi.getTimerCount()).toBe(0);
  } finally { vi.useRealTimers(); }
});
it('stops after the third invalid response', async () => {
  vi.useFakeTimers();
  try {
    let calls = 0;
    const pending = analyzeBatchPrintQuestion(input, settings, keys, async () => { calls++; return response('not json'); }, new AbortController().signal, options);
    const checked = expect(pending).rejects.toMatchObject({ code: 'MODEL_OUTPUT_INVALID' });
    await vi.advanceTimersByTimeAsync(5000); await checked; expect(calls).toBe(3); expect(vi.getTimerCount()).toBe(0);
  } finally { vi.useRealTimers(); }
});
it.each([401, 402, 400])('does not retry permanent HTTP %s failures', async status => {
  let calls = 0;
  await expect(analyzeBatchPrintQuestion(input, settings, keys, async () => { calls++; return new Response('', { status }); }, new AbortController().signal, options)).rejects.toThrow();
  expect(calls).toBe(1);
});
it('cancels during backoff without another dispatch or leftover timer', async () => {
  vi.useFakeTimers();
  try {
    let calls = 0; const controller = new AbortController();
    const pending = analyzeBatchPrintQuestion(input, settings, keys, async () => { calls++; return response('not json'); }, controller.signal, options);
    const checked = expect(pending).rejects.toMatchObject({ code: 'CANCELLED' });
    await vi.advanceTimersByTimeAsync(500); controller.abort(); await checked;
    expect(calls).toBe(1); expect(vi.getTimerCount()).toBe(0);
  } finally { vi.useRealTimers(); }
});
it('all attempts and backoff share the original deadline', async () => {
  vi.useFakeTimers();
  try {
    let calls = 0;
    const pending = analyzeBatchPrintQuestion(input, settings, keys, async (_url, init) => {
      calls++;
      if (calls < 3) { await new Promise(resolve => setTimeout(resolve, 100000)); return response('not json'); }
      return new Promise<Response>((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true }));
    }, new AbortController().signal, options);
    const checked = expect(pending).rejects.toMatchObject({ code: 'MODEL_TIMEOUT' });
    await vi.advanceTimersByTimeAsync(MAX_DEVICE_PHASE_DURATION_MS + 1); await checked;
    expect(calls).toBe(3); expect(vi.getTimerCount()).toBe(0);
  } finally { vi.useRealTimers(); }
});
