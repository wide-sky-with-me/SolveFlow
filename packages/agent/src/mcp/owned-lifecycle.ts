import { RunMcpConnection, type McpConnectionBinding } from "./run-connection.js";
const consumed = new WeakSet<RunMcpConnection>();

/** Parent-side single-use ownership. work must settle only after its worker exits.
 * This composes existing connections; it is not a transport factory, RPC or reaper.
 * A hanging close still needs transport-level containment; never race it to success.
 */
export async function withOwnedMcpConnection<T>(connection: RunMcpConnection, binding: McpConnectionBinding, signal: AbortSignal, work: () => Promise<T>): Promise<T> {
  connection.assertBinding(binding, binding.server, binding.credentialVersion);
  if (consumed.has(connection)) throw new Error("MCP_LIFECYCLE_ALREADY_OWNED");
  consumed.add(connection);
  try {
    signal.throwIfAborted();
    return await work();
  } finally {
    try { await connection.close(); }
    catch { throw new Error(signal.aborted ? "CANCELLED" : "MCP_CLEANUP_FAILED"); }
    if (signal.aborted) throw new Error("CANCELLED");
  }
}
