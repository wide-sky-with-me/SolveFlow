import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { DEFAULT_INHERITED_ENV_VARS, StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { expect } from "vitest";
import { createProbeServer } from "./probe-fixture.mjs";
import { compatibleHttpTransport } from "./http-transport-compat.js";
import { createBoundedHttpTransport } from "./http-connection.js";

export interface ProtocolFixture {
  client: Client;
  readonly processId: number | null;
  /** Temporary stdio working directory; empty string for HTTP. */
  cwd: string;
  /** Call in finally; closes resources and asserts transport reclamation. */
  close(): Promise<void>;
}

export async function openFixture(mode: "stdio" | "http"): Promise<ProtocolFixture> {
  const client = new Client({ name: "solveflow-local-probe-client", version: "0.0.1" }, { capabilities: {} });
  let clientClosed = false;
  client.onclose = () => { clientClosed = true; };
  if (mode === "stdio") {
    const cwd = await mkdtemp(join(tmpdir(), "solveflow-mcp-"));
    const env: Record<string, string> = {};
    // SDK 1.30.0 merges defaults even with env: {}, so override every inherited key.
    for (const name of DEFAULT_INHERITED_ENV_VARS) env[name] = "";
    env.HOME = cwd;
    env.PATH = dirname(process.execPath);
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [fileURLToPath(new URL("./probe-fixture.mjs", import.meta.url)), "--stdio"],
      cwd, env, stderr: "ignore", maxBufferSize: 64 * 1024,
    });
    try {
      await client.connect(transport, { timeout: 2_000 });
    } catch (error) {
      await client.close();
      await rm(cwd, { recursive: true, force: true });
      throw error;
    }
    const pid = transport.pid;
    return { client, cwd, processId: pid, async close() {
      try { await client.close(); } finally { await rm(cwd, { recursive: true, force: true }); }
      expect(clientClosed).toBe(true);
      expect(transport.pid).toBeNull();
      if (pid !== null) expect(() => process.kill(pid, 0)).toThrow();
    } };
  }

  const fixture = createProbeServer();
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: randomUUID });
  await fixture.server.connect(compatibleHttpTransport(transport));
  const http = createServer((request, response) => {
    if (request.url !== "/mcp") { response.writeHead(404).end(); return; }
    void transport.handleRequest(request, response).catch(() => {
      if (!response.headersSent) response.writeHead(500);
      response.end();
    });
  });
  try {
    await new Promise<void>((resolve, reject) => {
      http.once("error", reject);
      http.listen(0, "127.0.0.1", () => { http.off("error", reject); resolve(); });
    });
    const address = http.address();
    if (address === null || typeof address === "string") throw new Error("NO_LOCAL_PORT");
    const clientTransport = createBoundedHttpTransport({ endpoint: `http://127.0.0.1:${address.port}/mcp`, address: "127.0.0.1", allowPrivateAddress: true }, new AbortController().signal);
    await client.connect(clientTransport, { timeout: 2_000 });
  } catch (error) {
    fixture.stop();
    await client.close();
    await fixture.server.close();
    http.closeAllConnections();
    await new Promise<void>(resolve => http.close(() => resolve()));
    throw error;
  }
  return { client, cwd: "", processId: null, async close() {
    try { await client.close(); } finally {
      fixture.stop();
      await fixture.server.close();
      http.closeAllConnections();
      await new Promise<void>((resolve, reject) => http.close(error => error ? reject(error) : resolve()));
    }
    expect(clientClosed).toBe(true);
    expect(http.listening).toBe(false);
    expect(fixture.state.active).toBe(0);
  } };
}
