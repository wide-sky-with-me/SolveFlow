import { z } from 'zod';
import { ProblemStatementSchema } from '@solveflow/contracts/agent';
import type { SessionView } from '@solveflow/contracts/http';
const HistoryEntrySchema = z.strictObject({ id: z.uuid(), subject: z.string().max(40), createdAt: z.iso.datetime(), text: ProblemStatementSchema.shape.text, favorite: z.boolean() });
const HistoryDocumentSchema = z.strictObject({ schemaVersion: z.literal(1), entries: z.array(HistoryEntrySchema).max(100), currentId: z.uuid().nullable(), disabled: z.boolean() });
export function historyEntry(session: SessionView & { favorite?: boolean }) {
  const outcome = session.runs.find(run => run.outcome?.status === 'completed' || run.outcome?.status === 'needs_clarification')?.outcome;
  const problem = outcome && (outcome.status === 'completed' || outcome.status === 'needs_clarification') ? outcome.candidate.problem : null;
  return HistoryEntrySchema.parse({ id: session.id, subject: problem?.subject ?? session.subject, createdAt: session.createdAt, text: problem?.text ?? '已保存的题目', favorite: session.favorite ?? false });
}
/** Same encoded bridge as answers: never put raw model text in Android's JS template. */
export function encodeHistoryDocument(sessions: (SessionView & { favorite?: boolean })[], currentId: string | null, disabled: boolean): string {
  return encodeURIComponent(JSON.stringify(HistoryDocumentSchema.parse({ schemaVersion: 1, entries: sessions.map(historyEntry), currentId, disabled })));
}
export function decodeHistoryDocument(value: unknown) {
  return HistoryDocumentSchema.parse(JSON.parse(decodeURIComponent(z.string().max(10_000_000).parse(value))));
}
