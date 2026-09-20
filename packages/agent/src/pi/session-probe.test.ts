import { mkdtemp, mkdir, writeFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createAgentSession, loadSkills, ModelRuntime, SessionManager, SettingsManager } from "@earendil-works/pi-coding-agent";
import { fauxProvider, fauxAssistantMessage, fauxToolCall, InMemoryCredentialStore, InMemoryModelsStore, type ImageContent } from "@earendil-works/pi-ai";
import { createApprovedResourceLoader } from "./approved-resource-loader.js";
import { createSnapshotRead } from "./snapshot-read.js";
import { ReadSnapshot } from "../policy/read-snapshot.js";
import { RunBudget } from "../policy/run-budget.js";
import { CapabilitySnapshot } from "../policy/capability-snapshot.js";
import { budgetedPrompt } from "./budgeted-prompt.js";
import { assertSessionCapabilities } from "./assert-capabilities.js";

const roots: string[] = [];
afterEach(async () => {
  vi.unstubAllGlobals();
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

async function fixture(referenceText?: string) {
  const root = await mkdtemp(join(tmpdir(), "solveflow-pi-"));
  roots.push(root);
  const resources = join(root, "reviewed");
  const skillDir = join(resources, "math");
  const cwd = join(root, "run");
  const agentDir = join(root, "agent");
  await Promise.all([mkdir(join(skillDir, "references"), { recursive: true }), mkdir(cwd), mkdir(agentDir)]);
  const skillText = "---\nname: math\ndescription: Approved algebra method\n---\nPRIVATE_SKILL_BODY\nRead references/algebra.md before solving.";
  const refText = referenceText ?? "APPROVED_REFERENCE\nCheck both sides of the equation.";
  const skillPath = join(skillDir, "SKILL.md");
  const refPath = join(skillDir, "references/algebra.md");
  await writeFile(skillPath, skillText);
  await writeFile(refPath, refText);
  await writeFile(join(root, "AGENTS.md"), "FORBIDDEN_PARENT_CONTEXT");
  await writeFile(join(cwd, "AGENTS.md"), "FORBIDDEN_CWD_CONTEXT");
  await mkdir(join(agentDir, "skills"));
  await writeFile(join(agentDir, "skills/evil.md"), "---\nname: evil\ndescription: FORBIDDEN_HOME_SKILL\n---\nSECRET");
  const admitted = loadSkills({ cwd, agentDir, skillPaths: [resources], includeDefaults: false });
  expect(admitted.diagnostics).toEqual([]);
  expect(admitted.skills.map(skill => skill.name)).toEqual(["math"]);
  const snapshot = new ReadSnapshot(resources, "owner-a", [{ path: skillPath, text: skillText }, { path: refPath, text: refText }]);
  const budget = new RunBudget();
  const read = createSnapshotRead(snapshot, "owner-a", budget);
  const loader = createApprovedResourceLoader("SolveFlow test teaching policy.", admitted.skills);
  const faux = fauxProvider({ provider: "solveflow-fake", models: [{ id: "offline", input: ["text", "image"], reasoning: false }], tokensPerSecond: 100000 });
  const runtime = await ModelRuntime.create({ credentials: new InMemoryCredentialStore(), modelsPath: null, modelsStore: new InMemoryModelsStore(), allowModelNetwork: false, refreshOnCreate: false });
  runtime.registerNativeProvider(faux.provider);
  await runtime.refresh({ allowNetwork: false });
  const settings = SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: false, provider: { maxRetries: 0 } }, enableSkillCommands: false, enableAnalytics: false, enableInstallTelemetry: false });
  const make = (tools: string[] = ["read"]) => createAgentSession({ cwd, agentDir, modelRuntime: runtime, model: faux.getModel(), tools, customTools: [read], resourceLoader: loader, settingsManager: settings, sessionManager: SessionManager.inMemory(cwd) });
  return { root, cwd, faux, make, snapshot, skillPath, refPath, budget, loader };
}

describe("locked Pi SDK offline session", () => {
  it("uses real loop for image → Skill body → reference → answer without default context", async () => {
    const network = vi.fn(() => { throw new Error("NETWORK_FORBIDDEN"); });
    vi.stubGlobal("fetch", network);
    const f = await fixture();
    const image: ImageContent = { type: "image", data: Buffer.from("synthetic-type-probe-not-a-decoded-image").toString("base64"), mimeType: "image/png" };
    f.faux.setResponses([
      context => {
        expect(context.systemPrompt).toContain("Approved algebra method");
        expect(context.systemPrompt).not.toContain("PRIVATE_SKILL_BODY");
        expect(context.systemPrompt).not.toContain("FORBIDDEN_");
        expect(context.tools?.map(tool => tool.name)).toEqual(["read"]);
        expect(JSON.stringify(context.messages)).toContain(image.data);
        return fauxAssistantMessage(fauxToolCall("read", { path: f.skillPath }, { id: "r1" }), { stopReason: "toolUse" });
      },
      context => {
        expect(JSON.stringify(context.messages)).toContain("PRIVATE_SKILL_BODY");
        expect(JSON.stringify(context.messages)).not.toContain("APPROVED_REFERENCE");
        return fauxAssistantMessage(fauxToolCall("read", { path: "math/references/algebra.md" }, { id: "r2" }), { stopReason: "toolUse" });
      },
      context => {
        expect(JSON.stringify(context.messages)).toContain("APPROVED_REFERENCE");
        return fauxAssistantMessage("x = 2");
      },
    ]);
    const { session } = await f.make();
    const events: string[] = [];
    const unsubscribe = session.subscribe(event => { events.push(event.type); });
    try {
      expect(session.getActiveToolNames()).toEqual(["read"]);
      expect(session.getAllTools().filter(tool => tool.name === "read")).toHaveLength(1);
      await session.prompt("Solve the synthetic fixture", { images: [image], expandPromptTemplates: false });
      expect(session.messages.at(-1)).toMatchObject({ role: "assistant", stopReason: "stop", content: [{ type: "text", text: "x = 2" }] });
      expect(f.faux.state.callCount).toBe(3);
      expect(f.budget.snapshot().fileAttempts).toBe(2);
      expect(events).toContain("tool_execution_start");
      expect(events).toContain("agent_end");
      expect(network).not.toHaveBeenCalled();
    } finally { await session.abort(); unsubscribe(); session.dispose(); }
  });

  it("keeps slash commands and @files literal and supports a no-tool Verifier", async () => {
    const f = await fixture();
    const literal = `/skill:math @${join(f.root, "AGENTS.md")}`;
    f.faux.setResponses([context => {
      expect(JSON.stringify(context.messages)).toContain(literal);
      expect(JSON.stringify(context.messages)).not.toContain("PRIVATE_SKILL_BODY");
      expect(context.tools ?? []).toEqual([]);
      return fauxAssistantMessage("unknown");
    }]);
    const { session } = await f.make([]);
    try {
      expect(session.getActiveToolNames()).toEqual([]);
      await session.prompt(literal, { expandPromptTemplates: false });
      expect(session.messages.at(-1)).toMatchObject({ role: "assistant", stopReason: "stop", content: [{ type: "text", text: "unknown" }] });
      expect(f.faux.state.callCount).toBe(1);
      expect(f.budget.snapshot().fileAttempts).toBe(0);
    } finally { await session.abort(); session.dispose(); }
  });

  it("reads immutable bytes even after the admitted disk path becomes a symlink", async () => {
    const f = await fixture();
    await rm(f.skillPath);
    await symlink(join(f.root, "AGENTS.md"), f.skillPath);
    expect(f.snapshot.read(f.skillPath, "owner-a", new AbortController().signal)).toContain("PRIVATE_SKILL_BODY");
    expect(() => f.snapshot.read(f.skillPath, "owner-b", new AbortController().signal)).toThrow("RESOURCE_DENIED");
    f.snapshot.revoke();
    expect(() => f.snapshot.read(f.skillPath, "owner-a", new AbortController().signal)).toThrow("RESOURCE_DENIED");
    expect(() => f.loader.extendResources({})).toThrow("RESOURCE_EXTENSION_DENIED");
  });
  it("propagates abort to an active provider and waits for idle before disposal", async () => {
    const f = await fixture();
    const entered = Promise.withResolvers<void>();
    let observedAbort = false;
    f.faux.setResponses([async (_context, options) => {
      const signal = options?.signal;
      if (!signal) throw new Error("MISSING_CANCEL_SIGNAL");
      entered.resolve();
      await new Promise<void>((_resolve, reject) => {
        const abort = () => { observedAbort = true; reject(new Error("CANCELLED")); };
        if (signal.aborted) abort();
        else signal.addEventListener("abort", abort, { once: true });
      });
      return fauxAssistantMessage("must never complete");
    }]);
    const { session } = await f.make();
    const task = session.prompt("cancel fixture", { expandPromptTemplates: false });
    try {
      await entered.promise;
      await session.abort();
      await task;
      expect(observedAbort).toBe(true);
      expect(session.isStreaming).toBe(false);
      // 0.85.1 faux catches factory rejection as error, even after abort.
      // Business cancellation must use persisted cancellation, not this raw tag.
      expect(session.messages.at(-1)).toMatchObject({ role: "assistant", stopReason: "error", errorMessage: "CANCELLED" });
    } finally {
      try { await session.abort(); await task; } finally { session.dispose(); }
    }
  });
  it.each([
    { name: "read", args: { path: "math/SKILL.md", offset: 2, limit: 1 }, denied: false, expected: "name: math" },
    { name: "read", args: { path: "../AGENTS.md" }, denied: true, expected: "RESOURCE_DENIED" },
    { name: "read", args: { path: "/etc/passwd" }, denied: true, expected: "RESOURCE_DENIED" },
    { name: "read", args: { path: "math/SKILL.md", limit: 0 }, denied: true, expected: "" },
    { name: "bash", args: { command: "echo FORBIDDEN_EXECUTION" }, denied: true, expected: "" },
  ])("enforces real-loop tool call $name $args", async ({ name, args, denied, expected }) => {
    const f = await fixture();
    f.faux.setResponses([
      fauxAssistantMessage(fauxToolCall(name, args), { stopReason: "toolUse" }),
      context => {
        const result = context.messages.at(-1);
        expect(result).toMatchObject({ role: "toolResult", isError: denied });
        expect(JSON.stringify(result)).toContain(expected);
        expect(JSON.stringify(result)).not.toContain("FORBIDDEN_PARENT_CONTEXT");
        return fauxAssistantMessage("checked");
      },
    ]);
    const { session } = await f.make();
    try {
      await session.prompt("tool policy fixture", { expandPromptTemplates: false });
      expect(session.messages.at(-1)).toMatchObject({ role: "assistant", stopReason: "stop", content: [{ type: "text", text: "checked" }] });
      expect(f.faux.state.callCount).toBe(2);
    } finally { try { await session.abort(); } finally { session.dispose(); } }
  });
  it.each([
    { reference: "x".repeat(40_000), expected: "RESOURCE_LINE_TOO_LARGE", denied: true },
    { reference: "\"".repeat(20_000), expected: "RESOURCE_OUTPUT_TOO_LARGE", denied: true },
    { reference: "line\n".repeat(3000), expected: "Use offset=2001", denied: false },
  ])("bounds read output and retains safe pagination", async ({ reference, expected, denied }) => {
    const f = await fixture(reference);
    f.faux.setResponses([
      fauxAssistantMessage(fauxToolCall("read", { path: f.refPath }), { stopReason: "toolUse" }),
      context => {
        const result = context.messages.at(-1);
        expect(result).toMatchObject({ role: "toolResult", isError: denied });
        expect(JSON.stringify(result)).toContain(expected);
        expect(Buffer.byteLength(JSON.stringify(result), "utf8")).toBeLessThan(32 * 1024);
        return fauxAssistantMessage("bounded");
      },
    ]);
    const { session } = await f.make();
    try {
      await session.prompt("output fixture", { expandPromptTemplates: false });
      expect(session.messages.at(-1)).toMatchObject({ stopReason: "stop", content: [{ type: "text", text: "bounded" }] });
    } finally { try { await session.abort(); } finally { session.dispose(); } }
  });
  it("shares sixteen model attempts across earlier phases and the native tool loop", async () => {
    const f = await fixture();
    const { session } = await f.make();
    const read = session.getAllTools().find(tool => tool.name === "read");
    if (!read) throw new Error("MISSING_READ");
    const capabilities = new CapabilitySnapshot({ ownerId: "a", runId: "run" }, [{ name: "read", source: "<sdk:read>", schema: read.parameters, category: "file" }]);
    const original = session.agent.streamFunction;
    for (let i = 0; i < 8; i++) f.budget.reserveModel(new AbortController().signal);
    f.faux.setResponses(Array.from({ length: 8 }, () => fauxAssistantMessage(fauxToolCall("read", { path: f.skillPath }), { stopReason: "toolUse" })));
    try {
      await expect(budgetedPrompt({ session, capabilities, budget: f.budget, role: "solver", message: "loop limit", signal: new AbortController().signal })).rejects.toThrow("MODEL_LIMIT");
      expect(f.faux.state.callCount).toBe(8);
      expect(f.budget.snapshot()).toMatchObject({ modelAttempts: 16, fileAttempts: 8 });
      expect(session.agent.streamFunction).toBe(original);
      expect(session.isStreaming).toBe(false);
    } finally { session.dispose(); }
  });

  it("completes a nine-round native tool loop beyond the former solver cap", async () => {
    const f = await fixture(); const { session } = await f.make();
    const read = session.getAllTools().find(tool => tool.name === "read");
    if (!read) throw new Error("MISSING_READ");
    const capabilities = new CapabilitySnapshot({ ownerId: "a", runId: "run" }, [{ name: "read", source: "<sdk:read>", schema: read.parameters, category: "file" }]);
    f.faux.setResponses([
      ...Array.from({ length: 8 }, () => fauxAssistantMessage(fauxToolCall("read", { path: f.skillPath }), { stopReason: "toolUse" })),
      fauxAssistantMessage("finished after eight tools"),
    ]);
    try {
      await budgetedPrompt({ session, capabilities, budget: f.budget, role: "solver", message: "extended loop", signal: new AbortController().signal });
      expect(f.faux.state.callCount).toBe(9);
      expect(f.budget.snapshot()).toMatchObject({ modelAttempts: 9, fileAttempts: 8 });
      expect(session.messages.at(-1)).toMatchObject({ stopReason: "stop", content: [{ type: "text", text: "finished after eight tools" }] });
    } finally { session.dispose(); }
  });

  it("limits independent no-tool verifier calls to two", async () => {
    const f = await fixture();
    const { session } = await f.make([]);
    const capabilities = new CapabilitySnapshot({ ownerId: "a", runId: "run" }, []);
    f.faux.setResponses([fauxAssistantMessage("pass"), fauxAssistantMessage("unknown")]);
    const call = () => budgetedPrompt({ session, capabilities, budget: f.budget, role: "verifier", message: "verify", signal: new AbortController().signal });
    try {
      await call(); await call();
      await expect(call()).rejects.toThrow("VERIFIER_LIMIT");
      expect(f.faux.state.callCount).toBe(2);
      expect(f.budget.snapshot().verifierAttempts).toBe(2);
    } finally { session.dispose(); }
  });

  it("propagates the remaining wall-clock deadline to the active provider", async () => {
    const f = await fixture();
    const { session } = await f.make([]);
    const capabilities = new CapabilitySnapshot({ ownerId: "a", runId: "run" }, []);
    let clock = 0;
    const budget = new RunBudget(() => clock);
    clock = 119_950;
    let cancelled = false;
    f.faux.setResponses([async (_context, options) => {
      const signal = options?.signal;
      if (!signal) throw new Error("NO_SIGNAL");
      await new Promise<void>((_resolve, reject) => {
        const stop = () => { cancelled = true; reject(new Error("STOPPED")); };
        if (signal.aborted) stop(); else signal.addEventListener("abort", stop, { once: true });
      });
      return fauxAssistantMessage("unreachable");
    }]);
    try {
      await expect(budgetedPrompt({ session, capabilities, budget, role: "solver", message: "deadline", signal: new AbortController().signal })).rejects.toThrow("RUN_TIMEOUT");
      expect(cancelled).toBe(true);
      expect(session.isStreaming).toBe(false);
    } finally { session.dispose(); }
  });
  it.each(["replace-execute", "replace-schema", "duplicate-name"])("rejects actual execution table drift: %s", async mutation => {
    const f = await fixture();
    const { session } = await f.make();
    const actual = session.agent.state.tools[0];
    if (!actual) throw new Error("MISSING_TOOL");
    const capabilities = new CapabilitySnapshot({ ownerId: "a", runId: "r" }, [{ name: "read", source: "<sdk:read>", schema: actual.parameters, category: "file" }]);
    try {
      assertSessionCapabilities(session, capabilities);
      if (mutation === "replace-execute") session.agent.state.tools = [{ ...actual, execute: async () => ({ content: [{ type: "text", text: "unapproved" }], details: undefined }) }];
      if (mutation === "replace-schema") session.agent.state.tools = [{ ...actual, parameters: { type: "object", properties: {} } }];
      if (mutation === "duplicate-name") session.agent.state.tools = [actual, actual];
      expect(() => assertSessionCapabilities(session, capabilities)).toThrow("CAPABILITY_MISMATCH");
    } finally { session.dispose(); }
  });
  it("rejects execute mutation after provider response before tool dispatch", async () => {
    const f = await fixture();
    const { session } = await f.make();
    const actual = session.agent.state.tools[0];
    if (!actual) throw new Error("MISSING_TOOL");
    const capabilities = new CapabilitySnapshot({ ownerId: "a", runId: "r" }, [{ name: "read", source: "<sdk:read>", schema: actual.parameters, category: "file" }]);
    let hits = 0;
    f.faux.setResponses([() => {
      actual.execute = async () => { hits++; return { content: [{ type: "text", text: "unapproved" }], details: undefined }; };
      return fauxAssistantMessage(fauxToolCall("read", { path: f.skillPath }), { stopReason: "toolUse" });
    }]);
    try {
      await expect(budgetedPrompt({ session, capabilities, budget: f.budget, role: "solver", message: "dispatch drift", signal: new AbortController().signal })).rejects.toThrow("CAPABILITY_MISMATCH");
      expect(hits).toBe(0);
    } finally { session.dispose(); }
  });
});
