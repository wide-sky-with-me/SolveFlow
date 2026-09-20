import { mkdtempSync, rmSync, writeFileSync, readFileSync, symlinkSync, linkSync, chmodSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { SpendLedger, quoteMicros } from "./spend-ledger.js";

const roots: string[] = [];
const fresh = () => new AbortController().signal;
const path = () => { const root = mkdtempSync(join(tmpdir(), "solveflow-spend-")); roots.push(root); const file = join(root, "ledger.jsonl"); writeFileSync(file, "", { mode: 0o600 }); return file; };
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

it("appends an explicit budget renewal without deleting history or reusing attempt IDs", () => {
  const file = path(); const ledger = SpendLedger.open(file);
  ledger.reserve("old", "solver", 30_000_000n, fresh());
  const history = readFileSync(file, "utf8");
  ledger.renew("authorization-1");
  expect(readFileSync(file, "utf8").startsWith(history)).toBe(true);
  expect(() => ledger.renew("authorization-1")).toThrow("INVALID_RENEWAL");
  expect(() => ledger.reserve("old", "solver", 1n, fresh())).toThrow("SPEND_LIMIT_OR_DUPLICATE");
  ledger.settle("old", 1n);
  ledger.reserve("new", "solver", 2_000_000n, fresh()); ledger.close();
  expect(SpendLedger.inspect(file)).toEqual({ reservedMicros: "2000000", remainingMicros: "28000000", attempts: 2 });
});
it.each(["wrong-total", "higher-cap"])("rejects corrupt renewal %s", kind => {
  const file = path();
  writeFileSync(file, JSON.stringify({ version: 1, type: "renew", id: "authorization-1", previousMicros: kind === "wrong-total" ? "1" : "0", micros: kind === "higher-cap" ? "9007199254740992" : "30000000" }) + "\n");
  expect(() => SpendLedger.open(file)).toThrow("LEDGER_CORRUPT_OR_UNAVAILABLE");
});

it("quotes with exact integers and rounds fractional micro-RMB upward", () => {
  expect(quoteMicros(1, 0, 1n, 0n)).toBe(1n);
  expect(quoteMicros(1_000_000, 500_000, 2_000_000n, 4_000_000n, 1n)).toBe(4_000_001n);
  expect(() => quoteMicros(NaN, 0, 1n, 0n)).toThrow("INVALID_COST_QUOTE");
  expect(() => quoteMicros(1, 0, -1n, 0n)).toThrow("INVALID_COST_QUOTE");
});
it("reads a validated snapshot while the writer is open, without resetting or reserving", () => {
  const file = path(); const ledger = SpendLedger.open(file);
  try {
    ledger.reserve("a", "solver", 5_000_000n, fresh());
    expect(SpendLedger.inspect(file)).toEqual({ reservedMicros: "5000000", remainingMicros: "25000000", attempts: 1 });
    expect(ledger.snapshot().attempts).toBe(1);
    expect(existsSync(file + ".lock")).toBe(true);
    expect(() => SpendLedger.inspect(file, 4_000_000n)).toThrow("LEDGER_CORRUPT_OR_UNAVAILABLE");
  } finally { ledger.close(); }
});
it("fails closed on incomplete snapshots and never creates a missing ledger", () => {
  const file = path(); writeFileSync(file, '{"version":1');
  expect(() => SpendLedger.inspect(file)).toThrow("LEDGER_CORRUPT_OR_UNAVAILABLE");
  expect(() => SpendLedger.inspect(file + "-missing")).toThrow("LEDGER_CORRUPT_OR_UNAVAILABLE");
  expect(existsSync(file + "-missing")).toBe(false);
});
it("persists reservations across restarts, including unsettled/failed attempts", () => {
  const file = path(); const first = SpendLedger.open(file);
  first.reserve("attempt1", "solver", 2_000_000n, fresh()); first.close();
  const second = SpendLedger.open(file);
  try { expect(second.snapshot()).toEqual({ reservedMicros: "2000000", remainingMicros: "28000000", attempts: 1 }); }
  finally { second.close(); }
});
it("never refunds a reservation after settlement", () => {
  const file = path(); const ledger = SpendLedger.open(file);
  ledger.reserve("a", "verifier", 30_000_000n, fresh()); ledger.settle("a", 1n);
  expect(() => ledger.reserve("b", "solver", 1n, fresh())).toThrow("SPEND_LIMIT_OR_DUPLICATE"); ledger.close();
  const reopened = SpendLedger.open(file);
  try { expect(reopened.snapshot().remainingMicros).toBe("0"); expect(() => reopened.settle("a", 1n)).toThrow("INVALID_SETTLEMENT"); }
  finally { reopened.close(); }
});
it("rejects duplicate requests and competing writers without disturbing the owner", () => {
  const file = path(); const ledger = SpendLedger.open(file);
  try {
    expect(() => SpendLedger.open(file)).toThrow("LEDGER_LOCKED_OR_UNAVAILABLE");
    ledger.reserve("a", "solver", 1n, fresh());
    expect(() => ledger.reserve("a", "solver", 1n, fresh())).toThrow("SPEND_LIMIT_OR_DUPLICATE");
    ledger.reserve("b", "verifier", 1n, fresh());
    expect(ledger.snapshot().attempts).toBe(2);
  } finally { ledger.close(); }
});
it("rejects over-cap configuration, invalid reservations and pre-cancelled calls", () => {
  const file = path(); expect(() => SpendLedger.open(file, BigInt(Number.MAX_SAFE_INTEGER) + 1n)).toThrow("INVALID_LEDGER_CONFIG");
  const ledger = SpendLedger.open(file);
  try {
    expect(() => ledger.reserve("a", "solver", -1n, fresh())).toThrow("INVALID_RESERVATION");
    const controller = new AbortController(); controller.abort(new Error("CANCELLED"));
    expect(() => ledger.reserve("a", "solver", 1n, controller.signal)).toThrow("CANCELLED");
    expect(ledger.snapshot().attempts).toBe(0);
  } finally { ledger.close(); }
});
it.each(["partial", "unknown-field", "duplicate", "unmatched-settlement", "over-limit"])("fails closed on %s records", kind => {
  const file = path();
  const entry = { version: 1, type: "reserve", id: "a", model: "solver", micros: "1" };
  const text = kind === "partial" ? "{" : kind === "unknown-field" ? JSON.stringify({ ...entry, secret: "not-allowed" }) + "\n" : kind === "duplicate" ? (JSON.stringify(entry) + "\n").repeat(2) : kind === "unmatched-settlement" ? JSON.stringify({ version: 1, type: "settle", id: "a", micros: "1" }) + "\n" : JSON.stringify({ ...entry, micros: "30000001" }) + "\n";
  writeFileSync(file, text, { mode: 0o600 });
  expect(() => SpendLedger.open(file)).toThrow("LEDGER_CORRUPT_OR_UNAVAILABLE");
});
it.each(["symlink", "hardlink", "permissions"])("rejects unsafe ledger file %s", kind => {
  const file = path(); rmSync(file); const target = file + ".target"; writeFileSync(target, "", { mode: 0o600 });
  if (kind === "symlink") symlinkSync(target, file);
  if (kind === "hardlink") linkSync(target, file);
  if (kind === "permissions") { writeFileSync(file, "", { mode: 0o600 }); chmodSync(file, 0o644); }
  expect(() => SpendLedger.open(file)).toThrow("LEDGER_CORRUPT_OR_UNAVAILABLE");
});
it("does not automatically remove a crash-leftover lock", () => {
  const file = path(); writeFileSync(file + ".lock", "", { mode: 0o600 });
  expect(() => SpendLedger.open(file)).toThrow("LEDGER_LOCKED_OR_UNAVAILABLE");
  expect(existsSync(file + ".lock")).toBe(true);
});
it("rejects new operations after idempotent close", () => {
  const ledger = SpendLedger.open(path()); ledger.close(); ledger.close();
  expect(() => ledger.reserve("a", "solver", 1n, fresh())).toThrow("LEDGER_UNAVAILABLE");
});
it("does not silently recreate a missing ledger", () => {
  const file = path(); rmSync(file, { force: true });
  expect(() => SpendLedger.open(file)).toThrow("LEDGER_CORRUPT_OR_UNAVAILABLE");
});
it("freezes further spending and retains its lock after an underestimated bill", () => {
  const file = path(); const ledger = SpendLedger.open(file);
  ledger.reserve("a", "solver", 1n, fresh());
  expect(() => ledger.settle("a", 2n)).toThrow("INVALID_SETTLEMENT");
  try { expect(() => ledger.reserve("b", "solver", 1n, fresh())).toThrow("LEDGER_UNAVAILABLE"); }
  finally { ledger.close(); }
  expect(() => SpendLedger.open(file)).toThrow("LEDGER_LOCKED_OR_UNAVAILABLE");
});

it("accepts explicitly configured finite budgets above the historical 30 RMB default", () => {
  const file = path(); const ledger = SpendLedger.open(file, 100_000_000n);
  try { ledger.reserve("larger-budget", "solver", 35_000_000n, fresh()); expect(ledger.snapshot().remainingMicros).toBe("65000000"); }
  finally { ledger.close(); }
});
