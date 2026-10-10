import type { PhaseDiagnostic } from "../policy/phase-diagnostic.js";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { createAgentSession, ModelRuntime, SessionManager, SettingsManager, type AgentSession } from "@earendil-works/pi-coding-agent";
import { InMemoryCredentialStore, InMemoryModelsStore, type Model } from "@earendil-works/pi-ai";
import { AgentInputSchema, SolverCandidateSchema, ClarificationCandidateSchema, GeneratedAnswerCandidateSchema, KnowledgeDetailsSchema, VerificationSchema, type AgentInput, type PhaseResult } from "@solveflow/contracts/agent";
import { createAuthorizedOpenAiStream } from "./authorized-openai-stream.js";
import { createApprovedResourceLoader } from "./approved-resource-loader.js";
import { approvedSkills } from "./approved-skills.js";
import { admitSkills } from "./skill-admission.js";
import { createSnapshotRead } from "./snapshot-read.js";
import { createCalculateTool } from "./calculate-tool.js";
import { assertSessionCapabilities } from "./assert-capabilities.js";
import { runSessionPhase } from "./phase-runner.js";
import { CapabilitySnapshot } from "../policy/capability-snapshot.js";
import { prepareVisualEvidence } from "./visual-evidence.js";
import { RunBudget } from "../policy/run-budget.js";
import { SolvePhaseError } from "../orchestration/solve.js";

// The retained server path still generates the complete teaching presentation.
// Device generation intentionally permits omitted knowledge details until requested.
const LegacyLearningAnswerSchema = GeneratedAnswerCandidateSchema.safeExtend({
  knowledgeDetails: KnowledgeDetailsSchema,
  questions: z.array(GeneratedAnswerCandidateSchema.shape.questions.unwrap().element.safeExtend({ knowledgeDetails: KnowledgeDetailsSchema })).min(2).max(4).optional(),
});
const LegacyLearningSolverSchema = z.discriminatedUnion("kind", [LegacyLearningAnswerSchema, ClarificationCandidateSchema]);

/** Trusted server composition only. Production worker supplies validated configured metadata;
 * tests use a loopback model. Never return the SDK session or credential to callers. */
export async function runOpenAiPhase(value: AgentInput, budget: RunBudget, signal: AbortSignal, settings: {
  model: Model<"openai-completions">; apiKey: string;
  maxTokens?: number;
  learningPresentation?: boolean;
  onDiagnostic?: (diagnostic: PhaseDiagnostic) => void;
  runDirectory: string;
  authorize: (modelId: string, signal: AbortSignal) => Promise<void> | void;
}): Promise<PhaseResult> {
  const input = AgentInputSchema.parse(value);
  budget.assertActive(signal);
  const adapter = createAuthorizedOpenAiStream({ ...settings, maxTokens: settings.maxTokens ?? Math.min(4096, settings.model.maxTokens), timeoutMs: Math.max(1, Math.floor(Math.min(budget.remainingMs(), input.role === "verifier" ? 20_000 : 120_000))) });
  const root = await mkdtemp(join(settings.runDirectory, "phase-"));
  let session: AgentSession | undefined;
  let consumed = false;
  const credentials = new InMemoryCredentialStore();
  let revoke: (() => void) | undefined;
  try {
    const runtime = await ModelRuntime.create({ credentials, modelsPath: null, modelsStore: new InMemoryModelsStore(), allowModelNetwork: false, refreshOnCreate: false, signal });
    runtime.registerProvider(settings.model.provider, { baseUrl: settings.model.baseUrl, api: settings.model.api, models: [settings.model] });
    await runtime.setRuntimeApiKey(settings.model.provider, settings.apiKey, { signal });
    const admitted = await admitSkills({ root: fileURLToPath(new URL("../../resources/skills", import.meta.url)), owner: input.identity.ownerId,
      manifest: approvedSkills,
      availableTools: input.role === "solver" ? ["read", "calculate"] : [], signal });
    revoke = () => admitted.snapshot.revoke();
    const read = createSnapshotRead(admitted.snapshot, input.identity.ownerId, budget);
    const calculation = createCalculateTool(budget);
    const customTools = input.role === "solver" ? [read, calculation] : [];
    const tools = customTools.map(tool => tool.name);
    const capabilities = new CapabilitySnapshot(input.identity, tools.length ? [
      { name: "read", source: "<sdk:read>", schema: read.parameters, category: "file" },
      { name: "calculate", source: "<sdk:calculate>", schema: calculation.parameters, category: "business" },
    ] : []);
    const policy = await readFile(new URL(input.role === "solver" ? "../../resources/SYSTEM.md" : "../../resources/VERIFIER.md", import.meta.url), { encoding: "utf8", signal });
    // Reviewed student prompts: bounded, but sized for layered guidance (4 × 8 KiB ceiling).
    if (Buffer.byteLength(policy) > 32 * 1024) throw new SolvePhaseError("CAPABILITY_DENIED");
    const contentPolicy = await readFile(new URL("../../resources/CONTENT_POLICY.md", import.meta.url), { encoding: "utf8", signal });
    if (Buffer.byteLength(contentPolicy) > 32 * 1024) throw new SolvePhaseError("CAPABILITY_DENIED");
    const schema = z.toJSONSchema(input.role === "solver" ? settings.learningPresentation ? LegacyLearningSolverSchema : SolverCandidateSchema : VerificationSchema);
    const visualEvidence = settings.learningPresentation ? await prepareVisualEvidence(input.image, input.role === "verifier" ? input.candidate : undefined, signal, input.materials?.length ?? 0) : undefined;
    budget.assertActive(signal);
    const created = await createAgentSession({ cwd: root, agentDir: root, modelRuntime: runtime, model: settings.model, thinkingLevel: "off",
      tools, customTools, resourceLoader: createApprovedResourceLoader(contentPolicy + "\n\n" + policy + "\nJSON Schema:\n" + JSON.stringify(schema), admitted.skills),
      sessionManager: SessionManager.inMemory(root), settingsManager: SettingsManager.inMemory({ compaction: { enabled: false },
        retry: { enabled: false, provider: { maxRetries: 0 } }, enableSkillCommands: false, enableAnalytics: false, enableInstallTelemetry: false }) });
    session = created.session;
    session.agent.streamFunction = adapter.streamFunction;
    assertSessionCapabilities(session, capabilities);
    consumed = true;
    const result = await runSessionPhase(session, { input, capabilities, budget, signal, visualEvidence, ...(settings.onDiagnostic ? { onDiagnostic: settings.onDiagnostic } : {}) });
    if (settings.learningPresentation && input.role === "verifier" && result.role === "verifier" && result.verification.verdict === "pass" && !LegacyLearningAnswerSchema.safeParse(input.candidate).success) {
      return { ...result, verification: { schemaVersion: 1, verdict: "fail", checked: result.verification.checked, issues: [{ code: "INVALID_CANDIDATE", message: "缺少完整的知识点详情或逐题题干。请填写knowledgeDetails的含义、应用；多题每项必须填写problem与knowledgeDetails。" }] } };
    }
    return result;
  } catch (error) {
    if (signal.aborted) throw new SolvePhaseError("CANCELLED");
    const failure = adapter.failure();
    if (failure === "MODEL_UNAVAILABLE") throw new SolvePhaseError("MODEL_UNAVAILABLE");
    if (failure === "PROVIDER_REQUEST_REJECTED") throw new SolvePhaseError("MODEL_REQUEST_REJECTED");
    if (failure === "PROVIDER_RATE_LIMIT") throw new SolvePhaseError("MODEL_RATE_LIMITED");
    if (failure === "PROVIDER_AUTH_FAILED" || adapter.dispatchDenied() || (error instanceof Error && error.message === "MODEL_DISPATCH_DENIED")) throw new SolvePhaseError("CAPABILITY_DENIED");
    if (failure) throw new SolvePhaseError("INTERNAL_ERROR");
    throw error;
  } finally {
    try { if (session && !consumed) { try { await session.abort(); } finally { session.dispose(); } } }
    finally {
      revoke?.();
      try { await credentials.delete(settings.model.provider); }
      finally { await rm(root, { recursive: true, force: true }); }
    }
  }
}
