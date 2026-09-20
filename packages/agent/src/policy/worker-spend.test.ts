import { MessageChannel } from "node:worker_threads";
import { expect, it } from "vitest";
import { runIsolatedWorker } from "./isolated-worker.js";
import { createWorkerSpendClient } from "./worker-spend-client.js";
const entry = new URL("./spend-worker-fixture.mjs", import.meta.url);
const fresh = () => new AbortController().signal;
it.each(["missing", "extra", "duplicate"])("rejects %s authority/protocol without excess reservations", async mode => {
  let calls = 0;
  const authorizeModel = () => { calls += 1; };
  await expect(runIsolatedWorker(entry, { mode }, { signal: fresh(), timeoutMs: 2000, ...(mode === "missing" ? {} : { authorizeModel }) })).rejects.toThrow("MODEL_DISPATCH_DENIED");
  expect(calls).toBe(mode === "duplicate" ? 1 : 0);
});
it("cancellation during authorization prevents grant", async () => {
  const controller = new AbortController();
  await expect(runIsolatedWorker(entry, {}, { signal: controller.signal, timeoutMs: 2000, authorizeModel: () => { controller.abort(); } })).rejects.toThrow("CANCELLED");
});
it.each(["wrong-id", "close", "abort", "valid"])("worker client cleans listeners on %s", async mode => {
  const { port1, port2 } = new MessageChannel(); const controller = new AbortController();
  try {
    port2.once("message", () => {
      if (mode === "close") port2.close();
      else if (mode === "abort") controller.abort();
      else port2.postMessage({ type: "model.reserved", id: mode === "wrong-id" ? 2 : 1, ok: true });
    });
    const task = createWorkerSpendClient(port1)("fixed", controller.signal);
    if (mode === "valid") await expect(task).resolves.toBeUndefined();
    else await expect(task).rejects.toThrow("MODEL_DISPATCH_DENIED");
    expect(port1.listenerCount("message")).toBe(0); expect(port1.listenerCount("close")).toBe(0);
  } finally { port1.close(); port2.close(); }
});
it("keeps the original authority when caller mutates options after dispatch", async () => {
  let original = 0; let replacement = 0;
  const options = { signal: fresh(), timeoutMs: 2000, authorizeModel: () => { original += 1; } };
  const task = runIsolatedWorker(entry, {}, options);
  options.authorizeModel = () => { replacement += 1; };
  await expect(task).resolves.toEqual({ granted: true });
  expect(original).toBe(1); expect(replacement).toBe(0);
});
it("rejects accidental async authorities without an unhandled rejection", async () => {
  await expect(runIsolatedWorker(entry, {}, { signal: fresh(), timeoutMs: 2000, authorizeModel: async () => { throw new Error("private-authority-error"); } })).rejects.toThrow("MODEL_DISPATCH_DENIED");
});
it("preserves only the trusted spending-limit error across the worker boundary", async () => {
  await expect(runIsolatedWorker(entry, {}, { signal: fresh(), timeoutMs: 2000, authorizeModel: () => { throw new Error("SPEND_LIMIT"); } })).rejects.toThrow("SPEND_LIMIT");
});

it("worker client grants eighteen requests and rejects the nineteenth without sending", async () => {
  const { port1, port2 } = new MessageChannel(); let calls = 0;
  try {
    port2.on("message", value => { calls++; port2.postMessage({ type: "model.reserved", id: value.id, ok: true }); });
    const authorize = createWorkerSpendClient(port1);
    for (let i = 0; i < 18; i++) await authorize("fixed", fresh());
    await expect(authorize("fixed", fresh())).rejects.toThrow("MODEL_DISPATCH_DENIED");
    expect(calls).toBe(18);
    expect(port1.listenerCount("message")).toBe(0); expect(port1.listenerCount("close")).toBe(0);
  } finally { port1.close(); port2.close(); }
});
it.each([18, 19])("parent worker authority bounds sequential requests at eighteen (%i)", async count => {
  let calls = 0;
  const task = runIsolatedWorker(entry, { mode: "sequence", count }, { signal: fresh(), timeoutMs: 2000, authorizeModel: () => { calls++; } });
  if (count === 18) await expect(task).resolves.toEqual({ granted: true });
  else await expect(task).rejects.toThrow("MODEL_DISPATCH_DENIED");
  expect(calls).toBe(18);
});
