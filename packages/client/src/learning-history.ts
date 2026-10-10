import { problemText, answerText } from "@solveflow/contracts/agent";
import type { SolveOutcome, SolverInput } from "@solveflow/contracts/agent";
import { questionThreadHistory, resolveQuestionThread, type RunContext, type RunView } from "@solveflow/contracts/http";
type Entry = { message: string; answer: string };
const excerpt = (text: string, limit: number) => text.length <= limit ? text : text.slice(0, limit - 5) + "…（节选）";
/** Keep recent answer excerpts within the worker's UTF-8 JSON envelope budget. */
export function boundedHistory(entries: readonly Entry[], maxBytes = 12 * 1024) {
  const history: Entry[] = [];
  for (const entry of entries.slice(-9).reverse()) {
    const value = { message: excerpt(entry.message, 500), answer: excerpt(entry.answer, 2000) };
    if (new TextEncoder().encode(JSON.stringify([value, ...history])).byteLength > maxBytes) break;
    history.unshift(value);
  }
  return history;
}

/** Keep all selected-question conclusions in the existing bounded history field. */
export function candidateHistoryAnswer(candidate: { answer: string; selectedOptions?: string[] | undefined; questions?: { number: number; answer: string; selectedOptions?: string[] | undefined }[] | undefined }): string {
  return candidate.questions?.map(question => `第${question.number}题：${excerpt(answerText(question), 480)}`).join("\n\n") ?? answerText(candidate);
}

/** Clarifications are part of the conversation, including when the reply is only a digit. */
export function conversationHistory(runs: readonly { message: string; outcome: SolveOutcome | null; context?: RunContext | undefined }[], maxBytes = 12 * 1024) {
  return boundedHistory(runs.flatMap(run => {
    const result = run.outcome;
    if (!result || (result.status !== "completed" && result.status !== "needs_clarification")) return [];
    const message = run.context?.kind === "correction" ? `用户更正题干：${run.context.text}` : run.message;
    const candidate = result.candidate;
    const answer = result.status === "needs_clarification"
      ? `等待补充。已读题目：${excerpt(problemText(candidate.problem), 500)}\n待确认：${candidate.clarificationQuestions.map(question => excerpt(question, 240)).join("\n")}`
      : `${result.verified ? "曾经模型校验通过，仍须结合原题核验" : "未通过完整校验，不可作为确定事实"}。\n${candidateHistoryAnswer(result.candidate)}\n教学步骤：\n${result.candidate.steps.map(step => `${step.id} ${step.title}：${excerpt(step.explanation, 120)}${step.latex ? `；${excerpt(step.latex, 160)}` : ""}`).join("\n")}`;
    return [{ message, answer }];
  }), maxBytes);
}

function learningContext(runs: readonly RunView[], context: RunContext | null): Pick<SolverInput, "focus" | "problemCorrection"> {
  const selected = context ? questionThreadHistory(runs, context) : runs;
  // Corrections remain available verbatim on later follow-ups; never rewrite old answers.
  const correction = context?.kind === "correction" ? context : selected.findLast(run => run.context?.kind === "correction")?.context;
  const result: Pick<SolverInput, "focus" | "problemCorrection"> = correction?.kind === "correction" ? { problemCorrection: correction.text } : {};
  if (!context) return result;
  const address = resolveQuestionThread(runs, context);
  if (context.kind === "correction") return address?.number === undefined ? result : { ...result, focus: { sourceRunId: context.sourceRunId, kind: "question", content: `只更正并解答第${address.number}题，其余题目不在本次范围内。`, verified: false } };
  const source = runs.find(run => run.id === context.sourceRunId)?.outcome;
  if (context.kind === "verification") return result;
  if (context.kind === "explanation") {
    const projected = selected.find(run => run.id === context.sourceRunId)?.outcome;
    if (projected?.status !== "completed") throw new Error("INVALID_SAVED_CONTEXT");
    return { ...result, focus: { sourceRunId: context.sourceRunId, kind: "explanation", verified: projected.verified,
      content: excerpt(`${address?.number === undefined ? "本题" : `只讲解第${address.number}题，不扩展到其他题`}。补充可检查的详细教学步骤，独立核对原图和结论；发现旧答案错误须明确指出并给出正确结论，不能为旧答案凑证明。\n题干：${problemText(projected.candidate.problem)}\n待核对的简洁答案：${answerText(projected.candidate)}`, 2000) } };
  }
  if (context.kind === "regenerate") {
    const original = selected[0]; const originalResult = original?.outcome;
    if (!originalResult || (originalResult.status !== "completed" && originalResult.status !== "needs_clarification")) throw new Error("INVALID_SAVED_CONTEXT");
    const label = address?.number === undefined ? "重新完整解答本题" : `只重新完整解答第${address.number}题，不解答图片中的其他题目`;
    return { ...result, focus: { sourceRunId: context.sourceRunId, kind: "regenerate", verified: false,
      content: excerpt(`${label}。请重新读取原图，依据有效条件重新求解全部小问，按本次answerMode呈现结果；brief只保留必要依据和加粗结论，完整教学步骤另行请求。不是对之前某一步的追问或续写。\n原题识别记录（须核对原图，并优先使用明确更正）：${problemText(originalResult.candidate.problem)}\n最初的补充说明：${original.message}`, 2000) } };
  }
  if (context.kind === "knowledge") {
    const projected = selected.find(run => run.id === context.sourceRunId)?.outcome;
    if (projected?.status !== "completed") throw new Error("INVALID_SAVED_CONTEXT");
    const detail = projected.candidate.knowledgeDetails?.find(point => point.name === context.name);
    return { ...result, focus: { sourceRunId: context.sourceRunId, kind: "knowledge", verified: projected.verified, content: excerpt(`${address?.number === undefined ? "本题" : `第${address.number}题`}的知识点：${context.name}。${detail ? `含义：${detail.explanation}；应用：${detail.application}；易错点：${detail.pitfall ?? "未列出"}` : "旧记录只有名称，请结合本题讲解定义、使用条件和例子。"}`, 2000) } };
  }
  if (context.kind === "knowledge-list") {
    const projected = selected.find(run => run.id === context.sourceRunId)?.outcome;
    if (projected?.status !== "completed") throw new Error("INVALID_SAVED_CONTEXT");
    return { ...result, focus: { sourceRunId: context.sourceRunId, kind: "knowledge-list", verified: projected.verified,
      content: excerpt(`${address?.number === undefined ? "本题" : `只给出第${address.number}题，不扩展到其他题`}的知识点。结合原题列出直接考查的知识点名称，并给每个知识点写清含义、使用条件和本题应用；不要重复完整解题步骤。\n题干：${problemText(projected.candidate.problem)}`, 2000) } };
  }
  if (context.kind === "reply") {
    if (!source || (source.status !== "completed" && source.status !== "needs_clarification")) throw new Error("INVALID_SAVED_CONTEXT");
    const address = resolveQuestionThread(runs, context);
    const label = address?.number === undefined ? "继续这道题的对话" : `继续第${address.number}题的对话，不解答图片中的其他题目`;
    return { ...result, focus: { sourceRunId: context.sourceRunId, kind: "reply", content: excerpt(`${label}。上一轮：${source.status === "completed" ? answerText(source.candidate) : source.candidate.clarificationQuestions.join("；")}`, 2000), verified: source.verified } };
  }
  if (source?.status !== "completed") throw new Error("INVALID_SAVED_CONTEXT");
  const candidate = source.candidate;
  const reference = selected.find(run => run.id === context.sourceRunId)?.outcome;
  const steps = context.kind === "step" ? candidate.steps.filter(step => step.id === context.stepId)
    : reference?.status === "completed" ? reference.candidate.steps : [];
  if (!steps.length && context.kind === "question" && reference?.status === "completed") return { ...result, focus: { sourceRunId: context.sourceRunId, kind: "question", verified: reference.verified, content: excerpt(`只讨论第${context.number}题。题干：${problemText(reference.candidate.problem)}\n此前答案（须重新核验）：${answerText(reference.candidate)}`, 2000) } };
  if (!steps.length) throw new Error("INVALID_SAVED_CONTEXT");
  const label = `${address?.number === undefined ? "" : `只讨论第${address.number}题。`}${context.kind === "question" ? `第${context.number}题` : `步骤 ${context.stepId}`}`;
  const content = excerpt(`${label}，来自此前答案版本。\n${steps.map(step => `${step.title}\n${step.latex ?? ""}\n${step.explanation}`).join("\n")}`, 2000);
  return { ...result, focus: { sourceRunId: context.sourceRunId, kind: context.kind, content, verified: source.verified } };
}

/** Include only the explicitly addressed answer in full; older dialogue stays bounded. */
export function resolveLearningContext(runs: readonly RunView[], context: RunContext | null): Pick<SolverInput, "focus" | "problemCorrection"> {
  const result = learningContext(runs, context);
  if (!context || !result.focus) return result;
  const selected = questionThreadHistory(runs, context);
  const index = selected.findIndex(run => run.id === context.sourceRunId);
  const source = selected[index]?.outcome;
  if (source?.status !== 'completed') return result;
  // Follow the reviewed version's ancestry: a newer draft on another branch
  // of the same question is not the article this feedback addressed.
  let draftRun: RunView | undefined;
  let parentId = source.candidate.writing?.mode === 'feedback' ? selected[index]?.context?.sourceRunId : undefined;
  const visited = new Set<string>();
  while (parentId && visited.size < 10 && !visited.has(parentId)) {
    visited.add(parentId);
    const parent = selected.slice(0, index).find(run => run.id === parentId);
    if (parent?.outcome?.status === 'completed' && parent.outcome.candidate.problem.response?.type === 'essay') { draftRun = parent; break; }
    parentId = parent?.context?.sourceRunId;
  }
  const draft = draftRun?.outcome?.status === 'completed' ? { sourceRunId: draftRun.id, answer: draftRun.outcome.candidate.answer, ...(draftRun.outcome.candidate.writing?.title ? { title: draftRun.outcome.candidate.writing.title } : {}) } : undefined;
  return { ...result, focus: { ...result.focus, answer: source.candidate.answer,
    ...(source.candidate.parts ? { parts: source.candidate.parts } : {}),
    ...(source.candidate.writing ? { writing: source.candidate.writing } : {}),
    ...(source.candidate.chemistry ? { chemistry: source.candidate.chemistry } : {}),
    ...(draft ? { draft } : {}),
  } };
}
