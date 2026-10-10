import { expect, it, vi } from 'vitest';
import { LocalSettingsSchema, type LocalDiagnostic } from '@solveflow/contracts/local';
import type { SolverInput } from '@solveflow/contracts/agent';
import { solveOnDevice } from './mobile.js';

const profile = { provider: 'fixture', baseURL: 'https://primary.invalid/v1', model: 'primary', api: 'openai-completions', contextWindow: 32768, maxTokens: 8192, maxTokensField: 'max_tokens' };
const settings = LocalSettingsSchema.parse({ schemaVersion: 1, solver: profile, verifier: { ...profile, baseURL: 'https://verifier.invalid/v1', model: 'check' }, backup: { ...profile, baseURL: 'https://backup.invalid/v1', model: 'stronger' } });
const input: SolverInput = { schemaVersion: 1, role: 'solver', identity: { ownerId: 'device', sessionId: 'session', runId: 'run' }, message: '', image: { bytes: Uint8Array.of(1, 2), mimeType: 'image/jpeg' }, evidence: [], verificationMode: 'manual', answerMode: 'brief' };
const answer = { schemaVersion: 1, kind: 'answer', problem: { text: 'x+1=3', subject: 'math', uncertainties: [] }, answer: 'x=2', steps: [], knowledgePoints: [], citationIds: [], clarificationQuestions: [] };
const pass = { schemaVersion: 1, verdict: 'pass', checked: ['transcription', 'logic'], issues: [] };
const keys = { solver: 'synthetic-primary', verifier: 'synthetic-check', backup: 'synthetic-backup' };
function sse(value: unknown) { return new Response(`data: ${JSON.stringify({ id: 'fixture', choices: [{ index: 0, delta: { role: 'assistant', content: JSON.stringify(value) }, finish_reason: null }] })}\n\ndata: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`, { headers: { 'content-type': 'text/event-stream' } }); }

it.each([false, true])('gives slow backup and verification full windows while keeping cancellation terminal: cancel=%s', async cancel => {
  let now = 0; const controller = new AbortController(); const entries: LocalDiagnostic[] = [];
  const timers = new Set<{ at: number; callback: () => void }>();
  const clock = vi.spyOn(performance, 'now').mockImplementation(() => now); const urls: string[] = [];
  try {
    const result = await solveOnDevice({ ...input, useBackup: true, focus: { sourceRunId: '00000000-0000-4000-8000-000000000001', kind: 'regenerate', content: '原题', verified: false } }, settings, keys, async url => {
      urls.push(String(url)); const backup = String(url).includes('backup.invalid');
      now += backup ? 270_000 : 230_000;
      if (cancel && backup) controller.abort();
      for (const timer of [...timers]) if (timer.at <= now) timer.callback();
      return sse(backup ? answer : pass);
    }, controller.signal, () => {}, entry => entries.push(entry), (callback, ms) => {
      const timer = { at: now + ms, callback }; timers.add(timer); return () => { timers.delete(timer); };
    });
    expect(result).toMatchObject(cancel ? { status: 'cancelled' } : { status: 'completed', verified: true });
    expect(urls).toHaveLength(cancel ? 1 : 2);
    if (!cancel) expect(entries.filter(entry => entry.event === 'request').map(entry => entry.phaseMs)).toEqual([300_000, 300_000]);
  } finally { clock.mockRestore(); }
});

it('records which phase reached its deadline and rejects a late valid-looking backup answer', async () => {
  let now = 0; let expire = () => {}; const entries: LocalDiagnostic[] = [];
  const clock = vi.spyOn(performance, 'now').mockImplementation(() => now);
  try {
    const result = await solveOnDevice({ ...input, useBackup: true, focus: { sourceRunId: '00000000-0000-4000-8000-000000000001', kind: 'regenerate', content: '原题', verified: false } }, settings, keys, async () => { now = 300_001; expire(); return sse(answer); }, new AbortController().signal, () => {}, entry => entries.push(entry), callback => { expire = callback; return () => {}; });
    expect(result).toMatchObject({ status: 'failed', error: { code: 'MODEL_TIMEOUT' } });
    expect(entries).toContainEqual(expect.objectContaining({ role: 'backup', event: 'failure', reason: 'deadline', phaseMs: 300_000 }));
  } finally { clock.mockRestore(); }
});

it('uses the requested Sol model through Responses with explicit high reasoning', async () => {
  const config = LocalSettingsSchema.parse({ ...settings, backup: { ...settings.backup, model: 'gpt-6.1-sol', api: 'openai-responses', thinking: { mode: 'on', effort: 'high' } } });
  const result = await solveOnDevice(input, config, keys, async (url, init) => {
    if (String(url).includes('primary.invalid')) return new Response('{}', { status: 503 });
    if (!String(url).includes('backup.invalid')) return sse(pass);
    expect(String(url)).toBe('https://backup.invalid/v1/responses');
    const payload: unknown = JSON.parse(String(init?.body)); expect(payload).toMatchObject({ model: 'gpt-6.1-sol', reasoning: { effort: 'high' } });
    const item = { type: 'message', id: 'msg_fixture', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: JSON.stringify(answer), annotations: [] }] };
    const events = [{ type: 'response.created', response: { id: 'resp_fixture' } }, { type: 'response.output_item.added', output_index: 0, item: { ...item, content: [] } }, { type: 'response.output_item.done', output_index: 0, item }, { type: 'response.completed', response: { id: 'resp_fixture', status: 'completed', output: [item], usage: { input_tokens: 100, output_tokens: 100, total_tokens: 200 } } }];
    return new Response(events.map(event => `data: ${JSON.stringify(event)}\n\n`).join(''), { headers: { 'content-type': 'text/event-stream' } });
  }, new AbortController().signal, () => {});
  expect(result).toMatchObject({ status: 'completed', verified: true });
});

it('routes recovery to only the configured backup endpoint and key, then to verifier', async () => {
  const calls: { url: string; key: string | null; model: unknown }[] = []; const diagnostics: LocalDiagnostic[] = [];
  const result = await solveOnDevice(input, settings, keys, async (url, init) => {
    const payload: unknown = JSON.parse(String(init?.body));
    calls.push({ url: String(url), key: new Headers(init?.headers).get('authorization'), model: typeof payload === 'object' && payload !== null && 'model' in payload ? payload.model : null });
    if (String(url).includes('primary.invalid')) return new Response('{}', { status: 503 });
    return sse(String(url).includes('backup.invalid') ? answer : pass);
  }, new AbortController().signal, () => {}, entry => diagnostics.push(entry));
  expect(result).toMatchObject({ status: 'completed', verified: true });
  expect(calls).toEqual([
    { url: 'https://primary.invalid/v1/chat/completions', key: 'Bearer synthetic-primary', model: 'primary' },
    { url: 'https://primary.invalid/v1/chat/completions', key: 'Bearer synthetic-primary', model: 'primary' },
    { url: 'https://backup.invalid/v1/chat/completions', key: 'Bearer synthetic-backup', model: 'stronger' },
    { url: 'https://verifier.invalid/v1/chat/completions', key: 'Bearer synthetic-check', model: 'check' },
  ]);
  expect(diagnostics.some(entry => entry.role === 'backup')).toBe(true);
  expect(JSON.stringify(diagnostics)).not.toContain('synthetic-');
});

it('uses primary only for a successful manual answer and leaves backup idle', async () => {
  const urls: string[] = [];
  const result = await solveOnDevice(input, settings, keys, async url => { urls.push(String(url)); return sse(answer); }, new AbortController().signal, () => {});
  expect(result).toMatchObject({ status: 'completed', verified: false, verificationStatus: 'not_requested' });
  expect(urls).toEqual(['https://primary.invalid/v1/chat/completions']);
});

it('explicit backup regeneration bypasses primary but still verifies', async () => {
  const urls: string[] = [];
  const result = await solveOnDevice({ ...input, useBackup: true, focus: { sourceRunId: '00000000-0000-4000-8000-000000000001', kind: 'regenerate', content: '原题', verified: false } }, settings, keys, async url => { urls.push(String(url)); return sse(String(url).includes('backup.invalid') ? answer : pass); }, new AbortController().signal, () => {});
  expect(result).toMatchObject({ status: 'completed', verified: true });
  expect(urls).toEqual(['https://backup.invalid/v1/chat/completions', 'https://verifier.invalid/v1/chat/completions']);
});

it('reserves a bounded primary window so a stalled solve can hand over with an independent backup deadline', async () => {
  const windows: number[] = []; let phases = 0;
  const result = await solveOnDevice(input, settings, keys, async (url, init) => {
    if (String(url).includes('primary.invalid')) return new Promise<Response>((_resolve, reject) => { init?.signal?.addEventListener('abort', () => reject(new Error('synthetic-abort')), { once: true }); });
    return sse(String(url).includes('backup.invalid') ? answer : pass);
  }, new AbortController().signal, () => {}, () => {}, (callback, ms) => {
    windows.push(ms); if (++phases !== 1) return () => {};
    const timer = setTimeout(callback, 0); return () => clearTimeout(timer);
  });
  expect(result).toMatchObject({ status: 'completed', verified: true });
  expect(windows).toEqual([240_000, 300_000, 300_000]);
});
