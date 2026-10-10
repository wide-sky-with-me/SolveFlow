import { expect, it } from 'vitest';
import { LocalSettingsSchema, type LocalDiagnostic } from '@solveflow/contracts/local';
import type { SolverInput } from '@solveflow/contracts/agent';
import { solveOnDevice } from './mobile.js';
const profile = { provider: 'fixture', baseURL: 'https://primary.invalid/v1', model: 'primary', api: 'openai-completions', contextWindow: 32768, maxTokens: 8192, maxTokensField: 'max_tokens' };
const settings = LocalSettingsSchema.parse({ schemaVersion: 1, solver: profile, verifier: { ...profile, baseURL: 'https://verifier.invalid/v1' }, backup: { ...profile, baseURL: 'https://backup.invalid/v1' } });
const keys = { solver: 'synthetic-primary', verifier: 'synthetic-check', backup: 'synthetic-backup' };
const input: SolverInput = { schemaVersion: 1, role: 'solver', answerMode: 'brief', identity: { ownerId: 'owner', sessionId: 'session', runId: 'run' }, message: '', image: { bytes: Uint8Array.of(1, 2), mimeType: 'image/jpeg' }, evidence: [], verificationMode: 'automatic' };
const answer = { schemaVersion: 1, kind: 'answer', problem: { text: 'x+1=3', subject: 'math', uncertainties: [] }, answer: 'x=2', steps: [], knowledgePoints: [], citationIds: [], clarificationQuestions: [] };
const pass = { schemaVersion: 1, verdict: 'pass', checked: ['transcription', 'logic'], issues: [] };
const frame = (delta: object, finish: string | null = null) => `data: ${JSON.stringify({ id: 'fixture', choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`;
const sse = (value: unknown) => new Response(frame({ role: 'assistant', content: JSON.stringify(value) }) + frame({}, 'stop') + 'data: [DONE]\n\n', { headers: { 'content-type': 'text/event-stream' } });
it.each([false, true])('hands over only thinking-only primary output, with cancellation=%s taking priority', async cancel => {
  const entries: LocalDiagnostic[] = []; const urls: string[] = []; const timers: number[] = []; const controller = new AbortController();
  const result = await solveOnDevice(input, settings, keys, async (url, init) => {
    const host = new URL(String(url)).hostname; urls.push(host);
    if (host !== 'primary.invalid') return sse(host === 'verifier.invalid' ? pass : answer);
    return new Response(new ReadableStream<Uint8Array>({ start(stream) {
      stream.enqueue(new TextEncoder().encode(frame({ role: 'assistant', reasoning_content: 'PRIVATE_THINKING_CANARY' })));
      init?.signal?.addEventListener('abort', () => stream.error(new Error('PRIVATE_STREAM_CANARY')), { once: true });
    } }), { headers: { 'content-type': 'text/event-stream' } });
  }, controller.signal, () => {}, entry => entries.push(entry), (callback, ms) => {
    timers.push(ms); const id = ms === 60_000 ? setTimeout(() => cancel ? controller.abort() : callback(), 10) : undefined;
    return () => { if (id !== undefined) clearTimeout(id); };
  });
  expect(timers).toContain(60_000);
  if (cancel) { expect(result.status).toBe('cancelled'); expect(urls).toEqual(['primary.invalid']); }
  else { expect(result).toMatchObject({ status: 'completed', verified: true }); expect(urls).toEqual(['primary.invalid', 'backup.invalid', 'verifier.invalid']); expect(entries).toContainEqual(expect.objectContaining({ reason: 'thinking_limit', thinkingBytes: new TextEncoder().encode('PRIVATE_THINKING_CANARY').length })); }
  expect(JSON.stringify(entries)).not.toContain('PRIVATE_THINKING_CANARY'); expect(JSON.stringify(entries)).not.toContain('PRIVATE_STREAM_CANARY');
});
it.each(['brief', 'detailed'] as const)('records numeric thinking length, retains %s content, and releases thinking timers', async answerMode => {
  const entries: LocalDiagnostic[] = []; const windows: number[] = []; let thinkingCleared = false;
  const result = await solveOnDevice({ ...input, answerMode }, settings, keys, async url => {
    if (String(url).includes('verifier.invalid')) return sse(pass);
    return new Response(frame({ role: 'assistant', reasoning_content: 'PRIVATE_THINKING_CANARY' }) + frame({ content: JSON.stringify(answer) }) + frame({}, 'stop') + 'data: [DONE]\n\n', { headers: { 'content-type': 'text/event-stream' } });
  }, new AbortController().signal, () => {}, entry => entries.push(entry), (_callback, ms) => { windows.push(ms); return () => { if (ms === 60_000) thinkingCleared = true; }; });
  expect(result).toMatchObject({ status: 'completed', verified: true });
  expect(entries).toContainEqual(expect.objectContaining({ event: 'finish', thinkingBytes: new TextEncoder().encode('PRIVATE_THINKING_CANARY').length }));
  expect(JSON.stringify(entries)).not.toContain('PRIVATE_THINKING_CANARY');
  if (answerMode === 'brief') { expect(windows).toContain(60_000); expect(thinkingCleared).toBe(true); } else expect(windows).not.toContain(60_000);
});
it('keeps the ordinary phase window when no takeover is configured', async () => {
  const windows: number[] = [];
  const result = await solveOnDevice({ ...input, verificationMode: 'manual' }, { ...settings, verifier: null, backup: null }, { solver: keys.solver, verifier: null }, async () => new Response(frame({ role: 'assistant', reasoning_content: 'private' }) + frame({ content: JSON.stringify(answer) }) + frame({}, 'stop') + 'data: [DONE]\n\n', { headers: { 'content-type': 'text/event-stream' } }), new AbortController().signal, () => {}, () => {}, (_callback, ms) => { windows.push(ms); return () => {}; });
  expect(result.status).toBe('completed'); expect(windows).toEqual([300_000]);
});
