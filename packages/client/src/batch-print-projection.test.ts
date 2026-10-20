import { afterEach, expect, it, vi } from 'vitest';
import { BatchPrintSnapshotSchema } from '@solveflow/contracts/local';
import { projectBatchPrintSnapshot, questionsForBatchPrint, questionsForBatchQuestionPrint } from './batch-print-variants.js';

const id = '00000000-0000-4000-8000-000000000001';
const at = '2026-10-16T01:00:00.000Z';
function source(answered = true) {
  const uncertainties: string[] = [];
  return { schemaVersion: 1, exportedAt: at,
    batch: { id, title: 'Synthetic projection', exam: 'general', createdAt: at },
    records: [{ schemaVersion: 1, image: 'data:image/jpeg;base64,AQID',
      batch: { id, title: 'Synthetic projection', exam: 'general', createdAt: at, position: 1 },
      session: { schemaVersion: 1, id, subject: 'math', createdAt: at,
        upload: { schemaVersion: 1, id, mimeType: 'image/jpeg', bytes: 3, width: 30, height: 20, expiresAt: at, previewUrl: `/api/v1/uploads/${id}/image` },
        runs: answered ? [{ schemaVersion: 1, id, sessionId: id, status: 'completed', message: '', seq: 1, createdAt: at,
          outcome: { schemaVersion: 1, status: 'completed', verified: false, verification: null, warning: null, verificationStatus: 'not_requested',
            candidate: { schemaVersion: 1, kind: 'answer', problem: { text: 'Synthetic question', subject: 'math', uncertainties }, answer: 'PRIVATE_ANSWER', steps: [], knowledgePoints: [], clarificationQuestions: [], citationIds: [] } } }] : [] } }] };
}
afterEach(() => vi.restoreAllMocks());

it.each([false, true])('validates the entire source once when answer projection is %s', includeAnswers => {
  const input = source();
  const expectedProblems = questionsForBatchQuestionPrint(input);
  const expectedAnswers = includeAnswers ? questionsForBatchPrint(input) : [];
  const parse = vi.spyOn(BatchPrintSnapshotSchema, 'parse');
  const output = projectBatchPrintSnapshot(input, includeAnswers);
  expect(parse).toHaveBeenCalledTimes(1);
  expect(output.problems).toEqual(expectedProblems);
  expect(output.questions).toEqual(expectedAnswers);
  expect(output.problems[0]).toMatchObject({ recordId: id, ordinal: 1, problem: { text: 'Synthetic question' } });
  expect(JSON.stringify(output.problems)).not.toContain('PRIVATE_ANSWER');
});

it('keeps unanswered source projection available without creating answers', () => {
  const input = source(false);
  const output = projectBatchPrintSnapshot(input, false);
  expect(output.problems).toEqual([{ key: `${id}/unanswered`, recordId: id, ordinal: 1, problem: null }]);
  expect(output.questions).toEqual([]);
  expect(() => projectBatchPrintSnapshot(input, true)).toThrow('完整已保存回答');
});

it('runs the caller page gate before answer extraction, including incomplete answers', () => {
  const gateError = new Error('PAGE_GATE');
  const gate = vi.fn(() => { throw gateError; });
  expect(() => projectBatchPrintSnapshot(source(false), true, gate)).toThrow(gateError);
  expect(gate).toHaveBeenCalledExactlyOnceWith(1);
});

it('gates the number of subquestions rather than the number of source records', () => {
  const input = source();
  const candidate = input.records[0]!.session.runs[0]!.outcome.candidate;
  Object.assign(candidate, { questions: [1, 2, 3].map(number => ({ number, answer: String(number), problem: candidate.problem, stepIds: [], figureIds: [] })) });
  const gate = vi.fn();
  const output = projectBatchPrintSnapshot(input, true, gate);
  expect(gate).toHaveBeenCalledExactlyOnceWith(3);
  expect(output.questions.map(question => question.candidate.answer)).toEqual(['1', '2', '3']);
  expect(output.problems.map(problem => problem.ordinal)).toEqual([1, 2, 3]);
});

it.each(['image', 'metadata', 'answer'])('retains full schema errors for invalid %s before the page gate', field => {
  const input = source();
  if (field === 'image') input.records[0]!.image = 'data:image/jpeg;base64,A\n';
  if (field === 'metadata') input.records[0]!.session.id = 'invalid-id';
  if (field === 'answer') Object.assign(input.records[0]!.session.runs[0]!.outcome.candidate, { answer: 123 });
  const expected = BatchPrintSnapshotSchema.safeParse(input);
  if (expected.success) throw new Error('Fixture must fail source validation');
  const gate = vi.fn();
  let error: unknown;
  try { projectBatchPrintSnapshot(input, false, gate); } catch (cause) { error = cause; }
  expect(error).toMatchObject({ issues: expected.error.issues });
  expect(gate).not.toHaveBeenCalled();
});

it('does not mutate source data, return it by identity, or cache mutable input validation', () => {
  const input = source();
  const before = JSON.stringify(input);
  const output = projectBatchPrintSnapshot(input, true);
  expect(JSON.stringify(input)).toBe(before);
  expect(output.snapshot).not.toBe(input);
  expect(output.snapshot.records).not.toBe(input.records);
  input.records[0]!.image = 'invalid';
  input.records[0]!.session.runs[0]!.outcome.candidate.answer = 'changed';
  input.records[0]!.session.runs[0]!.outcome.candidate.problem.uncertainties.push('changed');
  expect(output.snapshot.records[0]!.image).toBe('data:image/jpeg;base64,AQID');
  expect(output.questions[0]?.candidate.answer).toBe('PRIVATE_ANSWER');
  const saved = output.snapshot.records[0]!.session.runs[0]?.outcome;
  if (saved?.status !== 'completed') throw new Error('Projection fixture missing answer');
  expect(saved.candidate.answer).toBe('PRIVATE_ANSWER');
  expect(saved.candidate.problem.uncertainties).toEqual([]);
  expect(() => projectBatchPrintSnapshot(input, false)).toThrow();
  expect(() => questionsForBatchQuestionPrint(input)).toThrow();
  expect(() => questionsForBatchPrint(input)).toThrow();
});
