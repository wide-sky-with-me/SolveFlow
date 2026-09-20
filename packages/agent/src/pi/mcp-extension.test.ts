import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { createAgentSession, ModelRuntime, SessionManager, SettingsManager } from "@earendil-works/pi-coding-agent";
import { fauxProvider, fauxAssistantMessage, fauxToolCall, InMemoryCredentialStore, InMemoryModelsStore } from "@earendil-works/pi-ai";
import { openFixture } from "../mcp/protocol.test-support.js";
import { echoSchema, emptySchema } from "../mcp/probe-fixture.mjs";
import { ReadOnlyMcpClient, type ApprovedReadOnlyTool } from "../mcp/read-only-client.js";
import { CapabilitySnapshot } from "../policy/capability-snapshot.js";
import { ReadSnapshot } from "../policy/read-snapshot.js";
import { RunBudget } from "../policy/run-budget.js";
import { createSnapshotRead } from "./snapshot-read.js";
import { createApprovedResourceLoader } from "./approved-resource-loader.js";
import { assertSessionCapabilities } from "./assert-capabilities.js";
import { createMcpExtension, mcpToolName } from "./mcp-extension.js";

import { RunMcpConnection } from "../mcp/run-connection.js";

async function makeProbe(mode: "stdio" | "http", category: "business" | "search" = "business") {
  const wire = await openFixture(mode);
  const cwd = await mkdtemp(join(tmpdir(), "solveflow-extension-"));
  let adapter: ReadOnlyMcpClient | undefined;
  try {
    const approved: ApprovedReadOnlyTool[] = [
      { name: "echo", inputSchema: echoSchema, parameters: z.strictObject({ text: z.string().max(128) }) },
      { name: "wait", inputSchema: emptySchema, parameters: z.strictObject({}) },
      { name: "stats", inputSchema: emptySchema, parameters: z.strictObject({}) },
    ];
    adapter = await ReadOnlyMcpClient.discover(wire.client, approved, new AbortController().signal);
    const identity = { ownerId: "a", runId: "a-1" };
    const budget = new RunBudget();
    const read = createSnapshotRead(new ReadSnapshot("/solveflow/skills", "a", []), "a", budget);
    const capabilities = new CapabilitySnapshot(identity, [
      { name: "read", source: "<sdk:read>", schema: read.parameters, category: "file" },
      ...approved.map(tool => ({ name: mcpToolName("local", tool.name), source: "<solveflow:mcp:local>", schema: tool.inputSchema, category })),
    ]);
    const owned = adapter;
    const connection = await RunMcpConnection.open({ ...identity, server: "local", credentialVersion: "fixture-v1" }, async () => owned, new AbortController().signal);
    const extension = createMcpExtension({ server: "local", credentialVersion: "fixture-v1", tools: approved, client: connection, identity, capabilities, budget });
    const faux = fauxProvider({ provider: "solveflow-extension-test", models: [{ id: "offline", input: ["text"], reasoning: false }], tokensPerSecond: 100000 });
    const runtime = await ModelRuntime.create({ credentials: new InMemoryCredentialStore(), modelsPath: null, modelsStore: new InMemoryModelsStore(), allowModelNetwork: false, refreshOnCreate: false });
    runtime.registerNativeProvider(faux.provider);
    await runtime.refresh({ allowNetwork: false });
    const { session } = await createAgentSession({
      cwd, agentDir: cwd, modelRuntime: runtime, model: faux.getModel(),
      tools: capabilities.names(), customTools: [read],
      resourceLoader: createApprovedResourceLoader("MCP bridge test only", [], [extension]),
      sessionManager: SessionManager.inMemory(cwd),
      settingsManager: SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: false, provider: { maxRetries: 0 } }, enableSkillCommands: false, enableAnalytics: false, enableInstallTelemetry: false }),
    });
    try { assertSessionCapabilities(session, capabilities); } catch (error) { session.dispose(); throw error; }
    const client = adapter;
    return { session, faux, budget, capabilities, adapter: client, approved, async close() {
      try { await session.abort(); } finally {
        try { session.dispose(); } finally {
          try { await client.close(); } finally {
            try { await wire.close(); } finally { await rm(cwd, { recursive: true, force: true }); }
          }
        }
      }
    } };
  } catch (error) {
    try { await adapter?.close(); } finally {
      try { await wire.close(); } finally { await rm(cwd, { recursive: true, force: true }); }
    }
    throw error;
  }
}

async function stats(adapter: ReadOnlyMcpClient) {
  const result = await adapter.call("stats", {}, new AbortController().signal);
  return z.object({ calls: z.number(), active: z.number(), started: z.number(), cancelled: z.number() }).parse(JSON.parse(result.content[0]?.text ?? "null"));
}

describe.each(["stdio", "http"] as const)("Pi Extension → real MCP %s", mode => {
  it("uses the actual extension registry, calls the real server and budgets the attempt", async () => {
    const f = await makeProbe(mode);
    try {
      const echo = mcpToolName("local", "echo");
      f.faux.setResponses([
        context => {
          expect(context.tools?.map(tool => tool.name)).toContain(echo);
          return fauxAssistantMessage(fauxToolCall(echo, { text: "evidence" }), { stopReason: "toolUse" });
        },
        context => {
          expect(context.messages.at(-1)).toMatchObject({ role: "toolResult", isError: false, content: [{ type: "text", text: "evidence" }] });
          return fauxAssistantMessage("bridge passed");
        },
      ]);
      // Mutating the administrator input after admission cannot retarget a call.
      const approvedEcho = f.approved[0];
      if (!approvedEcho) throw new Error("MISSING_FIXTURE");
      approvedEcho.name = "dangerous";
      assertSessionCapabilities(f.session, f.capabilities);
      await f.session.prompt("bridge fixture", { expandPromptTemplates: false });
      expect(f.session.messages.at(-1)).toMatchObject({ stopReason: "stop", content: [{ type: "text", text: "bridge passed" }] });
      expect(f.budget.snapshot().businessAttempts).toBe(1);
      expect(f.faux.state.callCount).toBe(2);
    } finally { await f.close(); }
  });

  it("rejects a revoked tool before contacting the MCP server", async () => {
    const f = await makeProbe(mode);
    try {
      const echo = mcpToolName("local", "echo");
      f.capabilities.revoke(echo);
      f.faux.setResponses([fauxAssistantMessage(fauxToolCall(echo, { text: "denied" }), { stopReason: "toolUse" }), context => {
        expect(context.messages.at(-1)).toMatchObject({ role: "toolResult", isError: true });
        expect(JSON.stringify(context.messages.at(-1))).toContain("CAPABILITY_DENIED");
        return fauxAssistantMessage("denied safely");
      }]);
      const before = await stats(f.adapter);
      await f.session.prompt("revocation fixture", { expandPromptTemplates: false });
      expect(f.session.messages.at(-1)).toMatchObject({ stopReason: "stop" });
      expect((await stats(f.adapter)).calls).toBe(before.calls + 1);
      expect(f.budget.snapshot().businessAttempts).toBe(0);
    } finally { await f.close(); }
  });

  it("applies the shared search quota at dispatch across MCP aliases", async () => {
    const f = await makeProbe(mode, "search");
    try {
      f.budget.reserveTool("search", new AbortController().signal);
      f.budget.reserveTool("search", new AbortController().signal);
      f.faux.setResponses([fauxAssistantMessage(fauxToolCall(mcpToolName("local", "echo"), { text: "third search" }), { stopReason: "toolUse" }), context => {
        expect(JSON.stringify(context.messages.at(-1))).toContain("TOOL_LIMIT");
        return fauxAssistantMessage("budget enforced");
      }]);
      await f.session.prompt("budget fixture", { expandPromptTemplates: false });
      expect(f.session.messages.at(-1)).toMatchObject({ stopReason: "stop" });
      expect(f.budget.snapshot().searchAttempts).toBe(2);
    } finally { await f.close(); }
  });

  it("cancels an in-flight MCP call through session.abort without closing its shared connection", async () => {
    const f = await makeProbe(mode);
    const wait = mcpToolName("local", "wait");
    f.faux.setResponses([fauxAssistantMessage(fauxToolCall(wait, {}), { stopReason: "toolUse" })]);
    const task = f.session.prompt("cancel MCP fixture", { expandPromptTemplates: false });
    try {
      await expect.poll(async () => (await stats(f.adapter)).active, { timeout: 2000 }).toBe(1);
      await f.session.abort();
      await task;
      await expect.poll(async () => (await stats(f.adapter)).cancelled, { timeout: 2000 }).toBe(1);
      expect((await stats(f.adapter)).active).toBe(0);
      expect(f.session.isStreaming).toBe(false);
      expect((await f.adapter.call("echo", { text: "connection alive" }, new AbortController().signal)).isError).toBe(false);
    } finally { await f.close(); await task; }
  });
});
