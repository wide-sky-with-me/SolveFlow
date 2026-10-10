// Test-only thread fixture. No network, child process, file writes or real model.
import { parentPort, workerData } from "node:worker_threads";
if (!parentPort) throw new Error("NO_PARENT");
if (workerData.mode === "complete") parentPort.postMessage({ result: "fixture", secretInherited: Boolean(process.env.SOLVEFLOW_PROBE_SENTINEL), execArgv: process.execArgv });
else if (workerData.mode === "spin") { while (true) { /* deliberately ignores cancel */ } }
else if (workerData.mode === "hang") setInterval(() => {}, 1000);
else if (workerData.mode === "crash") throw new Error("synthetic private error not for parent");
else if (workerData.mode === "oversize") parentPort.postMessage({ text: "x".repeat(40 * 1024) });
else if (workerData.mode === "echo") parentPort.postMessage(workerData);
else if (workerData.mode === "logs") { process.stdout.write("x".repeat(40 * 1024)); setInterval(() => {}, 1000); }
else if (workerData.mode === "cooperate") { parentPort.on("message", () => process.exit(0)); }
else if (workerData.mode === "diagnostic") {
  const diagnostic = { schemaVersion: 1, event: "MODEL_OUTPUT_REJECTED", runId: "run", role: "solver", reason: "JSON_INVALID", bytes: 10, fenced: true, empty: false, ...(workerData.invalid ? { text: "private-answer" } : {}) };
  for (let i = 0; i < (workerData.flood ? 5 : 1); i++) parentPort.postMessage({ type: "diagnostic", diagnostic });
  parentPort.postMessage({ result: "fixture" });
}
