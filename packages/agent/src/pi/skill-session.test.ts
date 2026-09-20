import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import { createAgentSession, ModelRuntime, SessionManager, SettingsManager } from "@earendil-works/pi-coding-agent";
import { fauxProvider, fauxAssistantMessage, fauxToolCall, InMemoryCredentialStore, InMemoryModelsStore } from "@earendil-works/pi-ai";
import { admitSkills } from "./skill-admission.js";
import { createSnapshotRead } from "./snapshot-read.js";
import { createCalculateTool } from "./calculate-tool.js";
import { createApprovedResourceLoader } from "./approved-resource-loader.js";
import { budgetedPrompt } from "./budgeted-prompt.js";
import { RunBudget } from "../policy/run-budget.js";
import { CapabilitySnapshot } from "../policy/capability-snapshot.js";

it("combines two admitted Skills through native loop and the restricted AST calculator", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "solveflow-skills-loop-"));
  try {
    const identity = { ownerId: "a", runId: "a-1" };
    const budget = new RunBudget();
    const admission = await admitSkills({
      root: fileURLToPath(new URL("../../resources/skills", import.meta.url)), owner: identity.ownerId,
      manifest: [
        { name: "general", directory: "general", files: ["SKILL.md"], requiredTools: [] },
        { name: "math", directory: "math", files: ["SKILL.md", "references/algebra.md"], requiredTools: ["calculate"] },
      ],
      availableTools: ["read", "calculate"], signal: new AbortController().signal,
    });
    expect(admission.excluded).toEqual([]);
    const read = createSnapshotRead(admission.snapshot, identity.ownerId, budget);
    const calculate = createCalculateTool(budget);
    const capabilities = new CapabilitySnapshot(identity, [
      { name: "read", source: "<sdk:read>", schema: read.parameters, category: "file" },
      { name: "calculate", source: "<sdk:calculate>", schema: calculate.parameters, category: "business" },
    ]);
    const faux = fauxProvider({ provider: "skill-combination", models: [{ id: "offline", input: ["text"], reasoning: false }], tokensPerSecond: 100000 });
    faux.setResponses([
      context => {
        expect(context.systemPrompt).toContain(admission.skills.find(skill => skill.name === "general")!.description);
        expect(context.systemPrompt).toContain(admission.skills.find(skill => skill.name === "math")!.description);
        expect(context.systemPrompt).not.toContain("# 通用解题方法");
        return fauxAssistantMessage(fauxToolCall("read", { path: "/solveflow/skills/general/SKILL.md" }), { stopReason: "toolUse" });
      },
      fauxAssistantMessage(fauxToolCall("read", { path: "/solveflow/skills/math/SKILL.md" }), { stopReason: "toolUse" }),
      fauxAssistantMessage(fauxToolCall("read", { path: "/solveflow/skills/math/references/algebra.md" }), { stopReason: "toolUse" }),
      fauxAssistantMessage(fauxToolCall("calculate", { schemaVersion: 1, expression: "(7-3)/2" }), { stopReason: "toolUse" }),
      context => {
        const transcript = JSON.stringify(context.messages);
        expect(transcript).toContain("# 通用解题方法");
        expect(transcript).toContain("# 数学课程方法");
        expect(transcript).toContain("# 代数核对参考");
        const calculation = context.messages.findLast(message => message.role === "toolResult" && message.toolName === "calculate");
        expect(calculation).toMatchObject({ role: "toolResult", content: [{ type: "text", text: JSON.stringify({ schemaVersion: 1, value: "2", approximate: false, precision: 1, warnings: [] }) }] });
        return fauxAssistantMessage("combined fixture complete");
      },
    ]);
    const runtime = await ModelRuntime.create({ credentials: new InMemoryCredentialStore(), modelsPath: null, modelsStore: new InMemoryModelsStore(), allowModelNetwork: false, refreshOnCreate: false });
    runtime.registerNativeProvider(faux.provider);
    await runtime.refresh({ allowNetwork: false });
    const { session } = await createAgentSession({
      cwd, agentDir: cwd, modelRuntime: runtime, model: faux.getModel(), tools: capabilities.names(), customTools: [read, calculate],
      resourceLoader: createApprovedResourceLoader("SolveFlow offline Skill combination probe.", admission.skills),
      sessionManager: SessionManager.inMemory(cwd),
      settingsManager: SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: false, provider: { maxRetries: 0 } }, enableSkillCommands: false, enableAnalytics: false, enableInstallTelemetry: false }),
    });
    try {
      await budgetedPrompt({ session, capabilities, budget, role: "solver", message: "Combine approved methods", signal: new AbortController().signal });
      expect(session.messages.at(-1)).toMatchObject({ stopReason: "stop", content: [{ type: "text", text: "combined fixture complete" }] });
      expect(budget.snapshot()).toMatchObject({ modelAttempts: 5, fileAttempts: 3, businessAttempts: 1 });
    } finally { try { await session.abort(); } finally { session.dispose(); } }
  } finally { await rm(cwd, { recursive: true, force: true }); }
});
