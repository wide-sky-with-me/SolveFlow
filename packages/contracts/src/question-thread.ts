import type { RunView, RunContext } from "./http.js";
import { questionSections } from "./question-sections.js";
import { isAuxiliaryContext } from "./run-context.js";
export interface QuestionThreadAddress { rootRunId: string; number?: number }

/** Resolve only persisted, same-session references. No matching on generated text. */
export function resolveQuestionThread(runs: readonly RunView[], context: RunContext): QuestionThreadAddress | null {
  const visited = new Set<string>();
  function visit(reference: RunContext, sessionId?: string): QuestionThreadAddress | null {
    if (visited.size >= 10 || visited.has(reference.sourceRunId)) return null;
    visited.add(reference.sourceRunId);
    const source = runs.find(run => run.id === reference.sourceRunId);
    if (!source || (sessionId && source.sessionId !== sessionId)) return null;
    const result = source.outcome;
    if (!result || (result.status !== "completed" && result.status !== "needs_clarification")) return null;
    const sections = result.status === "completed" ? questionSections(result.candidate) : null;
    // Any reference that carries a number is scoped to that question; only step resolves it from the payload.
    const number = "number" in reference ? reference.number
      : reference.kind === "step" ? sections?.find(section => section.steps.some(step => step.id === reference.stepId))?.number : undefined;
    if (isAuxiliaryContext(reference.kind) && result.status !== "completed") return null;
    if (reference.kind === "step" && !result.candidate.steps.some(step => step.id === reference.stepId)) return null;
    if (number !== undefined && !sections?.some(section => section.number === number)) return null;
    if (reference.kind === "knowledge") {
      const projected = projectQuestionRun(source, number).outcome;
      if (projected?.status !== "completed" || ![...projected.candidate.knowledgePoints, ...(projected.candidate.knowledgeDetails ?? []).map(point => point.name)].includes(reference.name)) return null;
    }
    const parent = source.context ? visit(source.context, source.sessionId) : null;
    if (source.context && !parent) return null;
    // A reply's generated headings cannot move it out of the user's original question.
    if (parent?.number !== undefined) return parent;
    if (sections) return number === undefined ? null : { rootRunId: source.id, number };
    const preceding = runs.slice(0, runs.findIndex(run => run.id === source.id) + 1).filter(run => run.sessionId === source.sessionId);
    const singleHistory = !preceding.some(run => run.outcome?.status === "completed" && questionSections(run.outcome.candidate));
    const earliest = singleHistory ? preceding.find(run => !run.context && (run.outcome?.status === "completed" || run.outcome?.status === "needs_clarification")) : undefined;
    return parent ?? { rootRunId: earliest?.id ?? source.id };
  }
  return visit(context);
}

/** Display/learning projection only: never overwrites the stored whole-run verification. */
export function projectQuestionRun(run: RunView, number?: number): RunView {
  const original = run.outcome?.status === "completed" ? run.outcome.candidate : undefined;
  if (number === undefined || !original) return run;
  const section = questionSections(original)?.find(item => item.number === number);
  if (!section) return run;
  const { questions: _questions, ...candidate } = original;
  const projected = { ...candidate, answer: section.answer, writing: section.writing, chemistry: section.chemistry, parts: section.parts, responseValue: section.responseValue, selectedOptions: section.selectedOptions, steps: section.steps, figures: section.figures, problem: section.problem ?? candidate.problem, knowledgeDetails: section.knowledgeDetails, knowledgePoints: section.knowledgeDetails?.map(point => point.name) ?? candidate.knowledgePoints };
  return run.outcome?.status === "completed" ? { ...run, outcome: { ...run.outcome, candidate: projected } } : run;
}

export function questionThreadHistory(runs: readonly RunView[], context: RunContext): RunView[] {
  const address = resolveQuestionThread(runs, context);
  if (!address) throw new Error("INVALID_SAVED_CONTEXT");
  return runs.flatMap(run => {
    if (run.id === address.rootRunId) return [projectQuestionRun(run, address.number)];
    const own = resolveQuestionThread(runs, run.context ?? { kind: "reply", sourceRunId: run.id });
    return own?.rootRunId === address.rootRunId && own.number === address.number ? [run] : [];
  });
}
