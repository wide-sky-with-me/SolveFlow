import { expect, it } from "vitest";
import { z } from "zod";
import { openFixture } from "../mcp/protocol.test-support.js";
import { echoSchema } from "../mcp/probe-fixture.mjs";
import { ReadOnlyMcpClient } from "../mcp/read-only-client.js";
import { RunMcpConnection } from "../mcp/run-connection.js";
import { CapabilitySnapshot } from "../policy/capability-snapshot.js";
import { RunBudget } from "../policy/run-budget.js";
import { createMcpExtension } from "./mcp-extension.js";

it("rejects MCP capabilities misclassified into the file quota", async () => {
  const fixture = await openFixture("http");
  try {
    const tools = [{ name: "echo", inputSchema: echoSchema, parameters: z.strictObject({ text: z.string().max(128) }) }];
    const client = await ReadOnlyMcpClient.discover(fixture.client, tools, new AbortController().signal);
    const identity = { ownerId: "a", runId: "r" };
    const capabilities = new CapabilitySnapshot(identity, [{ name: "mcp__local__echo", source: "<solveflow:mcp:local>", schema: echoSchema, category: "file" }]);
    const connection = await RunMcpConnection.open({ ...identity, server: "local", credentialVersion: "fixture-v1" }, async () => client, new AbortController().signal);
    expect(() => createMcpExtension({ server: "local", credentialVersion: "fixture-v1", tools, client: connection, identity, capabilities, budget: new RunBudget() })).toThrow("MCP_INVALID_CATEGORY");
  } finally { await fixture.close(); }
});
