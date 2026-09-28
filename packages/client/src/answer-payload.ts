import { z } from 'zod';
import { AgentErrorCodeSchema, SolveOutcomeSchema } from '@solveflow/contracts/agent';
import { LocalRecordSchema } from '@solveflow/contracts/local';
export const AnswerDocumentPayloadSchema = z.strictObject({
  schemaVersion: z.literal(1), outcome: SolveOutcomeSchema, image: LocalRecordSchema.shape.image.nullable(),
  width: z.number().int().positive().max(20000), height: z.number().int().positive().max(20000),
  explanation: z.strictObject({ runId: z.uuid(), verificationPending: z.boolean().optional(), outcome: SolveOutcomeSchema.nullable() }).optional(),
  knowledge: z.strictObject({ runId: z.uuid(), outcome: SolveOutcomeSchema.nullable() }).optional(),
  runId: z.string().min(1).max(128), number: z.number().int().min(1).max(999).nullable(), disabled: z.boolean(), showRegenerate: z.boolean().optional(), showHistory: z.boolean().optional(), verificationPending: z.boolean().optional(), verificationFailed: z.boolean().optional(), verificationErrorCode: AgentErrorCodeSchema.optional(),
});
export type AnswerDocumentPayload = z.infer<typeof AnswerDocumentPayloadSchema>;
/** Android's WebView injects initial props inside a JS template literal. Only a
 * percent-encoded JSON string crosses that boundary; no raw model text does. */
export function encodeAnswerDocument(value: AnswerDocumentPayload): string {
  return encodeURIComponent(JSON.stringify(AnswerDocumentPayloadSchema.parse(value)));
}
export function decodeAnswerDocument(value: unknown): AnswerDocumentPayload {
  const encoded = z.string().max(18_000_000).parse(value);
  return AnswerDocumentPayloadSchema.parse(JSON.parse(decodeURIComponent(encoded)));
}
