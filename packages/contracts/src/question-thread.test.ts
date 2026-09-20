import { expect, it } from "vitest";
import { RunViewSchema } from "./http.js";
import { resolveQuestionThread, questionThreadHistory } from "./question-thread.js";
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
function run(n: number, extra: object = {}) {
  return RunViewSchema.parse({ schemaVersion: 1, id: id(n), sessionId: id(99), status: "completed", message: `ask${n}`, seq: 1, createdAt: new Date(n * 1000).toISOString(), outcome: { schemaVersion: 1, status: "completed", verified: true, warning: null, verification: { schemaVersion: 1, verdict: "pass", checked: ["transcription"], issues: [] }, candidate: { schemaVersion: 1, kind: "answer", problem: { text: "两道题", subject: "math", uncertainties: [] }, answer: "两个结论", steps: [{ id: "a", title: "甲题步骤", explanation: "甲条件" }, { id: "b", title: "乙题步骤", explanation: "乙条件" }], questions: [{ number: 1, answer: "甲结论", stepIds: ["a"], figureIds: [] }, { number: 2, answer: "乙结论", stepIds: ["b"], figureIds: [] }], knowledgePoints: [], citationIds: [], clarificationQuestions: [] } }, ...extra });
}
it("keeps replies to replies and steps in their original question", () => {
  const root = run(1); const next = run(2, { context: { kind: "question", sourceRunId: root.id, number: 2 } });
  expect(resolveQuestionThread([root, next], { kind: "reply", sourceRunId: next.id })).toEqual({ rootRunId: root.id, number: 2 });
  expect(resolveQuestionThread([root], { kind: "step", sourceRunId: root.id, stepId: "b" })).toEqual({ rootRunId: root.id, number: 2 });
  expect(resolveQuestionThread([root], { kind: "reply", sourceRunId: root.id })).toBeNull();
});
it("limits learning history to the selected question, including its corrections", () => {
  const root = run(1); const other = run(2, { context: { kind: "question", sourceRunId: root.id, number: 1 } });
  const mine = run(3, { context: { kind: "question", sourceRunId: root.id, number: 2 } });
  const history = questionThreadHistory([root, other, mine], { kind: "reply", sourceRunId: mine.id });
  expect(history.map(value => value.id)).toEqual([root.id, mine.id]);
  expect(history[0]?.outcome).toMatchObject({ candidate: { answer: "乙结论", steps: [{ id: "b" }] } });
});
it("fails closed on missing references, cycles and cross-session ancestry", () => {
  const root = run(1); const cyclic = run(2, { context: { kind: "reply", sourceRunId: id(2) } });
  expect(resolveQuestionThread([root], { kind: "reply", sourceRunId: id(8) })).toBeNull();
  expect(resolveQuestionThread([cyclic], { kind: "reply", sourceRunId: id(2) })).toBeNull();
  const other = run(3, { sessionId: id(98), context: { kind: "question", sourceRunId: root.id, number: 2 } });
  expect(resolveQuestionThread([root, other], { kind: "reply", sourceRunId: other.id })).toBeNull();
});
it("allows scoped corrections and rejects ambiguous corrections to a whole multi-question answer", () => {
  const root = run(1);
  expect(resolveQuestionThread([root], { kind: "correction", sourceRunId: root.id, number: 2, text: "更正乙条件" })).toEqual({ rootRunId: root.id, number: 2 });
  expect(resolveQuestionThread([root], { kind: "correction", sourceRunId: root.id, text: "更正条件" })).toBeNull();
});
it("projects question-specific text and concepts and rejects a concept from a different question", () => {
  const root = run(1); if (root.outcome?.status !== "completed") throw new Error("fixture");
  root.outcome.candidate.questions!.forEach(question => {
    question.problem = { text: `第${question.number}题的完整条件`, subject: "math", uncertainties: [] };
    question.knowledgeDetails = [{ name: `概念${question.number}`, explanation: "定义", application: "用于本题" }];
  });
  const context = { kind: "knowledge" as const, sourceRunId: root.id, number: 2, name: "概念2" };
  expect(resolveQuestionThread([root], context)).toEqual({ rootRunId: root.id, number: 2 });
  expect(questionThreadHistory([root], context)[0]?.outcome).toMatchObject({ candidate: { problem: { text: "第2题的完整条件" }, knowledgePoints: ["概念2"], knowledgeDetails: [{ name: "概念2" }] } });
  expect(resolveQuestionThread([root], { ...context, name: "概念1" })).toBeNull();
  expect(resolveQuestionThread([root], { ...context, number: undefined })).toBeNull();
  const next = run(2, { context });
  expect(resolveQuestionThread([root, next], { kind: "reply", sourceRunId: next.id })).toEqual({ rootRunId: root.id, number: 2 });
});
it('projects explicit choice labels with their question and never leaks them into another question', async () => {
  const { projectQuestionRun } = await import('./question-thread.js');
  const root = run(1); if (root.outcome?.status !== 'completed') throw new Error('fixture');
  const first = root.outcome.candidate.questions![0]!;
  first.problem = { text: 'Choose the value.', subject: 'math', uncertainties: [], options: [{ label: 'F', text: '2' }, { label: 'H', text: '4' }] };
  first.selectedOptions = ['H'];
  const validated = RunViewSchema.parse(root);
  expect(projectQuestionRun(validated, 1).outcome).toMatchObject({ candidate: { selectedOptions: ['H'], problem: { options: first.problem.options } } });
  const second = projectQuestionRun(validated, 2).outcome;
  if (second?.status !== 'completed') throw new Error('fixture');
  expect(second.candidate.selectedOptions).toBeUndefined();
});
