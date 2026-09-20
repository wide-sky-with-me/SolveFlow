// Test-only worker: MCP transports/credentials remain in its parent.
import { parentPort, workerData } from "node:worker_threads";
import { createMcpPortCaller } from "../../dist/mcp/port-rpc.js";
const caller = createMcpPortCaller(workerData.toolPort);
try {
  const result = await caller.call("echo", { text: "cross-thread" }, new AbortController().signal);
  if (workerData.input.mode === "spin") {
    parentPort.postMessage({ type: "started" });
    while (true) { /* deliberate noncooperation after real MCP completed */ }
  }
  parentPort.postMessage(result);
} finally { caller.close(); }
