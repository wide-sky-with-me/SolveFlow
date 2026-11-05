import { z } from 'zod';
import { ExamTypeSchema } from './exam.js';
import { SolveOutcomeSchema } from './agent.js';

/** Metadata accompanies a bounded binary image; no question or result is persisted. */
export const ExamPracticeRequestSchema = z.strictObject({ requestId: z.uuid(), exam: ExamTypeSchema });
export type ExamPracticeRequest = z.infer<typeof ExamPracticeRequestSchema>;
export const ExamPracticeSnapshotSchema = z.strictObject({
  schemaVersion: z.literal(1), requestId: z.uuid(),
  status: z.enum(['running', 'finished', 'cancelled']),
  phase: z.enum(['preparing', 'understanding', 'solving', 'verifying', 'revising']),
  outcome: SolveOutcomeSchema.nullable(),
}).refine(value => (value.status === 'finished') === (value.outcome !== null), 'Finished practice requires an outcome.');
export type ExamPracticeSnapshot = z.infer<typeof ExamPracticeSnapshotSchema>;
