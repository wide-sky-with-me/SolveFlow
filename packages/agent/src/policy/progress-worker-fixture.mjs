import { parentPort, workerData } from "node:worker_threads";
const event = { schemaVersion: 1, type: "run.status", runId: "00000000-0000-4000-8000-000000000001", status: "solving" };
for (let i = 0; i < (workerData.flood ? 97 : 1); i++) parentPort.postMessage({ type: "progress", event: workerData.invalid ? { ...event, thinking: "private" } : event });
parentPort.postMessage({ result: "done" });
