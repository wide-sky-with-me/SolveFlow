import { expect, it } from "vitest";
import { AnswerCandidateSchema } from "./agent.js";
import { questionSections } from "./question-sections.js";
const candidate = () => AnswerCandidateSchema.parse({ schemaVersion: 1, kind: "answer", problem: { text: "自编练习", subject: "math", uncertainties: [] }, answer: "**第1题：$x=2$**\n\n**第2题：$y=4$**", steps: [
  { id: "s1", title: "第1题：移项", explanation: "先移项。" }, { id: "s2", title: "第1题：化简", explanation: "再化简。" }, { id: "s3", title: "第2题：代入", explanation: "代入求值。" },
], figures: [{ schemaVersion: 1, id: "f", kind: "coordinate", title: "第2题直线图", description: "y=2x", xRange: [0, 2], yRange: [0, 4], elements: [{ kind: "polynomial", coefficients: [0, 2] }] }], knowledgePoints: [], citationIds: [], clarificationQuestions: [] });
it("groups the legacy repeated-question shape without rewriting stored content", () => {
  const value = candidate(); const groups = questionSections(value);
  expect(groups?.map(q => [q.number, q.steps.length, q.figures.length])).toEqual([[1, 2, 0], [2, 1, 1]]);
  expect(groups?.[0]?.steps[0]?.title).toBe("移项"); expect(groups?.[0]?.answer).toBe("**$x=2$**");
  expect(value.steps[0]?.title).toBe("第1题：移项");
});
it("uses explicit references even when model steps arrive interleaved", () => {
  const value = candidate(); value.questions = [{ number: 1, answer: "x=2", stepIds: ["s2", "s1"], figureIds: [] }, { number: 2, answer: "y=4", stepIds: ["s3"], figureIds: ["f"] }];
  expect(questionSections(value)?.[0]?.steps.map(s => s.id)).toEqual(["s2", "s1"]);
});
it.each(["unnumbered-step", "unnumbered-figure", "missing-answer", "duplicate-answer", "extra-answer", "extra-preamble"])("keeps ambiguous legacy content intact: %s", scenario => {
  const value = candidate();
  if (scenario === "unnumbered-step") value.steps[0]!.title = "移项";
  if (scenario === "unnumbered-figure") value.figures![0]!.title = "直线";
  if (scenario === "missing-answer") value.answer = "第1题：x=2";
  if (scenario === "duplicate-answer") value.answer += "\n\n第1题：x=3";
  if (scenario === "extra-answer") value.answer += "\n\n第3题：x=3";
  if (scenario === "extra-preamble") value.answer = "还需核对条件。\n\n" + value.answer;
  expect(questionSections(value)).toBeNull();
});
