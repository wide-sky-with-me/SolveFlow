import { expect, it } from 'vitest';
import { AnswerCandidateSchema, VerificationSchema, assessVerificationCoverage } from './agent.js';

const candidate = AnswerCandidateSchema.parse({ schemaVersion: 1, kind: 'answer', problem: { text: 'Select all that apply.', subject: 'math', uncertainties: [], options: ['A', 'B', 'C'].map(label => ({ label, text: label })), response: { type: 'multiple-choice' } }, selectedOptions: ['A', 'C'], answer: 'Synthetic reason.', steps: [], knowledgePoints: [], citationIds: [], clarificationQuestions: [] });
const pass = { schemaVersion: 1, verdict: 'pass', checked: ['transcription', 'logic'], issues: [] };
const choice = { selectedOptions: ['C', 'A'], decisiveEvidence: 'Both identified options satisfy the supplied conditions.' };
it('accepts a substantive direct answer review without requiring a second option solution', () => {
  const old = VerificationSchema.parse(pass);
  expect(old.verdict).toBe('pass'); expect(assessVerificationCoverage(old, candidate).verdict).toBe('pass');
});
it('compares complete option sets independent of ordering or printed questionNumber on single questions', () => {
  expect(assessVerificationCoverage(VerificationSchema.parse({ ...pass, independentChoices: [choice] }), candidate).verdict).toBe('pass');
  expect(assessVerificationCoverage(VerificationSchema.parse({ ...pass, independentChoices: [{ ...choice, questionNumber: 38 }] }), candidate).verdict).toBe('pass');
});
it('turns a reported PASS with a different independent option set into FAIL', () => {
  expect(assessVerificationCoverage(VerificationSchema.parse({ ...pass, independentChoices: [{ ...choice, selectedOptions: ['A'] }] }), candidate)).toMatchObject({ verdict: 'fail', issues: [{ code: 'LOGIC' }] });
});
it.each([
  { independentChoices: [{ ...choice, selectedOptions: ['Z'] }] },
  { independentChoices: [choice, choice] },
  { independentChoices: [] },
])('does not trust invalid-label, duplicated or empty independent checks: %j', ({ independentChoices }) => {
  expect(assessVerificationCoverage(VerificationSchema.parse({ ...pass, independentChoices }), candidate).verdict).toBe('unknown');
});
it('still pairs independentChoices by questionNumber when one photo solves multiple questions', () => {
  const multi = AnswerCandidateSchema.parse({
    ...candidate,
    selectedOptions: undefined,
    problem: { text: 'Two questions.', subject: 'math', uncertainties: [] },
    questions: [1, 2].map(number => ({ number, problem: candidate.problem, selectedOptions: ['A', 'C'], answer: 'Reason.', stepIds: [], figureIds: [] })),
  });
  expect(assessVerificationCoverage(VerificationSchema.parse({
    ...pass,
    independentChoices: [{ ...choice, questionNumber: 1 }, { ...choice, questionNumber: 2 }],
    coverage: [1, 2].map(questionNumber => ({ questionNumber, verdict: 'pass', checked: ['transcription', 'logic'] })),
  }), multi).verdict).toBe('pass');
  expect(assessVerificationCoverage(VerificationSchema.parse({
    ...pass,
    independentChoices: [{ ...choice, questionNumber: 1 }, { ...choice, questionNumber: 9 }],
    coverage: [1, 2].map(questionNumber => ({ questionNumber, verdict: 'pass', checked: ['transcription', 'logic'] })),
  }), multi).verdict).toBe('unknown');
});
it.each([{ ...choice, selectedOptions: ['A', 'A'] }, { ...choice, decisiveEvidence: '' }, { ...choice, rawReasoning: 'private' }])('rejects malformed independent check data', item => {
  expect(VerificationSchema.safeParse({ ...pass, independentChoices: [item] }).success).toBe(false);
});
