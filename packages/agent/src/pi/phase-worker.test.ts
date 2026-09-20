import { expect, it } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SpendLedger } from "../policy/spend-ledger.js";
import { createRequestSpendGate } from "../policy/request-spend-gate.js";
import { runIsolatedWorker } from "../policy/isolated-worker.js";
const candidate = { schemaVersion: 1, kind: "answer", problem: { text: "fixture only", subject: "math", uncertainties: [] }, answer: "fixture", steps: [], knowledgePoints: [], citationIds: [], clarificationQuestions: [] };
it.each(["solver", "verifier"])("runs compiled %s phase inside supervised worker with original image", async role => {
  const output = role === "solver" ? candidate : { schemaVersion: 1, verdict: "pass", checked: ["arithmetic"], issues: [] };
  const phase = { schemaVersion: 1, role, identity: { ownerId: "a", sessionId: "s", runId: "r" }, message: "offline", evidence: [], ...(role === "verifier" ? { candidate } : {}) };
  const root = mkdtempSync(join(tmpdir(), "worker-spend-")); const file = join(root, "ledger"); writeFileSync(file, "", { mode: 0o600 });
  const ledger = SpendLedger.open(file);
  try {
    const authorizeModel = createRequestSpendGate(ledger, { modelId: "offline", attemptPrefix: role, maximumMicros: 1_000_000n });
    const result = await runIsolatedWorker(new URL("./phase-worker-fixture.mjs", import.meta.url), { phase, output }, { image: new Uint8Array(100 * 1024).fill(17), signal: new AbortController().signal, timeoutMs: 4000, authorizeModel });
    expect(result).toMatchObject({ role, ...(role === "solver" ? { candidate } : { verification: output }) });
    expect(JSON.stringify(result)).not.toMatch(/bytes|base64|mimeType|thinking/);
    expect(ledger.snapshot().reservedMicros).toBe("1000000");
  } finally { ledger.close(); rmSync(root, { recursive: true, force: true }); }
});
