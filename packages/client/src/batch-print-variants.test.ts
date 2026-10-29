import { expect, it } from 'vitest';
import { makeSafeAgentError } from '@solveflow/contracts/agent';
import { BatchPrintSnapshotSchema, type BatchPrintSnapshot } from '@solveflow/contracts/local';
import { questionsForBatchPrint, planBatchPrintCopies, batchPrintFilename, batchPrintArchiveFilename, batchQuestionFilename } from './batch-print-variants.js';

const id = (value: number) => `00000000-0000-4000-8000-${String(value).padStart(12, '0')}`;
const at = '2026-10-13T01:00:00.000Z';
it('distinguishes optional marked PDF and ZIP names while preserving the unmarked format and byte bound', () => {
  const copy = planBatchPrintCopies(questionsForBatchPrint(snapshot()), [{ correct: 2, incorrect: 1 }])[0];
  if (!copy) throw new Error('COPY');
  expect(batchPrintFilename('批次', copy)).toBe('批次_作答_第01份_3题_对2_错1.pdf');
  expect(batchPrintFilename('批次', copy, { markIncorrect: true })).toBe('批次_作答_第01份_3题_对2_错1_标记错题.pdf');
  expect(batchPrintArchiveFilename('批次', 2)).toBe('批次_作答_2份.zip');
  expect(batchPrintArchiveFilename('批次', 2, { markIncorrect: true })).toBe('批次_作答_2份_标记错题.zip');
  for (const name of [batchPrintFilename('批'.repeat(100), copy, { markIncorrect: true }), batchPrintArchiveFilename('批'.repeat(100), 20, { markIncorrect: true })]) expect(new TextEncoder().encode(name).byteLength).toBeLessThanOrEqual(240);
});
function candidate(choice = true) {
  return { schemaVersion: 1, kind: 'answer', problem: { text: 'Synthetic question', subject: 'math', uncertainties: [], ...(choice ? { options: [{ label: 'A', text: '1' }, { label: 'B', text: '2' }, { label: 'C', text: '3' }], response: { type: 'single-choice' } } : {}) }, answer: choice ? 'A: saved explanation' : 'x=1', ...(choice ? { selectedOptions: ['A'] } : {}), steps: [], clarificationQuestions: [], citationIds: [], knowledgePoints: [] };
}
function snapshot(wrong = false, choice = true, records = 3): BatchPrintSnapshot {
  const batch = { id: id(99), title: 'Synthetic batch', exam: 'general', createdAt: at };
  return BatchPrintSnapshotSchema.parse({ schemaVersion: 1, batch, exportedAt: at, records: Array.from({ length: records }, (_, index) => ({ schemaVersion: 1, batch: { ...batch, position: index + 1 }, image: 'data:image/jpeg;base64,AQID', session: { schemaVersion: 1, id: id(index + 1), subject: 'math', createdAt: at, upload: { schemaVersion: 1, id: id(index + 20), mimeType: 'image/jpeg', bytes: 3, width: 30, height: 20, expiresAt: at, previewUrl: `/api/v1/uploads/${id(index + 20)}/image` }, runs: [{ schemaVersion: 1, id: id(index + 40), sessionId: id(index + 1), status: 'completed', message: '', seq: 1, createdAt: at, outcome: { schemaVersion: 1, status: 'completed', candidate: candidate(choice), verified: false, warning: null, ...(wrong && index === 0 ? { verification: { schemaVersion: 1, verdict: 'fail', checked: ['arithmetic'], issues: [{ code: 'ARITHMETIC', message: 'Synthetic mismatch' }] } } : { verification: null, verificationStatus: 'not_requested' }) } }] } })) });
}

it('assumes every original answer correct without inheriting red warnings or changing history', () => {
  const source = snapshot(true); const before = JSON.stringify(source); const questions = questionsForBatchPrint(source);
  const [copy] = planBatchPrintCopies(questions, [{ correct: 3, incorrect: 0 }]);
  expect(copy?.answers.map(answer => answer.incorrect)).toEqual([false, false, false]);
  expect(copy?.answers.every(answer => !answer.changed)).toBe(true);
  expect(copy?.answers.map(answer => answer.answer)).toEqual(questions.map(question => question.candidate?.answer));
  expect(questions.every(question => !source.records.find(record => record.session.id === question.recordId)?.session.runs[0]?.outcome?.verified)).toBe(true);
  expect(JSON.stringify(source)).toBe(before);
});
it('adjusts actual option labels and deterministically varies both selected questions and options across copies', () => {
  const questions = questionsForBatchPrint(snapshot()); const requests = Array.from({ length: 10 }, () => ({ correct: 2, incorrect: 1 }));
  const copies = planBatchPrintCopies(questions, requests, [], 1234);
  expect(copies).toEqual(planBatchPrintCopies(questions, requests, [], 1234));
  expect(new Set(copies.map(copy => copy.answers.find(answer => answer.incorrect)?.key)).size).toBe(3);
  for (const copy of copies) {
    const wrong = copy.answers.filter(answer => answer.incorrect); expect(wrong).toHaveLength(1);
    expect(wrong[0]?.selectedOptions?.[0]).not.toBe('A'); expect(wrong[0]?.answer).toBe(wrong[0]?.selectedOptions?.join('、'));
    expect(copy.answers.filter(answer => !answer.changed).every(answer => answer.answer === 'A: saved explanation')).toBe(true);
  }
});
it('varies positional combinations across copies while avoiding repeated combinations', () => {
  const questions = questionsForBatchPrint(snapshot(false, true, 5));
  const copies = planBatchPrintCopies(questions, Array.from({ length: 10 }, () => ({ correct: 3, incorrect: 2 })), [], 1234);
  expect(new Set(copies.map(copy => copy.answers.filter(answer => answer.incorrect).map(answer => answer.key).join('|'))).size).toBeGreaterThanOrEqual(6);
});
it('accepts zero errors even with known failures, validates explicit references and rejects foreign references', () => {
  const questions = questionsForBatchPrint(snapshot(true)); const red = questions[0]!;
  expect(planBatchPrintCopies(questions, [{ correct: 3, incorrect: 0 }])[0]?.incorrect).toBe(0);
  expect(() => planBatchPrintCopies(questions, [{ correct: 3, incorrect: 0 }], [{ key: red.key, referenceOptions: ['Z'] }])).toThrow('无效');
  expect(() => planBatchPrintCopies(questions, [{ correct: 3, incorrect: 0 }], [{ key: 'foreign', referenceOptions: ['B'] }])).toThrow('本批之外');
  const copy = planBatchPrintCopies(questions, [{ correct: 3, incorrect: 0 }], [{ key: red.key, referenceOptions: ['B'] }])[0]!;
  expect(copy.answers[0]).toMatchObject({ selectedOptions: ['B'], answer: 'B', incorrect: false, changed: true });
  expect(red.baselineWrong).toBe(true); expect(red.candidate?.selectedOptions).toEqual(['A']);
});
it('keeps actual answers consistent with an explicit reference even when the requested counts match the original baseline', () => {
  const questions = questionsForBatchPrint(snapshot()); const first = questions[0]!;
  const copy = planBatchPrintCopies(questions, [{ correct: 3, incorrect: 0 }], [{ key: first.key, referenceOptions: ['B'] }])[0]!;
  expect(copy.answers[0]).toMatchObject({ selectedOptions: ['B'], changed: true, incorrect: false });
  expect(first.candidate?.selectedOptions).toEqual(['A']);
  const red = questionsForBatchPrint(snapshot(true));
  const preservedCount = planBatchPrintCopies(red, [{ correct: 2, incorrect: 1 }], [{ key: red[0]!.key, referenceOptions: ['A'] }])[0]!;
  expect(preservedCount.answers.filter(answer => answer.incorrect)).toHaveLength(1); expect(preservedCount.incorrect).toBe(1);
});
it('counts multi-question conversations individually and uses the matching saved verification', () => {
  const source = snapshot(false, false, 1); const root = source.records[0]!.session.runs[0]!;
  if (root.outcome?.status !== 'completed') throw new Error('Fixture missing completed answer');
  root.outcome.candidate.questions = [{ number: 1, answer: 'x=1', problem: root.outcome.candidate.problem, stepIds: [], figureIds: [] }, { number: 2, answer: 'x=2', problem: root.outcome.candidate.problem, stepIds: [], figureIds: [] }];
  const result = questionsForBatchPrint(source);
  expect(result).toHaveLength(2); expect(result.map(question => question.candidate?.answer)).toEqual(['x=1', 'x=2']);
  expect(planBatchPrintCopies(result, [{ correct: 1, incorrect: 1 }])[0]?.answers.filter(answer => answer.incorrect)).toHaveLength(1);
  const single = snapshot(); const first = single.records[0]!.session.runs[0]!;
  if (first.outcome?.status !== 'completed') throw new Error('Fixture missing completed answer');
  single.records[0]!.session.runs.push({ ...first, id: id(90), context: { kind: 'verification', sourceRunId: first.id }, outcome: { ...first.outcome, verificationStatus: undefined, verification: { schemaVersion: 1, verdict: 'fail', issues: [{ code: 'ARITHMETIC', message: 'Mismatch' }], checked: ['arithmetic'] } } });
  expect(questionsForBatchPrint(single)[0]?.baselineWrong).toBe(true);
});
it('keeps unknown and missing answers assumed correct, rejects fixed-total/count violations', () => {
  const source = snapshot(); const first = source.records[0]!.session.runs[0]!;
  if (first.outcome?.status !== 'completed') throw new Error('Fixture missing completed answer');
  first.outcome = { ...first.outcome, verificationStatus: undefined, verification: { schemaVersion: 1, verdict: 'unknown', issues: [{ code: 'INSUFFICIENT_EVIDENCE', message: 'Unclear' }], checked: [] } };
  const questions = questionsForBatchPrint(source); expect(questions[0]?.baselineWrong).toBe(false);
  expect(() => planBatchPrintCopies(questions, [{ correct: 1, incorrect: 1 }])).toThrow('总题数');
  expect(() => planBatchPrintCopies(questions, [{ correct: 2.5, incorrect: .5 }])).toThrow();
  expect(() => planBatchPrintCopies(questions, Array.from({ length: 21 }, () => ({ correct: 3, incorrect: 0 })))).toThrow();
  source.records[0]!.session.runs = [];
  const missing = questionsForBatchPrint(source);
  expect(missing).toHaveLength(3); expect(missing[0]).toMatchObject({ candidate: null, runId: null });
  expect(planBatchPrintCopies(missing, [{ correct: 3, incorrect: 0 }])[0]?.answers[0]).toMatchObject({ answer: '', incorrect: false, changed: false });
});
it('uses the latest main saved answer without inheriting a red warning from an older answer', () => {
  const source = snapshot(true, true, 1); const first = source.records[0]!.session.runs[0]!;
  if (first.outcome?.status !== 'completed') throw new Error('Fixture missing completed answer');
  const latest = { ...first, id: id(90), context: { kind: 'reply' as const, sourceRunId: first.id }, outcome: { ...first.outcome, verification: null, verificationStatus: 'not_requested' as const, candidate: { ...first.outcome.candidate, selectedOptions: ['B'], answer: 'B: corrected saved answer' } } };
  source.records[0]!.session.runs.push(latest);
  expect(questionsForBatchPrint(source)[0]).toMatchObject({ runId: latest.id, baselineWrong: false, candidate: { answer: 'B: corrected saved answer' } });
});
it('uses an unanswered response as a real wrong answer for non-choice questions and treats red answers as assumed correct without a reference', () => {
  const questions = questionsForBatchPrint(snapshot(false, false));
  expect(planBatchPrintCopies(questions, [{ correct: 2, incorrect: 1 }])[0]?.answers.find(answer => answer.incorrect)?.answer).toBe('');
  expect(() => planBatchPrintCopies(questions, [{ correct: 0, incorrect: 3 }], questions.map(question => ({ key: question.key, wrongAnswer: 'x=1' })))).toThrow('可调整');
  const red = questionsForBatchPrint(snapshot(true, false));
  expect(planBatchPrintCopies(red, [{ correct: 3, incorrect: 0 }])[0]?.incorrect).toBe(0);
  expect(planBatchPrintCopies(red, [{ correct: 3, incorrect: 0 }], [{ key: red[0]!.key, referenceAnswer: 'x=2' }])[0]?.answers[0]?.answer).toBe('x=2');
});
it('rejects incomplete labels, uses the other binary option for an explicit reference, and sanitizes copy filenames', () => {
  const source = snapshot(false, true, 1); const run = source.records[0]!.session.runs[0]!;
  if (run.outcome?.status !== 'completed') throw new Error('Fixture missing completed answer');
  run.outcome.candidate.problem.options = [{ label: 'A', text: '1' }]; run.outcome.candidate.problem.optionsComplete = false; run.outcome.candidate.problem.uncertainties = ['Missing options'];
  delete run.outcome.candidate.selectedOptions;
  expect(() => planBatchPrintCopies(questionsForBatchPrint(source), [{ correct: 0, incorrect: 1 }])).toThrow('可调整');
  run.outcome.candidate.problem.options = [{ label: 'A', text: '1' }, { label: 'B', text: '2' }]; delete run.outcome.candidate.problem.optionsComplete; run.outcome.candidate.selectedOptions = ['A'];
  const pair = questionsForBatchPrint(source);
  const binary = planBatchPrintCopies(pair, [{ correct: 0, incorrect: 1 }], [{ key: pair[0]!.key, referenceOptions: ['B'] }])[0]!;
  expect(binary.answers[0]?.selectedOptions).toEqual(['A']); expect(binary.incorrect).toBe(1);
  const copy = planBatchPrintCopies(questionsForBatchPrint(snapshot()), [{ correct: 3, incorrect: 0 }])[0]!;
  expect(batchPrintFilename('Maths:/1', copy)).toBe('Maths__1_作答_第01份_3题_对3_错0.pdf');
  expect(batchPrintFilename('Maths:/1', copy, { multiple: true })).toBe('Maths__1_作答_第01份_3题_对3_错0.pdf');
  const long = batchPrintFilename('数学试卷'.repeat(25), copy, { multiple: true });
  expect(new TextEncoder().encode(long).byteLength).toBeLessThanOrEqual(240); expect(long).toMatch(/_作答_第01份_3题_对3_错0\.pdf$/);
});
it('names question-only files without answer statistics and bounds total and filename bytes', () => {
  expect(batchQuestionFilename('Maths:/1', 27)).toBe('Maths__1_题目_27题.pdf');
  const long = batchQuestionFilename('数学试卷'.repeat(25), 400);
  expect(new TextEncoder().encode(long).byteLength).toBeLessThanOrEqual(240); expect(long).toMatch(/_题目_400题\.pdf$/);
  for (const total of [0, -1, 1.5, 401, Infinity, NaN]) expect(() => batchQuestionFilename('Maths', total)).toThrow('题目数量');
});

it('spreads five errors over positions and complexity levels, varies fresh seeds, and freezes the same seed', () => {
  const questions = questionsForBatchPrint(snapshot(false, false, 27));
  for (const question of questions) {
    if (!question.candidate) throw new Error('Fixture missing answer');
    question.candidate.problem.text = 'Synthetic '.repeat(5 + (question.ordinal % 3) * 100);
  }
  const requests = Array.from({ length: 10 }, () => ({ correct: 22, incorrect: 5 }));
  const first = planBatchPrintCopies(questions, requests, [], 1234);
  expect(first).toEqual(planBatchPrintCopies(questions, requests, [], 1234));
  expect(first).not.toEqual(planBatchPrintCopies(questions, requests, [], 5678));
  expect(new Set(first.map(copy => copy.answers.filter(answer => answer.incorrect).map(answer => answer.ordinal).join(','))).size).toBe(10);
  for (const copy of first) {
    const wrong = copy.answers.filter(answer => answer.incorrect);
    expect(wrong).toHaveLength(5);
    expect(new Set(wrong.map(answer => Math.floor((answer.ordinal - 1) / 9))).size).toBe(3);
    expect(new Set(wrong.map(answer => answer.ordinal % 3)).size).toBe(3);
    expect(wrong.every((answer, index) => !index || answer.ordinal - wrong[index - 1]!.ordinal > 1)).toBe(true);
  }
});
it('supports failed and unanswered records without inventing saved answers or verification', () => {
  const source = snapshot(true); source.records[0]!.session.runs = [];
  const run = source.records[1]!.session.runs[0]!;
  run.status = 'failed'; run.outcome = { schemaVersion: 1, status: 'failed', error: makeSafeAgentError('MODEL_TIMEOUT', id(90)), verified: false };
  const before = JSON.stringify(source); const questions = questionsForBatchPrint(source);
  expect(questions.map(question => question.candidate === null)).toEqual([true, true, false]);
  const zero = planBatchPrintCopies(questions, [{ correct: 3, incorrect: 0 }])[0]!;
  expect(zero.answers.every(answer => !answer.incorrect)).toBe(true);
  expect(zero.answers.slice(0, 2).map(answer => answer.answer)).toEqual(['', '']);
  expect(planBatchPrintCopies(questions, [{ correct: 0, incorrect: 3 }])[0]?.answers.every(answer => answer.incorrect)).toBe(true);
  expect(JSON.stringify(source)).toBe(before);
});
it('covers every requested count including all questions without losing or duplicating slots', () => {
  const questions = questionsForBatchPrint(snapshot(false, false, 27));
  for (let incorrect = 0; incorrect <= 27; incorrect++) {
    const copy = planBatchPrintCopies(questions, [{ correct: 27 - incorrect, incorrect }], [], 1234)[0]!;
    expect(copy.answers).toHaveLength(27);
    expect(copy.answers.filter(answer => answer.incorrect)).toHaveLength(incorrect);
    expect(new Set(copy.answers.map(answer => answer.key)).size).toBe(27);
  }
});

it('uses a per-copy remark and a fixed local timestamp without changing the answer plan', () => {
  const questions = questionsForBatchPrint(snapshot());
  const [original] = planBatchPrintCopies(questions, [{ correct: 2, incorrect: 1 }], [], 1234);
  const [copy] = planBatchPrintCopies(questions, [{ correct: 2, incorrect: 1, remark: '  第一组  ' }], [], 1234);
  expect(copy?.answers).toEqual(original?.answers); expect(copy?.remark).toBe('第一组');
  const exportedAt = new Date(2026, 9, 22, 23, 10, 3).toISOString();
  expect(batchPrintFilename('批次', copy, { exportedAt })).toBe('第一组_20261022-231003.pdf');
  expect(batchPrintFilename('批次', copy, { exportedAt, markIncorrect: true })).toBe('第一组_20261022-231003.pdf');
  expect(() => batchPrintFilename('批次', copy, { exportedAt: 'invalid' })).toThrow('导出时间');
  const unsafe = { ...copy, remark: '班级:/A?*\u007f' };
  expect(batchPrintFilename('批次', unsafe, { exportedAt })).toBe('班级__A____20261022-231003.pdf');
  const long = batchPrintFilename('批次', { ...copy, remark: '数'.repeat(80) }, { exportedAt });
  expect(long).toMatch(/_20261022-231003\.pdf$/); expect(new TextEncoder().encode(long).byteLength).toBeLessThanOrEqual(240);
  expect(batchPrintFilename('批次', { ...copy, remark: '   ' }, { exportedAt })).toBe('批次_作答_第01份_3题_对2_错1.pdf');
});
