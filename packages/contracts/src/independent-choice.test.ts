import { expect, it } from 'vitest';
import { AnswerCandidateSchema, VerificationSchema, assessVerificationCoverage } from './agent.js';

const candidate = AnswerCandidateSchema.parse({ schemaVersion: 1, kind: 'answer', problem: { text: 'Select all that apply.', subject: 'math', uncertainties: [], options: ['A', 'B', 'C'].map(label => ({ label, text: label })), response: { type: 'multiple-choice' } }, selectedOptions: ['A', 'C'], answer: 'Synthetic reason.', steps: [], knowledgePoints: [], citationIds: [], clarificationQuestions: [] });
const pass = { schemaVersion: 1, verdict: 'pass', checked: ['transcription', 'logic'], issues: [] };
const choice = { selectedOptions: ['C', 'A'], decisiveEvidence: 'Both identified options satisfy the supplied conditions.' };
it('accepts a substantive direct answer review without requiring a second option solution', () => {
  const old = VerificationSchema.parse(pass);
  expect(old.verdict).toBe('pass'); expect(assessVerificationCoverage(old, candidate).verdict).toBe('pass');
});
it('compares complete option sets independent of ordering', () => {
  expect(assessVerificationCoverage(VerificationSchema.parse({ ...pass, independentChoices: [choice] }), candidate).verdict).toBe('pass');
});
it('turns a reported PASS with a different independent option set into FAIL', () => {
  expect(assessVerificationCoverage(VerificationSchema.parse({ ...pass, independentChoices: [{ ...choice, selectedOptions: ['A'] }] }), candidate)).toMatchObject({ verdict: 'fail', issues: [{ code: 'LOGIC' }] });
});
it.each([
  { independentChoices: [{ ...choice, selectedOptions: ['Z'] }] },
  { independentChoices: [choice, choice] },
  { independentChoices: [{ ...choice, questionNumber: 2 }] },
  { independentChoices: [] },
])('does not trust unmapped, duplicated or misidentified independent checks: %j', ({ independentChoices }) => {
  expect(assessVerificationCoverage(VerificationSchema.parse({ ...pass, independentChoices }), candidate).verdict).toBe('unknown');
});
it.each([{ ...choice, selectedOptions: ['A', 'A'] }, { ...choice, decisiveEvidence: '' }, { ...choice, rawReasoning: 'private' }])('rejects malformed independent check data', item => {
  expect(VerificationSchema.safeParse({ ...pass, independentChoices: [item] }).success).toBe(false);
});
