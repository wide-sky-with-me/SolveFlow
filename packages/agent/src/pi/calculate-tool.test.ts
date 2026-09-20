import { expect, it } from "vitest";
import { createCalculateTool } from "./calculate-tool.js";
import { RunBudget } from "../policy/run-budget.js";
const fresh = () => new AbortController().signal;

it("charges failed calculation attempts and shares the business/MCP quota", async () => {
  const budget = new RunBudget(); const tool = createCalculateTool(budget);
  budget.reserveTool("search", fresh());
  for (let i = 0; i < 7; i++) {
    await expect(tool.execute("bad", { schemaVersion: 1, expression: "process.exit()" }, fresh())).rejects.toThrow("INVALID_EXPRESSION");
  }
  await expect(tool.execute("late", { schemaVersion: 1, expression: "2+2" }, fresh())).rejects.toThrow("TOOL_LIMIT");
  expect(budget.snapshot()).toMatchObject({ businessAttempts: 8, searchAttempts: 1 });
});
it("cannot expose a result after the run budget expires", async () => {
  let time = 0; const budget = new RunBudget(() => time); const tool = createCalculateTool(budget);
  time = 120_000;
  await expect(tool.execute("late", { schemaVersion: 1, expression: "2+2" }, fresh())).rejects.toThrow("RUN_TIMEOUT");
  expect(budget.snapshot().businessAttempts).toBe(0);
});
