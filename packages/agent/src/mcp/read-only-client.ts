import { isDeepStrictEqual } from "node:util";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { assertBoundedJson } from "../policy/bounded-json.js";

/** Administrator-reviewed contracts, never inferred from readOnlyHint. */
export interface ApprovedReadOnlyTool {
  name: string;
  inputSchema: Tool["inputSchema"];
  parameters: z.ZodType<Record<string, unknown>>;
}

const textResult = z.object({
  content: z.array(z.object({ type: z.literal("text"), text: z.string() }).strict()).max(32),
  isError: z.boolean().optional(),
});

export class McpProbeError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "McpProbeError";
  }
}

/** Minimal single-connection probe adapter, not a production pool/network policy.
 * The caller connects a trusted, bounded transport before discovery.
 * Results accept only text: images/resource links/embedded resources are rejected.
 * Byte checks below bound exposed output, not the HTTP transport receive buffer.
 */
const claimedConnections = new WeakSet<Client>();
export class ReadOnlyMcpClient {
  private readonly shutdown = new AbortController();
  private closePromise: Promise<void> | undefined;
  private constructor(
    private readonly client: Client,
    private readonly approved: ReadonlyMap<string, ApprovedReadOnlyTool>,
  ) {}

  static async discover(
    client: Client,
    approved: readonly ApprovedReadOnlyTool[],
    signal: AbortSignal,
  ): Promise<ReadOnlyMcpClient> {
    signal.throwIfAborted();
    if (approved.length > 64) throw new McpProbeError("MCP_INVALID_ALLOWLIST");
    const names = new Set<string>();
    for (const tool of approved) {
      if (!/^[a-z][a-z0-9_]{0,63}$/.test(tool.name) || names.has(tool.name)) {
        throw new McpProbeError("MCP_INVALID_ALLOWLIST");
      }
      names.add(tool.name);
    }
    const listed = await client.listTools({}, { signal, timeout: 2_000 });
    if (listed.nextCursor || listed.tools.length > 64) throw new McpProbeError("MCP_DISCOVERY_LIMIT");
    if (new Set(listed.tools.map(tool => tool.name)).size !== listed.tools.length) {
      throw new McpProbeError("MCP_DUPLICATE_TOOL");
    }
    const snapshot = new Map<string, ApprovedReadOnlyTool>();
    for (const tool of approved) {
      const remote = listed.tools.find(candidate => candidate.name === tool.name);
      if (!remote || !isDeepStrictEqual(remote.inputSchema, tool.inputSchema)) {
        throw new McpProbeError("MCP_SCHEMA_MISMATCH");
      }
      snapshot.set(tool.name, Object.freeze({ ...tool, inputSchema: structuredClone(tool.inputSchema) }));
    }
    return new ReadOnlyMcpClient(client, snapshot);
  }

  /** Claim the underlying SDK connection, not merely this adapter instance. */
  claimForRun(): void {
    if (claimedConnections.has(this.client)) throw new McpProbeError("MCP_CONNECTION_ALREADY_OWNED");
    claimedConnections.add(this.client);
  }

  names(): readonly string[] {
    return Object.freeze([...this.approved.keys()]);
  }

  async call(name: string, input: unknown, signal: AbortSignal, timeoutMs = 2_000) {
    const combined = AbortSignal.any([signal, this.shutdown.signal]);
    combined.throwIfAborted();
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 10_000) {
      throw new McpProbeError("MCP_INVALID_TIMEOUT");
    }
    const tool = this.approved.get(name);
    if (!tool) throw new McpProbeError("MCP_TOOL_NOT_APPROVED");
    try { assertBoundedJson(input); } catch { throw new McpProbeError("MCP_INPUT_LIMIT"); }
    const parsed = tool.parameters.safeParse(input);
    if (!parsed.success) throw new McpProbeError("MCP_INVALID_ARGUMENTS");
    try { assertBoundedJson(parsed.data); } catch { throw new McpProbeError("MCP_INPUT_LIMIT"); }
    combined.throwIfAborted();
    let raw: unknown;
    try {
      raw = await this.client.callTool({ name, arguments: parsed.data }, undefined, {
        signal: combined, timeout: timeoutMs, maxTotalTimeout: timeoutMs, resetTimeoutOnProgress: false,
      });
    } catch {
      if (combined.aborted) throw new McpProbeError("MCP_CANCELLED");
      throw new McpProbeError("MCP_CALL_FAILED");
    }
    combined.throwIfAborted();
    const result = textResult.safeParse(raw);
    if (!result.success) throw new McpProbeError("MCP_INVALID_RESULT");
    if (Buffer.byteLength(JSON.stringify(result.data), "utf8") > 32 * 1024) {
      throw new McpProbeError("MCP_OUTPUT_LIMIT");
    }
    return { content: result.data.content, isError: result.data.isError ?? false };
  }

  close(): Promise<void> {
    if (this.closePromise) return this.closePromise;
    this.shutdown.abort(new McpProbeError("MCP_CLOSED"));
    this.closePromise = this.client.close();
    return this.closePromise;
  }
}
