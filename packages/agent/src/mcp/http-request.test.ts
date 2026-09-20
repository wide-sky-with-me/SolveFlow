import { createServer, type RequestListener } from "node:http";
import type { Socket } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createMcpHttpRequest, MCP_HTTP_LIMITS } from "./http-request.js";

const fresh = () => new AbortController().signal;
const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); vi.unstubAllEnvs(); });

async function serve(handler: RequestListener, options: { lifetimeMs?: number; requestTimeoutMs?: number; authorization?: string } = {}) {
  let requests = 0;
  const sockets = new Set<Socket>();
  const server = createServer((request, response) => { requests += 1; handler(request, response); });
  server.on("connection", socket => { sockets.add(socket); socket.once("close", () => sockets.delete(socket)); });
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("NO_LOCAL_PORT");
  // This name cannot resolve in DNS. Only the approved pin may reach our server.
  const config = { endpoint: `http://mcp-fixture.invalid:${address.port}/mcp`, address: "127.0.0.1", allowPrivateAddress: true, ...options };
  const controller = new AbortController();
  const network = createMcpHttpRequest(config, controller.signal);
  cleanup.push(async () => {
    await network.close();
    await expect.poll(() => sockets.size).toBe(0);
    await new Promise<void>((resolve, reject) => server.close(err => err ? reject(err) : resolve()));
  });
  return { network, controller, config, sockets, requests: () => requests };
}

describe("MCP fixed HTTP receive/egress boundary", () => {
  it.each([
    { endpoint: "http://example.com/mcp", address: "8.8.8.8" },
    { endpoint: "https://example.com/mcp", address: "127.0.0.1" },
    { endpoint: "https://example.com/mcp", address: "169.254.169.254" },
    { endpoint: "https://example.com/mcp", address: "100.64.0.1" },
    { endpoint: "https://example.com/mcp", address: "10.0.0.1" },
    { endpoint: "https://example.com/mcp", address: "224.0.0.1" },
    { endpoint: "https://example.com/mcp", address: "::1" },
    { endpoint: "https://[::1]/mcp", address: "8.8.8.8" },
    { endpoint: "https://8.8.8.8/mcp", address: "1.1.1.1" },
    { endpoint: "https://user:private@example.com/mcp", address: "8.8.8.8" },
    { endpoint: "https://example.com/mcp?token=private", address: "8.8.8.8" },
    { endpoint: "https://example.com/mcp#private", address: "8.8.8.8" },
  ])("rejects unapproved endpoint/address before dispatch %#", config => {
    expect(() => createMcpHttpRequest(config, fresh())).toThrow(/^MCP_INVALID_ENDPOINT$/);
  });

  it("pins the actual socket while preserving Host and injecting only the selected credential", async () => {
    vi.stubEnv("HTTP_PROXY", "http://127.0.0.1:1");
    const fixture = await serve((request, response) => {
      expect(request.headers.host).toMatch(/^mcp-fixture.invalid:/);
      expect(request.headers.authorization).toBe("Bearer synthetic-a");
      expect(request.headers["accept-encoding"]).toBe("identity");
      response.end("ok");
    }, { authorization: "Bearer synthetic-a" });
    fixture.config.address = "8.8.8.8";
    fixture.config.authorization = "Bearer synthetic-b";
    expect(await (await fixture.network.fetch(fixture.network.endpoint)).text()).toBe("ok");
    expect(fixture.requests()).toBe(1);
  });

  it("rejects destination, method, host/credential overrides and oversized UTF8 bodies before network", async () => {
    const fixture = await serve((_request, response) => response.end("unexpected"));
    const endpoint = fixture.network.endpoint;
    for (const [input, init] of [
      [endpoint + "/other", {}], [endpoint, { method: "PUT" }],
      [endpoint, { headers: { authorization: "private" } }],
      [endpoint, { headers: { host: "elsewhere" } }],
      [endpoint, { method: "POST", body: "界".repeat(12_000) }],
      [endpoint, { method: "POST", body: new Uint8Array(1) }],
    ] satisfies Array<[string, RequestInit]>) {
      await expect(fixture.network.fetch(input, init)).rejects.toThrow(/^MCP_HTTP_REQUEST_DENIED$/);
    }
    expect(fixture.requests()).toBe(0);
  });

  it("never follows redirects or reuses a connection after an egress violation", async () => {
    const target = await serve((_request, response) => response.end("must not receive credentials"));
    const fixture = await serve((_request, response) => response.writeHead(302, { location: target.network.endpoint }).end());
    await expect(fixture.network.fetch(fixture.network.endpoint)).rejects.toThrow("MCP_HTTP_REDIRECT_DENIED");
    await expect(fixture.network.fetch(fixture.network.endpoint)).rejects.toThrow("MCP_HTTP_REDIRECT_DENIED");
    expect(fixture.requests()).toBe(1);
    expect(target.requests()).toBe(0);
  });

  it.each(["length", "chunked-json", "unterminated-sse", "compressed"])("bounds %s before SDK parsing", async mode => {
    const fixture = await serve((_request, response) => {
      if (mode === "length") { response.writeHead(200, { "content-length": MCP_HTTP_LIMITS.responseBytes + 1 }).flushHeaders(); return; }
      if (mode === "compressed") { response.writeHead(200, { "content-encoding": "gzip" }).end("compressed"); return; }
      response.writeHead(200, { "content-type": mode === "unterminated-sse" ? "text/event-stream" : "application/json" });
      response.end((mode === "unterminated-sse" ? "data: " : '{"x":"') + "x".repeat(MCP_HTTP_LIMITS.responseBytes));
    });
    await expect(fixture.network.fetch(fixture.network.endpoint).then(response => response.text())).rejects.toThrow(mode === "compressed" ? "MCP_HTTP_ENCODING_DENIED" : "MCP_HTTP_RESPONSE_LIMIT");
    await fixture.network.close();
    await expect.poll(() => fixture.sockets.size).toBe(0);
  });

  it("caps cumulative bytes across responses as well as individual responses", async () => {
    const fixture = await serve((_request, response) => response.end("x".repeat(MCP_HTTP_LIMITS.responseBytes)));
    for (let i = 0; i < 4; i++) expect((await (await fixture.network.fetch(fixture.network.endpoint)).text()).length).toBe(MCP_HTTP_LIMITS.responseBytes);
    await expect(fixture.network.fetch(fixture.network.endpoint).then(response => response.text())).rejects.toThrow("MCP_HTTP_RESPONSE_LIMIT");
  });

  it("caps attempts without hidden retries", async () => {
    const fixture = await serve((_request, response) => response.end("ok"));
    for (let i = 0; i < MCP_HTTP_LIMITS.requests; i++) await (await fixture.network.fetch(fixture.network.endpoint)).text();
    await expect(fixture.network.fetch(fixture.network.endpoint)).rejects.toThrow("MCP_HTTP_REQUEST_LIMIT");
    expect(fixture.requests()).toBe(MCP_HTTP_LIMITS.requests);
  });

  it("bounds active sockets and waiting requests, and cancels the queue without dispatch", async () => {
    const fixture = await serve(() => {});
    const pending = Array.from({ length: MCP_HTTP_LIMITS.concurrent * 2 }, () => fixture.network.fetch(fixture.network.endpoint).then(() => "unexpected", err => err instanceof Error ? err.message : "invalid"));
    await expect.poll(fixture.requests).toBe(MCP_HTTP_LIMITS.concurrent);
    await expect(fixture.network.fetch(fixture.network.endpoint)).rejects.toThrow("MCP_HTTP_REQUEST_LIMIT");
    fixture.controller.abort(new Error("private"));
    expect(await Promise.all(pending)).toEqual(Array.from({ length: MCP_HTTP_LIMITS.concurrent * 2 }, () => "MCP_CANCELLED"));
    expect(fixture.requests()).toBe(MCP_HTTP_LIMITS.concurrent);
  });

  it("request abort closes only that socket while the connection remains usable", async () => {
    const fixture = await serve((_request, response) => { response.writeHead(200); response.write("partial"); });
    const controller = new AbortController();
    const response = await fixture.network.fetch(fixture.network.endpoint, { signal: controller.signal });
    const pending = expect(response.text()).rejects.toThrow(/^MCP_(CANCELLED|HTTP_FAILED)$/);
    controller.abort(new Error("private"));
    await pending;
    const next = await fixture.network.fetch(fixture.network.endpoint);
    await next.body?.cancel();
    expect(fixture.requests()).toBe(2);
  });

  it.each(["cancel", "close", "lifetime", "request-timeout"])("reclaims a noncooperative peer on %s without leaking its private error", async mode => {
    const fixture = await serve((_request, response) => { response.writeHead(200); response.write("partial"); }, { lifetimeMs: mode === "lifetime" ? 100 : 2000, requestTimeoutMs: mode === "request-timeout" ? 100 : 2000 });
    const response = await fixture.network.fetch(fixture.network.endpoint, { method: "POST", body: "{}" });
    const pending = expect(response.text()).rejects.toThrow(/^MCP_(CANCELLED|CLOSED|HTTP_FAILED|HTTP_TIMEOUT)$/);
    if (mode === "cancel") fixture.controller.abort(new Error("private-revocation"));
    if (mode === "close") await fixture.network.close();
    await pending;
    await fixture.network.close();
    await expect.poll(() => fixture.sockets.size).toBe(0);
  });

  it("strips raw upstream errors and ignores cookies/auth discovery headers", async () => {
    const fixture = await serve((_request, response) => response.writeHead(401, { "www-authenticate": 'Bearer resource_metadata="https://invalid.example"', "set-cookie": "private=cookie" }).end("private diagnostics"));
    const response = await fixture.network.fetch(fixture.network.endpoint);
    expect(response.status).toBe(401);
    expect(await response.text()).toBe("");
    expect([...response.headers]).toEqual([]);
    expect(fixture.requests()).toBe(1);
  });
});
