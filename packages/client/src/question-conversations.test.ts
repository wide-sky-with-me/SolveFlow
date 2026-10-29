import { expect, it } from 'vitest';
import { continuationContext, questionConversations } from './question-conversations.js';
import type { RunContext, RunView } from '@solveflow/contracts/http';

const id = (n: number) => `${n}${n}${n}${n}${n}${n}${n}${n}-1111-4111-8111-111111111111`;
function run(number: number, context?: RunContext): RunView {
  return { schemaVersion: 1, id: id(number), sessionId: id(9), status: 'completed', message: '', createdAt: new Date(number * 1000).toISOString(), seq: 0,
    outcome: { schemaVersion: 1, status: 'completed', verified: false, verificationStatus: 'not_requested', verification: null, warning: null,
      candidate: { schemaVersion: 1, kind: 'answer', problem: { text: 'x+1=3', subject: 'math', uncertainties: [] }, answer: 'x=2', steps: [], knowledgePoints: [], citationIds: [], clarificationQuestions: [] } },
    ...(context ? { context } : {}) };
}

it('keeps on-demand runs inside their thread without making them the continuation target', () => {
  const root = run(1);
  const knowledge = run(2, { kind: 'knowledge-list', sourceRunId: root.id });
  const steps = run(3, { kind: 'explanation', sourceRunId: root.id });
  const thread = questionConversations([root, knowledge, steps])[0]!;
  expect(thread.runs.map(item => item.id)).toEqual([root.id, knowledge.id, steps.id]);
  // A finished knowledge list must not become the question a follow-up continues from.
  expect(continuationContext(thread)).toEqual({ kind: 'reply', sourceRunId: root.id });
  const answer = run(4, { kind: 'reply', sourceRunId: root.id });
  expect(continuationContext(questionConversations([root, knowledge, answer])[0]!)).toEqual({ kind: 'reply', sourceRunId: answer.id });
});

it.each(['explanation', 'knowledge-list'] as const)('keeps structured questions in an auxiliary %s inside the source thread', kind => {
  const root = run(1);
  const detail = run(2, { kind, sourceRunId: root.id });
  if (detail.outcome?.status !== 'completed') throw new Error('COMPLETED_FIXTURE_REQUIRED');
  detail.outcome.candidate.steps = [1, 2].map(number => ({ id: `example-${number}`, title: `Teaching example ${number}`, explanation: 'Apply the same rule.' }));
  detail.outcome.candidate.questions = [1, 2].map(number => ({ number, answer: `Teaching example ${number}`, stepIds: [`example-${number}`], figureIds: [] }));
  const threads = questionConversations([root, detail]);
  expect(threads).toHaveLength(1);
  expect(threads[0]?.runs.map(item => item.id)).toEqual([root.id, detail.id]);
  expect(continuationContext(threads[0]!)).toEqual({ kind: 'reply', sourceRunId: root.id });
  const followUp = run(3, { kind: 'step', sourceRunId: detail.id, stepId: 'example-1' });
  expect(questionConversations([root, detail, followUp]).map(thread => thread.runs.map(item => item.id))).toEqual([[root.id, detail.id, followUp.id]]);
});
