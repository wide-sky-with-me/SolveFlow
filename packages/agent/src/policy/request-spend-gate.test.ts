import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { expect, it } from "vitest";
import { SpendLedger } from "./spend-ledger.js";
import { createRequestSpendGate } from "./request-spend-gate.js";
it("freezes quote and model binding, denies substitution and repeated attempt IDs", () => {
  const root = mkdtempSync(join(tmpdir(), "gate-probe-")); const file = join(root, "ledger"); writeFileSync(file, "", { mode: 0o600 });
  const ledger = SpendLedger.open(file); const signal = new AbortController().signal;
  try {
    const config = { modelId: "fixed", attemptPrefix: "run-solver", maximumMicros: 30_000_000n };
    const gate = createRequestSpendGate(ledger, config);
    config.modelId = "fallback"; config.maximumMicros = 0n;
    expect(() => gate("fallback", signal)).toThrow("SPEND_MODEL_MISMATCH");
    gate("fixed", signal); expect(ledger.snapshot().remainingMicros).toBe("0");
    expect(() => gate("fixed", signal)).toThrow("SPEND_LIMIT_OR_DUPLICATE");
    const duplicate = createRequestSpendGate(ledger, { modelId: "fixed", attemptPrefix: "run-solver", maximumMicros: 0n });
    expect(() => duplicate("fixed", signal)).toThrow("SPEND_LIMIT_OR_DUPLICATE");
  } finally { ledger.close(); rmSync(root, { recursive: true, force: true }); }
});
