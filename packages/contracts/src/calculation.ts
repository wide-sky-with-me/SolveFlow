import { z } from "zod";

export const CalculationInputSchema = z.strictObject({
  schemaVersion: z.literal(1),
  expression: z.string().min(1).max(512),
  angleUnit: z.enum(["rad", "deg"]).default("rad"),
});
export type CalculationInput = z.infer<typeof CalculationInputSchema>;
export const CalculationResultSchema = z.strictObject({
  schemaVersion: z.literal(1),
  value: z.string().min(1).max(128),
  approximate: z.boolean(),
  precision: z.number().int().min(1).max(16),
  warnings: z.array(z.string().max(256)).max(4),
});
export type CalculationResult = z.infer<typeof CalculationResultSchema>;
