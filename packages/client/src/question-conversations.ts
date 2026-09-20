import { isAuxiliaryContext, projectQuestionRun, questionSections, resolveQuestionThread, type RunContext, type RunView } from "@solveflow/contracts/http";
export interface QuestionConversation { key: string; root: RunView; number?: number; runs: RunView[] }
const keyOf = (root: string, number?: number) => `${root}:${number ?? "single"}`;
export function questionConversations(runs: readonly RunView[]): QuestionConversation[] {
  const groups = new Map<string, QuestionConversation>();
  for (const run of runs) {
    const address = run.context ? resolveQuestionThread(runs, run.context) : null;
    const candidate = run.outcome?.status === "completed" ? run.outcome.candidate : undefined;
    const sections = candidate ? questionSections(candidate) : null;
    if (sections && address?.number === undefined) {
      for (const section of sections) {
        const key = keyOf(run.id, section.number);
        groups.set(key, { key, root: run, number: section.number, runs: [projectQuestionRun(run, section.number)] });
      }
      continue;
    }
    let group = address ? groups.get(keyOf(address.rootRunId, address.number)) : undefined;
    // Old unscoped single-question conversations can be shown together; multi-question
    // records without a reference remain separate rather than guessed from their text.
    if (!run.context && !sections && groups.size === 1) {
      const only = [...groups.values()][0]; if (only?.number === undefined) group = only;
    }
    if (group) { group.runs.push(run); continue; }
    const key = keyOf(run.id);
    groups.set(key, { key, root: run, runs: [run] });
  }
  return [...groups.values()];
}
export function continuationContext(thread: QuestionConversation): RunContext | undefined {
  const last = thread.runs.findLast(run => !isAuxiliaryContext(run.context?.kind) && (run.outcome?.status === "completed" || run.outcome?.status === "needs_clarification"));
  if (!last) return undefined;
  return last.id === thread.root.id && thread.number !== undefined
    ? { kind: "question", sourceRunId: last.id, number: thread.number }
    : { kind: "reply", sourceRunId: last.id };
}

/** A new full solution in the same question thread; never a step-only continuation. */
export function regenerationContext(thread: QuestionConversation): RunContext | undefined {
  const context = continuationContext(thread);
  if (!context) return undefined;
  return { kind: "regenerate", sourceRunId: context.sourceRunId, ...(context.kind === "question" ? { number: context.number } : {}) };
}
export const REGENERATE_MESSAGE = "请从头重新解答这道题，重新检查题干及图中条件，回答全部小问，只呈现必要依据和核心结果，结果加粗；详细步骤另行按需展开。沿用已确认的题干更正与补充条件，不续写或照搬此前答案。";
