import { z } from "zod";
import { IdentifierSchema } from "@solveflow/contracts/agent";
export const PhaseDiagnosticSchema = z.strictObject({
  schemaVersion: z.literal(1), event: z.literal("MODEL_OUTPUT_REJECTED"), runId: IdentifierSchema, role: z.enum(["solver", "verifier"]),
  reason: z.enum(["INCOMPLETE_RESPONSE", "OUTPUT_SIZE_LIMIT", "JSON_INVALID", "SCHEMA_INVALID"]),
  stopReason: z.enum(["stop", "length", "toolUse", "error", "aborted", "missing"]).optional(),
  bytes: z.number().int().min(0).max(32768).optional(), fenced: z.boolean().optional(), empty: z.boolean().optional(), semanticCheckFailed: z.boolean().optional(),
  issues: z.array(z.strictObject({ code: z.enum(["invalid_type", "too_big", "too_small", "invalid_format", "not_multiple_of", "unrecognized_keys", "invalid_union", "invalid_key", "invalid_element", "invalid_value", "custom"]),
    path: z.string().max(300).regex(/^(?:(?:schemaVersion|kind|problem|text|subject|uncertainties|answer|steps|id|title|explanation|latex|knowledgePoints|citationIds|clarificationQuestions|figures|xRange|yRange|elements|coefficients|checked|verdict|issues|item|field)(?:\.|$))*$/) })).max(8).optional(),
});
export type PhaseDiagnostic = z.infer<typeof PhaseDiagnosticSchema>;
