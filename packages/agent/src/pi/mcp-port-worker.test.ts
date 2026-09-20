import { MessageChannel } from "node:worker_threads";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { z } from "zod";
import { openFixture } from "../mcp/protocol.test-support.js";
import { echoSchema } from "../mcp/probe-fixture.mjs";
import { RunMcpConnection } from "../mcp/run-connection.js";
import { ReadOnlyMcpClient } from "../mcp/read-only-client.js";
import { serveMcpPort } from "../mcp/port-rpc.js";
import { createMcpRunAuthority } from "../mcp/run-authority.js";
import { RunBudget } from "../policy/run-budget.js";
import { CapabilitySnapshot } from "../policy/capability-snapshot.js";
import { withOwnedMcpConnection } from "../mcp/owned-lifecycle.js";
import { SpendLedger } from "../policy/spend-ledger.js";
import { createRunSpendAuthority } from "../policy/run-spend-authority.js";
import { runIsolatedWorker } from "../policy/isolated-worker.js";
const candidate = { schemaVersion: 1, kind: "answer", problem: { text: "fixture", subject: "math", uncertainties: [] }, answer: "fixture", steps: [], knowledgePoints: [], citationIds: [], clarificationQuestions: [] };
it.each(["stdio", "http"] as const)("runs native Pi through image, parent ledger and %s port extension", async mode => {
  const root = mkdtempSync(join(tmpdir(), "pi-port-")); const file = join(root, "ledger"); writeFileSync(file, "", { mode: 0o600 });
  const ledger = SpendLedger.open(file); const wire = await openFixture(mode);
  const { port1, port2 } = new MessageChannel(); const signal = new AbortController().signal;
  const binding = { ownerId: "a", runId: "a", server: "local", credentialVersion: "v1" };
  let connection: RunMcpConnection | undefined; let rpc: ReturnType<typeof serveMcpPort> | undefined;
  try {
    connection = await RunMcpConnection.open(binding, async (_scope, active) => ReadOnlyMcpClient.discover(wire.client, [{ name: "echo", inputSchema: echoSchema, parameters: z.strictObject({ text: z.string().max(128) }) }], active), signal);
    const parentBudget = new RunBudget();
    const parentCaps = new CapabilitySnapshot(binding, [{ name: "mcp__local__echo", source: "<solveflow:mcp:local>", schema: echoSchema, category: "business" }]);
    const authority = createMcpRunAuthority(binding, parentCaps, parentBudget, { echo: "mcp__local__echo" });
    rpc = serveMcpPort(port1, connection, binding, signal, authority); const serving = rpc;
    const result = await withOwnedMcpConnection(connection, binding, signal, async () => {
      try { return await runIsolatedWorker(new URL("./mcp-port-worker-fixture.mjs", import.meta.url), { candidate }, { image: new Uint8Array(100 * 1024).fill(17), toolPort: port2, signal, timeoutMs: 4000, authorizeModel: createRunSpendAuthority(ledger, parentBudget, { role: "solver", modelId: "offline", attemptPrefix: "phase", maximumMicros: 1_000_000n }) }); }
      finally { await serving.close(); }
    });
    expect(result).toMatchObject({ role: "solver", candidate });
    expect(JSON.stringify(result)).not.toMatch(/native-port-evidence|thinking|base64/);
    expect(ledger.snapshot().reservedMicros).toBe("2000000");
    await expect(wire.client.listTools()).rejects.toThrow();
    const pid = wire.processId; if (pid !== null) expect(() => process.kill(pid, 0)).toThrow();
  } finally { await rpc?.close(); port1.close(); port2.close(); await connection?.close(); await wire.close(); ledger.close(); rmSync(root, { recursive: true, force: true }); }
});
