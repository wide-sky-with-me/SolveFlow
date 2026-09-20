import { constants, openSync, closeSync, readFileSync, writeSync, fsyncSync, fstatSync, unlinkSync } from "node:fs";
import { isAbsolute, dirname } from "node:path";
import { z } from "zod";

const MAX_MICROS = 30_000_000n;
const MAX_ALLOWED_MICROS = BigInt(Number.MAX_SAFE_INTEGER);
const MAX_BYTES = 1024 * 1024;
const micros = z.string().regex(/^(0|[1-9][0-9]{0,15})$/);
const token = z.string().min(1).max(128).regex(/^[A-Za-z0-9][A-Za-z0-9_.-]*$/);
const reservation = z.strictObject({ version: z.literal(1), type: z.literal("reserve"), id: token, model: token, micros });
const settlement = z.strictObject({ version: z.literal(1), type: z.literal("settle"), id: token, micros });
const renewal = z.strictObject({ version: z.literal(1), type: z.literal("renew"), id: token, previousMicros: micros, micros });
const record = z.discriminatedUnion("type", [reservation, settlement, renewal]);
type RecordEntry = z.infer<typeof record>;
function readJournal(fd: number): string[] {
  const stat = fstatSync(fd);
  if (!stat.isFile() || stat.nlink !== 1 || stat.size > MAX_BYTES || (stat.mode & 0o077) !== 0) throw new Error("INVALID_LEDGER_FILE");
  const text = readFileSync(fd, "utf8");
  if (text && !text.endsWith("\n")) throw new Error("LEDGER_CORRUPT");
  return text.split("\n").filter(Boolean);
}

/** Exact, conservatively rounded quote. Rates use micro-RMB per million tokens.
 * Caller must include all billable tokens/fees and use reviewed upper bounds. */
export function quoteMicros(inputTokens: number, outputTokens: number, inputRate: bigint, outputRate: bigint, extraFees = 0n): bigint {
  if (![inputTokens, outputTokens].every(n => Number.isSafeInteger(n) && n >= 0) || inputRate < 0n || outputRate < 0n || extraFees < 0n) throw new Error("INVALID_COST_QUOTE");
  return (BigInt(inputTokens) * inputRate + BigInt(outputTokens) * outputRate + 999_999n) / 1_000_000n + extraFees;
}

/** Local M0 single-writer journal, not the M1 database. Root/ancestors must be
 * administrator-owned, not concurrently writable by untrusted actors. Lock files
 * left by crashes require manual reconciliation, never automatic reset. Reservations
 * are never refunded: even confirmed lower bills do not reopen spending capacity.
 * A provider-side hard quota remains necessary; estimates cannot cap remote billing. */
export class SpendLedger {
  readonly #fd: number;
  readonly #lockFd: number;
  readonly #path: string;
  readonly #cap: bigint;
  readonly #entries = new Map<string, { reserved: bigint; actual?: bigint }>();
  readonly #renewals = new Set<string>();
  #total = 0n;
  #closed = false;
  #poisoned = false;
  private constructor(path: string, fd: number, lockFd: number, cap: bigint) {
    this.#path = path; this.#fd = fd; this.#lockFd = lockFd; this.#cap = cap;
  }
  /** Read-only admission snapshot. A concurrent incomplete append fails closed;
   * only reserve under the exclusive writer lock grants dispatch permission. */
  static inspect(path: string, cap = MAX_MICROS) {
    if (!isAbsolute(path) || cap <= 0n || cap > MAX_ALLOWED_MICROS) throw new Error("INVALID_LEDGER_CONFIG");
    let fd: number | undefined;
    try {
      fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
      const replay = new SpendLedger(path, fd, -1, cap);
      for (const line of readJournal(fd)) replay.#apply(record.parse(JSON.parse(line)));
      return replay.snapshot();
    } catch { throw new Error("LEDGER_CORRUPT_OR_UNAVAILABLE"); }
    finally { if (fd !== undefined) closeSync(fd); }
  }
  static open(path: string, cap = MAX_MICROS): SpendLedger {
    if (!isAbsolute(path) || cap <= 0n || cap > MAX_ALLOWED_MICROS) throw new Error("INVALID_LEDGER_CONFIG");
    let lockFd: number;
    try { lockFd = openSync(path + ".lock", constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600); }
    catch { throw new Error("LEDGER_LOCKED_OR_UNAVAILABLE"); }
    let fd: number | undefined;
    try {
      fd = openSync(path, constants.O_RDWR | constants.O_APPEND | constants.O_NOFOLLOW);
      const ledger = new SpendLedger(path, fd, lockFd, cap);
      for (const line of readJournal(fd)) ledger.#apply(record.parse(JSON.parse(line)));
      // Persist file and directory metadata before granting reservations.
      fsyncSync(fd);
      const directoryFd = openSync(dirname(path), constants.O_RDONLY);
      try { fsyncSync(directoryFd); } finally { closeSync(directoryFd); }
      return ledger;
    } catch {
      if (fd !== undefined) closeSync(fd);
      closeSync(lockFd); unlinkSync(path + ".lock");
      throw new Error("LEDGER_CORRUPT_OR_UNAVAILABLE");
    }
  }
  #apply(entry: RecordEntry): void {
    const amount = BigInt(entry.micros);
    if (entry.type === "reserve") {
      if (this.#entries.has(entry.id) || this.#total + amount > this.#cap) throw new Error("SPEND_LIMIT_OR_DUPLICATE");
      this.#entries.set(entry.id, { reserved: amount }); this.#total += amount;
    } else if (entry.type === "renew") {
      if (this.#renewals.has(entry.id) || BigInt(entry.previousMicros) !== this.#total || amount <= 0n || amount > MAX_ALLOWED_MICROS) throw new Error("INVALID_RENEWAL");
      this.#renewals.add(entry.id); this.#total = 0n;
    } else {
      const found = this.#entries.get(entry.id);
      if (found && amount > found.reserved) this.#poisoned = true;
      if (!found || found.actual !== undefined || amount > found.reserved) throw new Error("INVALID_SETTLEMENT");
      found.actual = amount;
    }
  }
  #append(entry: RecordEntry): void {
    if (this.#closed || this.#poisoned) throw new Error("LEDGER_UNAVAILABLE");
    const bytes = Buffer.from(JSON.stringify(entry) + "\n");
    if (fstatSync(this.#fd).size + bytes.length > MAX_BYTES) throw new Error("LEDGER_FULL");
    // Apply first to reject invalid transitions. A failed durable write poisons the
    // instance, so no caller can dispatch using an unpersisted reservation.
    this.#apply(entry);
    try {
      let offset = 0;
      while (offset < bytes.length) {
        const written = writeSync(this.#fd, bytes, offset, bytes.length - offset);
        if (!written) throw new Error("SHORT_WRITE");
        offset += written;
      }
      fsyncSync(this.#fd);
    } catch { this.#poisoned = true; throw new Error("LEDGER_WRITE_FAILED"); }
  }
  reserve(id: string, model: string, amount: bigint, signal: AbortSignal): void {
    signal.throwIfAborted();
    const parsed = reservation.safeParse({ version: 1, type: "reserve", id, model, micros: amount.toString() });
    if (!parsed.success) throw new Error("INVALID_RESERVATION");
    this.#append(parsed.data);
  }
  settle(id: string, actual: bigint): void {
    const parsed = settlement.safeParse({ version: 1, type: "settle", id, micros: actual.toString() });
    if (!parsed.success) throw new Error("INVALID_SETTLEMENT");
    this.#append(parsed.data);
  }
  /** Administrator CLI only, after explicit authorization of a new budget.
   * Never called by admission, the worker, a model or a student HTTP request. */
  renew(authorizationId: string): void {
    const parsed = renewal.safeParse({ version: 1, type: "renew", id: authorizationId, previousMicros: this.#total.toString(), micros: this.#cap.toString() });
    if (!parsed.success) throw new Error("INVALID_RENEWAL");
    this.#append(parsed.data);
  }
  snapshot() { return Object.freeze({ reservedMicros: this.#total.toString(), remainingMicros: (this.#cap - this.#total).toString(), attempts: this.#entries.size }); }
  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    try { closeSync(this.#fd); } finally { try { closeSync(this.#lockFd); } finally { if (!this.#poisoned) unlinkSync(this.#path + ".lock"); } }
  }
}
