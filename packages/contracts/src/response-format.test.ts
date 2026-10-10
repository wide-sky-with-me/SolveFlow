import { expect, it } from 'vitest';
import { AnswerCandidateSchema, parseCandidateForExam } from './agent.js';
import { answerText } from './choice-presentation.js';
const base = { schemaVersion: 1, kind: 'answer', problem: { text: 'Answer the question.', subject: 'general', uncertainties: [] }, answer: 'Response.', steps: [], knowledgePoints: [], citationIds: [], clarificationQuestions: [] };
it('requires every declared FRQ part exactly once and preserves parts when serializing', () => {
  const value = { ...base, problem: { ...base.problem, response: { type: 'multipart', parts: ['(a)', '(b)'] } }, parts: [{ label: '(a)', answer: 'First answer.' }, { label: '(b)', answer: 'Second answer.' }] };
  const result = AnswerCandidateSchema.parse(value);
  expect(answerText(result)).toContain('(b)\nSecond answer.');
  expect(AnswerCandidateSchema.safeParse({ ...value, parts: [value.parts[0]] }).success).toBe(false);
  expect(AnswerCandidateSchema.safeParse({ ...value, parts: [value.parts[0], value.parts[0]] }).success).toBe(false);
  expect(AnswerCandidateSchema.safeParse({ ...value, parts: [...value.parts, { label: '(c)', answer: 'Extra' }] }).success).toBe(false);
  expect(AnswerCandidateSchema.safeParse(base).success).toBe(true);
});
it('validates a SAT entry separately from explanation without imposing it on other exams', () => {
  const value = { ...base, problem: { ...base.problem, response: { type: 'numeric' } }, responseValue: '2/3' };
  expect(parseCandidateForExam(value, 'sat')).toMatchObject({ responseValue: '2/3' });
  for (const responseValue of ['2 cm', '1/0', '1 1/2', '123456', '2/3/4', 'x=2']) expect(() => parseCandidateForExam({ ...value, responseValue }, 'sat')).toThrow();
  expect(parseCandidateForExam({ ...value, responseValue: '123456' }, 'ap')).toMatchObject({ responseValue: '123456' });
});
it('allows real multiple-choice tasks and obeys explicit exam corrections', () => {
  const value = { ...base, problem: { ...base.problem, exam: 'ap', response: { type: 'multiple-choice' }, options: [{ label: 'A', text: 'A' }, { label: 'B', text: 'B' }] }, selectedOptions: ['A', 'B'] };
  expect(parseCandidateForExam(value, 'sat')).toMatchObject({ selectedOptions: ['A', 'B'] });
  expect(AnswerCandidateSchema.safeParse({ ...value, problem: { ...value.problem, response: { type: 'single-choice' } } }).success).toBe(false);
});
it('checks declared writing limits without rewriting or truncating the essay', () => {
  const essay = { ...base, problem: { ...base.problem, response: { type: 'essay', wordLimit: 750 } }, answer: Array(750).fill('word').join(' ') };
  expect(parseCandidateForExam(essay, 'tara')).toMatchObject({ answer: essay.answer });
  expect(AnswerCandidateSchema.safeParse({ ...essay, answer: `${essay.answer} extra` }).success).toBe(false);
});
