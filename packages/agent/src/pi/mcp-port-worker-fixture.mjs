// Test-only native Pi loop. Parent owns fees, MCP transports and their lifetime.
import { parentPort, workerData } from "node:worker_threads";
import { tmpdir } from "node:os";
import { z } from "zod";
import { createAgentSession, ModelRuntime, SessionManager, SettingsManager } from "@earendil-works/pi-coding-agent";
import { fauxProvider, fauxAssistantMessage, fauxToolCall, InMemoryCredentialStore, InMemoryModelsStore } from "@earendil-works/pi-ai";
import { runSessionPhase } from "../../dist/pi/phase-runner.js";
import { createMcpExtension } from "../../dist/pi/mcp-extension.js";
import { createApprovedResourceLoader } from "../../dist/pi/approved-resource-loader.js";
import { createPortConnection } from "../../dist/mcp/port-connection.js";
import { createWorkerSpendClient } from "../../dist/policy/worker-spend-client.js";
import { CapabilitySnapshot } from "../../dist/policy/capability-snapshot.js";
import { RunBudget } from "../../dist/policy/run-budget.js";
import { echoSchema } from "../mcp/probe-fixture.mjs";
const { input: data, image, toolPort } = workerData;
const identity = { ownerId: "a", runId: "a" };
const proxy = createPortConnection(toolPort, { ...identity, server: "local", credentialVersion: "v1" }, ["echo"]);
const budget = new RunBudget();
const capabilities = new CapabilitySnapshot(identity, [{ name: "mcp__local__echo", source: "<solveflow:mcp:local>", schema: echoSchema, category: "business" }]);
const extension = createMcpExtension({ server: "local", credentialVersion: "v1", identity, client: proxy, budget, capabilities, tools: [{ name: "echo", inputSchema: echoSchema, parameters: z.strictObject({ text: z.string().max(128) }) }] });
const faux = fauxProvider({ provider: "port-phase-offline", models: [{ id: "offline", input: ["text", "image"], reasoning: false }] });
faux.setResponses([context => {
  const content = context.messages.at(-1)?.content;
  if (!Array.isArray(content) || !content.some(p => p.type === "image" && p.data === Buffer.from(image).toString("base64"))) throw new Error("IMAGE_MISSING");
  return fauxAssistantMessage(fauxToolCall("mcp__local__echo", { text: "native-port-evidence" }), { stopReason: "toolUse" });
}, context => {
  const result = context.messages.at(-1);
  if (result?.role !== "toolResult" || result.isError || !JSON.stringify(result.content).includes("native-port-evidence")) throw new Error("MCP_RESULT_MISSING");
  return fauxAssistantMessage(JSON.stringify(data.candidate));
}]);
const runtime = await ModelRuntime.create({ credentials: new InMemoryCredentialStore(), modelsPath: null, modelsStore: new InMemoryModelsStore(), allowModelNetwork: false, refreshOnCreate: false });
runtime.registerNativeProvider(faux.provider); await runtime.refresh({ allowNetwork: false });
const { session } = await createAgentSession({ cwd: tmpdir(), agentDir: tmpdir(), modelRuntime: runtime, model: faux.getModel(), tools: capabilities.names(), resourceLoader: createApprovedResourceLoader("Offline port fixture", [], [extension]), sessionManager: SessionManager.inMemory(tmpdir()), settingsManager: SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: false, provider: { maxRetries: 0 } }, enableSkillCommands: false, enableAnalytics: false, enableInstallTelemetry: false }) });
try {
  const result = await runSessionPhase(session, { input: { schemaVersion: 1, role: "solver", identity: { ...identity, sessionId: "s" }, message: "offline", evidence: [], image: { mimeType: "image/png", bytes: image } }, capabilities, budget, signal: new AbortController().signal, beforeModelDispatch: createWorkerSpendClient(parentPort) });
  parentPort.postMessage(result);
} finally { await proxy.close(); }
