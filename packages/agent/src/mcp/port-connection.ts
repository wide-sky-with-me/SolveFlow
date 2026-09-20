import type { MessagePort } from "node:worker_threads";
import type { RunMcpConnection, McpConnectionBinding } from "./run-connection.js";
import { createMcpPortCaller } from "./port-rpc.js";

/** Trusted worker-side metadata only. Actual authority stays at the parent port.
 * Neither names nor these labels grant access to a different parent connection.
 */
export function createPortConnection(port: MessagePort, binding: McpConnectionBinding, tools: readonly string[]): Pick<RunMcpConnection, "assertBinding" | "names" | "call" | "close"> {
  const scope = Object.freeze({ ...binding }); const names = Object.freeze([...tools]);
  const caller = createMcpPortCaller(port); let closed = false;
  return Object.freeze({
    assertBinding(identity: { ownerId: string; runId: string }, server: string, credentialVersion: string) {
      if (closed) throw new Error("MCP_CONNECTION_CLOSED");
      if (identity.ownerId !== scope.ownerId || identity.runId !== scope.runId || server !== scope.server || credentialVersion !== scope.credentialVersion) throw new Error("MCP_CONNECTION_IDENTITY_MISMATCH");
    },
    names() { return names; },
    async call(name: string, input: unknown, signal: AbortSignal, timeoutMs: number) {
      if (closed || !names.includes(name)) throw new Error("MCP_TOOL_NOT_APPROVED");
      return caller.call(name, input, signal, timeoutMs);
    },
    async close() { closed = true; caller.close(); },
  });
}
