import { parentPort, workerData } from "node:worker_threads";
const request = { type: "model.reserve", id: 1, modelId: "fixed", ...(workerData.mode === "extra" ? { micros: "0" } : {}) };
parentPort.on("message", value => {
  if (value.type !== "model.reserved") return;
  if (workerData.mode === "duplicate") parentPort.postMessage(request);
  else if (workerData.mode === "sequence" && request.id < workerData.count) parentPort.postMessage({ ...request, id: ++request.id });
  else parentPort.postMessage({ granted: true });
});
parentPort.postMessage(request);
