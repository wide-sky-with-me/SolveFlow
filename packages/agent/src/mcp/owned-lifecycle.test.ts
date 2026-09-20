import { expect, it, vi } from "vitest";
import { z } from "zod";
import { openFixture } from "./protocol.test-support.js";
import { echoSchema } from "./probe-fixture.mjs";
import { ReadOnlyMcpClient } from "./read-only-client.js";
import { RunMcpConnection } from "./run-connection.js";
import { withOwnedMcpConnection } from "./owned-lifecycle.js";
import { runIsolatedWorker } from "../policy/isolated-worker.js";
const binding = { ownerId: "a", runId: "a", server: "local", credentialVersion: "v1" };
const fresh = () => new AbortController().signal;
const approved = [{ name: "echo", inputSchema: echoSchema, parameters: z.strictObject({ text: z.string().max(128) }) }];
const worker = new URL("../policy/worker-fixture.mjs", import.meta.url);
it.each(["stdio", "http"] as const)("owns %s resources across worker completion, crash and forced timeout", async mode => {
  for (const outcome of ["complete", "crash", "spin"]) {
    const wire = await openFixture(mode);
    try {
      const connection = await RunMcpConnection.open(binding, async (_binding, signal) => ReadOnlyMcpClient.discover(wire.client, approved, signal), fresh());
      const signal = fresh();
      const task = withOwnedMcpConnection(connection, binding, signal, () => runIsolatedWorker(worker, { mode: outcome }, { signal, timeoutMs: outcome === "spin" ? 100 : 2000 }));
      if (outcome === "complete") await expect(task).resolves.toMatchObject({ result: "fixture" });
      else await expect(task).rejects.toThrow(outcome === "crash" ? "WORKER_LOST" : "RUN_TIMEOUT");
      // Verify BEFORE fixture fallback cleanup: parent ownership actually closed it.
      await expect(wire.client.listTools()).rejects.toThrow();
      const pid = wire.processId;
      if (pid !== null) expect(() => process.kill(pid, 0)).toThrow();
    } finally { await wire.close(); }
  }
});
it.each(["stdio", "http"] as const)("refuses duplicate %s lifecycle without closing rightful owner", async mode => {
  const wire = await openFixture(mode);
  let release: (() => void) | undefined;
  let task: Promise<void> | undefined;
  try {
    const connection = await RunMcpConnection.open(binding, async (_binding, signal) => ReadOnlyMcpClient.discover(wire.client, approved, signal), fresh());
    const pending = new Promise<void>(resolve => { release = resolve; });
    task = withOwnedMcpConnection(connection, binding, fresh(), () => pending);
    await expect(withOwnedMcpConnection(connection, binding, fresh(), async () => {})).rejects.toThrow("MCP_LIFECYCLE_ALREADY_OWNED");
    expect((await connection.call("echo", { text: "alive" }, fresh(), 1000)).isError).toBe(false);
  } finally { release?.(); await task; await wire.close(); }
});
it.each(["stdio", "http"] as const)("cancellation while %s closes cannot return success or private reason", async mode => {
  const wire = await openFixture(mode);
  const controller = new AbortController();
  try {
    const connection = await RunMcpConnection.open(binding, async (_binding, signal) => ReadOnlyMcpClient.discover(wire.client, approved, signal), fresh());
    const previousClose = wire.client.onclose;
    wire.client.onclose = () => { previousClose?.(); controller.abort(new Error("private-cancel-detail")); };
    await expect(withOwnedMcpConnection(connection, binding, controller.signal, async () => ({ result: "must-not-escape" }))).rejects.toThrow("CANCELLED");
    await expect(wire.client.listTools()).rejects.toThrow();
    const pid = wire.processId;
    if (pid !== null) expect(() => process.kill(pid, 0)).toThrow();
  } finally { await wire.close(); }
});
it.each([false, true])("sanitizes cleanup failure with cancellation=%s", async cancel => {
  const wire = await openFixture("http"); const controller = new AbortController();
  let restore: (() => void) | undefined;
  try {
    const connection = await RunMcpConnection.open(binding, async (_binding, signal) => ReadOnlyMcpClient.discover(wire.client, approved, signal), fresh());
    const spy = vi.spyOn(ReadOnlyMcpClient.prototype, "close").mockImplementation(async () => {
      if (cancel) controller.abort(new Error("private-reason"));
      throw new Error("private-cleanup-error");
    });
    restore = () => spy.mockRestore();
    await expect(withOwnedMcpConnection(connection, binding, controller.signal, async () => "not-success")).rejects.toThrow(cancel ? "CANCELLED" : "MCP_CLEANUP_FAILED");
    expect(spy).toHaveBeenCalledOnce();
  } finally { restore?.(); await wire.close(); }
});
