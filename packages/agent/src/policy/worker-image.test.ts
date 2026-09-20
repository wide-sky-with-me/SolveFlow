import { expect, it } from "vitest";
import { runIsolatedWorker } from "./isolated-worker.js";
const entry = new URL("./image-worker-fixture.mjs", import.meta.url);
const options = () => ({ signal: new AbortController().signal, timeoutMs: 2000 });
it("transfers an independent bounded view without detaching the caller buffer", async () => {
  const source = Buffer.from([99, 17, 18, 88]); const image = source.subarray(1, 3);
  const pending = runIsolatedWorker(entry, { mimeType: "image/png" }, { ...options(), image });
  image.fill(0);
  expect(await pending).toEqual({ length: 2, first: 17, last: 18, metadata: { mimeType: "image/png" } });
  expect(source.byteLength).toBe(4); expect(source[0]).toBe(99); expect(source[3]).toBe(88);
});
it("admits the exact 4MiB limit outside the metadata JSON quota", async () => {
  const image = new Uint8Array(4 * 1024 * 1024); image[0] = 11;
  await expect(runIsolatedWorker(entry, {}, { ...options(), image })).resolves.toMatchObject({ length: image.length, first: 11 });
});
it.each([new Uint8Array(), new Uint8Array(4 * 1024 * 1024 + 1), new Uint8Array(new SharedArrayBuffer(1))])("rejects empty, oversized or shared images before spawning", image => {
  expect(() => runIsolatedWorker(entry, {}, { ...options(), image })).toThrow("INVALID_WORKER_IMAGE");
});
