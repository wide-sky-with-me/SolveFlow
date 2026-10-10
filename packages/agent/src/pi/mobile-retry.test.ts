import { expect, it } from 'vitest';
import { LocalSettingsSchema, type LocalDiagnostic } from '@solveflow/contracts/local';
import type { SolverInput } from '@solveflow/contracts/agent';
import { solveOnDevice } from './mobile.js';
const profile = { provider: 'fixture', baseURL: 'https://primary.invalid/v1', model: 'primary', api: 'openai-completions', contextWindow: 32768, maxTokens: 4096, maxTokensField: 'max_tokens' };
const settings = LocalSettingsSchema.parse({ schemaVersion: 1, solver: profile, verifier: { ...profile, baseURL: 'https://verifier.invalid/v1', model: 'check' }, backup: { ...profile, baseURL: 'https://backup.invalid/v1', model: 'stronger' } });
const keys = { solver: 'synthetic-primary', verifier: 'synthetic-verifier', backup: 'synthetic-backup' };
const input: SolverInput = { schemaVersion: 1, role: 'solver', identity: { ownerId: 'device', sessionId: 'session', runId: 'run' }, message: '', image: { bytes: Uint8Array.of(1, 2), mimeType: 'image/jpeg' }, evidence: [], verificationMode: 'automatic', answerMode: 'brief' };
const answer = { schemaVersion: 1, kind: 'answer', problem: { text: 'x+1=3', subject: 'math', uncertainties: [] }, answer: 'x=2', steps: [], knowledgePoints: [], citationIds: [], clarificationQuestions: [] };
const pass = { schemaVersion: 1, verdict: 'pass', checked: ['transcription', 'logic'], issues: [] };
function sse(value: unknown) { return new Response(`data: ${JSON.stringify({ id: 'fixture', choices: [{ index: 0, delta: { role: 'assistant', content: JSON.stringify(value) }, finish_reason: null }] })}\n\ndata: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`, { headers: { 'content-type': 'text/event-stream' } }); }
it('reserves a bounded recheck after an initial verifier retry and backup correction', async () => {
  let checks = 0; let corrections = 0;
  const corrected = { ...answer, answer: 'Corrected x=2' };
  const result = await solveOnDevice(input, settings, keys, async url => {
    const host = new URL(String(url)).hostname;
    if (host === 'backup.invalid') { corrections++; return sse(corrected); }
    if (host !== 'verifier.invalid') return sse(answer);
    if (++checks === 1) return new Response('{}', { status: 503 });
    return sse(checks === 2 ? { ...pass, verdict: 'fail', issues: [{ code: 'ARITHMETIC', message: 'Correct the candidate.' }] } : pass);
  }, new AbortController().signal, () => {});
  expect(result).toMatchObject({ status: 'completed', candidate: corrected, verified: true }); expect(checks).toBe(3); expect(corrections).toBe(1);
});
it('retries a transient solver failure once and charges both calls before independent verification', async () => {
  const urls: string[] = []; const entries: LocalDiagnostic[] = [];
  const result = await solveOnDevice(input, settings, keys, async url => {
    urls.push(String(url)); if (urls.length === 1) return new Response('private-provider-canary', { status: 503 });
    return sse(String(url).includes('verifier.invalid') ? pass : answer);
  }, new AbortController().signal, () => {}, entry => entries.push(entry));
  expect(result).toMatchObject({ status: 'completed', verified: true });
  expect(urls).toEqual(['https://primary.invalid/v1/chat/completions', 'https://primary.invalid/v1/chat/completions', 'https://verifier.invalid/v1/chat/completions']);
  expect(entries.filter(e => e.role === 'solver' && e.event === 'request').map(e => e.attempt)).toEqual([1, 2]);
  expect(JSON.stringify(entries)).not.toContain('canary');
});
it('tries primary twice, hands over once, and preserves the backup answer after two unavailable verification attempts', async () => {
  const calls: string[] = [];
  const result = await solveOnDevice(input, settings, keys, async url => {
    const host = new URL(String(url)).hostname; calls.push(host);
    return host === 'backup.invalid' ? sse(answer) : new Response('{}', { status: 503 });
  }, new AbortController().signal, () => {});
  expect(calls).toEqual(['primary.invalid', 'primary.invalid', 'backup.invalid', 'verifier.invalid', 'verifier.invalid']);
  expect(result).toMatchObject({ status: 'completed', candidate: answer, verified: false, verification: null, warning: 'MODEL_UNAVAILABLE' });
});
it.each([401, 402, 400])('does not retry or call backup for HTTP %i', async status => {
  let calls = 0;
  const result = await solveOnDevice(input, settings, keys, async () => { calls++; return new Response('{}', { status }); }, new AbortController().signal, () => {});
  expect(result.status).toBe('failed'); expect(calls).toBe(1);
});
it('passes a missing primary model directly to backup without repeating its 404', async () => {
  const calls: string[] = [];
  const result = await solveOnDevice(input, settings, keys, async url => {
    const host = new URL(String(url)).hostname; calls.push(host);
    return host === 'primary.invalid' ? new Response('{}', { status: 404 }) : sse(host === 'verifier.invalid' ? pass : answer);
  }, new AbortController().signal, () => {});
  expect(result).toMatchObject({ status: 'completed', verified: true }); expect(calls).toEqual(['primary.invalid', 'backup.invalid', 'verifier.invalid']);
});
it('cancellation during retry backoff prevents the second request and backup', async () => {
  let calls = 0; const controller = new AbortController();
  const result = await solveOnDevice(input, settings, keys, async () => { calls++; setTimeout(() => controller.abort(), 20); return new Response('{}', { status: 503 }); }, controller.signal, () => {});
  expect(result.status).toBe('cancelled'); expect(calls).toBe(1);
});
it('retries an interrupted stream without replaying successful tools or sending partial assistant content', async () => {
  const bodies: unknown[] = []; let verifierCalls = 0;
  const result = await solveOnDevice(input, settings, keys, async (url, init) => {
    if (String(url).includes('verifier.invalid')) { verifierCalls++; return sse(pass); }
    bodies.push(JSON.parse(String(init?.body)));
    if (bodies.length === 1) return new Response(`data: ${JSON.stringify({ choices: [{ index: 0, delta: { role: 'assistant', tool_calls: [{ index: 0, id: 'read_one', type: 'function', function: { name: 'read', arguments: '{"path":"/skills/math/SKILL.md"}' } }] }, finish_reason: 'tool_calls' }] })}\n\ndata: [DONE]\n\n`, { headers: { 'content-type': 'text/event-stream' } });
    if (bodies.length === 2) return new Response(new ReadableStream<Uint8Array>({ start(c) { c.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ choices: [{ index: 0, delta: { role: 'assistant', content: 'PARTIAL_CANARY' }, finish_reason: null }] })}\n\n`)); setTimeout(() => c.error(new Error('private-stream-canary')), 5); } }), { headers: { 'content-type': 'text/event-stream' } });
    return sse(answer);
  }, new AbortController().signal, () => {});
  expect(result).toMatchObject({ status: 'completed', verified: true }); expect(bodies).toHaveLength(3); expect(verifierCalls).toBe(1);
  expect(JSON.stringify(bodies[2])).not.toContain('PARTIAL_CANARY');
  const payload = bodies[2]; if (!payload || typeof payload !== 'object' || !('messages' in payload) || !Array.isArray(payload.messages)) throw new Error('PAYLOAD');
  expect(payload.messages.filter((v: unknown) => !!v && typeof v === 'object' && 'role' in v && v.role === 'tool')).toHaveLength(1);
});
it('bounds each phase to one retry and permits only one configured verifier takeover', async () => {
  const windows: number[] = []; let calls = 0;
  const result = await solveOnDevice({ ...input, verificationMode: 'manual' }, { ...settings, backup: null }, { ...keys, backup: null }, async () => { calls++; return new Response('{}', { status: 503 }); }, new AbortController().signal, () => {}, () => {}, (_callback, ms) => { windows.push(ms); return () => {}; });
  expect(result).toMatchObject({ status: 'failed', error: { code: 'MODEL_UNAVAILABLE' } }); expect(calls).toBe(4); expect(windows).toEqual([300_000, 300_000]);
});
it('uses at most the two existing verifier dispatches even after format repair and stream failure', async () => {
  let checks = 0;
  const result = await solveOnDevice(input, settings, keys, async url => {
    if (!String(url).includes('verifier.invalid')) return sse(answer);
    checks++; return checks === 1 ? sse({}) : new Response('{}', { status: 503 });
  }, new AbortController().signal, () => {});
  expect(result).toMatchObject({ status: 'completed', verified: false, warning: 'MODEL_UNAVAILABLE' }); expect(checks).toBe(2);
});
