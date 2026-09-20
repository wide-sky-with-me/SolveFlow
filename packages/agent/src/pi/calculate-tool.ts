import { z } from "zod";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { CalculationInputSchema } from "@solveflow/contracts/calculation";
import { calculate } from "../tools/calculate.js";
import { RunBudget } from "../policy/run-budget.js";

export function createCalculateTool(budget: RunBudget) {
  return {
    name: "calculate", label: "数值计算",
    description: "受限数值计算：+ - * / **、sin/cos/tan/sqrt/abs/log/exp、常数 pi/e。angleUnit 默认 rad，可设 deg；log 为自然对数。不支持变量、单位换算或代码。近似值不是符号证明。",
    parameters: z.toJSONSchema(CalculationInputSchema, { io: "input" }),
    async execute(_id, input, signal) {
      const active = signal ?? new AbortController().signal;
      budget.reserveTool("business", active);
      const result = calculate(input, active);
      budget.assertActive(active);
      return { content: [{ type: "text", text: JSON.stringify(result) }], details: undefined };
    },
  } satisfies ToolDefinition;
}
