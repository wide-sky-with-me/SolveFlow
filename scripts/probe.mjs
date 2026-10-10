import { mkdtemp, mkdir, rm, lstat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { loadConfig, getLiveCallGate, getModelConnections, ConfigError } from "../packages/config/dist/index.js";
import { ProbeReportSchema } from "../packages/contracts/dist/agent.js";
import { runIsolatedWorker, WorkerBoundaryError, MAX_ISOLATED_WORKER_DURATION_MS } from "../packages/agent/dist/policy/isolated-worker.js";
import { createProbeImage } from "../packages/agent/dist/policy/probe-image.js";
import { SpendLedger } from "../packages/agent/dist/policy/spend-ledger.js";
import { initializeLedger } from "../packages/agent/dist/policy/initialize-ledger.js";
import { createModelSpendGate, modelAuthorizationId } from "../packages/agent/dist/policy/model-spend.js";
import { RunBudget } from "../packages/agent/dist/policy/run-budget.js";

const ledgerPath = fileURLToPath(new URL("../.runtime/m0-spend/ledger.jsonl", import.meta.url));
const args = process.argv.slice(2);
let directory; let ledger; let offline;
const controller = new AbortController();
const stop = () => controller.abort();
process.once("SIGINT", stop); process.once("SIGTERM", stop);
try {
  if (args.length > 1 || (args.length === 1 && !["--live", "--init-ledger"].includes(args[0]))) throw new Error("INVALID_PROBE_ARGS");
  if (args[0] === "--init-ledger") {
    await mkdir(dirname(ledgerPath), { recursive: true, mode: 0o700 });
    initializeLedger(ledgerPath);
    console.log(JSON.stringify({ schemaVersion: 1, ledgerInitialized: true, liveCalls: 0 }));
  } else {
    const live = args[0] === "--live";
    const mode = live ? "live" : "offline";
    // Offline path deliberately ignores the environment and never opens live ledger.
    const config = loadConfig(live ? process.env : {});
    if (live && !getLiveCallGate(config).allowed) {
      console.error(JSON.stringify({ code: "LIVE_CALLS_NOT_AUTHORIZED", reasons: getLiveCallGate(config).reasons }));
      process.exitCode = 1;
    } else {
      const budget = new RunBudget();
      const runId = randomUUID();
      let reservations = 0;
      let spend; let connections;
      if (live) {
        if (config.liveBudgetRmb !== null) {
        const marker = await lstat(ledgerPath + ".initialized");
        if (!marker.isFile() || marker.isSymbolicLink() || marker.nlink !== 1 || (marker.mode & 0o077) !== 0) throw new Error("INVALID_LEDGER_MARKER");
        ledger = SpendLedger.open(ledgerPath, BigInt(Math.floor(config.liveBudgetRmb * 1_000_000)));
        }
        connections = getModelConnections(config);
        spend = createModelSpendGate(ledger ?? null, { solver: connections.solver.route, verifier: connections.verifier.route }, runId);
      } else {
        const { startOfflineProbeProvider, offlineModelConnections } = await import("./offline-probe-provider.mjs");
        offline = await startOfflineProbeProvider();
        connections = offlineModelConnections(offline.baseURL);
      }
      directory = await mkdtemp(join(tmpdir(), "solveflow-probe-"));
      const common = { identity: { ownerId: "local-probe", sessionId: runId, runId }, runDirectory: directory };
      const input = { ...common, mode, connections };
      const approvedIds = new Set([modelAuthorizationId("solver", connections.solver.route), modelAuthorizationId("verifier", connections.verifier.route)]);
      const result = ProbeReportSchema.parse(await runIsolatedWorker(new URL("../packages/agent/dist/pi/probe-worker.js", import.meta.url), input,
        { signal: controller.signal, timeoutMs: Math.max(1, Math.floor(Math.min(MAX_ISOLATED_WORKER_DURATION_MS, budget.remainingMs()))), image: createProbeImage(),
          authorizeModel(modelId, signal) {
            budget.assertActive(signal);
            if (live) { if (!getLiveCallGate(config).allowed) throw new Error("LIVE_CALLS_NOT_AUTHORIZED"); spend(modelId, signal); }
            else if (!approvedIds.has(modelId)) throw new Error("MODEL_MISMATCH");
            reservations++;
            budget.assertActive(signal);
          } }));
      // This exact-match scorer is ONLY for the one self-authored equation fixture.
      const correct = result.outcome.status === "completed" && /^x\s*=\s*2[.。]?$/.test(result.outcome.candidate.answer.trim().replaceAll("$", ""));
      const passed = result.mode === mode && correct && result.outcome.verified && result.readCompleted > 0;
      console.log(JSON.stringify({ schemaVersion: 1, mode, passed, status: result.outcome.status, verified: result.outcome.verified,
        fixtureAnswerCorrect: correct, readCompleted: result.readCompleted, budget: result.budget, reservations,
        ...(result.outcome.status === "failed" || result.outcome.status === "cancelled" ? { error: result.outcome.error.code } : {}),
        ...(live ? { budgetMode: ledger ? "limited" : "unlimited", ...(ledger ? { ledger: ledger.snapshot() } : {}), actualCost: "unknown" } : { simulatedProvider: true, protocol: offline.observations }) }, null, 2));
      if (!passed) process.exitCode = 1;
    }
  }
} catch (error) {
  console.error(JSON.stringify(error instanceof ConfigError ? { code: error.code, fields: error.fields }
    : { code: error instanceof WorkerBoundaryError ? error.code : "PROBE_FAILED", ...(ledger ? { ledger: ledger.snapshot() } : {}) }));
  process.exitCode = 1;
} finally {
  process.removeListener("SIGINT", stop); process.removeListener("SIGTERM", stop);
  try { ledger?.close(); } finally {
    try { await offline?.close(); } finally { if (directory) await rm(directory, { recursive: true, force: true }); }
  }
}
