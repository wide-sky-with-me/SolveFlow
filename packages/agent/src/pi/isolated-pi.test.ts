import { expect, it } from "vitest";
import { runIsolatedWorker } from "../policy/isolated-worker.js";

it("terminates an actual Pi provider after it starts ignoring cancellation", async () => {
  const controller = new AbortController();
  let entered = false;
  let cancelledAt = 0;
  const pending = runIsolatedWorker(new URL("./uncooperative-worker-fixture.mjs", import.meta.url), {}, {
    signal: controller.signal, timeoutMs: 4000, graceMs: 20,
    onStarted() { entered = true; cancelledAt = performance.now(); controller.abort(); },
  });
  await expect(pending).rejects.toThrow("CANCELLED");
  expect(entered).toBe(true);
  expect(performance.now() - cancelledAt).toBeLessThan(2000);
});
