import { expect, it } from 'vitest';
import { ActTranscriptSchema, actProblem } from './act-transcription.js';
import { AnswerCandidateSchema, VerificationSchema, assessVerificationCoverage } from './agent.js';

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
  expect(assessVerificationCoverage(VerificationSchema.parse({ ...pass, actTranscription: { ...checks, tables: 'fail' } }), answer())).toMatchObject({ verdict: 'fail', issues: [{ code: 'TRANSCRIPTION' }] });
  expect(assessVerificationCoverage(VerificationSchema.parse({ ...pass, actTranscription: { ...checks, tables: 'not_applicable' } }), answer()).verdict).toBe('unknown');
  expect(assessVerificationCoverage(VerificationSchema.parse({ ...pass, actTranscription: checks }), answer()).verdict).toBe('pass');
});
it('keeps old stored verification readable but applies the ACT gate on a new review', () => {
  const old = VerificationSchema.parse(pass); expect(old).toEqual(pass);
  const candidate = AnswerCandidateSchema.parse({ ...answer(), problem: { ...answer().problem, exam: undefined, transcriptionScope: undefined } });
  expect(assessVerificationCoverage(old, candidate).verdict).toBe('pass');
  expect(assessVerificationCoverage(old, candidate, 'act').verdict).toBe('unknown');
});
it('lets explicit source exam identification override the default ACT context', () => {
  const problem = actProblem(ActTranscriptSchema.parse({ ...source, exam: 'sat' }));
  expect(problem.exam).toBe('sat'); expect(problem).not.toHaveProperty('transcriptionScope');
  const candidate = AnswerCandidateSchema.parse({ ...answer(), problem });
  expect(assessVerificationCoverage(VerificationSchema.parse(pass), candidate, 'act').verdict).toBe('pass');
});
