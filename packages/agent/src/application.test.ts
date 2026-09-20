import { expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { applicationSpendStatus, runApplicationAgent, createProbeImage } from "../dist/application.js";
import { SpendLedger } from "../dist/policy/spend-ledger.js";
import { startOfflineProbeProvider, offlineModelConnections } from "../../../scripts/offline-probe-provider.mjs";
it("runs unlimited application admission and actual Pi/Verifier without reading or opening the fee ledger", async () => {
  const provider = await startOfflineProbeProvider();
  const inspect = vi.spyOn(SpendLedger, "inspect").mockImplementation(() => { throw new Error("LEDGER_MUST_NOT_BE_READ"); });
  const open = vi.spyOn(SpendLedger, "open").mockImplementation(() => { throw new Error("LEDGER_MUST_NOT_BE_OPENED"); });
  try {
    const connections = offlineModelConnections(provider.baseURL);
    expect(applicationSpendStatus({ solver: connections.solver.route, verifier: connections.verifier.route }, null)).toBeUndefined();
    const outcome = await runApplicationAgent({ schemaVersion: 1, role: "solver", identity: { ownerId: "test-owner", sessionId: "test-session", runId: randomUUID() },
      message: "offline test", image: { bytes: createProbeImage(), mimeType: "image/png" }, evidence: [] },
      { connections, capRmb: null, timeoutMs: 10000, signal: new AbortController().signal, onEvent: async () => {} });
    expect(outcome).toMatchObject({ status: "completed", verified: true });
    expect(provider.observations.requests).toBe(3);
    expect(inspect).not.toHaveBeenCalled(); expect(open).not.toHaveBeenCalled();
  } finally { inspect.mockRestore(); open.mockRestore(); await provider.close(); }
});
