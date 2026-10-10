// Decision: .agents/notes/implemented/agent/2026-10-04-subject-presentation.md
import { z } from 'zod';

/** The sole article body is candidate.answer; review notes are kept separate. */
export const WritingSchema = z.strictObject({
  mode: z.enum(['composition', 'revision', 'feedback']),
  title: z.string().trim().min(1).max(160).optional(),
  feedback: z.array(z.strictObject({
    paragraph: z.number().int().min(1).max(60).optional(),
    comment: z.string().trim().min(1).max(600),
  })).min(1).max(6).optional(),
});
export type Writing = z.infer<typeof WritingSchema>;
