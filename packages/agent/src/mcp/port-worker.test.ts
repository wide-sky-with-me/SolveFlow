import { MessageChannel } from "node:worker_threads";
import { expect, it } from "vitest";
import { z } from "zod";
import { openFixture } from "./protocol.test-support.js";
import { echoSchema } from "./probe-fixture.mjs";
import { ReadOnlyMcpClient } from "./read-only-client.js";
import { RunMcpConnection } from "./run-connection.js";
import { serveMcpPort } from "./port-rpc.js";
import { withOwnedMcpConnection } from "./owned-lifecycle.js";
import { runIsolatedWorker } from "../policy/isolated-worker.js";
const binding = { ownerId: "a", runId: "a", server: "local", credentialVersion: "v1" };
const approved = [{ name: "echo", inputSchema: echoSchema, parameters: z.strictObject({ text: z.string().max(128) }) }];
it.each(["stdio", "http"] as const)("transfers RPC into supervised worker and reclaims parent %s resources", async mode => {
  for (const outcome of ["complete", "spin"]) {
    const wire = await openFixture(mode); const { port1, port2 } = new MessageChannel();
    const controller = new AbortController(); let started = false;
    let connection: RunMcpConnection | undefined;
    let rpc: ReturnType<typeof serveMcpPort> | undefined;
    try {
      connection = await RunMcpConnection.open(binding, async (_binding, signal) => ReadOnlyMcpClient.discover(wire.client, approved, signal), controller.signal);
      const owned = connection;
      rpc = serveMcpPort(port1, owned, binding, controller.signal);
      const serving = rpc;
      const task = withOwnedMcpConnection(owned, binding, controller.signal, async () => {
        try {
          return await runIsolatedWorker(new URL("./port-worker-fixture.mjs", import.meta.url), { mode: outcome }, { toolPort: port2, signal: controller.signal, timeoutMs: 4000, onStarted: () => { started = true; controller.abort(); } });
        } finally { await serving.close(); }
      });
      if (outcome === "complete") await expect(task).resolves.toMatchObject({ isError: false, content: [{ type: "text", text: "cross-thread" }] });
      else { await expect(task).rejects.toThrow("CANCELLED"); expect(started).toBe(true); }
      await expect(wire.client.listTools()).rejects.toThrow();
      const pid = wire.processId; if (pid !== null) expect(() => process.kill(pid, 0)).toThrow();
      expect(port1.listenerCount("message")).toBe(0);
    } finally { await rpc?.close(); port1.close(); port2.close(); await connection?.close(); await wire.close(); }
  }
});
