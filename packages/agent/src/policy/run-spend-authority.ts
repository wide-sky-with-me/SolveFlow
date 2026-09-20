import type { SpendLedger } from "./spend-ledger.js";
import type { RunBudget } from "./run-budget.js";
import { createRequestSpendGate } from "./request-spend-gate.js";

/** Parent composition must reuse one budget across initial/revised Solver and Verifiers.
 * Role, model and quote come from trusted phase construction, never from worker RPC.
 */
export function createRunSpendAuthority(ledger: SpendLedger, budget: RunBudget, options: { role: "solver" | "verifier"; modelId: string; attemptPrefix: string; maximumMicros: bigint }): (modelId: string, signal: AbortSignal) => void {
  const { role, modelId } = options;
  if (role !== "solver" && role !== "verifier") throw new Error("INVALID_SPEND_ROLE");
  const spend = createRequestSpendGate(ledger, options);
  return (actualModel, signal) => {
    if (actualModel !== modelId) throw new Error("SPEND_MODEL_MISMATCH");
    if (role === "solver") budget.reserveModel(signal);
    else budget.reserveVerifier(signal);
    spend(actualModel, signal);
    // fsync is synchronous: recheck the run deadline before returning permission.
    budget.assertActive(signal);
  };
}
