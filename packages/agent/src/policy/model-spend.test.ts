import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { expect, it } from "vitest";
import { ModelRouteSchema } from "@solveflow/contracts/model";
import { SpendLedger } from "./spend-ledger.js";
import { quoteModelRequest, modelAuthorizationId, createModelSpendGate } from "./model-spend.js";
const route = () => ModelRouteSchema.parse({ schemaVersion: 1, provider: "example", api: "openai-completions", model: "namespace/model:v1", baseURL: "https://example.test/v1", contextWindow: 10000, maxOutputTokens: 2000, requestMaxTokens: 100, inputRmbPerMillionTokens: 1, outputRmbPerMillionTokens: 2, supportsImages: true, supportsTools: true, compat: {} });
it("quotes configured full capacities and optional fees without inherited price floors", () => {
  expect(quoteModelRequest(route())).toBe(14000n);
  expect(quoteModelRequest({ ...route(), requestFeeRmb: 0.1 })).toBe(114000n);
  expect(quoteModelRequest({ ...route(), inputRmbPerMillionTokens: 0, outputRmbPerMillionTokens: 0 })).toBe(0n);
});
it("binds approval to role, provider, endpoint, model and pricing metadata", () => {
  const original = route(); const id = modelAuthorizationId("solver", original);
  for (const changed of [{ ...original, provider: "different" }, { ...original, baseURL: "https://other.test/v1" }, { ...original, model: "different/model" }, { ...original, outputRmbPerMillionTokens: 3 }]) expect(modelAuthorizationId("solver", changed)).not.toBe(id);
  expect(modelAuthorizationId("verifier", original)).not.toBe(id);
});
it("uses a request output ceiling only when explicitly reviewed in the route", () => {
  const limited = ModelRouteSchema.parse({ ...route(), outputBudgetMode: "request-limit" });
  expect(quoteModelRequest(limited)).toBe(10200n);
  expect(quoteModelRequest({ ...limited, requestMaxTokens: 500 })).toBe(11000n);
  expect(quoteModelRequest(route())).toBe(14000n);
  expect(modelAuthorizationId("solver", limited)).not.toBe(modelAuthorizationId("solver", route()));
});
it("preserves previous journal spending and refuses an unfunded minimum before new dispatch", () => {
  const directory = mkdtempSync(join(tmpdir(), "solveflow-model-budget-")); const file = join(directory, "ledger");
  writeFileSync(file, JSON.stringify({ version: 1, type: "reserve", id: "previous-run", model: "historical-model", micros: "29990000" }) + "\n", { mode: 0o600 });
  const ledger = SpendLedger.open(file);
  try {
    expect(() => createModelSpendGate(ledger, { solver: route(), verifier: route() }, "next-run")).toThrow("SPEND_LIMIT");
    expect(ledger.snapshot()).toEqual({ reservedMicros: "29990000", remainingMicros: "10000", attempts: 1 });
  } finally { ledger.close(); rmSync(directory, { recursive: true, force: true }); }
});
it("keeps enough remaining capacity for the independent verifier before another solver call", () => {
  const directory = mkdtempSync(join(tmpdir(), "solveflow-verifier-budget-")); const file = join(directory, "ledger");
  writeFileSync(file, "", { mode: 0o600 }); const ledger = SpendLedger.open(file, 28000n);
  try {
    const selected = route(); const signal = new AbortController().signal;
    const gate = createModelSpendGate(ledger, { solver: selected, verifier: selected }, "run");
    gate(modelAuthorizationId("solver", selected), signal);
    expect(() => gate(modelAuthorizationId("solver", selected), signal)).toThrow("SPEND_LIMIT");
    expect(ledger.snapshot().attempts).toBe(1);
    gate(modelAuthorizationId("verifier", selected), signal);
    expect(ledger.snapshot().remainingMicros).toBe("0");
  } finally { ledger.close(); rmSync(directory, { recursive: true, force: true }); }
});
it("unlimited spending still binds model routes, cancellation and maximum request count", () => {
  const selected = route(); const gate = createModelSpendGate(null, { solver: selected, verifier: selected }, "unlimited");
  const signal = new AbortController().signal;
  expect(() => gate("unknown-route", signal)).toThrow("MODEL_DISPATCH_DENIED");
  const cancelled = new AbortController(); cancelled.abort(new Error("CANCELLED"));
  expect(() => gate(modelAuthorizationId("solver", selected), cancelled.signal)).toThrow("CANCELLED");
  for (let i = 0; i < 20; i++) gate(modelAuthorizationId(i < 16 ? "solver" : "verifier", selected), signal);
  expect(() => gate(modelAuthorizationId("solver", selected), signal)).toThrow("MODEL_DISPATCH_DENIED");
});

it("finite spending permits sixteen solver requests and four verifier requests only", () => {
  const directory = mkdtempSync(join(tmpdir(), "solveflow-round-budget-"));
  const file = join(directory, "ledger"); writeFileSync(file, "", { mode: 0o600 });
  const ledger = SpendLedger.open(file);
  try {
    const selected = route(); const signal = new AbortController().signal;
    const gate = createModelSpendGate(ledger, { solver: selected, verifier: selected }, "extended");
    for (let i = 0; i < 20; i++) gate(modelAuthorizationId(i < 16 ? "solver" : "verifier", selected), signal);
    expect(ledger.snapshot().attempts).toBe(20);
    expect(() => gate(modelAuthorizationId("solver", selected), signal)).toThrow("MODEL_DISPATCH_DENIED");
    expect(ledger.snapshot().attempts).toBe(20);
  } finally { ledger.close(); rmSync(directory, { recursive: true, force: true }); }
});
