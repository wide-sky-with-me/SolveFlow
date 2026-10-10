import { expect, it } from 'vitest';
import type { SolverInput } from '@solveflow/contracts/agent';
import { solve } from './solve.js';
import { RunBudget } from '../policy/run-budget.js';
const input: SolverInput = { schemaVersion: 1, role: 'solver', exam: 'esat', identity: { ownerId: 'offline', sessionId: 'offline', runId: 'offline' }, message: '', image: { bytes: Uint8Array.of(1), mimeType: 'image/jpeg' }, evidence: [], answerMode: 'brief', verificationMode: 'manual' };
const candidate = { schemaVersion: 1, kind: 'answer', problem: { text: 'Select one.', subject: 'math', uncertainties: [], options: [{ label: 'A', text: '1' }, { label: 'B', text: '2' }] }, selectedOptions: ['A', 'B'], answer: 'Synthetic response.', steps: [], knowledgePoints: [], citationIds: [], clarificationQuestions: [] };
it('does not publish two selected options as a completed ESAT single choice', async () => {
  const result = await solve(input, async () => ({ role: 'solver', candidate, events: [] }), new RunBudget(), new AbortController().signal);
  expect(result.status).toBe('failed');
});
it('does not publish an over-limit TARA written answer', async () => {
  const essay = { ...candidate, problem: { text: 'Write an essay of no more than 750 words.', subject: 'english', uncertainties: [] }, selectedOptions: undefined, answer: Array(751).fill('word').join(' ') };
  const result = await solve({ ...input, exam: 'tara' }, async () => ({ role: 'solver', candidate: essay, events: [] }), new RunBudget(), new AbortController().signal);
  expect(result.status).toBe('failed');
});
it('rejects an invalid historical exam answer before paying for manual verification', async () => {
  let calls = 0;
  const result = await solve({ ...input, verificationTarget: candidate }, async () => {
    calls++;
    return { role: 'verifier', verification: { schemaVersion: 1, verdict: 'pass', checked: ['transcription', 'logic'], issues: [] }, events: [] };
  }, new RunBudget(), new AbortController().signal);
  expect(result).toMatchObject({ status: 'completed', verified: false, verification: { verdict: 'fail', issues: [{ code: 'INVALID_CANDIDATE' }] } });
  expect(calls).toBe(0);
});
