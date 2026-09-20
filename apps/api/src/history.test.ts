import { expect, it } from "vitest";
import { boundedHistory, candidateHistoryAnswer } from "./history.js";
it("keeps the most recent UTF-8 history within the worker envelope", () => {
  const entries = Array.from({ length: 9 }, (_, i) => ({ message: `${i}${"题".repeat(1999)}`, answer: `${i}${"答".repeat(3999)}` }));
  const result = boundedHistory(entries);
  expect(Buffer.byteLength(JSON.stringify(result))).toBeLessThanOrEqual(12 * 1024);
  expect(result.at(-1)?.message.startsWith("8")).toBe(true); expect(result.at(-1)?.answer).toContain("节选");
});
it("preserves short previous messages in chronological order", () => {
  const entries = [{ message: "为什么", answer: "等式性质" }, { message: "然后呢", answer: "除以2" }];
  expect(boundedHistory(entries)).toEqual(entries);
});

it("keeps every question conclusion in follow-up history instead of the overview", () => {
  const grouped = { answer: "共解答四题。", questions: [1, 2, 3, 4].map(number => ({ number, answer: `${number}的结论` + "答".repeat(990) })) };
  const answer = boundedHistory([{ message: "解答1–4题", answer: candidateHistoryAnswer(grouped) }])[0]!.answer;
  for (const number of [1, 2, 3, 4]) expect(answer).toContain(`第${number}题：${number}的结论`);
  expect(answer.length).toBeLessThanOrEqual(2000);
  expect(candidateHistoryAnswer({ answer: "单题答案" })).toBe("单题答案");
});
it("retains clarification questions and the verification status of previous answers", async () => {
  const { conversationHistory } = await import("./history.js");
  const { SolveOutcomeSchema } = await import("@solveflow/contracts/agent");
  const common = { schemaVersion: 1, problem: { text: "ax=6", subject: "math", uncertainties: ["a不清楚"] }, knowledgePoints: [], citationIds: [] };
  const outcome = SolveOutcomeSchema.parse({ schemaVersion: 1, status: "needs_clarification", verified: false, candidate: { ...common, kind: "clarification", answer: null, steps: [], clarificationQuestions: ["系数a是多少？"] } });
  const result = conversationHistory([{ message: "请解题", outcome }]);
  expect(result[0]?.answer).toContain("系数a是多少");
  expect(result[0]?.answer).toContain("等待补充");
});
it("labels unverified history and preserves the selected version instead of guessing from step numbers", async () => {
  const { conversationHistory, resolveLearningContext } = await import("./history.js");
  const { RunViewSchema } = await import("@solveflow/contracts/http");
  const run = RunViewSchema.parse({ schemaVersion: 1, id: "00000000-0000-4000-8000-000000000001", sessionId: "00000000-0000-4000-8000-000000000002", status: "completed", message: "求解", createdAt: new Date().toISOString(), seq: 1,
    outcome: { schemaVersion: 1, status: "completed", verified: false, warning: "MODEL_TIMEOUT", verification: null, candidate: { schemaVersion: 1, kind: "answer", problem: { text: "x=2", subject: "math", uncertainties: [] }, answer: "x=2", steps: [{ id: "first", title: "代回原题", explanation: "检验两边是否相等" }], knowledgePoints: [], citationIds: [], clarificationQuestions: [] } } });
  expect(conversationHistory([run])[0]?.answer).toContain("未通过完整校验，不可作为确定事实");
  expect(resolveLearningContext([run], { kind: "step", sourceRunId: run.id, stepId: "first" }).focus).toMatchObject({ sourceRunId: run.id, verified: false, content: expect.stringContaining("代回原题") });
  expect(() => resolveLearningContext([run], { kind: "step", sourceRunId: run.id, stepId: "absent" })).toThrow("INVALID_SAVED_CONTEXT");
});
it("resolves persisted knowledge details into bounded question-scoped model context", async () => {
  const { resolveLearningContext } = await import("./history.js");
  const { RunViewSchema } = await import("@solveflow/contracts/http");
  const run = RunViewSchema.parse({ schemaVersion: 1, id: "00000000-0000-4000-8000-000000000001", sessionId: "00000000-0000-4000-8000-000000000002", status: "completed", message: "求解", createdAt: new Date().toISOString(), seq: 1,
    outcome: { schemaVersion: 1, status: "completed", verified: false, warning: "MODEL_TIMEOUT", verification: null, candidate: { schemaVersion: 1, kind: "answer", problem: { text: "x=2", subject: "math", uncertainties: [] }, answer: "x=2", steps: [], knowledgePoints: ["等式性质"], knowledgeDetails: [{ name: "等式性质", explanation: "两边加同一个数仍相等", application: "两边同时加2", pitfall: "不能只改一边" }], citationIds: [], clarificationQuestions: [] } } });
  const context = { kind: "knowledge" as const, sourceRunId: run.id, name: "等式性质" };
  const input = resolveLearningContext([run], context);
  expect(input.focus).toMatchObject({ kind: "knowledge", verified: false, content: expect.stringContaining("两边同时加2") });
  expect(input.focus?.content).toContain("不能只改一边");
  expect(() => resolveLearningContext([run], { ...context, name: "伪造概念" })).toThrow("INVALID_SAVED_CONTEXT");
});
it('retains explicit selected labels in single and multi-question conversation context', () => {
  expect(candidateHistoryAnswer({ answer: 'A short reason.', selectedOptions: ['H'] })).toBe('答案：H\n\nA short reason.');
  expect(candidateHistoryAnswer({ answer: 'Summary', questions: [{ number: 2, selectedOptions: ['C'], answer: 'Reason for this question.' }] })).toContain('第2题：答案：C');
});
