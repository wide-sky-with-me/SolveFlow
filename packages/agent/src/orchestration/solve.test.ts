import { expect, it } from "vitest";
import { SolveOutcomeSchema, type AgentInput, type Verification } from "@solveflow/contracts/agent";
import { solve, SolvePhaseError } from "./solve.js";
import { RunBudget } from "../policy/run-budget.js";

const input = { schemaVersion: 1, role: "solver", identity: { ownerId: "a", sessionId: "s", runId: "r" }, message: "", image: { mimeType: "image/png", bytes: new Uint8Array([1, 2]) }, evidence: [] };
const answer = { schemaVersion: 1, kind: "answer", problem: { text: "2x + 3 = 7", subject: "math", uncertainties: [] }, answer: "x = 2", steps: [{ id: "one", title: "求解", explanation: "移项后除以2" }], knowledgePoints: [], citationIds: [], clarificationQuestions: [] };
const verdict = (value: Verification["verdict"]) => ({ schemaVersion: 1, verdict: value, checked: ["transcription", "arithmetic"], issues: value === "pass" ? [] : [{ code: "ARITHMETIC", stepId: "one", message: "请复查" }] });
it.each([
  { values: ["pass"], phases: 2, verified: true },
  { values: ["fail", "pass"], phases: 4, verified: true },
  { values: ["fail", "fail"], phases: 4, verified: false },
  { values: ["unknown"], phases: 2, verified: false },
] as const)("independently verifies $values with bounded correction", async ({ values, phases, verified }) => {
  const seen: AgentInput[] = []; const budget = new RunBudget(); let checks = 0;
  const result = await solve(input, async (phase, actualBudget) => {
    expect(actualBudget).toBe(budget); seen.push(phase);
    expect(phase.image.bytes).toEqual(input.image.bytes);
    if (phase.role === "solver") return { role: "solver", candidate: answer, events: [] };
    const next = values[checks++]; if (!next) throw new Error("UNEXPECTED_VERIFIER_CALL");
    return { role: "verifier", verification: verdict(next), events: [] };
  }, budget, new AbortController().signal);
  expect(result).toMatchObject({ status: "completed", verified });
  expect(seen).toHaveLength(phases);
  if (phases === 4) expect(seen[2]).toMatchObject({ role: "solver", revision: { candidate: answer, issues: verdict("fail").issues } });
});
it.each(["MODEL_TIMEOUT", "MODEL_OUTPUT_INVALID"] as const)("preserves an unverified candidate on verifier %s", async code => {
  const result = await solve(input, async phase => {
    if (phase.role === "verifier") throw new SolvePhaseError(code);
    return { role: "solver", candidate: answer, events: [] };
  }, new RunBudget(), new AbortController().signal);
  expect(result).toMatchObject({ status: "completed", verified: false, warning: code, verification: null });
});
it.each(["MODEL_UNAVAILABLE", "CAPABILITY_DENIED", "WORKER_LOST", "RUN_TIMEOUT"] as const)("does not downgrade fatal %s to success", async code => {
  const result = await solve(input, async phase => {
    if (phase.role === "verifier") throw new SolvePhaseError(code);
    return { role: "solver", candidate: answer, events: [] };
  }, new RunBudget(), new AbortController().signal);
  expect(result).toMatchObject({ status: "failed", error: { code } });
});
it("rejects invalid PASS and never treats it as verified", async () => {
  const result = await solve(input, async phase => phase.role === "solver" ? { role: "solver", candidate: answer, events: [] }
    : { role: "verifier", verification: { ...verdict("pass"), checked: [] }, events: [] }, new RunBudget(), new AbortController().signal);
  expect(result).toMatchObject({ status: "completed", verified: false, warning: "MODEL_OUTPUT_INVALID" });
});
it("does not verify a visual problem without a transcription check", async () => {
  const result = await solve(input, async phase => phase.role === "solver" ? { role: "solver", candidate: answer, events: [] }
    : { role: "verifier", verification: { ...verdict("pass"), checked: ["arithmetic"] }, events: [] }, new RunBudget(), new AbortController().signal);
  expect(result).toMatchObject({ status: "completed", verified: false, warning: "MODEL_OUTPUT_INVALID" });
});
it("stops for clarification without calling verifier", async () => {
  let calls = 0;
  const result = await solve(input, async () => { calls++; return { role: "solver", candidate: { ...answer, kind: "clarification", answer: null, steps: [], clarificationQuestions: ["请提供清晰图片"] }, events: [] }; }, new RunBudget(), new AbortController().signal);
  expect(result.status).toBe("needs_clarification"); expect(calls).toBe(1);
});
it("cancellation wins over a late valid result and prevents further phases", async () => {
  const controller = new AbortController(); let calls = 0;
  const result = await solve(input, async () => { calls++; controller.abort(); return { role: "solver", candidate: answer, events: [] }; }, new RunBudget(), controller.signal);
  expect(result.status).toBe("cancelled"); expect(calls).toBe(1);
});
it("refuses caller-controlled revision and forged verified outcomes", async () => {
  await expect(solve({ ...input, revision: { candidate: answer, issues: verdict("fail").issues } }, async () => { throw new Error("unreachable"); }, new RunBudget(), new AbortController().signal)).rejects.toThrow("INVALID_INITIAL_SOLVE_INPUT");
  expect(SolveOutcomeSchema.safeParse({ schemaVersion: 1, status: "completed", candidate: answer, verified: true, verification: verdict("unknown"), warning: null }).success).toBe(false);
});
it.each(["fail", "unknown"] as const)("suppresses a policy-violating candidate on verifier %s without revision", async value => {
  let calls = 0;
  const result = await solve(input, async phase => {
    calls++;
    return phase.role === "solver" ? { role: "solver", candidate: { ...answer, answer: "UNSAFE_CANDIDATE_CANARY" }, events: [] }
      : { role: "verifier", verification: { schemaVersion: 1, verdict: value, checked: ["transcription"], issues: [{ code: "POLICY_VIOLATION", message: "UNSAFE_ISSUE_CANARY" }] }, events: [] };
  }, new RunBudget(), new AbortController().signal);
  expect(result).toMatchObject({ status: "needs_clarification", candidate: { refusalReason: "policy", answer: null, steps: [] }, verified: false });
  expect(JSON.stringify(result)).not.toContain("CANARY"); expect(calls).toBe(2);
});
it("replaces model refusal prose with a fixed safe response before returning it", async () => {
  const result = await solve(input, async () => ({ role: "solver", candidate: { ...answer, kind: "clarification", answer: null, steps: [], refusalReason: "policy", problem: { ...answer.problem, text: "UNSAFE_PROBLEM_CANARY" }, clarificationQuestions: ["UNSAFE_REFUSAL_CANARY"] }, events: [] }), new RunBudget(), new AbortController().signal);
  expect(result.status).toBe("needs_clarification"); expect(JSON.stringify(result)).not.toContain("CANARY");
});
it("rejects completed outcomes carrying policy violations at the public boundary", () => {
  expect(SolveOutcomeSchema.safeParse({ schemaVersion: 1, status: "completed", candidate: answer, verified: false,
    verification: { schemaVersion: 1, verdict: "fail", checked: ["transcription"], issues: [{ code: "POLICY_VIOLATION", message: "超出范围" }] }, warning: null }).success).toBe(false);
});
it("provides fixed help-seeking guidance for immediate danger", async () => {
  const result = await solve(input, async () => ({ role: "solver", candidate: { ...answer, kind: "clarification", answer: null, steps: [], refusalReason: "emergency", clarificationQuestions: ["UNSAFE_DETAIL_CANARY"] }, events: [] }), new RunBudget(), new AbortController().signal);
  expect(result).toMatchObject({ status: "needs_clarification", candidate: { refusalReason: "emergency" } });
  expect(JSON.stringify(result)).toContain("当地急救"); expect(JSON.stringify(result)).not.toContain("CANARY");
});
it.each(["step", "regenerate"])("independently rechecks corrected conditions and %s context on every phase", async kind => {
  const focus = { sourceRunId: "00000000-0000-4000-8000-000000000001", kind, content: "旧版移项步骤", verified: true };
  const corrected = { ...input, focus, problemCorrection: "常数项更正为5", history: [{ message: "3", answer: "等待补充：系数是多少？" }] };
  let checks = 0;
  const result = await solve(corrected, async phase => {
    expect(phase.focus).toEqual(focus); expect(phase.problemCorrection).toBe("常数项更正为5");
    expect(phase.history).toEqual(corrected.history); expect(phase.image.bytes).toEqual(input.image.bytes);
    return phase.role === "solver" ? { role: "solver", candidate: answer, events: [] } : { role: "verifier", verification: verdict(++checks === 1 ? "fail" : "pass"), events: [] };
  }, new RunBudget(), new AbortController().signal);
  expect(checks).toBe(2); expect(result).toMatchObject({ status: "completed", verified: true });
});
