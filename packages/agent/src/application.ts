import { mkdtemp, rm, lstat } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { SolverInputSchema, SolveOutcomeSchema, type PublicAgentEvent, type SolveOutcome } from "@solveflow/contracts/agent";
import { runIsolatedWorker } from "./policy/isolated-worker.js";
import { SpendLedger } from "./policy/spend-ledger.js";
import { createModelSpendGate, quoteModelRequest } from "./policy/model-spend.js";
import { ModelConnectionsSchema, type ModelConnections, type ModelRoute } from "@solveflow/contracts/model";
import { assertBoundedJson, MAX_APPLICATION_JSON_BYTES } from "./policy/bounded-json.js";
export { createProbeImage } from "./policy/probe-image.js";
export { solve } from "./orchestration/solve.js";
export { RunBudget } from "./policy/run-budget.js";
export { calculate } from "./tools/calculate.js";
export function applicationSpendStatus(routes: { solver: ModelRoute; verifier: ModelRoute }, capRmb: number | null): "SPEND_LIMIT" | "SERVICE_UNAVAILABLE" | undefined {
  if (capRmb === null) return undefined;
  try {
    const snapshot = SpendLedger.inspect(fileURLToPath(new URL("../../../.runtime/m0-spend/ledger.jsonl", import.meta.url)), BigInt(Math.floor(capRmb * 1_000_000)));
    return BigInt(snapshot.remainingMicros) < quoteModelRequest(routes.solver) + quoteModelRequest(routes.verifier) ? "SPEND_LIMIT" : undefined;
  } catch { return "SERVICE_UNAVAILABLE"; }
}

/** Project-only API: no SDK types escape. Finite budgets reuse the existing M0/M1 journal. Unlimited mode skips
 * fee reservations while retaining configured-route and request-count authorization. */
export async function runApplicationAgent(raw: unknown, settings: {
  connections: ModelConnections; capRmb: number | null; timeoutMs: number;
  signal: AbortSignal; onEvent: (event: PublicAgentEvent) => Promise<void>;
}): Promise<SolveOutcome> {
  const input = SolverInputSchema.parse(raw);
  const connections = ModelConnectionsSchema.parse(settings.connections);
  const { image, ...data } = input;
  assertBoundedJson(data, MAX_APPLICATION_JSON_BYTES);
  const ledgerPath = fileURLToPath(new URL("../../../.runtime/m0-spend/ledger.jsonl", import.meta.url));
  let ledger: SpendLedger | null = null;
  if (settings.capRmb !== null) {
    const marker = await lstat(ledgerPath + ".initialized");
    if (!marker.isFile() || marker.isSymbolicLink() || marker.nlink !== 1 || (marker.mode & 0o077) !== 0) throw new Error("INVALID_LEDGER_MARKER");
    ledger = SpendLedger.open(ledgerPath, BigInt(Math.floor(settings.capRmb * 1_000_000)));
  }
  let directory: string | undefined;
  try {
    const authorizeModel = createModelSpendGate(ledger, { solver: connections.solver.route, verifier: connections.verifier.route }, input.identity.runId);
    directory = await mkdtemp(join(tmpdir(), "solveflow-app-agent-"));
    const result = await runIsolatedWorker(new URL("./pi/application-worker.js", import.meta.url), { data, mimeType: image.mimeType, connections, runDirectory: directory },
      { maxJsonBytes: MAX_APPLICATION_JSON_BYTES, signal: settings.signal, timeoutMs: settings.timeoutMs, image: image.bytes, authorizeModel, onEvent: settings.onEvent, onDiagnostic: diagnostic => {
        if (diagnostic.runId !== input.identity.runId) throw new Error("DIAGNOSTIC_IDENTITY_MISMATCH");
        console.warn(JSON.stringify(diagnostic));
      } });
    return SolveOutcomeSchema.parse(result);
  } finally { try { ledger?.close(); } finally { if (directory) await rm(directory, { recursive: true, force: true }); } }
}
