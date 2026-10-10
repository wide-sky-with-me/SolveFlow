import { afterEach, expect, it, vi } from "vitest";
import { runIsolatedWorker } from "./isolated-worker.js";
const entry = new URL("./worker-fixture.mjs", import.meta.url);
const fresh = () => new AbortController().signal;
const progressEntry = new URL("./progress-worker-fixture.mjs", import.meta.url);
it("awaits durable progress before resolving the worker result", async () => {
  let persisted = false;
  const result = await runIsolatedWorker(progressEntry, {}, { signal: fresh(), timeoutMs: 2000, onEvent: async event => {
    expect(event.type).toBe("run.status"); await new Promise(resolve => setTimeout(resolve, 30)); persisted = true;
  } });
  expect(persisted).toBe(true); expect(result).toEqual({ result: "done" });
});
it("propagates progress persistence failure without private detail", async () => {
  await expect(runIsolatedWorker(progressEntry, {}, { signal: fresh(), timeoutMs: 2000, onEvent: async () => { throw new Error("private SQL"); } })).rejects.toThrow("WORKER_LOST");
});
it.each([{ invalid: true }, { flood: true }])("rejects malformed or excessive public progress", async input => {
  await expect(runIsolatedWorker(progressEntry, input, { signal: fresh(), timeoutMs: 2000, onEvent: async () => {} })).rejects.toThrow("WORKER_OUTPUT_INVALID");
});
afterEach(() => vi.unstubAllEnvs());
it("returns only after completion cleanup and does not inherit environment", async () => {
  vi.stubEnv("SOLVEFLOW_PROBE_SENTINEL", "synthetic-secret");
  expect(await runIsolatedWorker(entry, { mode: "complete" }, { signal: fresh(), timeoutMs: 2000 })).toEqual({ result: "fixture", secretInherited: false, execArgv: [] });
});
it.each(["spin", "hang", "cooperate"])("terminates %s work at the parent deadline", async mode => {
  const start = performance.now();
  await expect(runIsolatedWorker(entry, { mode }, { signal: fresh(), timeoutMs: 150, graceMs: 20 })).rejects.toThrow("RUN_TIMEOUT");
  expect(performance.now() - start).toBeLessThan(2000);
});
it.each(["crash", "oversize", "logs"])("fails closed on %s without exposing raw error or logs", async mode => {
  const code = mode === "crash" ? "WORKER_LOST" : mode === "oversize" ? "WORKER_OUTPUT_INVALID" : "WORKER_OUTPUT_LIMIT";
  await expect(runIsolatedWorker(entry, { mode }, { signal: fresh(), timeoutMs: 2000 })).rejects.toThrow(code);
});
it("explicit cancellation of an uncooperative run leaves a second worker intact", async () => {
  const controller = new AbortController();
  const task = runIsolatedWorker(entry, { mode: "spin" }, { signal: controller.signal, timeoutMs: 2000, graceMs: 0 });
  const rejected = expect(task).rejects.toThrow("CANCELLED");
  controller.abort();
  await expect(runIsolatedWorker(entry, { mode: "complete" }, { signal: fresh(), timeoutMs: 2000 })).resolves.toMatchObject({ result: "fixture" });
  await rejected;
});
it("refuses oversized inputs and invalid entry protocols before spawning", () => {
  expect(() => runIsolatedWorker(entry, { text: "x".repeat(40 * 1024) }, { signal: fresh(), timeoutMs: 1000 })).toThrow("JSON_INPUT_LIMIT");
  expect(() => runIsolatedWorker(new URL("https://example.com/worker.js"), {}, { signal: fresh(), timeoutMs: 1000 })).toThrow("INVALID_WORKER_CONFIG");
});
it('transfers complete drafts through an explicitly bounded application envelope', async () => {
  const input = { mode: 'echo', message: '文'.repeat(8000), focus: { answer: '答'.repeat(8000) } };
  expect(() => runIsolatedWorker(entry, input, { signal: fresh(), timeoutMs: 2000 })).toThrow('JSON_INPUT_LIMIT');
  expect(await runIsolatedWorker(entry, input, { signal: fresh(), timeoutMs: 2000, maxJsonBytes: 256 * 1024 })).toEqual(input);
});
it("delivers bounded diagnostic metadata separately from the final result", async () => {
  const onDiagnostic = vi.fn();
  expect(await runIsolatedWorker(entry, { mode: "diagnostic" }, { signal: fresh(), timeoutMs: 2000, onDiagnostic })).toEqual({ result: "fixture" });
  expect(onDiagnostic).toHaveBeenCalledWith(expect.objectContaining({ reason: "JSON_INVALID", fenced: true }));
});
it.each([{ invalid: true }, { flood: true }])("rejects private content or excessive diagnostic messages", async input => {
  await expect(runIsolatedWorker(entry, { mode: "diagnostic", ...input }, { signal: fresh(), timeoutMs: 2000, onDiagnostic: () => {} })).rejects.toThrow("WORKER_OUTPUT_INVALID");
});
