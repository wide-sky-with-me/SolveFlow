import { expect, it } from "vitest";
import { OriginalIllustrationSchema, ProblemStatementSchema, KnowledgeDetailsSchema } from "./learning-content.js";
it("bounds original image crops and refuses model-controlled image URLs", () => {
  const image = { id: "original", alt: "原题坐标图", x: .6, y: .1, width: .3, height: .5 };
  expect(OriginalIllustrationSchema.safeParse(image).success).toBe(true);
  expect(ProblemStatementSchema.safeParse({ text: "题目", subject: "math", uncertainties: [], illustrations: [image, image] }).success).toBe(false);
  for (const extra of [{ x: -.1 }, { width: .5 }, { height: 0 }, { y: NaN }, { url: "https://outside.invalid/image" }]) expect(OriginalIllustrationSchema.safeParse({ ...image, ...extra }).success).toBe(false);
});
it("requires a knowledge explanation and its application without accepting duplicate concepts", () => {
  const point = { name: "一次函数", explanation: "形如y=kx+b", application: "求两条直线的交点" };
  expect(KnowledgeDetailsSchema.safeParse([point]).success).toBe(true);
  expect(KnowledgeDetailsSchema.safeParse([point, point]).success).toBe(false);
  expect(KnowledgeDetailsSchema.safeParse([{ ...point, application: "" }]).success).toBe(false);
});
it("keeps legacy answers readable and no longer forces learning details", async () => {
  const { AnswerCandidateSchema, GeneratedAnswerCandidateSchema } = await import("./agent.js");
  const old = { schemaVersion: 1, kind: "answer", problem: { text: "求x", subject: "math", uncertainties: [] }, answer: "x=2", steps: [{ id: "s", title: "移项", explanation: "两边减3" }], knowledgePoints: ["等式性质"], citationIds: [], clarificationQuestions: [] };
  expect(AnswerCandidateSchema.safeParse(old).success).toBe(true); expect(GeneratedAnswerCandidateSchema.safeParse(old).success).toBe(true);
  const detail = { name: "等式性质", explanation: "两边加同一个数仍相等", application: "两边减3" };
  expect(GeneratedAnswerCandidateSchema.safeParse({ ...old, knowledgeDetails: [detail] }).success).toBe(true);
  const grouped = { ...old, steps: [...old.steps, { id: "b", title: "代入", explanation: "代入2" }], knowledgeDetails: [detail], questions: [{ number: 1, answer: "a", stepIds: ["s"], figureIds: [] }, { number: 2, answer: "b", stepIds: ["b"], figureIds: [] }] };
  expect(GeneratedAnswerCandidateSchema.safeParse(grouped).success).toBe(false);
  expect(GeneratedAnswerCandidateSchema.safeParse({ ...grouped, questions: grouped.questions.map(question => ({ ...question, problem: old.problem, knowledgeDetails: [detail] })) }).success).toBe(true);
});
it("preserves edge labels with shared bounded padding, including image corners", async () => {
  const { originalIllustrationBounds } = await import("./learning-content.js");
  expect(originalIllustrationBounds({ x: .6, y: .2, width: .33, height: .68 })).toEqual({ x: .57, y: .17, width: .39, height: .74 });
  expect(originalIllustrationBounds({ x: 0, y: 0, width: 1, height: 1 })).toEqual({ x: 0, y: 0, width: 1, height: 1 });
});
