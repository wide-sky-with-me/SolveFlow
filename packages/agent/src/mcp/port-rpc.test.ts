import { MessageChannel } from "node:worker_threads";
import { once } from "node:events";
import { expect, it } from "vitest";
import { z } from "zod";
import { openFixture } from "./protocol.test-support.js";
import { echoSchema, emptySchema } from "./probe-fixture.mjs";
import { RunMcpConnection } from "./run-connection.js";
import { ReadOnlyMcpClient } from "./read-only-client.js";
import { serveMcpPort, createMcpPortCaller } from "./port-rpc.js";
const fresh = () => new AbortController().signal;
const binding = { ownerId: "a", runId: "a", server: "local", credentialVersion: "v1" };
const approved = [{ name: "echo", inputSchema: echoSchema, parameters: z.strictObject({ text: z.string().max(128) }) }, { name: "wait", inputSchema: emptySchema, parameters: z.strictObject({}) }];
it.each(["stdio", "http"] as const)("calls %s only through parent approval and closes cancelled RPC", async mode => {
  const wire = await openFixture(mode); const { port1, port2 } = new MessageChannel();
  let serving: ReturnType<typeof serveMcpPort> | undefined;
  let connection: RunMcpConnection | undefined;
  try {
    connection = await RunMcpConnection.open(binding, async (_binding, signal) => ReadOnlyMcpClient.discover(wire.client, approved, signal), fresh());
    const supplied = { ...binding };
    serving = serveMcpPort(port1, connection, supplied, fresh()); supplied.ownerId = "b";
    const caller = createMcpPortCaller(port2);
    expect(await caller.call("echo", { text: "parent-only" }, fresh())).toMatchObject({ isError: false, content: [{ type: "text", text: "parent-only" }] });
    await expect(caller.call("wait", {}, fresh(), 20)).rejects.toThrow("MCP_RPC_FAILED");
    await serving.close();
    expect(port1.listenerCount("message")).toBe(0); expect(port2.listenerCount("message")).toBe(0);
    expect((await connection.call("echo", { text: "connection-still-owned" }, fresh(), 1000)).isError).toBe(false);
  } finally { await serving?.close(); port1.close(); port2.close(); await connection?.close(); await wire.close(); }
});
it.each(["not_approved", "echo"])("rejects disallowed or malformed %s call with a fixed error", async name => {
  const wire = await openFixture("http"); const { port1, port2 } = new MessageChannel();
  let serving: ReturnType<typeof serveMcpPort> | undefined; let connection: RunMcpConnection | undefined;
  try {
    connection = await RunMcpConnection.open(binding, async (_binding, signal) => ReadOnlyMcpClient.discover(wire.client, approved, signal), fresh());
    serving = serveMcpPort(port1, connection, binding, fresh());
    await expect(createMcpPortCaller(port2).call(name, { unexpected: "private" }, fresh())).rejects.toThrow("MCP_RPC_FAILED");
  } finally { await serving?.close(); port1.close(); port2.close(); await connection?.close(); await wire.close(); }
});
it.each(["extra-owner", "replay", "limit"])("closes RPC on %s without duplicate ownership or renewed quota", async mode => {
  const wire = await openFixture("http"); const { port1, port2 } = new MessageChannel();
  let serving: ReturnType<typeof serveMcpPort> | undefined; let connection: RunMcpConnection | undefined;
  try {
    connection = await RunMcpConnection.open(binding, async (_binding, signal) => ReadOnlyMcpClient.discover(wire.client, approved, signal), fresh());
    const owned = connection;
    serving = serveMcpPort(port1, owned, binding, fresh());
    expect(() => serveMcpPort(port1, owned, binding, fresh())).toThrow("MCP_RPC_ALREADY_OWNED");
    const request = { v: 1, type: "call", id: 1, name: "echo", args: { text: "bounded" } };
    const count = mode === "extra-owner" ? 0 : mode === "limit" ? 8 : 1;
    for (let id = 1; id <= count; id += 1) {
      const response = once(port2, "message", { signal: AbortSignal.timeout(1000) });
      port2.postMessage({ ...request, id });
      expect((await response)[0]).toMatchObject({ id, ok: true });
    }
    const closed = once(port2, "close", { signal: AbortSignal.timeout(1000) });
    port2.postMessage(mode === "extra-owner" ? { ...request, ownerId: "b" } : { ...request, id: mode === "limit" ? 9 : 1 });
    await closed; await serving.close();
  } finally { await serving?.close(); port1.close(); port2.close(); await connection?.close(); await wire.close(); }
});
