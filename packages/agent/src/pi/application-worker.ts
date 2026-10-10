import { parentPort, workerData } from "node:worker_threads";
import { z } from "zod";
import { ModelConnectionsSchema } from "@solveflow/contracts/model";
import { configuredModel } from "./configured-model.js";
import { SolverInputSchema } from "@solveflow/contracts/agent";
import { solve } from "../orchestration/solve.js";
import { RunBudget } from "../policy/run-budget.js";
import { createWorkerSpendClient } from "../policy/worker-spend-client.js";
import { runOpenAiPhase } from "./openai-phase.js";
import { assertBoundedJson, MAX_APPLICATION_JSON_BYTES } from "../policy/bounded-json.js";
const port = parentPort;
if (!port) throw new Error("WORKER_ONLY");
const controller = new AbortController();
const cancel = (value: unknown) => { if (typeof value === "object" && value !== null && "type" in value && value.type === "cancel") controller.abort(); };
port.on("message", cancel);
try {
  const envelope = z.strictObject({ input: z.strictObject({ data: z.record(z.string(), z.unknown()), mimeType: z.enum(["image/jpeg", "image/png", "image/webp"]), connections: ModelConnectionsSchema, runDirectory: z.string().max(4096) }), image: z.instanceof(Uint8Array) }).parse(workerData);
  const config = envelope.input;
  const input = SolverInputSchema.parse({ ...config.data, image: { mimeType: config.mimeType, bytes: envelope.image } });
  const selected = { solver: configuredModel(config.connections.solver, "solver"), verifier: configuredModel(config.connections.verifier, "verifier") };
  const authorize = createWorkerSpendClient(port);
  const outcome = await solve(input, (phase, budget, signal) => {
    const connection = selected[phase.role];
    return runOpenAiPhase(phase, budget, signal, { ...connection, learningPresentation: true, onDiagnostic: diagnostic => port.postMessage({ type: "diagnostic", diagnostic }), runDirectory: config.runDirectory, authorize: (_model, active) => authorize(connection.authorizationId, active) });
  }, new RunBudget(), controller.signal,
    event => port.postMessage({ type: "progress", event }));
  assertBoundedJson(outcome, MAX_APPLICATION_JSON_BYTES); port.postMessage(outcome);
} finally { port.removeListener("message", cancel); port.close(); }
