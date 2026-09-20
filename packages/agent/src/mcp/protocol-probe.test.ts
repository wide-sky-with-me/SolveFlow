import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { echoSchema, emptySchema } from "./probe-fixture.mjs";
import { ReadOnlyMcpClient, type ApprovedReadOnlyTool } from "./read-only-client.js";
import { openFixture } from "./protocol.test-support.js";

const freshSignal = () => new AbortController().signal;
const approved: ApprovedReadOnlyTool[] = [
  { name: "echo", inputSchema: echoSchema, parameters: z.object({ text: z.string().max(128) }).strict() },
  ...["fail", "rpc_error", "wait", "stats", "oversize", "resource"].map(name => ({
    name, inputSchema: emptySchema, parameters: z.object({}).strict(),
  })),
];
const statsSchema = z.object({ calls: z.number(), started: z.number(), cancelled: z.number(), active: z.number(), inheritedSentinel: z.boolean(), home: z.string(), shell: z.string(), nodeOptionsPresent: z.boolean() });

async function stats(adapter: ReadOnlyMcpClient) {
  const result = await adapter.call("stats", {}, freshSignal());
  return statsSchema.parse(JSON.parse(result.content[0]?.text ?? "null"));
}

afterEach(() => vi.unstubAllEnvs());

describe.each(["stdio", "http"] as const)("real MCP %s protocol", mode => {
  it("initializes, lists, filters explicitly and calls without inherited secrets", async () => {
    vi.stubEnv("SOLVEFLOW_PROBE_SENTINEL", "synthetic-not-a-secret");
    const fixture = await openFixture(mode);
    try {
      const listed = await fixture.client.listTools({}, { timeout: 2_000 });
      expect(listed.tools.map(tool => tool.name)).toContain("dangerous");
      const adapter = await ReadOnlyMcpClient.discover(fixture.client, approved, freshSignal());
      expect(adapter.names()).not.toContain("dangerous");
      expect(await adapter.call("echo", { text: "2 + 2 = 4" }, freshSignal())).toEqual({
        content: [{ type: "text", text: "2 + 2 = 4" }], isError: false,
      });
      const before = await stats(adapter);
      await expect(adapter.call("dangerous", {}, freshSignal())).rejects.toThrow("MCP_TOOL_NOT_APPROVED");
      await expect(adapter.call("echo", { text: "x", ownerId: "other" }, freshSignal())).rejects.toThrow("MCP_INVALID_ARGUMENTS");
      const after = await stats(adapter);
      expect(after.calls).toBe(before.calls + 1);
      if (mode === "stdio") {
        expect(after.inheritedSentinel).toBe(false);
        expect(after.home).toBe(fixture.cwd);
        expect(after.shell).toBe("");
        expect(after.nodeOptionsPresent).toBe(false);
      }
      await adapter.close();
      await expect(adapter.call("echo", { text: "late" }, freshSignal())).rejects.toThrow("MCP_CLOSED");
    } finally { await fixture.close(); }
  });

  it("rejects missing/mismatched contracts and duplicate approval names", async () => {
    const fixture = await openFixture(mode);
    try {
      await expect(ReadOnlyMcpClient.discover(fixture.client, [{ name: "echo", inputSchema: emptySchema, parameters: z.object({}) }], freshSignal())).rejects.toThrow("MCP_SCHEMA_MISMATCH");
      await expect(ReadOnlyMcpClient.discover(fixture.client, [{ name: "missing", inputSchema: emptySchema, parameters: z.object({}) }], freshSignal())).rejects.toThrow("MCP_SCHEMA_MISMATCH");
      const entry = approved[0];
      if (!entry) throw new Error("NO_FIXTURE_CONTRACT");
      await expect(ReadOnlyMcpClient.discover(fixture.client, [entry, entry], freshSignal())).rejects.toThrow("MCP_INVALID_ALLOWLIST");
    } finally { await fixture.close(); }
  });

  it("preserves tool errors, sanitizes RPC errors and rejects unsafe output", async () => {
    const fixture = await openFixture(mode);
    try {
      const adapter = await ReadOnlyMcpClient.discover(fixture.client, approved, freshSignal());
      expect((await adapter.call("fail", {}, freshSignal())).isError).toBe(true);
      await expect(adapter.call("rpc_error", {}, freshSignal())).rejects.toThrow(/^MCP_CALL_FAILED$/);
      await expect(adapter.call("oversize", {}, freshSignal())).rejects.toThrow("MCP_OUTPUT_LIMIT");
      await expect(adapter.call("resource", {}, freshSignal())).rejects.toThrow("MCP_INVALID_RESULT");
    } finally { await fixture.close(); }
  });

  it("propagates cancellation to the server and leaves connection usable", async () => {
    const fixture = await openFixture(mode);
    try {
      const adapter = await ReadOnlyMcpClient.discover(fixture.client, approved, freshSignal());
      const controller = new AbortController();
      const pending = adapter.call("wait", {}, controller.signal);
      const rejection = expect(pending).rejects.toThrow("MCP_CANCELLED");
      await expect.poll(async () => (await stats(adapter)).started, { timeout: 1_000 }).toBe(1);
      controller.abort();
      await rejection;
      await expect.poll(async () => (await stats(adapter)).cancelled, { timeout: 1_000 }).toBe(1);
      expect((await stats(adapter)).active).toBe(0);
      expect((await adapter.call("echo", { text: "still usable" }, freshSignal())).isError).toBe(false);
    } finally { await fixture.close(); }
  });

  it("times out through the real protocol and cancels server work", async () => {
    const fixture = await openFixture(mode);
    try {
      const adapter = await ReadOnlyMcpClient.discover(fixture.client, approved, freshSignal());
      await expect(adapter.call("wait", {}, freshSignal(), 100)).rejects.toThrow("MCP_CALL_FAILED");
      await expect.poll(async () => (await stats(adapter)).cancelled, { timeout: 1_000 }).toBe(1);
      expect((await stats(adapter)).active).toBe(0);
    } finally { await fixture.close(); }
  });
  it("closes active calls and reclaims the transport idempotently", async () => {
    const fixture = await openFixture(mode);
    try {
      const adapter = await ReadOnlyMcpClient.discover(fixture.client, approved, freshSignal());
      const pending = adapter.call("wait", {}, freshSignal());
      const rejection = expect(pending).rejects.toThrow("MCP_CANCELLED");
      await expect.poll(async () => (await stats(adapter)).started, { timeout: 1_000 }).toBe(1);
      await Promise.all([adapter.close(), adapter.close()]);
      await rejection;
    } finally { await fixture.close(); }
  });
  it.each(["raw", "transformed"])("rejects globally oversized %s arguments before sending", async modeOfInput => {
    const fixture = await openFixture(mode);
    try {
      const adapter = await ReadOnlyMcpClient.discover(fixture.client, [
        { name: "echo", inputSchema: echoSchema, parameters: z.strictObject({ text: modeOfInput === "raw" ? z.string() : z.string().transform(() => "x".repeat(1024 * 1024)) }) },
      ], freshSignal());
      await expect(adapter.call("echo", { text: modeOfInput === "raw" ? "x".repeat(1024 * 1024) : "small" }, freshSignal())).rejects.toThrow("MCP_INPUT_LIMIT");
    } finally { await fixture.close(); }
  });
});
