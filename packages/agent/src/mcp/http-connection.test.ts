import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import type { Socket } from "node:net";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { afterEach, expect, it } from "vitest";
import { z } from "zod";
import { createProbeServer, echoSchema } from "./probe-fixture.mjs";
import { compatibleHttpTransport } from "./http-transport-compat.js";
import { openHttpMcpConnection } from "./http-connection.js";
import type { McpHttpEndpoint } from "./http-request.js";

const fresh = () => new AbortController().signal;
const binding = { ownerId: "a", runId: "run-a", server: "local", credentialVersion: "v1" };
const approved = [{ name: "echo", inputSchema: echoSchema, parameters: z.strictObject({ text: z.string().max(128) }) }];
const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); });

async function server(authorization: string, mode: "normal" | "reject" | "hang" = "normal") {
  const fixture = createProbeServer();
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: randomUUID });
  await fixture.server.connect(compatibleHttpTransport(transport));
  const sockets = new Set<Socket>();
  let accepted = 0;
  let denied = 0;
  const http = createServer((request, response) => {
    if (request.headers.authorization !== authorization) { denied += 1; response.writeHead(401).end("private"); return; }
    accepted += 1;
    if (mode === "reject") { response.writeHead(503).end("private"); return; }
    if (mode === "hang") return;
    void transport.handleRequest(request, response).catch(() => response.destroy());
  });
  http.on("connection", socket => { sockets.add(socket); socket.once("close", () => sockets.delete(socket)); });
  await new Promise<void>((resolve, reject) => { http.once("error", reject); http.listen(0, "127.0.0.1", resolve); });
  const address = http.address();
  if (!address || typeof address === "string") throw new Error("NO_LOCAL_PORT");
  cleanup.push(async () => {
    fixture.stop(); await fixture.server.close(); http.closeAllConnections();
    await new Promise<void>((resolve, reject) => http.close(err => err ? reject(err) : resolve()));
  });
  const endpoint: McpHttpEndpoint = { endpoint: `http://127.0.0.1:${address.port}/mcp`, address: "127.0.0.1", allowPrivateAddress: true, authorization };
  return { endpoint, sockets, accepted: () => accepted, denied: () => denied };
}

it("resolves immutable owner/run credentials and revokes only the selected concurrent connection", async () => {
  const a = await server("Bearer synthetic-a");
  const b = await server("Bearer synthetic-b");
  const controller = new AbortController();
  const resolve = (scope: Readonly<typeof binding>) => {
    expect(Object.isFrozen(scope)).toBe(true);
    if (scope.ownerId === "a" && scope.runId === "run-a" && scope.credentialVersion === "v1") return a.endpoint;
    if (scope.ownerId === "b" && scope.runId === "run-b" && scope.credentialVersion === "v2") return b.endpoint;
    throw new Error("private resolver detail");
  };
  const [ca, cb] = await Promise.all([
    openHttpMcpConnection(binding, resolve, approved, controller.signal),
    openHttpMcpConnection({ ...binding, ownerId: "b", runId: "run-b", credentialVersion: "v2" }, resolve, approved, fresh()),
  ]);
  cleanup.push(() => cb.close(), () => ca.close());
  expect((await ca.call("echo", { text: "a" }, fresh(), 1000)).content[0]?.text).toBe("a");
  controller.abort(new Error("private revocation detail"));
  await ca.close();
  await expect.poll(() => a.sockets.size).toBe(0);
  await expect(ca.call("echo", { text: "late" }, fresh(), 1000)).rejects.toThrow("MCP_CONNECTION_CLOSED");
  expect((await cb.call("echo", { text: "b survives" }, fresh(), 1000)).content[0]?.text).toBe("b survives");
  expect(a.denied() + b.denied()).toBe(0);
  await cb.close();
  await expect.poll(() => b.sockets.size).toBe(0);
});

it.each(["reject", "bad-credential", "bad-schema", "cancel-init"])("reclaims failed initialization: %s", async mode => {
  const remote = await server("Bearer synthetic", mode === "reject" ? "reject" : mode === "cancel-init" ? "hang" : "normal");
  const controller = new AbortController();
  const endpoint = mode === "bad-credential" ? { ...remote.endpoint, authorization: "Bearer wrong-synthetic" } : remote.endpoint;
  const allowlist = mode === "bad-schema" ? [{ name: "echo", parameters: z.strictObject({ text: z.string() }), inputSchema: { type: "object" as const } }] : approved;
  const task = openHttpMcpConnection(binding, () => endpoint, allowlist, controller.signal);
  const rejection = expect(task).rejects.toThrow(mode === "cancel-init" ? /^MCP_CANCELLED$/ : /^MCP_CONNECT_FAILED$/);
  if (mode === "cancel-init") {
    await expect.poll(remote.accepted).toBe(1);
    controller.abort(new Error("private cancellation"));
  }
  await rejection;
  await expect.poll(() => remote.sockets.size).toBe(0);
});

it("rejects pre-cancelled work without resolving credentials or dispatching", async () => {
  const controller = new AbortController(); controller.abort(new Error("CANCELLED"));
  let resolved = false;
  await expect(openHttpMcpConnection(binding, () => { resolved = true; throw new Error("must not execute"); }, approved, controller.signal)).rejects.toThrow("MCP_CANCELLED");
  expect(resolved).toBe(false);
});

it("sanitizes credential resolver failures before exposing a connection", async () => {
  await expect(openHttpMcpConnection(binding, () => { throw new Error("private credential reference"); }, approved, fresh())).rejects.toThrow(/^MCP_CONNECT_FAILED$/);
});
