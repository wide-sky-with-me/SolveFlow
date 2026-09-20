import { MAX_MODEL_DISPATCHES } from "@solveflow/contracts/agent";
import { createHash } from "node:crypto";
import { ModelRouteSchema, type ModelRoute, type ModelRole } from "@solveflow/contracts/model";
import { SpendLedger, quoteMicros } from "./spend-ledger.js";
import { createRequestSpendGate } from "./request-spend-gate.js";
export function modelAuthorizationId(role: ModelRole, route: ModelRoute) {
  return "route-" + createHash("sha256").update(JSON.stringify({ role, route: ModelRouteSchema.parse(route) })).digest("hex");
}
export function quoteModelRequest(route: ModelRoute) {
  const value = ModelRouteSchema.parse(route);
  // Input stays at full capacity (including images). Request ceilings require an
  // explicit review of the provider's total-output contract, including reasoning.
  const outputTokens = value.outputBudgetMode === "request-limit" ? value.requestMaxTokens : value.maxOutputTokens;
  return quoteMicros(value.contextWindow, outputTokens,
    BigInt(Math.ceil(value.inputRmbPerMillionTokens * 1_000_000)), BigInt(Math.ceil(value.outputRmbPerMillionTokens * 1_000_000)), BigInt(Math.ceil(value.requestFeeRmb * 1_000_000)));
}
export function createModelSpendGate(ledger: SpendLedger | null, routes: Record<ModelRole, ModelRoute>, attemptPrefix: string) {
  if (ledger === null) {
    const approved = new Set([modelAuthorizationId("solver", routes.solver), modelAuthorizationId("verifier", routes.verifier)]);
    let attempts = 0;
    return (id: string, signal: AbortSignal) => {
      signal.throwIfAborted();
      if (!approved.has(id) || attempts >= MAX_MODEL_DISPATCHES) throw new Error("MODEL_DISPATCH_DENIED");
      attempts++;
    };
  }
  const minimum = quoteModelRequest(routes.solver) + quoteModelRequest(routes.verifier);
  if (BigInt(ledger.snapshot().remainingMicros) < minimum) throw new Error("SPEND_LIMIT");
  const gates = new Map(["solver", "verifier"].map(role => {
    const selected = role === "solver" ? "solver" : "verifier";
    const route = routes[selected]; const modelId = modelAuthorizationId(selected, route);
    return [modelId, createRequestSpendGate(ledger, { modelId, attemptPrefix: `${attemptPrefix}-${role}`, maximumMicros: quoteModelRequest(route) })] as const;
  }));
  let attempts = 0;
  return (id: string, signal: AbortSignal) => {
    signal.throwIfAborted(); const gate = gates.get(id);
    if (!gate || attempts >= MAX_MODEL_DISPATCHES) throw new Error("MODEL_DISPATCH_DENIED");
    const solver = id === modelAuthorizationId("solver", routes.solver);
    const required = solver ? quoteModelRequest(routes.solver) + quoteModelRequest(routes.verifier) : quoteModelRequest(routes.verifier);
    if (BigInt(ledger.snapshot().remainingMicros) < required) throw new Error("SPEND_LIMIT");
    gate(id, signal); attempts++;
  };
}
