import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { SpendLedger } from "./spend-ledger.js";
import { RunBudget } from "./run-budget.js";
import { createRunSpendAuthority } from "./run-spend-authority.js";
const fresh = () => new AbortController().signal;
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "run-spend-")); const path = join(root, "ledger"); writeFileSync(path, "", { mode: 0o600 });
  const ledger = SpendLedger.open(path);
  return { ledger, close() { ledger.close(); rmSync(root, { recursive: true, force: true }); } };
}
it("shares solver and verifier caps across separately constructed phase authorities", () => {
  const f = fixture(); const budget = new RunBudget();
  try {
    for (const role of ["solver", "verifier"] as const) {
      const perPhase = role === "solver" ? 8 : 1;
      for (const phase of ["initial", "revision"]) {
        const authorize = createRunSpendAuthority(f.ledger, budget, { role, modelId: role, attemptPrefix: role + "-" + phase, maximumMicros: 1_000_000n });
        for (let i = 0; i < perPhase; i += 1) authorize(role, fresh());
      }
      const excess = createRunSpendAuthority(f.ledger, budget, { role, modelId: role, attemptPrefix: role + "-extra", maximumMicros: 1_000_000n });
      expect(() => excess(role, fresh())).toThrow(role === "solver" ? "MODEL_LIMIT" : "VERIFIER_LIMIT");
    }
    expect(budget.snapshot()).toMatchObject({ modelAttempts: 16, verifierAttempts: 2 });
    expect(f.ledger.snapshot().reservedMicros).toBe("18000000");
  } finally { f.close(); }
});
it("freezes role/model and retains attempts when durable fee reservation fails", () => {
  const f = fixture(); const budget = new RunBudget();
  try {
    const options: { role: "solver" | "verifier"; modelId: string; attemptPrefix: string; maximumMicros: bigint } = { role: "solver", modelId: "fixed", attemptPrefix: "phase", maximumMicros: 30_000_000n };
    const authorize = createRunSpendAuthority(f.ledger, budget, options);
    options.role = "verifier"; options.modelId = "other"; options.maximumMicros = 0n;
    expect(() => authorize("other", fresh())).toThrow("SPEND_MODEL_MISMATCH");
    authorize("fixed", fresh());
    expect(() => authorize("fixed", fresh())).toThrow();
    expect(budget.snapshot()).toMatchObject({ modelAttempts: 2, verifierAttempts: 0 });
    expect(f.ledger.snapshot().reservedMicros).toBe("30000000");
  } finally { f.close(); }
});
it("denies expired parent run before persistent spending", () => {
  const f = fixture(); let now = 0; const budget = new RunBudget(() => now);
  try {
    const authorize = createRunSpendAuthority(f.ledger, budget, { role: "solver", modelId: "fixed", attemptPrefix: "phase", maximumMicros: 1n });
    now = 120_001;
    expect(() => authorize("fixed", fresh())).toThrow("RUN_TIMEOUT");
    expect(f.ledger.snapshot().reservedMicros).toBe("0");
  } finally { f.close(); }
});
