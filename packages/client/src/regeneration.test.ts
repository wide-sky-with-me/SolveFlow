import { expect, it } from 'vitest';
import { RunContextSchema, RunViewSchema, questionThreadHistory, resolveQuestionThread } from '@solveflow/contracts/http';
import { questionConversations, regenerationContext } from './question-conversations.js';
import { resolveLearningContext } from './learning-history.js';
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
function root() {
  return RunViewSchema.parse({ schemaVersion: 1, id: id(1), sessionId: id(99), status: 'completed', message: '请说明计算依据', seq: 1, createdAt: new Date(1000).toISOString(), outcome: { schemaVersion: 1, status: 'completed', verified: true, warning: null, verification: { schemaVersion: 1, verdict: 'pass', checked: ['transcription'], issues: [] }, candidate: { schemaVersion: 1, kind: 'answer', problem: { text: '两道题', subject: 'math', uncertainties: [] }, answer: '旧结论', steps: [{ id: 'a', title: '甲步骤', explanation: '甲条件' }, { id: 'b', title: '乙步骤', explanation: '乙条件' }], questions: [{ number: 1, answer: '甲结论', stepIds: ['a'], figureIds: [], problem: { text: '甲题条件', subject: 'math', uncertainties: [] } }, { number: 2, answer: '乙结论', stepIds: ['b'], figureIds: [], problem: { text: '乙题条件', subject: 'math', uncertainties: [] } }], knowledgePoints: [], citationIds: [], clarificationQuestions: [] } } });
}
it('regenerates only the selected question, with original evidence instead of a step-only focus', () => {
  const first = root(); const thread = questionConversations([first])[1]!; const context = regenerationContext(thread)!;
  expect(context).toEqual({ kind: 'regenerate', sourceRunId: first.id, number: 2 });
  expect(RunContextSchema.parse(context)).toEqual(context);
  expect(resolveQuestionThread([first], context)).toEqual({ rootRunId: first.id, number: 2 });
  const focus = resolveLearningContext([first], context).focus!;
  expect(focus).toMatchObject({ kind: 'regenerate', verified: false });
  expect(focus.content).toContain('只重新完整解答第2题'); expect(focus.content).toContain('乙题条件'); expect(focus.content).toContain('请说明计算依据');
  expect(focus.content).not.toContain('甲题条件'); expect(focus.content).not.toContain('乙步骤');
});
it('retains the latest correction and conversation grouping across repeated regeneration and reload', () => {
  const first = root(); const original = JSON.stringify(first);
  const corrected = RunViewSchema.parse({ ...first, id: id(2), context: { kind: 'correction', sourceRunId: first.id, number: 2, text: '乙题更正条件' } });
  const context = regenerationContext(questionConversations([first, corrected])[1]!)!;
  expect(context).toEqual({ kind: 'regenerate', sourceRunId: corrected.id });
  expect(resolveLearningContext([first, corrected], context).problemCorrection).toBe('乙题更正条件');
  const regenerated = RunViewSchema.parse({ ...first, id: id(3), context });
  const groups = questionConversations([first, corrected, regenerated]);
  expect(groups).toHaveLength(2); expect(groups[0]?.runs.map(run => run.id)).toEqual([first.id]);
  expect(groups[1]?.runs.map(run => run.id)).toEqual([first.id, corrected.id, regenerated.id]);
  const next = regenerationContext(groups[1]!)!;
  expect(resolveQuestionThread([first, corrected, regenerated], next)).toEqual({ rootRunId: first.id, number: 2 });
  expect(JSON.stringify(first)).toBe(original);
});
it('rejects missing, ambiguous and cross-session regeneration references', () => {
  const first = root();
  for (const context of [{ kind: 'regenerate' as const, sourceRunId: id(10) }, { kind: 'regenerate' as const, sourceRunId: first.id }, { kind: 'regenerate' as const, sourceRunId: first.id, number: 3 }]) {
    expect(() => questionThreadHistory([first], context)).toThrow('INVALID_SAVED_CONTEXT');
  }
  const foreign = RunViewSchema.parse({ ...first, id: id(2), sessionId: id(88), context: { kind: 'regenerate', sourceRunId: first.id, number: 2 } });
  expect(() => resolveLearningContext([first, foreign], { kind: 'regenerate', sourceRunId: foreign.id })).toThrow('INVALID_SAVED_CONTEXT');
});
