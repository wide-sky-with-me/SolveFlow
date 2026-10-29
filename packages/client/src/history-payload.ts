import { z } from 'zod';
import { ProblemStatementSchema } from '@solveflow/contracts/agent';
import { questionAnswerState, isAuxiliaryContext, terminal, type RunView, type SessionView } from '@solveflow/contracts/http';
import { LocalHistorySummarySchema } from '@solveflow/contracts/local';
import type { LocalHistorySummary } from '@solveflow/contracts/local';
import { questionConversations } from './question-conversations.js';
const HistoryEntrySchema = z.strictObject({ id: z.uuid(), subject: z.string().max(40), createdAt: z.iso.datetime(), text: ProblemStatementSchema.shape.text, favorite: z.boolean(), answerState: LocalHistorySummarySchema.shape.answerState });
const HistoryDocumentSchema = z.strictObject({ schemaVersion: z.literal(1), entries: z.array(HistoryEntrySchema).max(100), currentId: z.uuid().nullable(), disabled: z.boolean(), offset: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER - 100).default(0) });
/** Display the original save time in the device's local timezone, including seconds. */
export function formatHistoryTime(value: string): string {
  const date = new Date(value);
  const pad = (part: number) => String(part).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}
export function historyEntry(session: (SessionView & { favorite?: boolean }) | LocalHistorySummary) {
  if ('text' in session) return HistoryEntrySchema.parse({ id: session.id, subject: session.subject, createdAt: session.createdAt, text: session.text, favorite: session.favorite, ...(session.answerState ? { answerState: session.answerState } : {}) });
  const outcome = session.runs.find(run => run.outcome?.status === 'completed' || run.outcome?.status === 'needs_clarification')?.outcome;
  const problem = outcome && (outcome.status === 'completed' || outcome.status === 'needs_clarification') ? outcome.candidate.problem : null;
  const candidate = outcome && (outcome.status === 'completed' || outcome.status === 'needs_clarification') ? outcome.candidate : null;
  const numbers = [...new Set([problem?.sourceNumber, ...(candidate?.kind === 'answer' ? candidate.questions?.map(question => question.problem?.sourceNumber) ?? [] : [])].filter(Boolean))];
  // Decision: .agents/notes/implemented/storage/2026-10-20-grouped-answer-status.md
  const states = questionConversations(session.runs).map(thread => questionAnswerState(thread.runs));
  const answerState = states.includes('failed') ? 'failed'
    : states.length && states.every(state => state === 'verified') ? 'verified'
    : states.some(state => state === 'answered' || state === 'verified') ? 'answered' : 'unanswered';
  return HistoryEntrySchema.parse({ id: session.id, subject: problem?.subject ?? session.subject, createdAt: session.createdAt, text: (numbers.length ? `原题号 ${numbers.join('、')} · ${problem?.text ?? ''}` : problem?.text ?? '已保存的题目').slice(0, 8000), favorite: session.favorite ?? false, answerState });
}
/** Same encoded bridge as answers: never put raw model text in Android's JS template. */
export function encodeHistoryDocument(sessions: ((SessionView & { favorite?: boolean }) | LocalHistorySummary)[], currentId: string | null, disabled: boolean, offset = 0): string {
  return encodeURIComponent(JSON.stringify(HistoryDocumentSchema.parse({ schemaVersion: 1, entries: sessions.map(historyEntry), currentId, disabled, offset })));
}
export function decodeHistoryDocument(value: unknown) {
  return HistoryDocumentSchema.parse(JSON.parse(decodeURIComponent(z.string().max(10_000_000).parse(value))));
}

/** Task phase and answer availability are independent of verification success. */
export function historyTaskStatus(runs: readonly RunView[]): Pick<LocalHistorySummary, 'answerReady' | 'taskState'> {
  const threads = questionConversations(runs);
  const answers = threads.flatMap(thread => { const answer = thread.runs.findLast(run => !isAuxiliaryContext(run.context?.kind)); return answer ? [answer] : []; });
  const states = answers.map(answer => !terminal(answer.status) ? 'pending' : answer.status === 'cancelled' ? 'cancelled' : answer.outcome?.status === 'needs_clarification' ? 'needs_clarification' : answer.status === 'failed' || answer.outcome?.status === 'failed' ? 'failed' : 'completed');
  const taskState = states.includes('pending') ? 'pending' : states.includes('failed') ? 'failed' : states.includes('needs_clarification') ? 'needs_clarification' : states.includes('cancelled') ? 'cancelled' : states.length ? 'completed' : 'unanswered';
  return { answerReady: answers.length > 0 && answers.every(answer => answer.outcome?.status === 'completed'), taskState };
}
