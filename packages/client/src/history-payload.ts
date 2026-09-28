import { z } from 'zod';
import { ProblemStatementSchema } from '@solveflow/contracts/agent';
import type { SessionView } from '@solveflow/contracts/http';
import type { LocalHistorySummary } from '@solveflow/contracts/local';
const HistoryEntrySchema = z.strictObject({ id: z.uuid(), subject: z.string().max(40), createdAt: z.iso.datetime(), text: ProblemStatementSchema.shape.text, favorite: z.boolean() });
const HistoryDocumentSchema = z.strictObject({ schemaVersion: z.literal(1), entries: z.array(HistoryEntrySchema).max(100), currentId: z.uuid().nullable(), disabled: z.boolean(), offset: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER - 100).default(0) });
/** Display the original save time in the device's local timezone, including seconds. */
export function formatHistoryTime(value: string): string {
  const date = new Date(value);
  const pad = (part: number) => String(part).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}
export function historyEntry(session: (SessionView & { favorite?: boolean }) | LocalHistorySummary) {
  if ('text' in session) return HistoryEntrySchema.parse({ id: session.id, subject: session.subject, createdAt: session.createdAt, text: session.text, favorite: session.favorite });
  const outcome = session.runs.find(run => run.outcome?.status === 'completed' || run.outcome?.status === 'needs_clarification')?.outcome;
  const problem = outcome && (outcome.status === 'completed' || outcome.status === 'needs_clarification') ? outcome.candidate.problem : null;
  const candidate = outcome && (outcome.status === 'completed' || outcome.status === 'needs_clarification') ? outcome.candidate : null;
  const numbers = [...new Set([problem?.sourceNumber, ...(candidate?.kind === 'answer' ? candidate.questions?.map(question => question.problem?.sourceNumber) ?? [] : [])].filter(Boolean))];
  return HistoryEntrySchema.parse({ id: session.id, subject: problem?.subject ?? session.subject, createdAt: session.createdAt, text: (numbers.length ? `原题号 ${numbers.join('、')} · ${problem?.text ?? ''}` : problem?.text ?? '已保存的题目').slice(0, 8000), favorite: session.favorite ?? false });
}
/** Same encoded bridge as answers: never put raw model text in Android's JS template. */
export function encodeHistoryDocument(sessions: ((SessionView & { favorite?: boolean }) | LocalHistorySummary)[], currentId: string | null, disabled: boolean, offset = 0): string {
  return encodeURIComponent(JSON.stringify(HistoryDocumentSchema.parse({ schemaVersion: 1, entries: sessions.map(historyEntry), currentId, disabled, offset })));
}
export function decodeHistoryDocument(value: unknown) {
  return HistoryDocumentSchema.parse(JSON.parse(decodeURIComponent(z.string().max(10_000_000).parse(value))));
}
