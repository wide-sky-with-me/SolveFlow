import { MAX_SOLVER_MODEL_ATTEMPTS, MAX_VERIFIER_MODEL_ATTEMPTS } from "@solveflow/contracts/agent";

export type ToolCategory = "file" | "business" | "search";

export class BudgetExceeded extends Error {
  constructor(readonly code: "RUN_TIMEOUT" | "MODEL_LIMIT" | "TOOL_LIMIT" | "VERIFIER_LIMIT") {
    super(code);
    this.name = "BudgetExceeded";
  }
}

/** One run, no refunds: failed calls, retries and format repairs consume attempts. */
export class RunBudget {
  private readonly startedAt: number;
  private modelAttempts = 0;
  private verifierAttempts = 0;
  private fileAttempts = 0;
  private businessAttempts = 0;
  private searchAttempts = 0;
  private formatRepairUsed = false;

  constructor(private readonly now: () => number = () => performance.now()) {
    this.startedAt = now();
  }

  remainingMs(): number {
    return Math.max(0, 120_000 - (this.now() - this.startedAt));
  }

  assertActive(signal: AbortSignal): void {
    // RN's abort-controller supports aborted/events, but not throwIfAborted/reason.
    if (signal.aborted) {
      const error = new Error("CANCELLED"); error.name = "AbortError";
      throw signal.reason ?? error;
    }
    if (this.remainingMs() <= 0) throw new BudgetExceeded("RUN_TIMEOUT");
  }

  reserveModel(signal: AbortSignal): void {
    this.assertActive(signal);
    if (this.modelAttempts >= MAX_SOLVER_MODEL_ATTEMPTS) throw new BudgetExceeded("MODEL_LIMIT");
    this.modelAttempts += 1;
  }
  /** One syntax-repair opportunity across all Solver phases; dispatch still
   * passes through reserveModel and the durable fee gate separately. */
  tryReserveFormatRepair(signal: AbortSignal): boolean {
    this.assertActive(signal);
    if (this.formatRepairUsed) return false;
    this.formatRepairUsed = true;
    return true;
  }

  reserveVerifier(signal: AbortSignal): number {
    this.assertActive(signal);
    if (this.verifierAttempts >= MAX_VERIFIER_MODEL_ATTEMPTS) throw new BudgetExceeded("VERIFIER_LIMIT");
    this.verifierAttempts += 1;
    return Math.min(20_000, this.remainingMs());
  }

  /** Synchronous reservation before dispatch prevents concurrent overbooking. */
  reserveTool(category: ToolCategory, signal: AbortSignal): number {
    this.assertActive(signal);
    if (this.fileAttempts + this.businessAttempts >= 16
      || (category === "file" && this.fileAttempts >= 8)
      || (category !== "file" && this.businessAttempts >= 8)
      || (category === "search" && this.searchAttempts >= 2)) {
      throw new BudgetExceeded("TOOL_LIMIT");
    }
    if (category === "file") this.fileAttempts += 1;
    else this.businessAttempts += 1;
    if (category === "search") this.searchAttempts += 1;
    return Math.min(category === "file" ? 2_000 : 10_000, this.remainingMs());
  }

  snapshot() {
    return Object.freeze({
      modelAttempts: this.modelAttempts,
      verifierAttempts: this.verifierAttempts,
      fileAttempts: this.fileAttempts,
      businessAttempts: this.businessAttempts,
      searchAttempts: this.searchAttempts,
    });
  }
}
