import { expect, it } from 'vitest';
import { AnswerCandidateSchema, BriefSolverCandidateSchema } from './agent.js';
import { answerText, problemText } from './choice-presentation.js';
const problem = { text: 'Which value is closest?', subject: 'math', uncertainties: [], options: [{ label: 'A', text: '$1$' }, { label: 'C', text: '$2$' }] };
const candidate = { schemaVersion: 1, kind: 'answer', problem, selectedOptions: ['C'], answer: 'The predicted value is close to $2$.', steps: [], knowledgePoints: [], citationIds: [], clarificationQuestions: [] };
it('accepts structured choices and serializes them without parsing prose', () => {
  expect(BriefSolverCandidateSchema.parse(candidate)).toEqual(candidate);
  expect(answerText(candidate)).toBe('答案：C\n\nThe predicted value is close to $2$.');
  expect(problemText(problem)).toBe('Which value is closest?\n\nA. $1$\n\nC. $2$');
});
it('requires selected labels to belong to the given options', () => {
  for (const selectedOptions of [undefined, [], ['B'], ['C', 'C']]) expect(AnswerCandidateSchema.safeParse({ ...candidate, selectedOptions }).success).toBe(false);
  expect(AnswerCandidateSchema.safeParse({ ...candidate, problem: { ...problem, options: undefined } }).success).toBe(false);
  expect(AnswerCandidateSchema.safeParse({ ...candidate, problem: { ...problem, options: [problem.options[0], problem.options[0]] } }).success).toBe(false);
});
it('keeps original ACT labels and supports explicit multiple selections', () => {
  const act = { ...candidate, problem: { ...problem, options: [{ label: 'F', text: '6' }, { label: 'H', text: '10' }, { label: 'J', text: '14' }] }, selectedOptions: ['H', 'J'] };
  expect(BriefSolverCandidateSchema.parse(act)).toEqual(act);
  expect(answerText(act)).toContain('答案：H、J');
});
it('validates each question separately and rejects a whole-page selected option', () => {
  const { selectedOptions: _selection, ...base } = candidate;
  const grouped = { ...base, problem: { text: 'Two questions', subject: 'math', uncertainties: [] }, questions: [1, 2].map(number => ({ number, problem, selectedOptions: [number === 1 ? 'A' : 'C'], answer: 'A brief reason', stepIds: [], figureIds: [] })) };
  expect(BriefSolverCandidateSchema.safeParse(grouped).success).toBe(true);
  expect(BriefSolverCandidateSchema.safeParse({ ...grouped, selectedOptions: ['C'] }).success).toBe(false);
  expect(BriefSolverCandidateSchema.safeParse({ ...grouped, questions: grouped.questions.map(q => ({ ...q, selectedOptions: ['F'] })) }).success).toBe(false);
});
it('does not extract choices or letters from answer text', () => {
  const plain = { answer: '**结果：C**\n\nExplain A. and B.' };
  expect(answerText(plain)).toBe(plain.answer);
  const text = 'Choose. (A) one (B) two (C) three (D) four';
  expect(problemText({ text, subject: 'math', uncertainties: [] })).toBe(text);
});

it('retains a complete written response in brief mode and in persisted outcomes without teaching steps', () => {
  const answer = 'Evidence supports the stated conclusion. '.repeat(160).trim();
  const essay = { ...candidate, problem: { text: 'Write an essay using the sources.', subject: 'english', uncertainties: [] }, selectedOptions: undefined, answer };
  expect(BriefSolverCandidateSchema.parse(essay).answer).toBe(answer);
  expect(AnswerCandidateSchema.parse(essay).answer).toBe(answer);
  expect(BriefSolverCandidateSchema.safeParse({ ...essay, answer: 'x'.repeat(8001) }).success).toBe(false);
  expect(BriefSolverCandidateSchema.safeParse({ ...essay, steps: [{ id: 's1', title: 'Extra teaching', explanation: 'Not requested' }] }).success).toBe(false);
  const grouped = { ...essay, answer: 'Responses follow.', questions: [1, 2].map(number => ({ number, problem: essay.problem, answer, stepIds: [], figureIds: [] })) };
  const parsed = BriefSolverCandidateSchema.parse(grouped);
  expect(parsed.kind === 'answer' ? parsed.questions?.[1]?.answer : null).toBe(answer);
  expect(AnswerCandidateSchema.parse(grouped).questions?.[1]?.answer).toBe(answer);
});
