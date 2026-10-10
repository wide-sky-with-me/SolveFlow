import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import { z } from "zod";
import { createAgentSession, ModelRuntime, SessionManager, SettingsManager } from "@earendil-works/pi-coding-agent";
import { fauxProvider, fauxAssistantMessage, fauxToolCall, InMemoryCredentialStore, InMemoryModelsStore } from "@earendil-works/pi-ai";
import { approvedSkills } from "./approved-skills.js";
import { admitSkills } from "./skill-admission.js";
import { createSnapshotRead } from "./snapshot-read.js";
import { createCalculateTool } from "./calculate-tool.js";
import { createApprovedResourceLoader } from "./approved-resource-loader.js";
import { budgetedPrompt } from "./budgeted-prompt.js";
import { RunBudget } from "../policy/run-budget.js";
import { CapabilitySnapshot } from "../policy/capability-snapshot.js";
const root = fileURLToPath(new URL("../../resources/skills", import.meta.url));
const cases = [
  { name: "exams", reference: "sat.md", expression: "1/3", expected: 1/3 },
  { name: "exams", reference: "act.md", expression: "(15-5)/2", expected: 5 },
  { name: "exams", reference: "ap.md", expression: "(20-8)/4", expected: 3 },
  { name: "exams", reference: "esat.md", expression: "(60/3.6)*2", expected: 100/3 },
  { name: "exams", reference: "tmua.md", expression: "2**2-4", expected: 0 },
  { name: "exams", reference: "tara.md", expression: "80*0.75", expected: 60 },
  { name: "physics", reference: "models.md", expression: "(10-2)/2*3**2/2", expected: 18 },
  { name: "chemistry", reference: "stoichiometry.md", expression: "10/100*44", expected: 4.4 },
  { name: "biology", reference: "genetics-and-experiments.md", expression: "0.5/0.75", expected: 2 / 3 },
];
it.each(cases)("loads the production $name skill and reference on demand, then checks its numeric example through native Pi", async fixture => {
  const signal = new AbortController().signal; const cwd = await mkdtemp(join(tmpdir(), "solveflow-course-skill-"));
  const identity = { ownerId: "course-owner", runId: "course-run" }; const budget = new RunBudget();
  const admission = await admitSkills({ root, owner: identity.ownerId, manifest: approvedSkills, availableTools: ["read", "calculate"], signal });
  try {
    expect(admission.skills.map(skill => skill.name)).toEqual(approvedSkills.map(skill => skill.name)); expect(admission.excluded).toEqual([]);
    const entry = admission.skills.find(skill => skill.name === fixture.name)!;
    const reference = `${entry.baseDir}/references/${fixture.reference}`;
    const body = admission.snapshot.read(entry.filePath, identity.ownerId, signal);
    const referenceBody = admission.snapshot.read(reference, identity.ownerId, signal);
    expect(body).toContain(`references/${fixture.reference}`);
    expect(() => admission.snapshot.read(reference, "another-owner", signal)).toThrow();
    const read = createSnapshotRead(admission.snapshot, identity.ownerId, budget); const calculate = createCalculateTool(budget);
    const capabilities = new CapabilitySnapshot(identity, [
      { name: "read", source: "<sdk:read>", schema: read.parameters, category: "file" },
      { name: "calculate", source: "<sdk:calculate>", schema: calculate.parameters, category: "business" },
    ]);
    const faux = fauxProvider({ provider: "course-skill-fixture", models: [{ id: "offline", input: ["text"], reasoning: false }], tokensPerSecond: 100000 });
    faux.setResponses([
      context => {
        expect(context.systemPrompt).toContain(entry.filePath); expect(context.systemPrompt).toContain(entry.description);
        expect(context.systemPrompt).not.toContain(body); expect(context.systemPrompt).not.toContain(referenceBody);
        return fauxAssistantMessage(fauxToolCall("read", { path: entry.filePath }), { stopReason: "toolUse" });
      },
      fauxAssistantMessage(fauxToolCall("read", { path: reference }), { stopReason: "toolUse" }),
      context => {
        const readResults = context.messages.filter(message => message.role === "toolResult" && message.toolName === "read");
        expect(readResults).toHaveLength(2); expect(readResults.every(message => message.role === "toolResult" && !message.isError)).toBe(true);
        return fauxAssistantMessage(fauxToolCall("calculate", { schemaVersion: 1, expression: fixture.expression }), { stopReason: "toolUse" });
      },
      context => {
        const result = context.messages.findLast(message => message.role === "toolResult" && message.toolName === "calculate");
        if (result?.role !== "toolResult" || result.content[0]?.type !== "text") throw new Error("CALCULATION_MISSING");
        const calculation = z.object({ value: z.string() }).parse(JSON.parse(result.content[0].text));
        expect(Number(calculation.value)).toBeCloseTo(fixture.expected, 12);
        return fauxAssistantMessage("offline course probe complete");
      },
    ]);
    const runtime = await ModelRuntime.create({ credentials: new InMemoryCredentialStore(), modelsPath: null, modelsStore: new InMemoryModelsStore(), allowModelNetwork: false, refreshOnCreate: false });
    runtime.registerNativeProvider(faux.provider); await runtime.refresh({ allowNetwork: false });
    const { session } = await createAgentSession({ cwd, agentDir: cwd, modelRuntime: runtime, model: faux.getModel(), tools: capabilities.names(), customTools: [read, calculate],
      resourceLoader: createApprovedResourceLoader("Offline course skill loading probe.", admission.skills), sessionManager: SessionManager.inMemory(cwd),
      settingsManager: SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: false, provider: { maxRetries: 0 } }, enableSkillCommands: false, enableAnalytics: false, enableInstallTelemetry: false }) });
    try {
      await budgetedPrompt({ session, capabilities, budget, role: "solver", message: "Exercise the admitted course method", signal });
      expect(session.messages.at(-1)).toMatchObject({ stopReason: "stop" });
      expect(budget.snapshot()).toMatchObject({ modelAttempts: 4, fileAttempts: 2, businessAttempts: 1 });
    } finally { try { await session.abort(); } finally { session.dispose(); } }
  } finally { admission.snapshot.revoke(); await rm(cwd, { recursive: true, force: true }); }
});
it("excludes course skills when calculator is absent and revokes admitted resources", async () => {
  const signal = new AbortController().signal;
  const admission = await admitSkills({ root, owner: "owner", manifest: approvedSkills, availableTools: ["read"], signal });
  try { expect(admission.skills.map(skill => skill.name)).toEqual(["exams", "general", "writing"]); expect(admission.snapshot.read('/solveflow/skills/writing/SKILL.md', 'owner', signal)).toContain('focus.draft'); for (const fixture of cases.filter(item => item.name !== "exams")) expect(admission.excluded).toContainEqual({ name: fixture.name, missingTools: ["calculate"] }); }
  finally { admission.snapshot.revoke(); }
  expect(() => admission.snapshot.read("/solveflow/skills/general/SKILL.md", "owner", signal)).toThrow();
});
