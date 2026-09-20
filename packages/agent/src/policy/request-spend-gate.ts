import { MAX_MODEL_DISPATCHES } from "@solveflow/contracts/agent";
import { SpendLedger } from "./spend-ledger.js";

/** Trusted local composition supplies a reviewed worst-case cost per request.
 * It must cover all input/image/reasoning/output tokens and fees; this gate does not
 * derive a price or authenticate a model. A live factory must require this gate. */
export function createRequestSpendGate(ledger: SpendLedger, options: { modelId: string; attemptPrefix: string; maximumMicros: bigint }): (modelId: string, signal: AbortSignal) => void {
  const { modelId, attemptPrefix, maximumMicros } = options;
  const token = /^[A-Za-z0-9][A-Za-z0-9_.-]*$/;
  if (!token.test(modelId) || modelId.length > 128 || !token.test(attemptPrefix) || attemptPrefix.length > 100 || maximumMicros < 0n || maximumMicros > 30_000_000n) throw new Error("INVALID_SPEND_GATE");
  let attempt = 0;
  return (actualModel, signal) => {
    signal.throwIfAborted();
    if (actualModel !== modelId) throw new Error("SPEND_MODEL_MISMATCH");
    if (attempt >= MAX_MODEL_DISPATCHES) throw new Error("SPEND_ATTEMPT_LIMIT");
    attempt += 1;
    ledger.reserve(attemptPrefix + "-" + attempt, modelId, maximumMicros, signal);
  };
}
