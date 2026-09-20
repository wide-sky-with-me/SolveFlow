import { AgentErrorCodeSchema, PhaseResultSchema, SolveOutcomeSchema, SolverInputSchema, makeSafeAgentError, policyRefusal,
  parseCandidateWithEvidence, parseVerificationForCandidate, type AgentInput, type SolverInput,
  type SolveOutcome, type PublicAgentEvent, type AgentErrorCode } from "@solveflow/contracts/agent";
import { RunBudget } from "../policy/run-budget.js";

export type PhaseExecutor = (input: AgentInput, budget: RunBudget, signal: AbortSignal) => Promise<unknown>;
export class SolvePhaseError extends Error {
  constructor(readonly code: AgentErrorCode) { super(code); }
}
export function publicFailure(error: unknown): AgentErrorCode {
  const code = error instanceof Error && "code" in error ? error.code : undefined;
  const parsed = AgentErrorCodeSchema.safeParse(code);
  return parsed.success ? parsed.data : "INTERNAL_ERROR";
}

/** Sequential business stages only. Pi owns model/tool loops inside each phase.
 * The executor must be trusted and cancellable; deployment runs this in a supervised
 * worker. No persistence/retry or claims of owner authentication are made here. */
export async function solve(inputValue: unknown, execute: PhaseExecutor, budget: RunBudget, signal: AbortSignal,
  onEvent: (event: PublicAgentEvent) => void = () => {}): Promise<SolveOutcome> {
  const parsed = SolverInputSchema.safeParse(inputValue);
  if (!parsed.success || parsed.data.revision) throw new Error("INVALID_INITIAL_SOLVE_INPUT");
  const { verificationTarget, ...original } = parsed.data;
  const emit = (status: "solving" | "verifying" | "revising") => onEvent({ schemaVersion: 1, type: "run.status", runId: original.identity.runId, status });
  const run = async (input: AgentInput) => {
    budget.assertActive(signal);
    const value = await execute(input, budget, signal);
    const parsed = PhaseResultSchema.safeParse(value);
    if (!parsed.success) throw new SolvePhaseError("MODEL_OUTPUT_INVALID");
    const output = parsed.data;
    budget.assertActive(signal); // A late result cannot override cancellation/deadline.
    if (output.role !== input.role || output.events.some(event => event.runId !== original.identity.runId)) throw new Error("INVALID_PHASE_RESULT");
    for (const event of output.events) if (event.type === "tool.status") onEvent(event);
    return output;
  };
  try {
    if (verificationTarget) {
      const candidate = parseCandidateWithEvidence(verificationTarget, original.evidence);
      if (candidate.kind !== 'answer') throw new SolvePhaseError('INVALID_INPUT');
      emit('verifying');
      const checked = await run({ ...original, role: 'verifier', candidate });
      if (checked.role !== 'verifier') throw new SolvePhaseError('MODEL_OUTPUT_INVALID');
      let verification;
      try { verification = parseVerificationForCandidate(checked.verification, candidate); } catch { throw new SolvePhaseError("MODEL_OUTPUT_INVALID"); }
      if (verification.verdict === 'pass' && !verification.checked.includes('transcription')) throw new SolvePhaseError('MODEL_OUTPUT_INVALID');
      if (verification.issues.some(issue => issue.code === 'POLICY_VIOLATION')) return SolveOutcomeSchema.parse({ schemaVersion: 1, status: 'needs_clarification', candidate: policyRefusal(), verified: false });
      return SolveOutcomeSchema.parse({ schemaVersion: 1, status: 'completed', candidate, verified: verification.verdict === 'pass', verification, warning: null });
    }
    let request: SolverInput = original;
    for (let revision = 0; revision <= 1; revision += 1) {
      emit(revision ? "revising" : "solving");
      const output = await run(request);
      if (output.role !== "solver") throw new Error("INVALID_PHASE_ROLE");
      let candidate;
      try { candidate = parseCandidateWithEvidence(output.candidate, original.evidence); }
      catch { throw new SolvePhaseError("MODEL_OUTPUT_INVALID"); }
      if (candidate.kind === "clarification") return SolveOutcomeSchema.parse({ schemaVersion: 1, status: "needs_clarification", candidate: candidate.refusalReason ? policyRefusal(candidate.refusalReason) : candidate, verified: false });
      if (original.verificationMode === "manual") return SolveOutcomeSchema.parse({ schemaVersion: 1, status: "completed", candidate, verified: false, verification: null, warning: null, verificationStatus: "not_requested" });
      emit("verifying");
      let verification;
      try {
        const checked = await run({ ...original, role: "verifier", candidate });
        if (checked.role !== "verifier") throw new Error("INVALID_PHASE_ROLE");
        try {
          verification = parseVerificationForCandidate(checked.verification, candidate);
          if (verification.verdict === "pass" && !verification.checked.includes("transcription")) throw new Error("ORIGINAL_IMAGE_NOT_CHECKED");
        }
        catch { throw new SolvePhaseError("MODEL_OUTPUT_INVALID"); }
      } catch (error) {
        if (signal.aborted) throw error;
        const code = publicFailure(error);
        // Model loss, authorization, worker loss and the total deadline stop the run.
        // Only a verifier-specific timeout/invalid output may preserve a candidate.
        if (code !== "MODEL_TIMEOUT" && code !== "MODEL_OUTPUT_INVALID") throw error;
        return SolveOutcomeSchema.parse({ schemaVersion: 1, status: "completed", candidate, verified: false, verification: null, warning: code });
      }
      if (verification.issues.some(issue => issue.code === "POLICY_VIOLATION")) {
        return SolveOutcomeSchema.parse({ schemaVersion: 1, status: "needs_clarification", candidate: policyRefusal(), verified: false });
      }
      if (verification.verdict !== "fail" || revision === 1) return SolveOutcomeSchema.parse({ schemaVersion: 1, status: "completed", candidate,
        verified: verification.verdict === "pass", verification, warning: null });
      request = { ...original, revision: { candidate, issues: verification.issues } };
    }
    throw new Error("UNREACHABLE_STAGE");
  } catch (error) {
    const code = signal.aborted ? "CANCELLED" : publicFailure(error);
    return SolveOutcomeSchema.parse({ schemaVersion: 1, status: code === "CANCELLED" ? "cancelled" : "failed", verified: false,
      error: makeSafeAgentError(code, original.identity.runId) });
  }
}
