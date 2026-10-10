import { z } from "zod";
/** Reference a persisted answer version; the API resolves content and ownership. */
export const RunContextSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("knowledge"), sourceRunId: z.uuid(), name: z.string().trim().min(1).max(120), number: z.number().int().min(1).max(999).optional() }),
  z.strictObject({ kind: z.literal("knowledge-list"), sourceRunId: z.uuid(), number: z.number().int().min(1).max(999).optional() }),
  z.strictObject({ kind: z.literal("verification"), sourceRunId: z.uuid(), number: z.number().int().min(1).max(999).optional() }),
  z.strictObject({ kind: z.literal("explanation"), sourceRunId: z.uuid(), number: z.number().int().min(1).max(999).optional() }),
  z.strictObject({ kind: z.literal("regenerate"), sourceRunId: z.uuid(), number: z.number().int().min(1).max(999).optional(), useBackup: z.literal(true).optional() }),
  z.strictObject({ kind: z.literal("reply"), sourceRunId: z.uuid() }),
  z.strictObject({ kind: z.literal("step"), sourceRunId: z.uuid(), stepId: z.string().min(1).max(128).regex(/^[A-Za-z0-9][A-Za-z0-9_-]*$/) }),
  z.strictObject({ kind: z.literal("question"), sourceRunId: z.uuid(), number: z.number().int().min(1).max(999) }),
  z.strictObject({ kind: z.literal("correction"), sourceRunId: z.uuid(), text: z.string().trim().min(1).max(2000), number: z.number().int().min(1).max(999).optional() }),
]);
export type RunContext = z.infer<typeof RunContextSchema>;
/** On-demand requests that render beside a conversation instead of adding an answer version. */
export const AUXILIARY_CONTEXT_KINDS: ReadonlySet<RunContext["kind"]> = new Set(["explanation", "verification", "knowledge-list"]);
export function isAuxiliaryContext(kind: RunContext["kind"] | undefined): boolean {
  return kind !== undefined && AUXILIARY_CONTEXT_KINDS.has(kind);
}
