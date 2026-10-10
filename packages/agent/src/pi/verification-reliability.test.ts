import { expect, it, vi } from 'vitest';
import { LocalSettingsSchema } from '@solveflow/contracts/local';
import { AnswerCandidateSchema, VerificationSchema, type SolverInput } from '@solveflow/contracts/agent';
import { solveOnDevice } from './mobile.js';
import { solve } from '../orchestration/solve.js';
import { RunBudget } from '../policy/run-budget.js';

const input: SolverInput = { schemaVersion: 1, role: 'solver', identity: { ownerId: 'offline', sessionId: 'offline', runId: 'offline' }, message: '', image: { bytes: Uint8Array.of(1), mimeType: 'image/jpeg' }, evidence: [] };
const settings = LocalSettingsSchema.parse({ schemaVersion: 1, solver: { provider: 'fixture', baseURL: 'https://model.invalid/v1', model: 'fixture', api: 'openai-completions', contextWindow: 32768, maxTokens: 8192, maxTokensField: 'max_tokens' }, verifier: null });
const candidate = AnswerCandidateSchema.parse({ schemaVersion: 1, kind: 'answer', problem: { text: 'Compute two results.', subject: 'math', uncertainties: [], response: { type: 'multipart', parts: ['(a)', '(b)'] } }, answer: 'Two results.', parts: [{ label: '(a)', answer: '2' }, { label: '(b)', answer: '4' }], steps: [], knowledgePoints: [], citationIds: [], clarificationQuestions: [] });
const pass = { schemaVersion: 1, verdict: 'pass', checked: ['transcription', 'logic'], issues: [] };
const unit = (partLabel: string, questionNumber?: number) => ({ ...(questionNumber === undefined ? {} : { questionNumber }), partLabel, verdict: 'pass', checked: ['transcription', 'arithmetic'] });
function response(value: unknown) { return new Response(`data: ${JSON.stringify({ id: 'fixture', choices: [{ index: 0, delta: { role: 'assistant', content: JSON.stringify(value) }, finish_reason: null }] })}\n\ndata: ${JSON.stringify({ id: 'fixture', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`, { headers: { 'content-type': 'text/event-stream' } }); }

it('preserves historical verification records without requiring new coverage fields', () => {
  expect(VerificationSchema.parse(pass)).toEqual(pass);
});
it.each([
  { name: 'omitted coverage', coverage: undefined },
  { name: 'missing part', coverage: [unit('(a)')] },
  { name: 'duplicate part', coverage: [unit('(a)'), unit('(a)')] },
  { name: 'extra requirement seen in the image', coverage: [unit('(a)'), unit('(b)'), unit('(c)')] },
  { name: 'unrelated question', coverage: [unit('(a)', 9), unit('(b)', 9)] },
  { name: 'no substantive check', coverage: [unit('(a)'), { ...unit('(b)'), checked: ['transcription'] }] },
  { name: 'unreadable part', coverage: [unit('(a)'), { ...unit('(b)'), verdict: 'unknown' }] },
])('does not publish multipart PASS with $name on either execution path', async ({ coverage }) => {
  const verification = { ...pass, ...(coverage ? { coverage } : {}) };
  const outcome = await solve(input, async phase => phase.role === 'solver' ? { role: 'solver', candidate, events: [] } : { role: 'verifier', verification, events: [] }, new RunBudget(), new AbortController().signal);
  expect(outcome).toMatchObject({ status: 'completed', verified: false, verification: { verdict: 'unknown', issues: [{ code: 'INSUFFICIENT_EVIDENCE' }] } });
  let calls = 0;
  const device = await solveOnDevice(input, settings, { solver: 'fixture', verifier: null }, async () => response(++calls === 1 ? candidate : verification), new AbortController().signal, () => {});
  expect(device).toMatchObject({ status: 'completed', verified: false });
  expect(calls).toBe(2);
});
it('accepts all independently checked parts without additional model calls', async () => {
  let calls = 0;
  const outcome = await solveOnDevice(input, settings, { solver: 'fixture', verifier: null }, async () => response(++calls === 1 ? candidate : { ...pass, coverage: [unit('(b)'), unit('(a)')] }), new AbortController().signal, () => {});
  expect(outcome).toMatchObject({ status: 'completed', verified: true });
  expect(calls).toBe(2);
});
it('requires coverage for each question instead of sharing the first question checks', async () => {
  const grouped = AnswerCandidateSchema.parse({ ...candidate, parts: undefined, problem: { text: 'Questions 1 and 2.', subject: 'math', uncertainties: [] }, questions: [1, 2].map(number => ({ number, problem: { ...candidate.problem, response: undefined }, answer: `${number}`, stepIds: [], figureIds: [] })) });
  const verification = { ...pass, coverage: [1, 1].map(questionNumber => ({ questionNumber, verdict: 'pass', checked: ['transcription', 'arithmetic'] })) };
  const outcome = await solve(input, async phase => phase.role === 'solver' ? { role: 'solver', candidate: grouped, events: [] } : { role: 'verifier', verification, events: [] }, new RunBudget(), new AbortController().signal);
  expect(outcome).toMatchObject({ status: 'completed', verified: false, verification: { verdict: 'unknown' } });
});
it.each([false, true])('checks each multipart label within its own question (swapped: %s)', async swapped => {
  const grouped = AnswerCandidateSchema.parse({ ...candidate, parts: undefined, problem: { text: 'Two questions, two parts each.', subject: 'math', uncertainties: [] }, questions: [1, 2].map(number => ({ number, problem: { ...candidate.problem, response: { type: 'multipart', parts: number === 1 ? ['(a)', '(b)'] : ['(i)', '(ii)'] } }, parts: (number === 1 ? ['(a)', '(b)'] : ['(i)', '(ii)']).map(label => ({ label, answer: '2' })), answer: 'Two results.', stepIds: [], figureIds: [] })) });
  const verification = { ...pass, coverage: [unit('(a)', swapped ? 2 : 1), unit('(b)', swapped ? 2 : 1), unit('(i)', swapped ? 1 : 2), unit('(ii)', swapped ? 1 : 2)] };
  const outcome = await solve(input, async phase => phase.role === 'solver' ? { role: 'solver', candidate: grouped, events: [] } : { role: 'verifier', verification, events: [] }, new RunBudget(), new AbortController().signal);
  expect(outcome).toMatchObject({ status: 'completed', verified: !swapped, verification: { verdict: swapped ? 'unknown' : 'pass' } });
});
it('rechecks historical multipart answers with the current coverage gate in one paid phase', async () => {
  let calls = 0;
  const outcome = await solveOnDevice({ ...input, verificationMode: 'manual', verificationTarget: candidate }, settings, { solver: 'fixture', verifier: null }, async () => { calls++; return response(pass); }, new AbortController().signal, () => {});
  expect(outcome).toMatchObject({ status: 'completed', verified: false, verification: { verdict: 'unknown' }, candidate: { parts: candidate.parts } });
  expect(calls).toBe(1);
});
it('preserves a real FAIL and its issue even when part coverage is incomplete', async () => {
  let checks = 0;
  const fail = { ...pass, verdict: 'fail', coverage: [{ ...unit('(a)'), verdict: 'fail' }], issues: [{ code: 'ARITHMETIC', message: 'Part (a) is incorrect.' }] };
  const outcome = await solve(input, async phase => {
    if (phase.role === 'solver') return { role: 'solver', candidate, events: [] };
    checks++; return { role: 'verifier', verification: fail, events: [] };
  }, new RunBudget(), new AbortController().signal);
  expect(outcome).toMatchObject({ status: 'completed', verified: false, verification: fail });
  expect(checks).toBe(2);
});
it('applies substantive checks at the shared orchestration boundary too', async () => {
  const single = AnswerCandidateSchema.parse({ ...candidate, parts: undefined, problem: { ...candidate.problem, response: undefined } });
  const outcome = await solve(input, async phase => phase.role === 'solver' ? { role: 'solver', candidate: single, events: [] } : { role: 'verifier', verification: { ...pass, checked: ['transcription'] }, events: [] }, new RunBudget(), new AbortController().signal);
  expect(outcome).toMatchObject({ status: 'completed', verified: false, verification: { verdict: 'unknown' } });
});
it('gives a short essay the 300s verifier window without shortening the first solve by exam name', async () => {
  let now = 0; const timers: number[] = []; let calls = 0;
  const clock = vi.spyOn(performance, 'now').mockImplementation(() => now);
  try {
    const essay = { ...candidate, parts: undefined, answer: 'A short but complete essay.', problem: { ...candidate.problem, response: { type: 'essay' } } };
    const outcome = await solveOnDevice({ ...input, exam: 'ap' }, settings, { solver: 'fixture', verifier: null }, async () => { if (++calls === 1) { now = 70_000; return response(essay); } return response(pass); }, new AbortController().signal, () => {}, () => {}, (_callback, ms) => { timers.push(ms); return () => {}; });
    expect(timers).toEqual([240_000, 300_000]);
    expect(outcome).toMatchObject({ status: 'completed', verified: true });
  } finally { clock.mockRestore(); }
});
it('allows 300s for explicitly declared short multipart answers with a finite independent deadline', async () => {
  const timers: number[] = []; let calls = 0;
  const outcome = await solveOnDevice(input, settings, { solver: 'fixture', verifier: null }, async () => response(++calls === 1 ? candidate : { ...pass, coverage: [unit('(a)'), unit('(b)')] }), new AbortController().signal, () => {}, () => {}, (_callback, ms) => { timers.push(ms); return () => {}; });
  expect(timers).toEqual([240_000, 300_000]);
  expect(outcome).toMatchObject({ status: 'completed', verified: true });
});
it('allows 300s for a structured chemistry check and preserves configured model parameters', async () => {
  const timers: number[] = []; let calls = 0;
  const term = (formula: string, coefficient: number) => ({ formula, coefficient, charge: 0 });
  const chemistry = { ...candidate, parts: undefined, problem: { text: 'Balance the reaction.', subject: 'chemistry', uncertainties: [] }, answer: '2H2 + O2 -> 2H2O', chemistry: { reactions: [{ reactants: [term('H2', 2), term('O2', 1)], products: [term('H2O', 2)], arrow: 'forward' }] } };
  const outcome = await solveOnDevice(input, settings, { solver: 'fixture', verifier: null }, async (_url, init) => {
    expect(JSON.parse(String(init?.body))).toMatchObject({ model: 'fixture', max_tokens: 8192 });
    return response(++calls === 1 ? chemistry : pass);
  }, new AbortController().signal, () => {}, () => {}, (_callback, ms) => { timers.push(ms); return () => {}; });
  expect(timers).toEqual([240_000, 300_000]);
  expect(outcome).toMatchObject({ status: 'completed', verified: true });
});
it('cancels a long-response verification without accepting its late PASS', async () => {
  let calls = 0; const controller = new AbortController();
  const outcome = await solveOnDevice(input, settings, { solver: 'fixture', verifier: null }, async () => {
    if (++calls === 1) return response(candidate);
    controller.abort(); return response({ ...pass, coverage: [unit('(a)'), unit('(b)')] });
  }, controller.signal, () => {});
  expect(outcome).toMatchObject({ status: 'cancelled', verified: false });
  expect(calls).toBe(2);
});
it('completes a multipart correction after 180s without clipping its verification window', async () => {
  let now = 0; let calls = 0; const timers: number[] = [];
  const clock = vi.spyOn(performance, 'now').mockImplementation(() => now);
  const fail = { ...pass, verdict: 'fail', issues: [{ code: 'ARITHMETIC', message: 'Check part (a).' }] };
  try {
    const outcome = await solveOnDevice({ ...input, exam: 'ap' }, settings, { solver: 'fixture', verifier: null }, async () => {
      calls++;
      if (calls === 1) { now = 130_000; return response(candidate); }
      if (calls === 2) { now = 200_000; return response(fail); }
      if (calls === 3) { now = 220_000; return response(candidate); }
      return response({ ...pass, coverage: [unit('(a)'), unit('(b)')] });
    }, new AbortController().signal, () => {}, () => {}, (_callback, ms) => { timers.push(ms); return () => {}; });
    expect(outcome).toMatchObject({ status: 'completed', verified: true });
    expect(calls).toBe(4);
    expect(timers[2]).toBe(240_000);
    expect(timers[3]).toBe(300_000);
    expect(now).toBeGreaterThan(180_000);
  } finally { clock.mockRestore(); }
});
