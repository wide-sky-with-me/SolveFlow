// Test-only entry. Runs compiled production phase boundary with an offline provider.
import { parentPort, workerData } from "node:worker_threads";
import { tmpdir } from "node:os";
import { createAgentSession, ModelRuntime, SessionManager, SettingsManager } from "@earendil-works/pi-coding-agent";
import { fauxProvider, fauxAssistantMessage, InMemoryCredentialStore, InMemoryModelsStore } from "@earendil-works/pi-ai";
import { runSessionPhase } from "../../dist/pi/phase-runner.js";
import { createApprovedResourceLoader } from "../../dist/pi/approved-resource-loader.js";
import { CapabilitySnapshot } from "../../dist/policy/capability-snapshot.js";
import { RunBudget } from "../../dist/policy/run-budget.js";
const { input: data, image } = workerData;
const input = { ...data.phase, image: { mimeType: "image/png", bytes: image } };
const faux = fauxProvider({ provider: "phase-worker-offline", models: [{ id: "offline", input: ["text", "image"], reasoning: false }] });
faux.setResponses([context => {
  const last = context.messages.at(-1);
  if (last?.role !== "user" || !Array.isArray(last.content) || !last.content.some(p => p.type === "image" && p.data === Buffer.from(image).toString("base64"))) throw new Error("ORIGINAL_IMAGE_MISSING");
  return fauxAssistantMessage(JSON.stringify(data.output));
}]);
const runtime = await ModelRuntime.create({ credentials: new InMemoryCredentialStore(), modelsPath: null, modelsStore: new InMemoryModelsStore(), allowModelNetwork: false, refreshOnCreate: false });
runtime.registerNativeProvider(faux.provider); await runtime.refresh({ allowNetwork: false });
const { session } = await createAgentSession({ cwd: tmpdir(), agentDir: tmpdir(), modelRuntime: runtime, model: faux.getModel(), tools: [], resourceLoader: createApprovedResourceLoader("Offline phase worker test", []), sessionManager: SessionManager.inMemory(tmpdir()), settingsManager: SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: false, provider: { maxRetries: 0 } }, enableSkillCommands: false, enableAnalytics: false, enableInstallTelemetry: false }) });
const { createWorkerSpendClient } = await import("../../dist/policy/worker-spend-client.js");
const result = await runSessionPhase(session, { input, capabilities: new CapabilitySnapshot(input.identity, []), budget: new RunBudget(), signal: new AbortController().signal, beforeModelDispatch: createWorkerSpendClient(parentPort) });
// Send terminal data only after the phase has run its cleanup.
parentPort.postMessage(result);
