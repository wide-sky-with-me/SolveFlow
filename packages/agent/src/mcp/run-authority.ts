import type { McpConnectionBinding } from "./run-connection.js";
import type { CapabilitySnapshot } from "../policy/capability-snapshot.js";
import type { RunBudget } from "../policy/run-budget.js";

/** Share the SAME budget/capabilities across all parent transports in one run.
 * Mapping is admitted server configuration, never supplied by a worker request.
 */
export function createMcpRunAuthority(binding: McpConnectionBinding, capabilities: CapabilitySnapshot, budget: RunBudget, toolCapabilities: Readonly<Record<string, string>>) {
  const scope = Object.freeze({ ...binding });
  capabilities.assertIdentity(scope);
  const mapping = new Map(Object.entries(toolCapabilities));
  if (mapping.size > 32) throw new Error("MCP_INVALID_AUTHORITY");
  return Object.freeze({
    reserve(actual: McpConnectionBinding, name: string, signal: AbortSignal) {
      if (actual.ownerId !== scope.ownerId || actual.runId !== scope.runId || actual.server !== scope.server || actual.credentialVersion !== scope.credentialVersion) throw new Error("MCP_CONNECTION_IDENTITY_MISMATCH");
      const capability = mapping.get(name);
      if (!capability) throw new Error("MCP_TOOL_NOT_APPROVED");
      const granted = capabilities.authorize(capability, scope, signal);
      if (granted.category === "file") throw new Error("MCP_INVALID_CATEGORY");
      const timeoutMs = budget.reserveTool(granted.category, granted.signal);
      return { signal: granted.signal, timeoutMs, assertActive() { budget.assertActive(granted.signal); } };
    },
  });
}
export type McpRunAuthority = ReturnType<typeof createMcpRunAuthority>;
