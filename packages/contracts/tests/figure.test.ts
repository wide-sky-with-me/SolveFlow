import { expect, it } from "vitest";
import { FigureSchema } from "../src/figure.js";
import { AnswerCandidateSchema, SolveOutcomeSchema, parseVerificationForCandidate } from "../src/agent.js";
const figure = { schemaVersion: 1, id: "curve", kind: "coordinate", title: "抛物线", description: "y=x²-4x+3", xRange: [-1, 5], yRange: [-2, 8], elements: [{ kind: "polynomial", coefficients: [3, -4, 1] }] };
it("accepts bounded declarative curves and rejects code, external URLs and invalid coordinates", () => {
  expect(FigureSchema.parse(figure).elements).toHaveLength(1);
  for (const value of [{ ...figure, svg: "<svg onload=...>" }, { ...figure, url: "https://outside.test/track" }, { ...figure, xRange: [2, 2] }, { ...figure, elements: [{ kind: "polynomial", coefficients: [Infinity] }] }, { ...figure, elements: [{ kind: "script", code: "alert(1)" }] }]) expect(FigureSchema.safeParse(value).success).toBe(false);
});
it("requires independent diagram verification before accepting PASS for illustrated answers", () => {
  const candidate = AnswerCandidateSchema.parse({ schemaVersion: 1, kind: "answer", problem: { text: "test", subject: "math", uncertainties: [] }, answer: "test", steps: [], citationIds: [], knowledgePoints: [], clarificationQuestions: [], figures: [figure] });
  expect(() => parseVerificationForCandidate({ schemaVersion: 1, verdict: "pass", checked: ["transcription"], issues: [] }, candidate)).toThrow();
  expect(parseVerificationForCandidate({ schemaVersion: 1, verdict: "pass", checked: ["transcription", "diagram"], issues: [] }, candidate).verdict).toBe("pass");
  const outcome = { schemaVersion: 1, status: "completed", candidate, verified: true, warning: null, verification: { schemaVersion: 1, verdict: "pass", checked: ["transcription"], issues: [] } };
  expect(SolveOutcomeSchema.safeParse(outcome).success).toBe(false);
  expect(SolveOutcomeSchema.safeParse({ ...outcome, verification: { ...outcome.verification, checked: ["transcription", "diagram"] } }).success).toBe(true);
});
it("supports bounded economic areas and sampled lines with named axes", () => {
  const economic = { ...figure, equalAspect: false, xLabel: "数量Q（件）", yLabel: "价格P（元/件）", elements: [{ kind: "polygon", points: [[0, 10], [0, 6], [4, 6]], label: "消费者剩余" }, { kind: "polyline", points: [[0, 10], [4, 6], [10, 0]], label: "需求" }] };
  expect(FigureSchema.safeParse(economic).success).toBe(true);
  expect(FigureSchema.safeParse({ ...economic, elements: [{ kind: "polygon", points: [[0, 0], [1, 1]] }] }).success).toBe(false);
  expect(FigureSchema.safeParse({ ...economic, elements: [{ kind: "polyline", points: Array.from({ length: 129 }, () => [0, 0]) }] }).success).toBe(false);
});
it("requires diagram verification for original crops even when no new figure is generated", () => {
  const candidate = AnswerCandidateSchema.parse({ schemaVersion: 1, kind: "answer", problem: { text: "原题有图", subject: "math", uncertainties: [], illustrations: [{ id: "crop", alt: "三角形ABC", x: .5, y: .2, width: .4, height: .5 }] }, answer: "结论", steps: [], knowledgePoints: [], citationIds: [], clarificationQuestions: [] });
  const verification = { schemaVersion: 1, verdict: "pass", checked: ["transcription"], issues: [] };
  expect(() => parseVerificationForCandidate(verification, candidate)).toThrow("DIAGRAM_NOT_VERIFIED");
  expect(SolveOutcomeSchema.safeParse({ schemaVersion: 1, status: "completed", verified: true, warning: null, candidate, verification }).success).toBe(false);
  expect(parseVerificationForCandidate({ ...verification, checked: ["transcription", "diagram"] }, candidate).verdict).toBe("pass");
});
it("accepts diagram failures so crop defects enter the existing correction flow", () => {
  const candidate = AnswerCandidateSchema.parse({ schemaVersion: 1, kind: "answer", problem: { text: "有图", subject: "math", uncertainties: [] }, answer: "结论", steps: [], knowledgePoints: [], citationIds: [], clarificationQuestions: [], figures: [figure] });
  expect(parseVerificationForCandidate({ schemaVersion: 1, verdict: "fail", checked: ["transcription", "diagram"], issues: [{ code: "DIAGRAM", message: "裁片遗漏左侧边长标注，请向左扩大" }] }, candidate).verdict).toBe("fail");
});
