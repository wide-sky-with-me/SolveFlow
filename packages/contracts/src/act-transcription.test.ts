import { expect, it } from 'vitest';
import { ActTranscriptSchema, actProblem } from './act-transcription.js';
import { AnswerCandidateSchema, VerificationSchema, assessVerificationCoverage, parseGeneratedVerification } from './agent.js';

const source = { schemaVersion: 1, kind: 'act-transcript', subject: 'science', blocks: [{ kind: 'table', text: '| Row | X | Y |\n| --- | --- | --- |\n| 1 | 7 | N.A. |\n| 2 | 5 | 19 |' }, { kind: 'passage', text: 'Then the group moved; then the group waited.' }], questions: [{ number: 4, text: 'Which expression matches the data?', options: [{ label: 'B', text: '1:7' }, { label: 'D', text: '1:9' }], activeSpan: { block: 1, text: 'then', occurrence: 1 }, uncertainties: [] }], uncertainties: [] };
const answer = () => AnswerCandidateSchema.parse({ schemaVersion: 1, kind: 'answer', problem: actProblem(ActTranscriptSchema.parse(source)), selectedOptions: ['B'], answer: 'The ratio follows the data.', steps: [], knowledgePoints: [], citationIds: [], clarificationQuestions: [] });
const pass = { schemaVersion: 1, verdict: 'pass', checked: ['transcription', 'logic'], issues: [] };
const checks = { body: 'pass', question: 'pass', options: 'pass', activeSpan: 'pass', tables: 'pass' };

it('preserves all table rows and N.A. cells, exact option ratios and a case-sensitive current occurrence', () => {
  const parsed = ActTranscriptSchema.parse(source), problem = actProblem(parsed);
  expect(problem.text).toBe(source.blocks[0]!.text + '\n\nThen the group moved; **then** the group waited.\n\nWhich expression matches the data?');
  expect(problem.options).toEqual(source.questions[0]!.options); expect(problem.transcriptionScope).toBe('act-visible');
  expect(source.blocks[1]!.text).not.toContain('**');
});
it.each([{ block: 31, text: 'then', occurrence: 1 }, { block: 1, text: 'therefore', occurrence: 1 }, { block: 1, text: 'then', occurrence: 2 }])('rejects an invented or out-of-range current span: %j', activeSpan => {
  expect(ActTranscriptSchema.safeParse({ ...source, questions: [{ ...source.questions[0], activeSpan }] }).success).toBe(false);
});
it('keeps missing material warnings without manufacturing a missing table', () => {
  const parsed = ActTranscriptSchema.parse({ ...source, uncertainties: ['Table 3 was not photographed.'] });
  expect(actProblem(parsed).uncertainties).toContain('Table 3 was not photographed.'); expect(actProblem(parsed).text).not.toContain('Table 3');
});
it('rejects oversized source text and repeated question identities', () => {
  expect(ActTranscriptSchema.safeParse({ ...source, blocks: [{ kind: 'passage', text: 'a'.repeat(8000) }] }).success).toBe(false);
  expect(ActTranscriptSchema.safeParse({ ...source, questions: [source.questions[0], source.questions[0]] }).success).toBe(false);
});
it.each(['body', 'question', 'options', 'activeSpan', 'tables'])('does not accept a claimed PASS when %s was not checked', field => {
  const review = VerificationSchema.parse({ ...pass, actTranscription: { ...checks, [field]: 'unknown' } });
  expect(assessVerificationCoverage(review, answer()).verdict).toBe('unknown');
});
it('detects contradictory source failures and inappropriate table exemptions', () => {
  expect(assessVerificationCoverage(VerificationSchema.parse({ ...pass, actTranscription: { ...checks, tables: 'fail' } }), answer())).toMatchObject({ verdict: 'unknown', issues: [{ code: 'REVIEW_INCOMPLETE' }] });
  expect(assessVerificationCoverage(VerificationSchema.parse({ ...pass, actTranscription: { ...checks, tables: 'not_applicable' } }), answer()).verdict).toBe('unknown');
  expect(assessVerificationCoverage(VerificationSchema.parse({ ...pass, actTranscription: checks }), answer()).verdict).toBe('pass');
});
it('allows brief ACT candidates without full-passage transcriptionScope to pass focused review while enforcing actTranscription on act-visible candidates', () => {
  const old = VerificationSchema.parse(pass); expect(old).toEqual(pass);
  const briefAct = AnswerCandidateSchema.parse({ ...answer(), problem: { ...answer().problem, transcriptionScope: undefined } });
  expect(assessVerificationCoverage(old, briefAct, 'act').verdict).toBe('pass');
  expect(assessVerificationCoverage(old, answer(), 'act').verdict).toBe('unknown');
});
it('lets explicit source exam identification override the default ACT context', () => {
  const problem = actProblem(ActTranscriptSchema.parse({ ...source, exam: 'sat' }));
  expect(problem.exam).toBe('sat'); expect(problem).not.toHaveProperty('transcriptionScope');
  const candidate = AnswerCandidateSchema.parse({ ...answer(), problem });
  expect(assessVerificationCoverage(VerificationSchema.parse(pass), candidate, 'act').verdict).toBe('pass');
});

it('allows an incidental source difference only with a specific observation and verified answer evidence', () => {
  const report = { ...pass, evidenceStatus: 'sufficient', actTranscription: { ...checks, body: 'fail' },
    sourceObservations: [{ field: 'body', difference: 'The first sentence ends with a period, not a semicolon.', answerEvidence: 'The requested ratio still follows from row 1, X = 7.' }] };
  expect(assessVerificationCoverage(VerificationSchema.parse(report), answer()).verdict).toBe('pass');
  expect(assessVerificationCoverage(VerificationSchema.parse({ ...report, evidenceStatus: 'uncertain' }), answer()).verdict).toBe('unknown');
  expect(assessVerificationCoverage(VerificationSchema.parse({ ...report, actTranscription: { ...report.actTranscription, tables: 'fail' } }), answer()).verdict).not.toBe('pass');
});
it('ignores printed questionNumber differences on single-question checks while retaining genuine option disagreements', () => {
  const candidate = answer();
  const choice = { questionNumber: 55, selectedOptions: ['B'], decisiveEvidence: 'The first table row gives a ratio of 1 to 7.' };
  const review = { ...pass, evidenceStatus: 'sufficient', actTranscription: checks, independentChoices: [choice],
    coverage: [{ questionNumber: 55, verdict: 'pass', checked: ['transcription', 'logic'] }] };
  const assess = (value: unknown, target = candidate) => assessVerificationCoverage(VerificationSchema.parse(value), target).verdict;
  for (const label of [undefined, '55', 'Item 55', 'Item #9', 'Items 55–56']) {
    const next = AnswerCandidateSchema.parse({ ...candidate, problem: { ...candidate.problem, sourceNumber: label } });
    expect(assess(review, next)).toBe('pass');
    expect(assess({ ...review, independentChoices: [{ ...choice, questionNumber: 38 }], coverage: [{ questionNumber: 38, verdict: 'pass', checked: ['transcription', 'logic'] }] }, next)).toBe('pass');
    expect(parseGeneratedVerification(review, next).verdict).toBe('pass');
  }
  expect(assess({ ...review, independentChoices: [{ ...choice, selectedOptions: ['D'] }] })).toBe('fail');
});

it('retains an explicit ACT transcript item number when the optional printed label is absent, without printing the single-item fallback', () => {
  const parsed = ActTranscriptSchema.parse(source);
  expect(actProblem(parsed).sourceNumber).toBe('4');
  expect(actProblem({ ...parsed, questions: parsed.questions.map(q => ({ ...q, number: 1 })) }).sourceNumber).toBeUndefined();
});

it('names the specific unchecked or inconsistent source fields and explains what remains to verify', () => {
  const assess = (overrides: object) => assessVerificationCoverage(VerificationSchema.parse({ ...pass, actTranscription: { ...checks, ...overrides } }), answer());
  expect(assess({ tables: 'fail' }).issues[0]?.message).toBe('核验发现表格与原图有出入，但未说明差异是否改变答案。请对照原图复验。');
  expect(assess({ activeSpan: 'unknown', options: 'not_applicable' }).issues[0]?.message).toBe('核验尚未确认原图中的选项、高亮片段，无法判断这些内容是否支持当前答案。请重新核验。');
});
