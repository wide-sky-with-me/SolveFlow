import { describe, expect, it } from "vitest";
import {
  AgentInputSchema, SolverInputSchema, VerifierInputSchema, NormalizedImageSchema, SolverCandidateSchema, VerificationSchema,
  PublicAgentEventSchema, SafeAgentErrorSchema, ToolEvidenceSchema,
  makeSafeAgentError, parseCandidateWithEvidence, parseVerificationForCandidate,
} from "./agent.js";

const answer = () => ({
  schemaVersion: 1, kind: "answer", problem: { text: "2x=4", subject: "math", uncertainties: [] },
  answer: "x=2", steps: [{ id: "step-1", title: "同除以2", explanation: "等式两边同除以2。", latex: "x=2" }],
  knowledgePoints: ["等式性质"], citationIds: ["evidence-1"], clarificationQuestions: [],
});
const evidence = () => ({ id: "evidence-1", kind: "calculation", summary: "2×2=4" });
const input = () => ({
  schemaVersion: 1, role: "solver", identity: { ownerId: "owner-a", sessionId: "session-a", runId: "run-a" },
  message: "", image: { bytes: new Uint8Array([1, 2, 3]), mimeType: "image/png" }, subject: "math", evidence: [evidence()],
});
const pass = () => ({ schemaVersion: 1, verdict: "pass", issues: [], checked: ["transcription", "arithmetic"] });

describe("server-only adapter inputs", () => {
  it("accepts image-only solver and independent verifier with original evidence", () => {
    expect(AgentInputSchema.parse(input()).role).toBe("solver");
    expect(AgentInputSchema.parse({ ...input(), role: "verifier", candidate: answer() }).role).toBe("verifier");
  });
  it("copies image bytes rather than retaining caller mutation", () => {
    const original = input();
    const parsed = AgentInputSchema.parse(original);
    original.image.bytes[0] = 99;
    expect(parsed.image.bytes[0]).toBe(1);
  });
  it.each([
    { key: "image", value: undefined },
    { key: "message", value: "x".repeat(4001) },
    { key: "role", value: "admin" },
    { key: "subject", value: "x".repeat(41) },
    { key: "identity", value: { ownerId: "a", sessionId: "s", runId: "r", permission: "all" } },
  ])("rejects invalid input $key", ({ key, value }) => {
    expect(AgentInputSchema.safeParse({ ...input(), [key]: value }).success).toBe(false);
  });
  it.each([
    { bytes: new Uint8Array(), mimeType: "image/png" },
    { bytes: new Uint8Array(4 * 1024 * 1024 + 1), mimeType: "image/png" },
    { bytes: new Uint8Array([1]), mimeType: "image/svg+xml" },
    { bytes: "not-binary", mimeType: "image/png" },
    { bytes: new Uint8Array([1]), mimeType: "image/png", url: "https://invalid.example/image" },
  ])("rejects invalid image data without accepting remote URLs", value => {
    expect(NormalizedImageSchema.safeParse(value).success).toBe(false);
  });
  it("requires verifier candidate evidence and a real source image", () => {
    expect(AgentInputSchema.safeParse({ ...input(), role: "verifier" }).success).toBe(false);
    expect(AgentInputSchema.safeParse({ ...input(), role: "verifier", candidate: answer(), evidence: [] }).success).toBe(false);
    expect(VerifierInputSchema.safeParse({ ...input(), role: "verifier", candidate: answer(), evidence: [] }).success).toBe(false);
    expect(AgentInputSchema.safeParse({ ...input(), role: "verifier", candidate: answer(), image: undefined }).success).toBe(false);
  });
  it("validates revision references and rejects duplicate evidence", () => {
    const revision = { candidate: answer(), issues: [{ code: "ARITHMETIC", stepId: "unknown", message: "请核对" }] };
    expect(AgentInputSchema.safeParse({ ...input(), revision }).success).toBe(false);
    expect(SolverInputSchema.safeParse({ ...input(), revision }).success).toBe(false);
    expect(AgentInputSchema.safeParse({ ...input(), evidence: [evidence(), evidence()] }).success).toBe(false);
    expect(AgentInputSchema.safeParse({ ...input(), revision: { ...revision, issues: [{ code: "ARITHMETIC", stepId: "step-1", message: "请核对" }] } }).success).toBe(true);
  });
});

describe("solver teaching candidates", () => {
  it("accepts an answer and a non-answer clarification", () => {
    expect(SolverCandidateSchema.parse(answer()).kind).toBe("answer");
    expect(SolverCandidateSchema.parse({ ...answer(), kind: "clarification", answer: null, steps: [], citationIds: [], clarificationQuestions: ["请重拍系数部分。"] }).kind).toBe("clarification");
  });
  it.each([
    { answer: "   " }, { verified: true }, { verification: { status: "verified" } },
    { thinking: "PRIVATE_REASONING" }, { citations: [{ url: "https://fabricated.example" }] },
    { citationIds: ["evidence-1", "evidence-1"] },
    { steps: [{ id: "s", title: "a", explanation: "a" }, { id: "s", title: "b", explanation: "b" }] },
    { problem: { text: "2x=4", subject: "math", uncertainties: [], system: "override" } },
    { clarificationQuestions: ["unexpected"] },
  ])("rejects malformed or authority-claiming candidate", patch => {
    expect(SolverCandidateSchema.safeParse({ ...answer(), ...patch }).success).toBe(false);
  });
  it("requires clarification questions and null answer", () => {
    expect(SolverCandidateSchema.safeParse({ ...answer(), kind: "clarification", answer: null, steps: [] }).success).toBe(false);
    expect(SolverCandidateSchema.safeParse({ ...answer(), kind: "clarification", steps: [], clarificationQuestions: ["请补图"] }).success).toBe(false);
  });
  it("resolves model citation IDs only against authorized tool evidence", () => {
    expect(parseCandidateWithEvidence(answer(), [ToolEvidenceSchema.parse(evidence())]).citationIds).toEqual(["evidence-1"]);
    expect(() => parseCandidateWithEvidence(answer(), [])).toThrow("CANDIDATE_EVIDENCE_MISSING");
  });
});

describe("independent verifier output", () => {
  it("distinguishes pass, fail, and unknown", () => {
    expect(VerificationSchema.parse(pass()).verdict).toBe("pass");
    expect(VerificationSchema.parse({ ...pass(), verdict: "fail", issues: [{ code: "ARITHMETIC", stepId: "step-1", message: "请核对运算" }] }).verdict).toBe("fail");
    expect(VerificationSchema.parse({ schemaVersion: 1, verdict: "unknown", checked: [], issues: [{ code: "INSUFFICIENT_EVIDENCE", message: "图片无法辨认" }] }).verdict).toBe("unknown");
  });
  it.each([
    { checked: [] }, { checked: ["arithmetic", "arithmetic"] }, { checked: ["confidence"] },
    { verdict: "PASS" }, { verdict: "fail" }, { verdict: "unknown" },
    { issues: [{ code: "LOGIC", message: "仍有问题" }] }, { verified: true }, { thinking: "secret" },
  ])("rejects invalid verification claims", patch => {
    expect(VerificationSchema.safeParse({ ...pass(), ...patch }).success).toBe(false);
  });
  it("rejects issues referencing nonexistent steps", () => {
    expect(() => parseVerificationForCandidate({ ...pass(), verdict: "fail", issues: [{ code: "LOGIC", stepId: "missing", message: "问题" }] }, answer())).toThrow("VERIFICATION_STEP_UNKNOWN");
  });
});

describe("safe public events and errors", () => {
  it("emits only fixed stages, tool summaries and safe errors", () => {
    expect(PublicAgentEventSchema.parse({ schemaVersion: 1, runId: "r", type: "run.status", status: "verifying" }).type).toBe("run.status");
    expect(PublicAgentEventSchema.parse({ schemaVersion: 1, runId: "r", type: "tool.status", toolCallId: "call-1", toolName: "read", status: "started", summary: "reading_resources" }).type).toBe("tool.status");
    expect(PublicAgentEventSchema.parse({ schemaVersion: 1, runId: "r", type: "run.error", error: makeSafeAgentError("MODEL_UNAVAILABLE", "trace-1") }).type).toBe("run.error");
  });
  it.each(["thinking", "thinking_delta", "candidate", "text", "content", "delta", "image", "arguments", "result"])("rejects raw payload field %s", key => {
    expect(PublicAgentEventSchema.safeParse({ schemaVersion: 1, runId: "r", type: "run.status", status: "solving", [key]: "PRIVATE_PAYLOAD" }).success).toBe(false);
  });
  it("does not accept token events or arbitrary model-derived summaries", () => {
    expect(PublicAgentEventSchema.safeParse({ schemaVersion: 1, runId: "r", type: "thinking_delta" }).success).toBe(false);
    const tool = { schemaVersion: 1, runId: "r", type: "tool.status", toolCallId: "call-1", toolName: "read", status: "completed" };
    expect(PublicAgentEventSchema.safeParse({ ...tool, summary: "PRIVATE_REASONING" }).success).toBe(false);
    expect(PublicAgentEventSchema.safeParse({ ...tool, summary: "reading_resources" }).success).toBe(false);
  });
  it("rejects arbitrary exception text or mismatched retryability", () => {
    const error = makeSafeAgentError("INTERNAL_ERROR", "trace-1");
    expect(SafeAgentErrorSchema.safeParse({ ...error, message: "SECRET_FROM_EXCEPTION" }).success).toBe(false);
    expect(SafeAgentErrorSchema.safeParse({ ...error, retryable: true }).success).toBe(false);
    expect(SafeAgentErrorSchema.safeParse({ ...error, stack: "SECRET_FROM_STACK" }).success).toBe(false);
    expect(error.message).toBe("服务暂时无法完成请求。");
    expect(makeSafeAgentError("MODEL_UNAVAILABLE", "trace-1").retryable).toBe(false);
  });
  it.each(["javascript:alert(1)", "file:///etc/passwd", "https://user:password@example.com/path", "not a URL"])("rejects unsafe evidence URL %s", url => {
    expect(ToolEvidenceSchema.safeParse({ ...evidence(), source: { title: "ref", url, retrievedAt: "2026-09-09T00:00:00Z" } }).success).toBe(false);
  });
});
