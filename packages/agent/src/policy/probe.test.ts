import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, rm, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inflateSync } from "node:zlib";
import { expect, it } from "vitest";
import { z } from "zod";
import { initializeLedger } from "./initialize-ledger.js";
import { createProbeImage } from "./probe-image.js";

it("runs the compiled SDK/worker/image/read/calculate/Solver/Verifier path without live credentials", async () => {
  const { stdout, stderr } = await promisify(execFile)(process.execPath, ["scripts/probe.mjs"], { cwd: new URL("../../../../", import.meta.url), env: {}, timeout: 20_000 });
  expect(stderr).toBe("");
  const report = z.object({ mode: z.literal("offline"), passed: z.literal(true), verified: z.literal(true), reservations: z.literal(3), readCompleted: z.literal(1),
    budget: z.object({ modelAttempts: z.literal(2), verifierAttempts: z.literal(1), fileAttempts: z.literal(1), businessAttempts: z.literal(1) }),
    protocol: z.object({ requests: z.literal(3), images: z.literal(3), verifierWithoutTools: z.literal(1), calculations: z.literal(1) }) }).parse(JSON.parse(stdout));
  expect(report.passed).toBe(true);
}, 25_000);
it("live CLI fails closed before constructing a worker with missing config", async () => {
  try {
    await promisify(execFile)(process.execPath, ["scripts/probe.mjs", "--live"], { cwd: new URL("../../../../", import.meta.url), env: {}, timeout: 5000 });
    expect.fail("must reject");
  } catch (error) {
    const result = z.object({ code: z.literal(1), stdout: z.literal(""), stderr: z.string() }).parse(error);
    expect(JSON.parse(result.stderr)).toMatchObject({ code: "LIVE_CALLS_NOT_AUTHORIZED", reasons: expect.arrayContaining(["MISSING_LLM_API_KEY", "LIVE_CALLS_DISABLED"]) });
  }
});
it("initialization is exclusive and a missing ledger cannot reset spending", async () => {
  const root = await mkdtemp(join(tmpdir(), "solveflow-init-test-")); const path = join(root, "journal");
  try {
    initializeLedger(path);
    expect((await stat(path)).mode & 0o777).toBe(0o600);
    expect(await readFile(path, "utf8")).toBe("");
    expect(() => initializeLedger(path)).toThrow();
    await rm(path);
    expect(() => initializeLedger(path)).toThrow();
  } finally { await rm(root, { recursive: true, force: true }); }
});
it("generates a valid bounded PNG containing black and white pixels and no metadata", () => {
  const image = Buffer.from(createProbeImage());
  expect(image.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  const types: string[] = []; let raw: Buffer | undefined;
  for (let offset = 8; offset < image.length;) {
    const size = image.readUInt32BE(offset); const type = image.toString("ascii", offset + 4, offset + 8); types.push(type);
    if (type === "IDAT") raw = inflateSync(image.subarray(offset + 8, offset + 8 + size));
    offset += size + 12;
  }
  expect(types).toEqual(["IHDR", "IDAT", "IEND"]);
  expect(raw?.length).toBe((528 * 3 + 1) * 104);
  expect(raw?.includes(255)).toBe(true); expect(raw?.includes(0)).toBe(true);
});
