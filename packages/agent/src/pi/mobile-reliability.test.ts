import { expect, it, vi } from 'vitest';
import { z } from 'zod';
import { LocalSettingsSchema } from '@solveflow/contracts/local';
import { type SolverInput } from '@solveflow/contracts/agent';
import { solveOnDevice } from './mobile.js';

const settings = LocalSettingsSchema.parse({ schemaVersion: 1, solver: { provider: 'fixture', baseURL: 'https://fixture.invalid/v1', model: 'fixture', api: 'openai-completions', contextWindow: 32768, maxTokens: 8192, maxTokensField: 'max_tokens' }, verifier: null });
const input: SolverInput = { schemaVersion: 1, role: 'solver', exam: 'tara', answerMode: 'brief', identity: { ownerId: 'owner', sessionId: 'session', runId: 'run' }, message: 'Solve the supplied question.', image: { bytes: Uint8Array.of(1, 2, 3), mimeType: 'image/jpeg' }, evidence: [] };
const candidate = { schemaVersion: 1, kind: 'answer', problem: { text: 'Solve x+1=3.', subject: 'math', uncertainties: [] }, answer: 'x=2', steps: [], knowledgePoints: [], citationIds: [], clarificationQuestions: [] };
const choice = { ...candidate, problem: { ...candidate.problem, options: [{ label: 'A', text: '1' }, { label: 'B', text: '2' }], response: { type: 'single-choice' } }, selectedOptions: ['A'], answer: 'A deliberately incorrect candidate reason.' };
const pass = { schemaVersion: 1, verdict: 'pass', checked: ['transcription', 'logic'], issues: [] };
const selection = (label: string) => ({ selectedOptions: [label], decisiveEvidence: 'The original equation gives x=2.' });
function response(content?: object, call?: { name: string; arguments: object }) {
  const delta = { role: 'assistant', ...(content ? { content: JSON.stringify(content) } : {}), ...(call ? { tool_calls: [{ index: 0, id: 'call-1', type: 'function', function: { name: call.name, arguments: JSON.stringify(call.arguments) } }] } : {}) };
  return new Response(`data: ${JSON.stringify({ id: 'fixture', choices: [{ index: 0, delta, finish_reason: null }] })}\n\ndata: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: call ? 'tool_calls' : 'stop' }] })}\n\ndata: [DONE]\n\n`, { headers: { 'content-type': 'text/event-stream' } });
}
const read = () => response(undefined, { name: 'read', arguments: { path: '/skills/math/SKILL.md' } });
const request = (init?: RequestInit) => z.looseObject({ messages: z.array(z.looseObject({ role: z.string(), content: z.unknown() })), tools: z.unknown().optional(), tool_choice: z.unknown().optional() }).parse(JSON.parse(String(init?.body)));

it('recovers one provider tool response to a no-tools finish without executing it or replaying tool protocol', async () => {
  let calls = 0;
  const outcome = await solveOnDevice({ ...input, verificationMode: 'manual' }, settings, { solver: 'fixture', verifier: null }, async (_url, init) => {
    calls++;
    if (calls <= 3) return read();
    const body = request(init);
    expect(body.tool_choice).toBe('none'); expect(body.tools).toBeUndefined();
    expect(body.messages.some(m => m.role === 'tool' || 'tool_calls' in m)).toBe(false);
    expect(JSON.stringify(body.messages)).toContain('工具观察');
    return calls === 4 ? response(candidate, { name: 'calculate', arguments: { schemaVersion: 1, expression: '999+1', angleUnit: 'rad' } }) : response(candidate);
  }, new AbortController().signal, () => {});
  expect(outcome).toMatchObject({ status: 'completed', verified: false, candidate: { answer: 'x=2' } });
  expect(calls).toBe(5);
});
it('does not count repeated provider tool finishes as a valid answer or keep retrying', async () => {
  let calls = 0;
  const outcome = await solveOnDevice({ ...input, verificationMode: 'manual' }, settings, { solver: 'fixture', verifier: null }, async () => { calls++; return read(); }, new AbortController().signal, () => {});
  expect(outcome).toMatchObject({ status: 'failed', error: { code: 'MODEL_OUTPUT_INVALID' } });
  expect(calls).toBe(5); // Three real reads, one final turn, one shared repair; no sixth dispatch.
});
it('keeps a failed calculation visible as failed data in the tool-free repair', async () => {
  let calls = 0;
  const outcome = await solveOnDevice({ ...input, verificationMode: 'manual' }, settings, { solver: 'fixture', verifier: null }, async (_url, init) => {
    calls++;
    if (calls <= 2) return response(undefined, { name: 'calculate', arguments: { schemaVersion: 1, expression: `unknown${calls}`, angleUnit: 'rad' } });
    const body = request(init);
    expect(body.tools).toBeUndefined(); expect(JSON.stringify(body.messages)).toContain('isError');
    expect(body.messages.some(m => m.role === 'tool' || 'tool_calls' in m)).toBe(false);
    return response(candidate);
  }, new AbortController().signal, () => {});
  expect(outcome.status).toBe('completed'); expect(calls).toBe(3);
});
it.each(['tara', 'esat', 'tmua', 'ap'] as const)('allows an ordinary %s first solve to complete at 130s with a full independent verification window', async exam => {
  let now = 0; const timers: number[] = []; let calls = 0;
  const clock = vi.spyOn(performance, 'now').mockImplementation(() => now);
  try {
    const outcome = await solveOnDevice({ ...input, exam }, settings, { solver: 'fixture', verifier: null }, async () => { if (++calls === 1) { now = 130_000; return response(candidate); } return response(pass); }, new AbortController().signal, () => {}, () => {}, (_callback, ms) => { timers.push(ms); return () => {}; });
    expect(timers).toEqual([240_000, 300_000]); expect(outcome).toMatchObject({ status: 'completed', verified: true });
  } finally { clock.mockRestore(); }
});
it('gives a late schema repair at 235s a bounded 20s window and leaves time for verification', async () => {
  let now = 0; let calls = 0; const timers: number[] = [];
  const clock = vi.spyOn(performance, 'now').mockImplementation(() => now);
  try {
    const outcome = await solveOnDevice(input, settings, { solver: 'fixture', verifier: null }, async () => {
      calls++;
      if (calls === 1) { now = 235_000; return response({ ...candidate, answer: null }); }
      if (calls === 2) { now = 254_000; return response(candidate); }
      return response(pass);
    }, new AbortController().signal, () => {}, () => {}, (_callback, ms) => { timers.push(ms); return () => {}; });
    expect(outcome).toMatchObject({ status: 'completed', verified: true });
    expect(timers).toEqual([240_000, 20_000, 300_000]); expect(calls).toBe(3);
  } finally { clock.mockRestore(); }
});
it.each(['cancel', 'deadline'] as const)('rejects a valid-looking late repair after %s', async mode => {
  let now = 0; let calls = 0; let expire = () => {}; const controller = new AbortController();
  const clock = vi.spyOn(performance, 'now').mockImplementation(() => now);
  try {
    const outcome = await solveOnDevice(input, settings, { solver: 'fixture', verifier: null }, async () => {
      if (++calls === 1) { now = 235_000; return response({ ...candidate, answer: null }); }
      if (mode === 'cancel') controller.abort(); else { now = 255_001; expire(); }
      return response(candidate);
    }, controller.signal, () => {}, () => {}, callback => { expire = callback; return () => {}; });
    expect(outcome).toMatchObject(mode === 'cancel' ? { status: 'cancelled', verified: false } : { status: 'failed', error: { code: 'MODEL_TIMEOUT' } });
    expect(calls).toBe(2);
  } finally { clock.mockRestore(); }
});
it('keeps HTTP rejection terminal instead of turning it into a paid repair', async () => {
  let calls = 0;
  const outcome = await solveOnDevice(input, settings, { solver: 'fixture', verifier: null }, async () => { calls++; return new Response('private body', { status: 400 }); }, new AbortController().signal, () => {});
  expect(outcome).toMatchObject({ status: 'failed', error: { code: 'MODEL_REQUEST_REJECTED' } }); expect(calls).toBe(1);
});
it('closes the first unregistered tool request before its history can cause HTTP rejection', async () => {
  let calls = 0;
  const outcome = await solveOnDevice({ ...input, verificationMode: 'manual' }, settings, { solver: 'fixture', verifier: null }, async (_url, init) => {
    if (++calls === 1) return response(undefined, { name: 'grep', arguments: { pattern: 'private' } });
    const body = request(init);
    expect(body.tool_choice).toBe('none'); expect(body.tools).toBeUndefined();
    expect(body.messages.some(m => 'tool_calls' in m || m.role === 'tool')).toBe(false);
    return response(candidate);
  }, new AbortController().signal, () => {});
  expect(outcome.status).toBe('completed'); expect(calls).toBe(2);
});
it('allows a choice answer review 300s when time remains, without adding requests', async () => {
  let calls = 0; const timers: number[] = [];
  const correct = { ...choice, selectedOptions: ['B'] };
  const outcome = await solveOnDevice(input, settings, { solver: 'fixture', verifier: null }, async () => response(++calls === 1 ? correct : { ...pass, independentChoices: [selection('B')] }), new AbortController().signal, () => {}, () => {}, (_callback, ms) => { timers.push(ms); return () => {}; });
  expect(outcome).toMatchObject({ status: 'completed', verified: true });
  expect(timers[1]).toBe(300_000); expect(calls).toBe(2);
});
it.each([230_000, 190_000])('borrows at most 15s only when the first solve has recent streamed progress at %i', async progressAt => {
  let now = 0; let calls = 0; let expire = () => {}; const timers: number[] = [];
  const clock = vi.spyOn(performance, 'now').mockImplementation(() => now);
  try {
    const outcome = await solveOnDevice(input, settings, { solver: 'fixture', verifier: null }, async () => {
      if (++calls !== 1) return response(pass);
      const encoder = new TextEncoder();
      return new Response(new ReadableStream<Uint8Array>({ async start(controller) {
        now = progressAt;
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ id: 'fixture', choices: [{ index: 0, delta: { role: 'assistant', content: JSON.stringify(candidate) }, finish_reason: null }] })}\n\n`));
        await new Promise(resolve => setTimeout(resolve, 20)); // Let the real Pi stream publish the token event.
        now = 240_000; expire();
        if (progressAt === 230_000) now = 250_000;
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`));
        controller.close();
      } }), { headers: { 'content-type': 'text/event-stream' } });
    }, new AbortController().signal, () => {}, () => {}, (callback, ms) => { expire = callback; timers.push(ms); return () => {}; });
    if (progressAt === 230_000) {
      expect(outcome).toMatchObject({ status: 'completed', verified: true });
      expect(timers).toEqual([240_000, 15_000, 300_000]); expect(calls).toBe(2);
    } else {
      expect(outcome).toMatchObject({ status: 'failed', error: { code: 'MODEL_TIMEOUT' } });
      expect(timers).toEqual([240_000]); expect(calls).toBe(1);
    }
  } finally { clock.mockRestore(); }
});
it('reviews the full brief candidate against the image, then revises a reported error once', async () => {
  let calls = 0;
  const corrected = { ...choice, answer: 'The equation gives x=2.', selectedOptions: ['B'] };
  const outcome = await solveOnDevice(input, settings, { solver: 'fixture', verifier: null }, async (_url, init) => {
    calls++;
    if (calls === 1) return response(choice);
    if (calls === 3) return response(corrected);
    const body = request(init);
    const serialized = JSON.stringify(body.messages);
    expect(serialized).toContain(calls === 2 ? choice.answer : corrected.answer);
    const user = body.messages.find(m => m.role === 'user');
    const blocks = z.array(z.looseObject({ type: z.string(), text: z.string().optional() })).parse(user?.content);
    const data = z.looseObject({ candidate: z.looseObject({ problem: z.unknown() }) }).parse(JSON.parse(blocks.find(b => b.type === 'text')!.text!));
    expect(data.candidate).toMatchObject(calls === 2 ? choice : corrected);
    expect(serialized).toContain('data:image/jpeg;base64,AQID'); expect(body.tools).toBeUndefined();
    return response(calls === 2 ? { ...pass, verdict: 'fail', issues: [{ code: 'ARITHMETIC', message: 'The candidate does not satisfy the original equation.' }] } : pass);
  }, new AbortController().signal, () => {});
  expect(outcome).toMatchObject({ status: 'completed', verified: true, candidate: { selectedOptions: ['B'] } }); expect(calls).toBe(4);
});
it('accepts a substantive direct choice review without independently solving options', async () => {
  let calls = 0;
  const outcome = await solveOnDevice(input, settings, { solver: 'fixture', verifier: null }, async () => response(++calls === 1 ? choice : pass), new AbortController().signal, () => {});
  expect(outcome).toMatchObject({ status: 'completed', verified: true, verification: { verdict: 'pass' } }); expect(calls).toBe(2);
});
it.each(['pass', 'fail'] as const)('uses the configured backup once after a direct FAIL and leaves a second %s terminal', async lastVerdict => {
  const configured = LocalSettingsSchema.parse({ ...settings, verifier: { ...settings.solver, baseURL: 'https://review.invalid/v1', model: 'reviewer' }, backup: { ...settings.solver, baseURL: 'https://backup.invalid/v1', model: 'stronger' } });
  const requests: string[] = []; const corrected = { ...choice, answer: 'x=2', selectedOptions: ['B'] };
  const outcome = await solveOnDevice(input, configured, { solver: 'fixture', verifier: 'review-fixture', backup: 'backup-fixture' }, async (url, init) => {
    requests.push(String(url));
    if (requests.length === 1) return response(choice);
    if (requests.length === 3) return response(corrected);
    const body = request(init); const serialized = JSON.stringify(body.messages);
    expect(serialized).toContain(requests.length === 2 ? choice.answer : corrected.answer);
    expect(serialized).toContain('data:image/jpeg;base64,AQID'); expect(body.tools).toBeUndefined();
    return response(requests.length === 2 || lastVerdict === 'fail' ? { ...pass, verdict: 'fail', issues: [{ code: 'ARITHMETIC', message: 'Incorrect answer.' }] } : pass);
  }, new AbortController().signal, () => {});
  expect(requests).toEqual(['https://fixture.invalid/v1/chat/completions', 'https://review.invalid/v1/chat/completions', 'https://backup.invalid/v1/chat/completions', 'https://review.invalid/v1/chat/completions']);
  expect(outcome).toMatchObject({ status: 'completed', verified: lastVerdict === 'pass', candidate: { selectedOptions: ['B'] }, verification: { verdict: lastVerdict } });
});
