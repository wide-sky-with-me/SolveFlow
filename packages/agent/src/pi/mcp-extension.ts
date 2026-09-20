import type { Extension, ToolDefinition } from "@earendil-works/pi-coding-agent";
import type { ApprovedReadOnlyTool } from "../mcp/read-only-client.js";
import { RunMcpConnection } from "../mcp/run-connection.js";
import { CapabilitySnapshot, type RunIdentity } from "../policy/capability-snapshot.js";
import { RunBudget } from "../policy/run-budget.js";

export function mcpToolName(server: string, tool: string): string {
  if (!/^[a-z][a-z0-9-]{0,23}$/.test(server) || !/^[a-z][a-z0-9_]{0,31}$/.test(tool)) throw new Error("INVALID_MCP_NAME");
  return `mcp__${server.replaceAll("-", "_")}__${tool}`;
}

/** A data-only, explicitly admitted Pi Extension. The official session ExtensionRunner
 * registers it; no default discovery, filesystem extension imports or private APIs. */
export function createMcpExtension(options: {
  server: string;
  tools: readonly ApprovedReadOnlyTool[];
  client: Pick<RunMcpConnection, "assertBinding" | "names" | "call">;
  credentialVersion: string;
  identity: RunIdentity;
  capabilities: CapabilitySnapshot;
  budget: RunBudget;
}): Extension {
  const { client, capabilities, budget } = options;
  const sourcePath = `<solveflow:mcp:${options.server}>`;
  const sourceInfo = { path: sourcePath, source: "solveflow-mcp", scope: "temporary" as const, origin: "top-level" as const };
  const identity = Object.freeze({ ...options.identity });
  const { server, credentialVersion } = options;
  client.assertBinding(identity, server, credentialVersion);
  const extension: Extension = {
    path: sourcePath, resolvedPath: sourcePath, sourceInfo,
    tools: new Map(), handlers: new Map(), messageRenderers: new Map(), commands: new Map(), flags: new Map(), shortcuts: new Map(),
  };
  for (const approved of options.tools) {
    const remoteName = approved.name;
    const name = mcpToolName(options.server, remoteName);
    if (extension.tools.has(name) || !client.names().includes(remoteName)) throw new Error("MCP_TOOL_NOT_APPROVED");
    if (capabilities.authorize(name, identity, new AbortController().signal).category === "file") throw new Error("MCP_INVALID_CATEGORY");
    const definition: ToolDefinition = {
      name, label: name, description: `Approved read-only MCP capability ${name}.`,
      parameters: structuredClone(approved.inputSchema),
      async execute(_id, input, signal) {
        client.assertBinding(identity, server, credentialVersion);
        const authorized = capabilities.authorize(name, identity, signal ?? new AbortController().signal);
        const timeout = budget.reserveTool(authorized.category, authorized.signal);
        const result = await client.call(remoteName, input, authorized.signal, timeout);
        authorized.signal.throwIfAborted();
        budget.assertActive(authorized.signal);
        if (result.isError) throw new Error("MCP_TOOL_ERROR");
        return { content: result.content, details: undefined };
      },
    };
    extension.tools.set(name, { definition, sourceInfo });
  }
  return extension;
}
