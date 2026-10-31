import { z } from 'zod';
import { ExamTypeSchema } from './exam.js';
import { PublicAgentEventSchema, SolveOutcomeSchema } from './agent.js';

/** Public photo service accepts only a single image and an exam, never model configuration. */
export const PHOTO_IMAGE_BYTES = 4 * 1024 * 1024;
export const PHOTO_BODY_BYTES = Math.ceil(PHOTO_IMAGE_BYTES * 4 / 3) + 2048;
export const PhotoLoginSchema = z.strictObject({ key: z.string().trim().min(16).max(160) });
export const PhotoAccountSchema = z.strictObject({ schemaVersion: z.literal(1), accountId: z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/) });
export const PhotoSolveRequestSchema = z.strictObject({
  schemaVersion: z.literal(1), requestId: z.uuid(), sessionId: z.uuid(), exam: ExamTypeSchema,
  image: z.string().max(Math.ceil(PHOTO_IMAGE_BYTES * 4 / 3) + 32).regex(/^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/),
});
export const PhotoStreamMessageSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('event'), event: PublicAgentEventSchema }),
  z.strictObject({ type: z.literal('result'), outcome: SolveOutcomeSchema }),
]);
export type PhotoAccount = z.infer<typeof PhotoAccountSchema>;
export type PhotoSolveRequest = z.infer<typeof PhotoSolveRequestSchema>;
