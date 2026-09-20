import { describe, expect, it } from "vitest";
import { z } from "zod";
import { openFixture } from "./protocol.test-support.js";
import { echoSchema, emptySchema } from "./probe-fixture.mjs";
import { ReadOnlyMcpClient } from "./read-only-client.js";
import { RunMcpConnection } from "./run-connection.js";

const fresh = () => new AbortController().signal;
const binding = { ownerId: "a", runId: "run-a", server: "local", credentialVersion: "v1" };
const approved = [
  { name: "echo", inputSchema: echoSchema, parameters: z.strictObject({ text: z.string().max(128) }) },
  { name: "wait", inputSchema: emptySchema, parameters: z.strictObject({}) },
  { name: "stats", inputSchema: emptySchema, parameters: z.strictObject({}) },
];
async function active(client: RunMcpConnection) {
  const result = await client.call("stats", {}, fresh(), 1000);
  return z.object({ active: z.number() }).parse(JSON.parse(result.content[0]?.text ?? "null")).active;
}

describe.each(["stdio", "http"] as const)("run connection %s", mode => {
  it("freezes identity and refuses cross-owner/run/server/credential versions", async () => {
    const wire = await openFixture(mode);
    try {
      const supplied = { ...binding };
      const connection = await RunMcpConnection.open(supplied, async (scope, signal) => {
        expect(Object.isFrozen(scope)).toBe(true);
        return ReadOnlyMcpClient.discover(wire.client, approved, signal);
      }, fresh());
      try {
        supplied.ownerId = "b";
        connection.assertBinding(binding, "local", "v1");
        for (const mismatch of [{ ...binding, ownerId: "b" }, { ...binding, runId: "run-b" }, { ...binding, server: "other" }, { ...binding, credentialVersion: "v2" }]) {
          expect(() => connection.assertBinding(mismatch, mismatch.server, mismatch.credentialVersion)).toThrow("MCP_CONNECTION_IDENTITY_MISMATCH");
        }
      } finally { await connection.close(); }
      expect(() => connection.assertBinding(binding, "local", "v1")).toThrow("MCP_CONNECTION_CLOSED");
    } finally { await wire.close(); }
  });
  it("rejects duplicate client ownership without closing the original run", async () => {
    const wire = await openFixture(mode);
    try {
      const raw = await ReadOnlyMcpClient.discover(wire.client, approved, fresh());
      const first = await RunMcpConnection.open(binding, async () => raw, fresh());
      try {
        await expect(RunMcpConnection.open({ ...binding, ownerId: "b" }, async () => raw, fresh())).rejects.toThrow("MCP_CONNECTION_ALREADY_OWNED");
        const alias = await ReadOnlyMcpClient.discover(wire.client, approved, fresh());
        await expect(RunMcpConnection.open({ ...binding, ownerId: "b" }, async () => alias, fresh())).rejects.toThrow("MCP_CONNECTION_ALREADY_OWNED");
        expect((await first.call("echo", { text: "alive" }, fresh(), 1000)).isError).toBe(false);
      } finally { await first.close(); }
    } finally { await wire.close(); }
  });
  it("closes a newly initialized client if cancellation arrives during initialization", async () => {
    const wire = await openFixture(mode);
    const controller = new AbortController();
    try {
      await expect(RunMcpConnection.open(binding, async (_scope, signal) => {
        const client = await ReadOnlyMcpClient.discover(wire.client, approved, signal);
        controller.abort(new Error("CANCELLED"));
        return client;
      }, controller.signal)).rejects.toThrow("CANCELLED");
    } finally { await wire.close(); }
  });
  it("closing one concurrent run does not cancel the other connection", async () => {
    const a = await openFixture(mode);
    let b: Awaited<ReturnType<typeof openFixture>> | undefined;
    let ca: RunMcpConnection | undefined;
    let cb: RunMcpConnection | undefined;
    try {
      b = await openFixture(mode);
      const bw = b;
      ca = await RunMcpConnection.open(binding, async (_scope, signal) => ReadOnlyMcpClient.discover(a.client, approved, signal), fresh());
      cb = await RunMcpConnection.open({ ...binding, ownerId: "b", runId: "run-b" }, async (_scope, signal) => ReadOnlyMcpClient.discover(bw.client, approved, signal), fresh());
      const left = ca; const right = cb;
      const pa = left.call("wait", {}, fresh(), 5000).then(() => "unexpected", () => "cancelled");
      const pb = right.call("wait", {}, fresh(), 5000).then(() => "unexpected", () => "cancelled");
      await expect.poll(() => active(left)).toBe(1);
      await expect.poll(() => active(right)).toBe(1);
      await left.close();
      expect(await pa).toBe("cancelled");
      expect(await active(right)).toBe(1);
      expect((await right.call("echo", { text: "still independent" }, fresh(), 1000)).isError).toBe(false);
      await right.close();
      expect(await pb).toBe("cancelled");
    } finally {
      try { await ca?.close(); } finally {
        try { await cb?.close(); } finally { try { await a.close(); } finally { await b?.close(); } }
      }
    }
  });
});
