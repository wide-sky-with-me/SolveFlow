import { parentPort, workerData } from "node:worker_threads";
import { isAbsolute } from "node:path";
import { z } from "zod";
import { ModelConnectionsSchema } from "@solveflow/contracts/model";
import { configuredModel } from "./configured-model.js";
import { solve } from "../orchestration/solve.js";
import { RunBudget } from "../policy/run-budget.js";
import { createWorkerSpendClient } from "../policy/worker-spend-client.js";
import { runOpenAiPhase } from "./openai-phase.js";
import { assertBoundedJson } from "../policy/bounded-json.js";
import { RunIdentitySchema } from "@solveflow/contracts/agent";

// Server-only bootstrap. Neither the API key nor the host directory enters prompts.
const common = { identity: RunIdentitySchema, runDirectory: z.string().max(4096).refine(isAbsolute) };
const dataSchema = z.strictObject({ ...common, mode: z.enum(["live", "offline"]), connections: ModelConnectionsSchema });
const envelope = z.strictObject({ input: dataSchema, image: z.instanceof(Uint8Array) });
const port = parentPort;
if (!port) throw new Error("WORKER_ONLY");
const controller = new AbortController();
const cancel = (message: unknown) => {
  if (typeof message === "object" && message !== null && "type" in message && message.type === "cancel") controller.abort();
};
port.on("message", cancel);
try {
  const data = envelope.parse(workerData);
  const config = data.input;
  const selected = { solver: configuredModel(config.connections.solver, "solver"), verifier: configuredModel(config.connections.verifier, "verifier") };
  const budget = new RunBudget();
  const authorize = createWorkerSpendClient(port);
  let readCompleted = 0;
  const outcome = await solve({ schemaVersion: 1, role: "solver", identity: config.identity,
    message: "请解答原图中的一道题。先依据可用 Skill 描述读取相关方法，再给出答案。", subject: "math",
    image: { mimeType: "image/png", bytes: data.image }, evidence: [] },
  (input, sharedBudget, signal) => {
    const connection = selected[input.role];
    return runOpenAiPhase(input, sharedBudget, signal, { ...connection, runDirectory: config.runDirectory, authorize: (_model, active) => authorize(connection.authorizationId, active) });
  }, budget, controller.signal,
  event => { if (event.type === "tool.status" && event.toolName === "read" && event.status === "completed") readCompleted++; });
  const result = { schemaVersion: 1, mode: config.mode, outcome, budget: budget.snapshot(), readCompleted };
  assertBoundedJson(result);
  port.postMessage(result);
} catch {
  // Never post an exception from SDK/config/credentials or a raw transcript.
  port.postMessage({ schemaVersion: 1, error: "PROBE_WORKER_FAILED" });
} finally {
  port.removeListener("message", cancel);
  port.close();
}
