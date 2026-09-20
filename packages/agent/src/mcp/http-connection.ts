import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { compatibleHttpTransport } from "./http-transport-compat.js";
import { createMcpHttpRequest, type McpHttpEndpoint } from "./http-request.js";
import { ReadOnlyMcpClient, type ApprovedReadOnlyTool } from "./read-only-client.js";
import { RunMcpConnection, type McpConnectionBinding } from "./run-connection.js";

/** No OAuth/discovery/reconnect. close waits for local sockets to close; remote
 * computation is not guaranteed to stop. The SDK transport only closes streams,
 * so session termination/remote expiry remains a server deployment responsibility. */
export function createBoundedHttpTransport(endpoint: McpHttpEndpoint, signal: AbortSignal) {
  const network = createMcpHttpRequest(endpoint, signal);
  const source = new StreamableHTTPClientTransport(new URL(network.endpoint), {
    fetch: network.fetch,
    reconnectionOptions: { maxRetries: 0, initialReconnectionDelay: 10, maxReconnectionDelay: 10, reconnectionDelayGrowFactor: 1 },
  });
  const transport = compatibleHttpTransport(source);
  const originalClose = transport.close.bind(transport);
  let closing: Promise<void> | undefined;
  transport.close = () => {
    closing ??= (async () => { try { await originalClose(); } finally { await network.close(); } })();
    return closing;
  };
  return transport;
}

/** Trusted server resolver must select endpoint/credentials using the authenticated
 * immutable scope, never model-supplied owner fields. Each run gets its own client.
 * Revocation uses the supplied signal; failed initialization always closes sockets. */
export function openHttpMcpConnection(
  binding: McpConnectionBinding,
  resolveEndpoint: (scope: Readonly<McpConnectionBinding>) => McpHttpEndpoint,
  approved: readonly ApprovedReadOnlyTool[],
  signal: AbortSignal,
): Promise<RunMcpConnection> {
  return RunMcpConnection.open(binding, async scope => {
    const client = new Client({ name: "solveflow", version: "0.0.0" }, { capabilities: {} });
    const transport = createBoundedHttpTransport(resolveEndpoint(scope), signal);
    const revoke = () => { void client.close().catch(() => { /* Awaited by connection cleanup below. */ }); };
    signal.addEventListener("abort", revoke, { once: true });
    const close = transport.close.bind(transport);
    transport.close = async () => {
      signal.removeEventListener("abort", revoke);
      await close();
    };
    try {
      signal.throwIfAborted();
      await client.connect(transport, { signal, timeout: 2_000 });
      return await ReadOnlyMcpClient.discover(client, approved, signal);
    } catch {
      try { await client.close(); } finally { await transport.close(); }
      throw new Error(signal.aborted ? "MCP_CANCELLED" : "MCP_CONNECT_FAILED");
    }
  }, signal).catch(() => { throw new Error(signal.aborted ? "MCP_CANCELLED" : "MCP_CONNECT_FAILED"); });
}
