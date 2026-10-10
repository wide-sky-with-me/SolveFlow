import { expect, it } from 'vitest';
import { solve, SolvePhaseError, type PhaseExecutor } from './solve.js';
import { RunBudget } from '../policy/run-budget.js';

const input = { schemaVersion: 1, role: 'solver', identity: { ownerId: 'a', sessionId: 's', runId: 'r' }, message: '', image: { mimeType: 'image/png', bytes: new Uint8Array([1]) }, evidence: [], verificationMode: 'manual' };
const answer = { schemaVersion: 1, kind: 'answer', problem: { text: 'x+1=3', subject: 'math', uncertainties: [] }, answer: 'x=2', steps: [], knowledgePoints: [], citationIds: [], clarificationQuestions: [] };
const verdict = (pass: boolean) => ({ role: 'verifier', events: [], verification: { schemaVersion: 1, verdict: pass ? 'pass' : 'fail', checked: ['transcription', 'logic'], issues: pass ? [] : [{ code: 'LOGIC', message: '重新求解' }] } });

it('recovers an unavailable solver with the configured backup and independently verifies it', async () => {
  let backupCalls = 0; let checks = 0;
  const primary: PhaseExecutor = async value => { if (value.role === 'solver') throw new SolvePhaseError('MODEL_UNAVAILABLE'); checks++; return verdict(true); };
  const result = await solve(input, primary, new RunBudget(), new AbortController().signal, () => {}, { execute: async value => { backupCalls++; expect(value.image).toEqual(input.image); return { role: 'solver', candidate: answer, events: [] }; } });
  expect(result).toMatchObject({ status: 'completed', verified: true }); expect(backupCalls).toBe(1); expect(checks).toBe(1);
});

it('uses backup for an automatic FAIL and does not perform a second backup revision', async () => {
  let backupCalls = 0; let solverCalls = 0; let checks = 0;
  const result = await solve({ ...input, verificationMode: 'automatic' }, async value => value.role === 'solver'
    ? (solverCalls++, { role: 'solver', candidate: answer, events: [] }) : (checks++, verdict(false)),
  new RunBudget(), new AbortController().signal, () => {}, { execute: async value => { backupCalls++; expect(value.role === 'solver' && value.revision?.issues).toHaveLength(1); return { role: 'solver', candidate: answer, events: [] }; } });
  expect(result).toMatchObject({ status: 'completed', verified: false, verification: { verdict: 'fail' } });
  expect(solverCalls).toBe(1); expect(backupCalls).toBe(1); expect(checks).toBe(2);
});

it.each(['CANCELLED', 'SPEND_LIMIT', 'CAPABILITY_DENIED', 'RUN_TIMEOUT', 'MODEL_LIMIT', 'TOOL_LIMIT'] as const)('does not recover the nonrecoverable error %s', async code => {
  let calls = 0;
  const result = await solve(input, async () => { throw new SolvePhaseError(code); }, new RunBudget(), new AbortController().signal, () => {}, { execute: async () => { calls++; return { role: 'solver', candidate: answer, events: [] }; } });
  expect(result.status).toBe(code === 'CANCELLED' ? 'cancelled' : 'failed'); expect(calls).toBe(0);
});

it('cancellation during backup beats a late answer and suppresses verification', async () => {
  const controller = new AbortController(); let checks = 0;
  const result = await solve(input, async value => { if (value.role === 'solver') throw new SolvePhaseError('MODEL_OUTPUT_INVALID'); checks++; return verdict(true); }, new RunBudget(), controller.signal, () => {}, { execute: async () => { controller.abort(); return { role: 'solver', candidate: answer, events: [] }; } });
  expect(result.status).toBe('cancelled'); expect(checks).toBe(0);
});

it('allows the stronger model to reconsider clarification once and still verifies its answer', async () => {
  let calls = 0;
  const result = await solve(input, async value => value.role === 'verifier' ? verdict(true) : ({ role: 'solver', candidate: { ...answer, kind: 'clarification', answer: null, clarificationQuestions: ['请补充清晰题图'] }, events: [] }), new RunBudget(), new AbortController().signal, () => {}, { execute: async value => { calls++; expect(value.image).toEqual(input.image); return { role: 'solver', candidate: answer, events: [] }; } });
  expect(result).toMatchObject({ status: 'completed', verified: true }); expect(calls).toBe(1);
});

it('preserves clarification when the stronger model also lacks a decisive condition', async () => {
  let calls = 0;
  const clarify = { role: 'solver', candidate: { ...answer, kind: 'clarification', answer: null, clarificationQuestions: ['请补充缺失的数值'] }, events: [] };
  const result = await solve(input, async () => clarify, new RunBudget(), new AbortController().signal, () => {}, { execute: async () => { calls++; return clarify; } });
  expect(result.status).toBe('needs_clarification'); expect(calls).toBe(1);
});

it('retains the first answer with its failed check if the one stronger correction times out', async () => {
  let calls = 0;
  const result = await solve({ ...input, verificationMode: 'automatic' }, async value => value.role === 'solver' ? { role: 'solver', candidate: answer, events: [] } : verdict(false), new RunBudget(), new AbortController().signal, () => {}, { execute: async () => { calls++; throw new SolvePhaseError('MODEL_TIMEOUT'); } });
  expect(result).toMatchObject({ status: 'completed', verified: false, candidate: answer, verification: { verdict: 'fail' }, warning: 'MODEL_TIMEOUT' });
  expect(calls).toBe(1);
});
