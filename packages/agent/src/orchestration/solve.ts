// Decision: .agents/notes/implemented/architecture/2026-10-09-batch-dispatch-and-verification.md
// Decision: .agents/notes/implemented/architecture/2026-10-08-answer-checkpoint-queues.md
import { AgentErrorCodeSchema, PhaseResultSchema, SolveOutcomeSchema, SolverInputSchema, makeSafeAgentError, policyRefusal,
  parseCandidateWithEvidence, parseCandidateForExam, parseVerificationForCandidate, assessVerificationCoverage, type AgentInput, type SolverInput,
  type SolveOutcome, type AnswerCandidate, type Verification, type PublicAgentEvent, type AgentErrorCode } from "@solveflow/contracts/agent";
import { RunBudget } from "../policy/run-budget.js";

export type PhaseExecutor = (input: AgentInput, budget: RunBudget, signal: AbortSignal) => Promise<unknown>;
export type SolveRecovery = { execute: PhaseExecutor; prefer?: boolean };
export type SolveLifecycle = { candidate: (candidate: AnswerCandidate) => Promise<void>; verification: () => Promise<() => Promise<void>> };
const recoverable = new Set<AgentErrorCode>(['MODEL_TIMEOUT', 'MODEL_OUTPUT_INVALID', 'MODEL_UNAVAILABLE', 'MODEL_RATE_LIMITED']);
const recoverableVerification = new Set<AgentErrorCode>([...recoverable, 'VERIFIER_LIMIT']);
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
  onEvent: (event: PublicAgentEvent) => void = () => {}, recovery?: SolveRecovery, lifecycle?: SolveLifecycle): Promise<SolveOutcome> {
  const parsed = SolverInputSchema.safeParse(inputValue);
  if (!parsed.success || parsed.data.revision) throw new Error("INVALID_INITIAL_SOLVE_INPUT");
  const { verificationTarget, ...original } = parsed.data;
  const emit = (status: "solving" | "verifying" | "revising") => onEvent({ schemaVersion: 1, type: "run.status", runId: original.identity.runId, status });
  let recoveryUsed = false;
  let availableAnswer: AnswerCandidate | undefined;
  let availableVerification: Verification | null = null;
  let releaseVerification: (() => Promise<void>) | undefined;
  const run = async (input: AgentInput, useRecovery = false) => {
    budget.assertActive(signal);
    if (useRecovery) {
      if (!recovery || recoveryUsed || input.role !== 'solver') throw new SolvePhaseError('INVALID_INPUT');
      recoveryUsed = true;
      emit('revising');
    }
    const value = await (useRecovery && recovery ? recovery.execute : execute)(input, budget, signal);
    const parsed = PhaseResultSchema.safeParse(value);
    if (!parsed.success) throw new SolvePhaseError("MODEL_OUTPUT_INVALID");
    const output = parsed.data;
    budget.assertActive(signal); // A late result cannot override cancellation/deadline.
    if (output.role !== input.role || output.events.some(event => event.runId !== original.identity.runId)) throw new Error("INVALID_PHASE_RESULT");
    for (const event of output.events) if (event.type === "tool.status") onEvent(event);
    return output;
  };
  try {
    if (original.useBackup && !recovery?.prefer) throw new SolvePhaseError('INVALID_INPUT');
    if (verificationTarget) {
      budget.assertActive(signal);
      const candidate = parseCandidateWithEvidence(verificationTarget, original.evidence);
      if (candidate.kind !== 'answer') throw new SolvePhaseError('INVALID_INPUT');
      // Historical records remain readable, but cannot bypass current exam constraints.
      try { parseCandidateForExam(candidate, original.exam); }
      catch {
        return SolveOutcomeSchema.parse({ schemaVersion: 1, status: 'completed', candidate, verified: false, warning: null,
          verification: { schemaVersion: 1, verdict: 'fail', checked: [], issues: [{ code: 'INVALID_CANDIDATE', message: '答案不符合当前考试的作答格式，请重新解答后校验。' }] } });
      }
      emit('verifying');
      const checked = await run({ ...original, role: 'verifier', candidate });
      if (checked.role !== 'verifier') throw new SolvePhaseError('MODEL_OUTPUT_INVALID');
      let verification;
      try { verification = parseVerificationForCandidate(checked.verification, candidate); } catch { throw new SolvePhaseError("MODEL_OUTPUT_INVALID"); }
      if (verification.verdict === 'pass' && !verification.checked.includes('transcription')) throw new SolvePhaseError('MODEL_OUTPUT_INVALID');
      verification = assessVerificationCoverage(verification, candidate);
      if (verification.issues.some(issue => issue.code === 'POLICY_VIOLATION')) return SolveOutcomeSchema.parse({ schemaVersion: 1, status: 'needs_clarification', candidate: policyRefusal(), verified: false });
      return SolveOutcomeSchema.parse({ schemaVersion: 1, status: 'completed', candidate, verified: verification.verdict === 'pass', verification, warning: null });
    }
    let request: SolverInput = original;
    for (let revision = 0; revision <= 1; revision += 1) {
      emit(revision ? "revising" : "solving");
      let output;
      const useRecovery = !!recovery && !recoveryUsed && (revision === 1 || recovery.prefer);
      try { output = await run(request, useRecovery); }
      catch (error) {
        if (!recovery || recoveryUsed || signal.aborted || !recoverable.has(publicFailure(error))) throw error;
        output = await run(request, true);
      }
      if (output.role !== "solver") throw new Error("INVALID_PHASE_ROLE");
      let candidate;
      try { candidate = parseCandidateForExam(parseCandidateWithEvidence(output.candidate, original.evidence), original.exam); }
      catch { throw new SolvePhaseError("MODEL_OUTPUT_INVALID"); }
      if (candidate.kind === 'clarification' && !candidate.refusalReason && recovery && !recoveryUsed) {
        const reconsidered = await run(request, true);
        if (reconsidered.role !== 'solver') throw new SolvePhaseError('MODEL_OUTPUT_INVALID');
        candidate = parseCandidateForExam(parseCandidateWithEvidence(reconsidered.candidate, original.evidence), original.exam);
      }
      if (candidate.kind === "clarification") return SolveOutcomeSchema.parse({ schemaVersion: 1, status: "needs_clarification", candidate: candidate.refusalReason ? policyRefusal(candidate.refusalReason) : candidate, verified: false });
      availableAnswer = candidate;
      availableVerification = null;
      if (original.verificationMode === "manual" && !recoveryUsed) return SolveOutcomeSchema.parse({ schemaVersion: 1, status: "completed", candidate, verified: false, verification: null, warning: null, verificationStatus: "not_requested" });
      await lifecycle?.candidate(candidate);
      budget.assertActive(signal);
      if (lifecycle && !releaseVerification) releaseVerification = await lifecycle.verification();
      budget.assertActive(signal);
      emit("verifying");
      let verification;
      try {
        const checked = await run({ ...original, role: "verifier", candidate });
        if (checked.role !== "verifier") throw new Error("INVALID_PHASE_ROLE");
        try {
          verification = parseVerificationForCandidate(checked.verification, candidate);
          if (verification.verdict === "pass" && !verification.checked.includes("transcription")) throw new Error("ORIGINAL_IMAGE_NOT_CHECKED");
          verification = assessVerificationCoverage(verification, candidate);
        }
        catch { throw new SolvePhaseError("MODEL_OUTPUT_INVALID"); }
      } catch (error) {
        if (signal.aborted) throw error;
        const code = publicFailure(error);
        // Decision: .agents/notes/implemented/agent/2026-10-08-verifier-transport-degradation.md
        // Losing the independent check does not discard an already valid answer.
        // Authorization, cancellation and solver/spend budgets still stop the run.
        if (!recoverableVerification.has(code)) throw error;
        budget.assertActive(signal);
        return SolveOutcomeSchema.parse({ schemaVersion: 1, status: "completed", candidate, verified: false, verification: null, warning: code });
      }
      if (verification.issues.some(issue => issue.code === "POLICY_VIOLATION")) {
        return SolveOutcomeSchema.parse({ schemaVersion: 1, status: "needs_clarification", candidate: policyRefusal(), verified: false });
      }
      availableVerification = verification;
      if (verification.verdict !== "fail" || revision === 1 || recoveryUsed) return SolveOutcomeSchema.parse({ schemaVersion: 1, status: "completed", candidate,
        verified: verification.verdict === "pass", verification, warning: null });
      request = { ...original, revision: { candidate, issues: verification.issues } };
    }
    throw new Error("UNREACHABLE_STAGE");
  } catch (error) {
    const code = signal.aborted ? "CANCELLED" : publicFailure(error);
    if (availableAnswer && recoverable.has(code)) {
      budget.assertActive(signal);
      return SolveOutcomeSchema.parse({ schemaVersion: 1, status: 'completed', candidate: availableAnswer, verified: false, verification: availableVerification, warning: code });
    }
    return SolveOutcomeSchema.parse({ schemaVersion: 1, status: code === "CANCELLED" ? "cancelled" : "failed", verified: false,
      error: makeSafeAgentError(code, original.identity.runId) });
  } finally { await releaseVerification?.(); }
}
