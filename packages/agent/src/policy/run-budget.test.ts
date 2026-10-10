import { describe, expect, it } from "vitest";
import { RunBudget } from "./run-budget.js";

const signal = () => new AbortController().signal;

describe("run budget reservations", () => {
  it("allows unlimited cumulative device time while keeping attempts, tools and cancellation bounded", () => {
    let now = 0; const budget = new RunBudget(() => now, null);
    now = 24 * 60 * 60 * 1000;
    expect(budget.remainingMs()).toBe(Infinity);
    expect(budget.reserveTool('file', signal())).toBe(2000);
    expect(budget.reserveVerifier(signal())).toBe(20000);
    budget.reserveVerifier(signal()); budget.reserveVerifier(signal()); budget.reserveVerifier(signal());
    expect(() => budget.reserveVerifier(signal())).toThrow('VERIFIER_LIMIT');
    for (let i = 0; i < 16; i++) budget.reserveModel(signal());
    expect(() => budget.reserveModel(signal())).toThrow('MODEL_LIMIT');
    const controller = new AbortController(); controller.abort();
    expect(() => budget.reserveTool('file', controller.signal)).toThrow();
  });
  it("counts failed/retried model attempts without refunds", () => {
    const budget = new RunBudget();
    for (let i = 0; i < 16; i++) budget.reserveModel(signal());
    expect(() => budget.reserveModel(signal())).toThrow("MODEL_LIMIT");
    expect(budget.snapshot().modelAttempts).toBe(16);
  });

  it("enforces both tool buckets and total attempts", () => {
    const budget = new RunBudget();
    for (let i = 0; i < 8; i++) budget.reserveTool("file", signal());
    expect(() => budget.reserveTool("file", signal())).toThrow("TOOL_LIMIT");
    for (let i = 0; i < 8; i++) budget.reserveTool("business", signal());
    expect(() => budget.reserveTool("business", signal())).toThrow("TOOL_LIMIT");
    expect(budget.snapshot()).toMatchObject({ fileAttempts: 8, businessAttempts: 8 });
  });

  it("counts all search aliases against one shared quota", () => {
    const budget = new RunBudget();
    budget.reserveTool("search", signal());
    budget.reserveTool("search", signal());
    expect(() => budget.reserveTool("search", signal())).toThrow("TOOL_LIMIT");
    expect(budget.snapshot()).toMatchObject({ businessAttempts: 2, searchAttempts: 2 });
  });

  it("caps tools and verifier by the remaining wall clock", () => {
    let now = 0;
    const budget = new RunBudget(() => now);
    expect(budget.reserveTool("file", signal())).toBe(2_000);
    now = 179_500;
    expect(budget.reserveTool("business", signal())).toBe(500);
    expect(budget.reserveVerifier(signal())).toBe(500);
    now = 180_000;
    expect(() => budget.reserveModel(signal())).toThrow("RUN_TIMEOUT");
    expect(() => budget.reserveTool("file", signal())).toThrow("RUN_TIMEOUT");
    expect(() => budget.reserveVerifier(signal())).toThrow("RUN_TIMEOUT");
  });

  it("limits the initial check and corrected-answer recheck to four total attempts", () => {
    const budget = new RunBudget(() => 0);
    expect(budget.reserveVerifier(signal())).toBe(20_000);
    budget.reserveVerifier(signal()); budget.reserveVerifier(signal()); budget.reserveVerifier(signal());
    expect(() => budget.reserveVerifier(signal())).toThrow("VERIFIER_LIMIT");
  });

  it("rejects cancelled dispatch without consuming attempts", () => {
    const controller = new AbortController();
    controller.abort(new Error("CANCELLED"));
    const budget = new RunBudget();
    expect(() => budget.reserveModel(controller.signal)).toThrow("CANCELLED");
    expect(() => budget.reserveTool("file", controller.signal)).toThrow("CANCELLED");
    expect(() => budget.reserveVerifier(controller.signal)).toThrow("CANCELLED");
    expect(budget.snapshot().modelAttempts).toBe(0);
  });

  it("rejects native cancellation without reason or throwIfAborted", () => {
    const controller = new AbortController();
    Object.defineProperties(controller.signal, { reason: { value: undefined }, throwIfAborted: { value: undefined } });
    const budget = new RunBudget();
    expect(() => budget.assertActive(controller.signal)).not.toThrow();
    controller.abort();
    expect(() => budget.reserveModel(controller.signal)).toThrow("CANCELLED");
    expect(() => budget.reserveTool("file", controller.signal)).toThrow("CANCELLED");
    expect(() => budget.reserveVerifier(controller.signal)).toThrow("CANCELLED");
    expect(budget.snapshot()).toMatchObject({ modelAttempts: 0, verifierAttempts: 0, fileAttempts: 0 });
  });
});
