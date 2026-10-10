import { randomUUID } from 'node:crypto';
import { expect, it } from 'vitest';
import { CreateRunSchema, type RunView } from '@solveflow/contracts/http';
import { RunViewSchema } from '@solveflow/contracts/http';
import { resolveLearningContext } from './learning-history.js';

it('keeps a full draft across review and revision without borrowing a later version', () => {
  const sessionId = randomUUID();
  const makeRun = (answer: string, mode: 'composition' | 'feedback' | 'revision', sourceRunId?: string) => RunViewSchema.parse({
    schemaVersion: 1, id: randomUUID(), sessionId, createdAt: new Date().toISOString(), status: 'completed', seq: 1, message: '',
    ...(sourceRunId ? { context: { kind: 'reply', sourceRunId } } : {}),
    outcome: { schemaVersion: 1, status: 'completed', verified: false, verificationStatus: 'not_requested', warning: null, verification: null,
      candidate: { schemaVersion: 1, kind: 'answer', problem: { text: 'Write an argument.', subject: 'english', response: { type: mode === 'feedback' ? 'short-answer' : 'essay' }, uncertainties: [] },
        answer, writing: { mode }, steps: [], knowledgePoints: [], citationIds: [], clarificationQuestions: [] } },
  });
  const essay = makeRun('Original evidence. '.repeat(300) + 'ORIGINAL_END', 'composition');
  const otherBranch = makeRun('DIFFERENT_DRAFT', 'revision', essay.id);
  const review = makeRun('Clarify the final paragraph.', 'feedback', essay.id);
  const future = makeRun('LATER_VERSION', 'revision', review.id);
  const focus = resolveLearningContext([essay, otherBranch, review, future], { kind: 'reply', sourceRunId: review.id }).focus;
  expect(focus).toMatchObject({ answer: 'Clarify the final paragraph.', writing: { mode: 'feedback' }, draft: { sourceRunId: essay.id } });
  expect(focus?.draft?.answer).toContain('ORIGINAL_END');
  expect(JSON.stringify(focus)).not.toContain('LATER_VERSION');
  expect(JSON.stringify(focus)).not.toContain('DIFFERENT_DRAFT');
});

it('keeps the complete selected essay available when asking about its final paragraph', () => {
  const answer = 'Evidence and explanation. '.repeat(220) + 'FINAL PARAGRAPH';
  const run: RunView = { schemaVersion: 1, id: randomUUID(), sessionId: randomUUID(), createdAt: new Date().toISOString(), status: 'completed', seq: 1, message: '', outcome: { schemaVersion: 1, status: 'completed', verified: false, verificationStatus: 'not_requested' as const, warning: null, verification: null, candidate: { schemaVersion: 1, kind: 'answer', problem: { text: 'Write an essay.', subject: 'english', uncertainties: [] }, answer, steps: [], knowledgePoints: [], citationIds: [], clarificationQuestions: [] } } };
  const result = resolveLearningContext([run], { kind: 'reply', sourceRunId: run.id });
  expect(result.focus).toMatchObject({ answer });
  expect(CreateRunSchema.safeParse({ schemaVersion: 1, message: answer }).success).toBe(true);
  expect(CreateRunSchema.safeParse({ schemaVersion: 1, message: 'x'.repeat(8001) }).success).toBe(false);
});

it('keeps complete multipart content scoped to the selected question', () => {
  const problem = { text: 'Two independent questions.', subject: 'math', uncertainties: [] };
  const parts = [{ label: '(a)', answer: 'First part.' }, { label: '(b)', answer: 'Last part. '.repeat(240).trim() }];
  const run = RunViewSchema.parse({ schemaVersion: 1, id: randomUUID(), sessionId: randomUUID(), createdAt: new Date().toISOString(), status: 'completed', seq: 1, message: '', outcome: {
    schemaVersion: 1, status: 'completed', verified: false, verificationStatus: 'not_requested', warning: null, verification: null,
    candidate: { schemaVersion: 1, kind: 'answer', problem, answer: 'Overview only.', steps: [], knowledgePoints: [], citationIds: [], clarificationQuestions: [], questions: [
      { number: 1, problem: { ...problem, response: { type: 'multipart', parts: ['(a)', '(b)'] } }, answer: 'Selected answer.', parts, stepIds: [], figureIds: [] },
      { number: 2, problem, answer: 'OTHER_QUESTION_PRIVATE_CONTEXT', stepIds: [], figureIds: [] },
    ] },
  } });
  const result = resolveLearningContext([run], { kind: 'question', sourceRunId: run.id, number: 1 });
  expect(result.focus).toMatchObject({ answer: 'Selected answer.', parts });
  expect(JSON.stringify(result)).not.toContain('OTHER_QUESTION_PRIVATE_CONTEXT');
});
