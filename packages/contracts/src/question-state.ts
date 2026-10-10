import type { RunView } from './http.js';
import { isAuxiliaryContext } from './run-context.js';
export type QuestionAnswerState = 'verified' | 'answered' | 'failed' | 'unanswered';
/** A failed independent check does not erase an existing answer. */
export function questionAnswerState(runs: readonly RunView[]): QuestionAnswerState {
  const answer = runs.findLast(run => !isAuxiliaryContext(run.context?.kind));
  if (!answer) return 'unanswered';
  const check = runs.findLast(run => run.context?.kind === 'verification' && run.context.sourceRunId === answer.id);
  const result = check?.outcome?.status === 'completed' ? check.outcome : answer.outcome;
  if (result?.status === 'completed') return result.verified ? 'verified' : 'answered';
  if (result || ['failed', 'cancelled', 'needs_clarification'].includes(answer.status)) return 'failed';
  return 'unanswered';
}
