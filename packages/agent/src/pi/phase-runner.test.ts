import { tmpdir } from "node:os";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { SpendLedger } from "../policy/spend-ledger.js";
import { createRequestSpendGate } from "../policy/request-spend-gate.js";
import { expect, it, vi } from "vitest";
import { createAgentSession, ModelRuntime, SessionManager, SettingsManager } from "@earendil-works/pi-coding-agent";
import { fauxProvider, fauxAssistantMessage, fauxToolCall, InMemoryCredentialStore, InMemoryModelsStore } from "@earendil-works/pi-ai";
import { createApprovedResourceLoader } from "./approved-resource-loader.js";
import { createSnapshotRead } from "./snapshot-read.js";
import { ReadSnapshot } from "../policy/read-snapshot.js";
import { CapabilitySnapshot } from "../policy/capability-snapshot.js";
import { RunBudget } from "../policy/run-budget.js";
import { runSessionPhase } from "./phase-runner.js";
const identity = { ownerId: "owner", sessionId: "session", runId: "run" };
const candidate = { schemaVersion: 1, kind: "answer", problem: { text: "1+1", subject: "math", uncertainties: [] }, answer: "2", steps: [], knowledgePoints: [], citationIds: [], clarificationQuestions: [] };
const solverInput = { schemaVersion: 1, role: "solver", identity, message: "solve", image: { bytes: new Uint8Array([1, 2, 3]), mimeType: "image/png" }, evidence: [] };
it("diagnoses rejected output without logging private model content or unknown field names", async () => {
  const f = await fixture(); const log = vi.spyOn(console, "warn").mockImplementation(() => {});
  f.faux.setResponses([fauxAssistantMessage(JSON.stringify({ ...candidate, "private-canary": "private-answer" }))]);
  try {
    await expect(runSessionPhase(f.session, { ...f, input: solverInput })).rejects.toThrow("MODEL_OUTPUT_INVALID");
    expect(log).toHaveBeenCalledOnce();
    expect(JSON.stringify(log.mock.calls)).toContain("SCHEMA_INVALID");
    expect(JSON.stringify(log.mock.calls)).not.toMatch(/private-canary|private-answer|AQID/);
  } finally { log.mockRestore(); }
});
async function fixture(withRead = false) {
  const faux = fauxProvider({ provider: "phase-offline", models: [{ id: "offline", input: ["text", "image"], reasoning: false }] });
  const runtime = await ModelRuntime.create({ credentials: new InMemoryCredentialStore(), modelsPath: null, modelsStore: new InMemoryModelsStore(), allowModelNetwork: false, refreshOnCreate: false });
  runtime.registerNativeProvider(faux.provider); await runtime.refresh({ allowNetwork: false });
  const budget = new RunBudget();
  const read = createSnapshotRead(new ReadSnapshot("/solveflow/skills", identity.ownerId, [{ path: "general/SKILL.md", text: "private-resource-body" }]), identity.ownerId, budget);
  const capabilities = new CapabilitySnapshot(identity, withRead ? [{ name: "read", source: "<sdk:read>", schema: read.parameters, category: "file" }] : []);
  const { session } = await createAgentSession({ cwd: tmpdir(), agentDir: tmpdir(), modelRuntime: runtime, model: faux.getModel(), tools: withRead ? ["read"] : [], customTools: withRead ? [read] : [], resourceLoader: createApprovedResourceLoader("Offline phase probe", []), sessionManager: SessionManager.inMemory(tmpdir()), settingsManager: SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: false, provider: { maxRetries: 0 } }, enableSkillCommands: false, enableAnalytics: false, enableInstallTelemetry: false }) });
  return { session, faux, budget, capabilities, signal: new AbortController().signal };
}
it("executes a native read loop, emits safe summaries and excludes thinking/tool data", async () => {
  const f = await fixture(true);
  f.faux.setResponses([fauxAssistantMessage([fauxToolCall("read", { path: "general/SKILL.md" })]), fauxAssistantMessage([{ type: "thinking", thinking: "private-thinking" }, { type: "text", text: JSON.stringify(candidate) }])]);
  const dispose = vi.spyOn(f.session, "dispose");
  const result = await runSessionPhase(f.session, { ...f, input: solverInput });
  expect(result).toMatchObject({ role: "solver", candidate });
  expect(result.events.map(e => e.type)).toEqual(["run.status", "tool.status", "tool.status"]);
  expect(JSON.stringify(result)).not.toMatch(/private-thinking|private-resource-body|AQID/);
  expect(dispose).toHaveBeenCalledOnce();
  expect(f.budget.snapshot()).toMatchObject({ modelAttempts: 2, fileAttempts: 1 });
  await expect(runSessionPhase(f.session, { ...f, input: solverInput })).rejects.toThrow("CAPABILITY_DENIED");
});
it("passes original image independently to a tool-free Verifier", async () => {
  const f = await fixture(); let sawImage = false;
  f.faux.setResponses([context => {
    const user = context.messages.at(-1);
    sawImage = user?.role === "user" && Array.isArray(user.content) && user.content.some(p => p.type === "image" && p.data === "AQID" && p.mimeType === "image/png");
    return fauxAssistantMessage(JSON.stringify({ schemaVersion: 1, verdict: "pass", issues: [], checked: ["arithmetic"] }));
  }]);
  const result = await runSessionPhase(f.session, { ...f, input: { ...solverInput, role: "verifier", candidate } });
  expect(sawImage).toBe(true); expect(result).toMatchObject({ role: "verifier", verification: { verdict: "pass" } });
  expect(f.budget.snapshot().verifierAttempts).toBe(1);
});
it.each(["not JSON", JSON.stringify({ ...candidate, verified: true }), JSON.stringify({ ...candidate, citationIds: ["invented"] })])("bounds JSON repair and rejects invalid schema or evidence without leaking exceptions", async text => {
  const f = await fixture(); f.faux.setResponses([fauxAssistantMessage(text), fauxAssistantMessage(text)]);
  await expect(runSessionPhase(f.session, { ...f, input: solverInput })).rejects.toThrow("MODEL_OUTPUT_INVALID");
  expect(f.budget.snapshot().modelAttempts).toBe(text === "not JSON" ? 2 : 1);
});
it("repairs JSON once through the same native session, retaining the original image and charging another attempt", async () => {
  const f = await fixture(); let sawImage = false; const reserve = vi.fn();
  f.faux.setResponses([fauxAssistantMessage('{"answer":"\\q"}'), context => {
    sawImage = context.messages.some(message => message.role === "user" && Array.isArray(message.content) && message.content.some(part => part.type === "image" && part.data === "AQID"));
    return fauxAssistantMessage(JSON.stringify(candidate));
  }]);
  const result = await runSessionPhase(f.session, { ...f, input: solverInput, beforeModelDispatch: reserve });
  expect(result).toMatchObject({ role: "solver", candidate }); expect(sawImage).toBe(true);
  expect(reserve).toHaveBeenCalledTimes(2); expect(f.budget.snapshot().modelAttempts).toBe(2);
});
it("does not repair again when a previous phase consumed the run repair allowance", async () => {
  const f = await fixture(); expect(f.budget.tryReserveFormatRepair(f.signal)).toBe(true);
  f.faux.setResponses([fauxAssistantMessage("not JSON"), fauxAssistantMessage(JSON.stringify(candidate))]);
  await expect(runSessionPhase(f.session, { ...f, input: solverInput })).rejects.toThrow("MODEL_OUTPUT_INVALID");
  expect(f.budget.snapshot().modelAttempts).toBe(1);
});
it("rejects cross-owner input before model dispatch and still disposes", async () => {
  const f = await fixture(); const dispose = vi.spyOn(f.session, "dispose");
  await expect(runSessionPhase(f.session, { ...f, input: { ...solverInput, identity: { ...identity, ownerId: "other" } } })).rejects.toThrow("CAPABILITY_DENIED");
  expect(f.budget.snapshot().modelAttempts).toBe(0); expect(dispose).toHaveBeenCalledOnce();
});
it("rejects malformed input before dispatch", async () => {
  const f = await fixture();
  await expect(runSessionPhase(f.session, { ...f, input: { private: "secret" } })).rejects.toThrow("INVALID_INPUT");
  expect(f.budget.snapshot().modelAttempts).toBe(0);
});
it("rejects an idle session containing pre-existing conversation history", async () => {
  const f = await fixture();
  try {
    f.faux.setResponses([fauxAssistantMessage("old-private-conversation")]);
    await f.session.prompt("previous owner context", { expandPromptTemplates: false });
    f.faux.setResponses([fauxAssistantMessage(JSON.stringify(candidate))]);
    await expect(runSessionPhase(f.session, { ...f, input: solverInput })).rejects.toThrow("CAPABILITY_DENIED");
    expect(f.budget.snapshot().modelAttempts).toBe(0);
  } finally { await f.session.abort(); f.session.dispose(); }
});
it("persists a separate fee reservation before every native model round", async () => {
  const root = mkdtempSync(join(tmpdir(), "phase-spend-")); const file = join(root, "ledger");
  writeFileSync(file, "", { mode: 0o600 }); const ledger = SpendLedger.open(file);
  const f = await fixture(true); let entered = 0;
  const gate = createRequestSpendGate(ledger, { modelId: "offline", attemptPrefix: "run-solver", maximumMicros: 1_000_000n });
  f.faux.setResponses([() => {
    entered += 1; expect(ledger.snapshot().reservedMicros).toBe("1000000");
    return fauxAssistantMessage([fauxToolCall("read", { path: "general/SKILL.md" })]);
  }, () => {
    entered += 1; expect(ledger.snapshot().reservedMicros).toBe("2000000");
    return fauxAssistantMessage(JSON.stringify(candidate));
  }]);
  try {
    await runSessionPhase(f.session, { ...f, input: solverInput, beforeModelDispatch: gate });
    expect(entered).toBe(2); ledger.close();
    const reopened = SpendLedger.open(file);
    try { expect(reopened.snapshot().reservedMicros).toBe("2000000"); } finally { reopened.close(); }
  } finally { ledger.close(); rmSync(root, { recursive: true, force: true }); }
});
it("never enters provider when the fee authority rejects", async () => {
  const f = await fixture(); let entered = false;
  f.faux.setResponses([() => { entered = true; return fauxAssistantMessage(JSON.stringify(candidate)); }]);
  await expect(runSessionPhase(f.session, { ...f, input: solverInput, beforeModelDispatch: () => { throw new Error("private-billing-detail"); } })).rejects.toThrow("MODEL_DISPATCH_DENIED");
  expect(entered).toBe(false);
});
it("rechecks cancellation after asynchronous fee reservation", async () => {
  const f = await fixture(); const controller = new AbortController(); let entered = false;
  f.faux.setResponses([() => { entered = true; return fauxAssistantMessage(JSON.stringify(candidate)); }]);
  await expect(runSessionPhase(f.session, { ...f, input: solverInput, signal: controller.signal, beforeModelDispatch: async () => { await Promise.resolve(); controller.abort(); } })).rejects.toThrow("CANCELLED");
  expect(entered).toBe(false);
});
it.each(["unsubscribe", "abort", "dispose"])("sanitizes %s failure and attempts every cleanup step", async step => {
  const f = await fixture(); f.faux.setResponses([fauxAssistantMessage(JSON.stringify(candidate))]);
  const originalSubscribe = f.session.subscribe.bind(f.session);
  const originalDispose = f.session.dispose.bind(f.session);
  const dispose = vi.spyOn(f.session, "dispose");
  const abort = vi.spyOn(f.session, "abort");
  if (step === "unsubscribe") vi.spyOn(f.session, "subscribe").mockImplementation(listener => {
    const unsubscribe = originalSubscribe(listener);
    return () => { unsubscribe(); throw new Error("private-unsubscribe-detail"); };
  });
  if (step === "abort") abort.mockRejectedValue(new Error("private-abort-detail"));
  if (step === "dispose") dispose.mockImplementation(() => { originalDispose(); throw new Error("private-dispose-detail"); });
  try {
    await expect(runSessionPhase(f.session, { ...f, input: solverInput })).rejects.toThrow("CLEANUP_FAILED");
    expect(abort).toHaveBeenCalled(); expect(dispose).toHaveBeenCalled();
  } finally { vi.restoreAllMocks(); await f.session.abort(); f.session.dispose(); }
});
it.each(["unsubscribe", "dispose"])("cancellation during successful %s cleanup overrides candidate", async step => {
  const f = await fixture(); const controller = new AbortController();
  f.faux.setResponses([fauxAssistantMessage(JSON.stringify(candidate))]);
  const cancel = () => controller.abort(new Error("private-late-cancel"));
  if (step === "unsubscribe") {
    const subscribe = f.session.subscribe.bind(f.session);
    vi.spyOn(f.session, "subscribe").mockImplementation(listener => {
      const unsubscribe = subscribe(listener);
      return () => { unsubscribe(); cancel(); };
    });
  } else {
    const dispose = f.session.dispose.bind(f.session);
    vi.spyOn(f.session, "dispose").mockImplementation(() => { dispose(); cancel(); });
  }
  try {
    await expect(runSessionPhase(f.session, { ...f, input: solverInput, signal: controller.signal })).rejects.toThrow("CANCELLED");
  } finally { vi.restoreAllMocks(); await f.session.abort(); f.session.dispose(); }
});
it("never dispatches a JSON repair after cancellation or an exhausted model budget", async () => {
  for (const exhausted of [false, true]) {
    const f = await fixture(); const controller = new AbortController();
    if (exhausted) for (let i = 0; i < 15; i++) f.budget.reserveModel(controller.signal);
    f.faux.setResponses([fauxAssistantMessage("not JSON"), fauxAssistantMessage(JSON.stringify(candidate))]);
    await expect(runSessionPhase(f.session, { ...f, input: solverInput, signal: controller.signal, onDiagnostic: () => { if (!exhausted) controller.abort(); } })).rejects.toThrow(exhausted ? "MODEL_LIMIT" : "CANCELLED");
    expect(f.budget.snapshot().modelAttempts).toBe(exhausted ? 16 : 1);
  }
});
