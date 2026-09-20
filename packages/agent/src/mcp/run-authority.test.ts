import { MessageChannel } from "node:worker_threads";
import { expect, it } from "vitest";
import { z } from "zod";
import { openFixture } from "./protocol.test-support.js";
import { echoSchema } from "./probe-fixture.mjs";
import { RunMcpConnection } from "./run-connection.js";
import { ReadOnlyMcpClient } from "./read-only-client.js";
import { createMcpRunAuthority } from "./run-authority.js";
import { serveMcpPort, createMcpPortCaller } from "./port-rpc.js";
import { RunBudget } from "../policy/run-budget.js";
import { CapabilitySnapshot } from "../policy/capability-snapshot.js";
const identity = { ownerId: "a", runId: "a" };
const fresh = () => new AbortController().signal;
it.each(["search", "business"] as const)("shares parent %s quota across two actual MCP servers", async category => {
  const budget = new RunBudget();
  const caps = new CapabilitySnapshot(identity, ["alpha", "beta"].map(server => ({ name: server + "_echo", source: server, schema: echoSchema, category })));
  const resources: { close(): Promise<void> }[] = [];
  const callers: ReturnType<typeof createMcpPortCaller>[] = [];
  try {
    for (const server of ["alpha", "beta"]) {
      const wire = await openFixture("http"); resources.push(wire);
      const binding = { ...identity, server, credentialVersion: "v1" };
      const connection = await RunMcpConnection.open(binding, async (_scope, signal) => ReadOnlyMcpClient.discover(wire.client, [{ name: "echo", inputSchema: echoSchema, parameters: z.strictObject({ text: z.string().max(128) }) }], signal), fresh());
      resources.push(connection);
      const { port1, port2 } = new MessageChannel();
      const authority = createMcpRunAuthority(binding, caps, budget, { echo: server + "_echo" });
      resources.push(serveMcpPort(port1, connection, binding, fresh(), authority));
      const caller = createMcpPortCaller(port2); callers.push(caller);
    }
    const limit = category === "search" ? 2 : 8;
    for (let i = 0; i < limit; i += 1) expect((await callers[i % 2]?.call("echo", { text: "counted" }, fresh()))?.isError).toBe(false);
    await expect(callers[0]?.call("echo", { text: "denied" }, fresh())).rejects.toThrow("MCP_RPC_FAILED");
    expect(budget.snapshot().businessAttempts).toBe(limit);
    expect(budget.snapshot().searchAttempts).toBe(category === "search" ? 2 : 0);
  } finally { for (const caller of callers) caller.close(); for (const resource of resources.reverse()) await resource.close(); }
});
it("freezes mapping, propagates revocation and forbids identity/file-category bypass", () => {
  const budget = new RunBudget();
  const caps = new CapabilitySnapshot(identity, [{ name: "search_echo", source: "local", schema: echoSchema, category: "search" }, { name: "file_echo", source: "local", schema: echoSchema, category: "file" }]);
  const binding = { ...identity, server: "local", credentialVersion: "v1" }; const mapping = { echo: "search_echo", file: "file_echo" };
  const authority = createMcpRunAuthority(binding, caps, budget, mapping); mapping.echo = "file_echo";
  expect(() => authority.reserve({ ...binding, ownerId: "b" }, "echo", fresh())).toThrow("MCP_CONNECTION_IDENTITY_MISMATCH");
  expect(() => authority.reserve(binding, "file", fresh())).toThrow("MCP_INVALID_CATEGORY");
  const granted = authority.reserve(binding, "echo", fresh());
  caps.revoke("search_echo"); expect(granted.signal.aborted).toBe(true);
  expect(() => granted.assertActive()).toThrow();
  expect(() => authority.reserve(binding, "echo", fresh())).toThrow("CAPABILITY_DENIED");
  expect(budget.snapshot().searchAttempts).toBe(1);
});
it("counts malformed approved-tool attempts before argument validation", async () => {
  const wire = await openFixture("http"); const { port1, port2 } = new MessageChannel();
  const budget = new RunBudget();
  const caps = new CapabilitySnapshot(identity, [{ name: "echo", source: "local", schema: echoSchema, category: "business" }]);
  const binding = { ...identity, server: "local", credentialVersion: "v1" };
  let connection: RunMcpConnection | undefined; let rpc: ReturnType<typeof serveMcpPort> | undefined;
  try {
    connection = await RunMcpConnection.open(binding, async (_scope, signal) => ReadOnlyMcpClient.discover(wire.client, [{ name: "echo", inputSchema: echoSchema, parameters: z.strictObject({ text: z.string().max(128) }) }], signal), fresh());
    rpc = serveMcpPort(port1, connection, binding, fresh(), createMcpRunAuthority(binding, caps, budget, { echo: "echo" }));
    await expect(createMcpPortCaller(port2).call("echo", { invalid: true }, fresh())).rejects.toThrow("MCP_RPC_FAILED");
    expect(budget.snapshot().businessAttempts).toBe(1);
  } finally { await rpc?.close(); port1.close(); port2.close(); await connection?.close(); await wire.close(); }
});
