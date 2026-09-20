// Offline-only probe: genuine Pi loop, deliberately noncooperative faux provider.
import { parentPort } from "node:worker_threads";
import { tmpdir } from "node:os";
import { createAgentSession, createExtensionRuntime, ModelRuntime, SessionManager, SettingsManager } from "@earendil-works/pi-coding-agent";
import { fauxProvider, InMemoryCredentialStore, InMemoryModelsStore } from "@earendil-works/pi-ai";
if (!parentPort) throw new Error("NO_PARENT");
const faux = fauxProvider({ provider: "worker-offline", models: [{ id: "offline", input: ["text"], reasoning: false }] });
faux.setResponses([() => {
  parentPort.postMessage({ type: "started" });
  while (true) { /* actual provider ignores AbortSignal and blocks this worker */ }
}]);
const runtime = await ModelRuntime.create({ credentials: new InMemoryCredentialStore(), modelsPath: null, modelsStore: new InMemoryModelsStore(), allowModelNetwork: false, refreshOnCreate: false });
runtime.registerNativeProvider(faux.provider);
await runtime.refresh({ allowNetwork: false });
const extensions = { extensions: [], errors: [], runtime: createExtensionRuntime() };
const loader = {
  getExtensions: () => extensions, getSkills: () => ({ skills: [], diagnostics: [] }),
  getPrompts: () => ({ prompts: [], diagnostics: [] }), getThemes: () => ({ themes: [], diagnostics: [] }),
  getAgentsFiles: () => ({ agentsFiles: [] }), getSystemPrompt: () => "Offline worker cancellation probe.",
  getSystemPromptSource: () => undefined, getAppendSystemPrompt: () => [], getAppendSystemPromptSources: () => [],
  extendResources: () => { throw new Error("DENIED"); }, reload: async () => {},
};
const { session } = await createAgentSession({ cwd: tmpdir(), agentDir: tmpdir(), modelRuntime: runtime, model: faux.getModel(), tools: [], resourceLoader: loader,
  sessionManager: SessionManager.inMemory(tmpdir()), settingsManager: SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: false, provider: { maxRetries: 0 } }, enableSkillCommands: false, enableAnalytics: false, enableInstallTelemetry: false }) });
try { await session.prompt("offline", { expandPromptTemplates: false }); }
finally { session.dispose(); }
