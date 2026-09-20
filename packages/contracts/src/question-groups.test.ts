import { describe, expect, it } from "vitest";
import { AnswerCandidateSchema, parseVerificationForCandidate } from "./agent.js";

const candidate = () => ({ schemaVersion: 1, kind: "answer", problem: { text: "两道自编练习", subject: "math", uncertainties: [] }, answer: "两题已分别解答。", clarificationQuestions: [], knowledgePoints: [], citationIds: [],
  steps: [{ id: "q1-s1", title: "移项", explanation: "等式两边减去常数。" }, { id: "q2-s1", title: "代入", explanation: "将横坐标代入函数。" }],
  figures: [{ schemaVersion: 1, id: "q2-plot", kind: "coordinate", title: "直线", description: "y=2x", xRange: [0, 2], yRange: [0, 4], elements: [{ kind: "polynomial", coefficients: [0, 2] }] }],
  questions: [{ number: 1, answer: "x=2", stepIds: ["q1-s1"], figureIds: [] }, { number: 2, answer: "y=4", stepIds: ["q2-s1"], figureIds: ["q2-plot"] }],
});
describe("question ownership", () => {
  it("accepts explicit groups while preserving legacy answers", () => {
    expect(AnswerCandidateSchema.parse(candidate()).questions).toHaveLength(2);
    const { questions: _, ...legacy } = candidate();
    expect(AnswerCandidateSchema.safeParse(legacy).success).toBe(true);
  });
  it.each(["duplicate-number", "reused-step", "missing-step", "unknown-step", "reused-figure", "unassigned-figure", "unknown-figure", "too-many-questions"])("rejects %s", scenario => {
    const value = candidate();
    switch (scenario) {
      case "duplicate-number": value.questions[1]!.number = 1; break;
      case "reused-step": value.questions[1]!.stepIds.push("q1-s1"); break;
      case "missing-step": value.steps.push({ id: "orphan", title: "结论", explanation: "遗漏步骤" }); break;
      case "unknown-step": value.questions[0]!.stepIds = ["missing"]; break;
      case "reused-figure": value.questions[0]!.figureIds = ["q2-plot"]; break;
      case "unassigned-figure": value.questions[1]!.figureIds = []; break;
      case "unknown-figure": value.questions[0]!.figureIds = ["missing"]; break;
      case "too-many-questions": value.questions.push(...value.questions, value.questions[0]!); break;
    }
    expect(AnswerCandidateSchema.safeParse(value).success).toBe(false);
  });
  it("keeps global step references and mandatory diagram verification", () => {
    expect(() => parseVerificationForCandidate({ schemaVersion: 1, verdict: "pass", checked: ["transcription"], issues: [] }, candidate())).toThrow("DIAGRAM_NOT_VERIFIED");
    expect(parseVerificationForCandidate({ schemaVersion: 1, verdict: "fail", checked: ["diagram"], issues: [{ code: "LOGIC", stepId: "q2-s1", message: "核对图示" }] }, candidate()).verdict).toBe("fail");
  });
});
