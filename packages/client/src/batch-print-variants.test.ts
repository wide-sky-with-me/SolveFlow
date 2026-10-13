import { expect, it } from 'vitest';
import { BatchPrintSnapshotSchema, type BatchPrintSnapshot } from '@solveflow/contracts/local';
import { questionsForBatchPrint, planBatchPrintCopies, batchPrintFilename, batchQuestionFilename } from './batch-print-variants.js';

const id = (value: number) => `00000000-0000-4000-8000-${String(value).padStart(12, '0')}`;
const at = '2026-10-13T01:00:00.000Z';
function candidate(choice = true) {
  return { schemaVersion: 1, kind: 'answer', problem: { text: 'Synthetic question', subject: 'math', uncertainties: [], ...(choice ? { options: [{ label: 'A', text: '1' }, { label: 'B', text: '2' }, { label: 'C', text: '3' }], response: { type: 'single-choice' } } : {}) }, answer: choice ? 'A: saved explanation' : 'x=1', ...(choice ? { selectedOptions: ['A'] } : {}), steps: [], clarificationQuestions: [], citationIds: [], knowledgePoints: [] };
}
function snapshot(wrong = false, choice = true, records = 3): BatchPrintSnapshot {
  const batch = { id: id(99), title: 'Synthetic batch', exam: 'general', createdAt: at };
  return BatchPrintSnapshotSchema.parse({ schemaVersion: 1, batch, exportedAt: at, records: Array.from({ length: records }, (_, index) => ({ schemaVersion: 1, batch: { ...batch, position: index + 1 }, image: 'data:image/jpeg;base64,AQID', session: { schemaVersion: 1, id: id(index + 1), subject: 'math', createdAt: at, upload: { schemaVersion: 1, id: id(index + 20), mimeType: 'image/jpeg', bytes: 3, width: 30, height: 20, expiresAt: at, previewUrl: `/api/v1/uploads/${id(index + 20)}/image` }, runs: [{ schemaVersion: 1, id: id(index + 40), sessionId: id(index + 1), status: 'completed', message: '', seq: 1, createdAt: at, outcome: { schemaVersion: 1, status: 'completed', candidate: candidate(choice), verified: false, warning: null, ...(wrong && index === 0 ? { verification: { schemaVersion: 1, verdict: 'fail', checked: ['arithmetic'], issues: [{ code: 'ARITHMETIC', message: 'Synthetic mismatch' }] } } : { verification: null, verificationStatus: 'not_requested' }) } }] } })) });
}

it('preserves saved candidates and red warnings by default while assuming unverified saved answers correct', () => {
  const source = snapshot(true); const before = JSON.stringify(source); const questions = questionsForBatchPrint(source);
  const [copy] = planBatchPrintCopies(questions, [{ correct: 2, incorrect: 1 }]);
  expect(copy?.answers.map(answer => answer.incorrect)).toEqual([true, false, false]);
  expect(copy?.answers.every(answer => !answer.changed)).toBe(true);
  expect(copy?.answers.map(answer => answer.answer)).toEqual(questions.map(question => question.candidate.answer));
  expect(questions.every(question => !source.records.find(record => record.session.id === question.recordId)?.session.runs[0]?.outcome?.verified)).toBe(true);
  expect(JSON.stringify(source)).toBe(before);
});
it('adjusts actual option labels and deterministically varies both selected questions and options across copies', () => {
  const questions = questionsForBatchPrint(snapshot()); const requests = Array.from({ length: 10 }, () => ({ correct: 2, incorrect: 1 }));
  const copies = planBatchPrintCopies(questions, requests);
  expect(copies).toEqual(planBatchPrintCopies(questions, requests));
  expect(new Set(copies.map(copy => copy.answers.find(answer => answer.incorrect)?.key)).size).toBe(3);
  for (const copy of copies) {
    const wrong = copy.answers.filter(answer => answer.incorrect); expect(wrong).toHaveLength(1);
    expect(wrong[0]?.selectedOptions?.[0]).not.toBe('A'); expect(wrong[0]?.answer).toBe(wrong[0]?.selectedOptions?.join('、'));
    expect(copy.answers.filter(answer => !answer.changed).every(answer => answer.answer === 'A: saved explanation')).toBe(true);
  }
});
it('uses all distinct error combinations before repeating when enough combinations exist', () => {
  const questions = questionsForBatchPrint(snapshot(false, true, 5));
  const copies = planBatchPrintCopies(questions, Array.from({ length: 10 }, () => ({ correct: 3, incorrect: 2 })));
  expect(new Set(copies.map(copy => copy.answers.filter(answer => answer.incorrect).map(answer => answer.key).join('|'))).size).toBe(10);
});
it('requires a valid per-question reference before reducing known failures and rejects foreign references', () => {
  const questions = questionsForBatchPrint(snapshot(true)); const red = questions[0]!;
  expect(() => planBatchPrintCopies(questions, [{ correct: 3, incorrect: 0 }])).toThrow('参照');
  expect(() => planBatchPrintCopies(questions, [{ correct: 3, incorrect: 0 }], [{ key: red.key, referenceOptions: ['Z'] }])).toThrow('无效');
  expect(() => planBatchPrintCopies(questions, [{ correct: 3, incorrect: 0 }], [{ key: 'foreign', referenceOptions: ['B'] }])).toThrow('本批之外');
  const copy = planBatchPrintCopies(questions, [{ correct: 3, incorrect: 0 }], [{ key: red.key, referenceOptions: ['B'] }])[0]!;
  expect(copy.answers[0]).toMatchObject({ selectedOptions: ['B'], answer: 'B', incorrect: false, changed: true });
  expect(red.baselineWrong).toBe(true); expect(red.candidate.selectedOptions).toEqual(['A']);
});
it('keeps actual answers consistent with an explicit reference even when the requested counts match the original baseline', () => {
  const questions = questionsForBatchPrint(snapshot()); const first = questions[0]!;
  const copy = planBatchPrintCopies(questions, [{ correct: 3, incorrect: 0 }], [{ key: first.key, referenceOptions: ['B'] }])[0]!;
  expect(copy.answers[0]).toMatchObject({ selectedOptions: ['B'], changed: true, incorrect: false });
  expect(first.candidate.selectedOptions).toEqual(['A']);
  const red = questionsForBatchPrint(snapshot(true));
  const preservedCount = planBatchPrintCopies(red, [{ correct: 2, incorrect: 1 }], [{ key: red[0]!.key, referenceOptions: ['A'] }])[0]!;
  expect(preservedCount.answers[0]?.selectedOptions).not.toEqual(['A']); expect(preservedCount.incorrect).toBe(1);
});
it('counts multi-question conversations individually and uses the matching saved verification', () => {
  const source = snapshot(false, false, 1); const root = source.records[0]!.session.runs[0]!;
  if (root.outcome?.status !== 'completed') throw new Error('Fixture missing completed answer');
  root.outcome.candidate.questions = [{ number: 1, answer: 'x=1', problem: root.outcome.candidate.problem, stepIds: [], figureIds: [] }, { number: 2, answer: 'x=2', problem: root.outcome.candidate.problem, stepIds: [], figureIds: [] }];
  const result = questionsForBatchPrint(source);
  expect(result).toHaveLength(2); expect(result.map(question => question.candidate.answer)).toEqual(['x=1', 'x=2']);
  expect(planBatchPrintCopies(result, [{ correct: 1, incorrect: 1 }])[0]?.answers.filter(answer => answer.incorrect)).toHaveLength(1);
  const single = snapshot(); const first = single.records[0]!.session.runs[0]!;
  if (first.outcome?.status !== 'completed') throw new Error('Fixture missing completed answer');
  single.records[0]!.session.runs.push({ ...first, id: id(90), context: { kind: 'verification', sourceRunId: first.id }, outcome: { ...first.outcome, verificationStatus: undefined, verification: { schemaVersion: 1, verdict: 'fail', issues: [{ code: 'ARITHMETIC', message: 'Mismatch' }], checked: ['arithmetic'] } } });
  expect(questionsForBatchPrint(single)[0]?.baselineWrong).toBe(true);
});
it('keeps unknown verification as assumed correct, rejects incomplete answers and fixed-total/count violations', () => {
  const source = snapshot(); const first = source.records[0]!.session.runs[0]!;
  if (first.outcome?.status !== 'completed') throw new Error('Fixture missing completed answer');
  first.outcome = { ...first.outcome, verificationStatus: undefined, verification: { schemaVersion: 1, verdict: 'unknown', issues: [{ code: 'INSUFFICIENT_EVIDENCE', message: 'Unclear' }], checked: [] } };
  const questions = questionsForBatchPrint(source); expect(questions[0]?.baselineWrong).toBe(false);
  expect(() => planBatchPrintCopies(questions, [{ correct: 1, incorrect: 1 }])).toThrow('总题数');
  expect(() => planBatchPrintCopies(questions, [{ correct: 2.5, incorrect: .5 }])).toThrow();
  expect(() => planBatchPrintCopies(questions, Array.from({ length: 21 }, () => ({ correct: 3, incorrect: 0 })))).toThrow();
  source.records[0]!.session.runs = [];
  expect(() => questionsForBatchPrint(source)).toThrow('完整已保存回答');
});
it('uses the latest main saved answer without inheriting a red warning from an older answer', () => {
  const source = snapshot(true, true, 1); const first = source.records[0]!.session.runs[0]!;
  if (first.outcome?.status !== 'completed') throw new Error('Fixture missing completed answer');
  const latest = { ...first, id: id(90), context: { kind: 'reply' as const, sourceRunId: first.id }, outcome: { ...first.outcome, verification: null, verificationStatus: 'not_requested' as const, candidate: { ...first.outcome.candidate, selectedOptions: ['B'], answer: 'B: corrected saved answer' } } };
  source.records[0]!.session.runs.push(latest);
  expect(questionsForBatchPrint(source)[0]).toMatchObject({ runId: latest.id, baselineWrong: false, candidate: { answer: 'B: corrected saved answer' } });
});
it('uses an unanswered response as a real wrong answer for non-choice questions and requires reference to correct red answers', () => {
  const questions = questionsForBatchPrint(snapshot(false, false));
  expect(planBatchPrintCopies(questions, [{ correct: 2, incorrect: 1 }])[0]?.answers.find(answer => answer.incorrect)?.answer).toBe('');
  expect(() => planBatchPrintCopies(questions, [{ correct: 0, incorrect: 3 }], questions.map(question => ({ key: question.key, wrongAnswer: 'x=1' })))).toThrow('可调整');
  const red = questionsForBatchPrint(snapshot(true, false));
  expect(() => planBatchPrintCopies(red, [{ correct: 3, incorrect: 0 }])).toThrow('参照');
  expect(planBatchPrintCopies(red, [{ correct: 3, incorrect: 0 }], [{ key: red[0]!.key, referenceAnswer: 'x=2' }])[0]?.answers[0]?.answer).toBe('x=2');
});
it('rejects choice changes with incomplete labels or no valid alternative and sanitizes copy filenames', () => {
  const source = snapshot(false, true, 1); const run = source.records[0]!.session.runs[0]!;
  if (run.outcome?.status !== 'completed') throw new Error('Fixture missing completed answer');
  run.outcome.candidate.problem.options = [{ label: 'A', text: '1' }]; run.outcome.candidate.problem.optionsComplete = false; run.outcome.candidate.problem.uncertainties = ['Missing options'];
  delete run.outcome.candidate.selectedOptions;
  expect(() => planBatchPrintCopies(questionsForBatchPrint(source), [{ correct: 0, incorrect: 1 }])).toThrow('可调整');
  run.outcome.candidate.problem.options = [{ label: 'A', text: '1' }, { label: 'B', text: '2' }]; delete run.outcome.candidate.problem.optionsComplete; run.outcome.candidate.selectedOptions = ['A'];
  const pair = questionsForBatchPrint(source);
  expect(() => planBatchPrintCopies(pair, [{ correct: 0, incorrect: 1 }], [{ key: pair[0]!.key, referenceOptions: ['B'] }])).toThrow('可调整');
  const copy = planBatchPrintCopies(questionsForBatchPrint(snapshot()), [{ correct: 3, incorrect: 0 }])[0]!;
  expect(batchPrintFilename('Maths:/1', copy)).toBe('Maths__1_总3_对3_错0.pdf');
  expect(batchPrintFilename('Maths:/1', copy, { multiple: true })).toBe('Maths__1_总3_对3_错0_01.pdf');
  const long = batchPrintFilename('数学试卷'.repeat(25), copy, { multiple: true });
  expect(new TextEncoder().encode(long).byteLength).toBeLessThanOrEqual(240); expect(long).toMatch(/_总3_对3_错0_01\.pdf$/);
});
it('names question-only files without answer statistics and bounds total and filename bytes', () => {
  expect(batchQuestionFilename('Maths:/1', 27)).toBe('Maths__1_总27_纯题目.pdf');
  const long = batchQuestionFilename('数学试卷'.repeat(25), 400);
  expect(new TextEncoder().encode(long).byteLength).toBeLessThanOrEqual(240); expect(long).toMatch(/_总400_纯题目\.pdf$/);
  for (const total of [0, -1, 1.5, 401, Infinity, NaN]) expect(() => batchQuestionFilename('Maths', total)).toThrow('题目数量');
});
