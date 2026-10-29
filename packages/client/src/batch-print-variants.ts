import { BatchPrintSnapshotSchema, parseCapturedBatchPrintSnapshot, parseCollectedBatchPrintSnapshot, BatchPrintProblemsSchema, BatchPrintQuestionsSchema, BatchPrintCopyRequestsSchema, BatchPrintReferencesSchema, BatchPrintCopySchema, MAX_BATCH_PRINT_QUESTIONS, MAX_BATCH_PRINT_COPIES, type BatchPrintSnapshot, type BatchPrintProblem, type BatchPrintQuestion, type BatchPrintReference, type BatchPrintCopy, type BatchPrintCopyAnswer } from '@solveflow/contracts/local';
import { isAuxiliaryContext } from '@solveflow/contracts/http';
import { questionConversations } from './question-conversations.js';
import { selectPrintErrors } from './batch-print-selection.js';

/** Question extraction is independent of solving and never projects answer fields. */
export function questionsForBatchQuestionPrint(input: unknown): BatchPrintProblem[] {
  return sourceProblems(BatchPrintSnapshotSchema.parse(input));
}

// Decision: .agents/notes/implemented/storage/2026-10-19-pdf-captured-validation.md
/** Only for an exclusively owned capture; keeps all source and output validation. */
export async function questionsForCapturedBatchQuestionPrint(input: unknown, beforeRecord: () => Promise<void>): Promise<BatchPrintProblem[]> {
  return sourceProblems(await parseCapturedBatchPrintSnapshot(input, beforeRecord));
}

// Decision: .agents/notes/implemented/storage/2026-10-19-pdf-preflight-validation.md
/** Captures a schema-produced inert snapshot for cooperative preflight; does not replace the formal task capture. */
export async function questionsForCollectedBatchQuestionPrint(input: unknown, beforeRecord: () => Promise<void>): Promise<BatchPrintProblem[]> {
  return sourceProblems(await parseCollectedBatchPrintSnapshot(input, beforeRecord));
}

function sourceProblems(snapshot: BatchPrintSnapshot): BatchPrintProblem[] {
  const questions: BatchPrintProblem[] = [];
  for (const record of [...snapshot.records].sort((a, b) => (a.batch?.position ?? 0) - (b.batch?.position ?? 0))) {
    const threads = questionConversations(record.session.runs).filter(thread => thread.runs.some(run => !isAuxiliaryContext(run.context?.kind)));
    if (!threads.length) questions.push({ key: `${record.session.id}/unanswered`, ordinal: questions.length + 1, recordId: record.session.id, problem: null });
    for (const thread of threads) {
      const run = thread.runs.findLast(item => !isAuxiliaryContext(item.context?.kind) && (item.outcome?.status === 'completed' || item.outcome?.status === 'needs_clarification'));
      const problem = run?.outcome?.status === 'completed' || run?.outcome?.status === 'needs_clarification' ? run.outcome.candidate.problem : null;
      questions.push({ key: `${record.session.id}/${thread.key}`, ordinal: questions.length + 1, recordId: record.session.id, ...(thread.number !== undefined ? { number: thread.number } : {}), problem });
    }
  }
  return BatchPrintProblemsSchema.parse(questions);
}

/** An export assumption never changes the saved independent verification. */
export function questionsForBatchPrint(input: unknown): BatchPrintQuestion[] {
  return savedQuestions(BatchPrintSnapshotSchema.parse(input));
}

function savedQuestions(snapshot: BatchPrintSnapshot): BatchPrintQuestion[] {
  const questions: BatchPrintQuestion[] = [];
  for (const record of [...snapshot.records].sort((a, b) => (a.batch?.position ?? 0) - (b.batch?.position ?? 0))) {
    const threads = questionConversations(record.session.runs).filter(thread => thread.runs.some(run => !isAuxiliaryContext(run.context?.kind)));
    if (!threads.length) questions.push({ key: `${record.session.id}/unanswered`, ordinal: questions.length + 1, recordId: record.session.id, runId: null, candidate: null, baselineWrong: false, validOptions: [] });
    for (const thread of threads) {
      const primary = thread.runs.filter(run => !isAuxiliaryContext(run.context?.kind));
      const run = primary.findLast(item => item.outcome?.status === 'completed' || item.outcome?.status === 'needs_clarification');
      const candidate = run?.outcome?.status === 'completed' ? run.outcome.candidate : null;
      const check = thread.runs.findLast(item => item.context?.kind === 'verification' && item.context.sourceRunId === run?.id && item.outcome?.status === 'completed');
      const result = check?.outcome?.status === 'completed' ? check.outcome : run?.outcome;
      questions.push({ key: `${record.session.id}/${thread.key}`, ordinal: questions.length + 1, recordId: record.session.id, runId: run?.id ?? null, ...(thread.number !== undefined ? { number: thread.number } : {}), candidate, baselineWrong: (result?.status === 'completed' && result.verification?.verdict === 'fail') || primary.at(-1)?.outcome?.status === 'failed', validOptions: candidate?.problem.options?.map(option => option.label) ?? [] });
    }
  }
  return BatchPrintQuestionsSchema.parse(questions);
}

// Decision: .agents/notes/implemented/storage/2026-10-16-export-snapshot-projection.md
/** Validate one source per invocation; keep page errors ahead of answer extraction. */
export function projectBatchPrintSnapshot(input: unknown, includeAnswers: boolean, checkPageCount?: (count: number) => void): { snapshot: BatchPrintSnapshot; problems: BatchPrintProblem[]; questions: BatchPrintQuestion[] } {
  const snapshot = BatchPrintSnapshotSchema.parse(input);
  const problems = sourceProblems(snapshot);
  checkPageCount?.(problems.length);
  return { snapshot, problems, questions: includeAnswers ? savedQuestions(snapshot) : [] };
}

// Decision: .agents/notes/implemented/storage/2026-10-19-pdf-captured-projection.md
/** Only for an inert isolated capture (no accessors/proxies), exclusively owned until completion. Still validates unknown. */
export async function projectCapturedBatchPrintSnapshot(input: unknown, includeAnswers: boolean, beforeRecord: () => Promise<void>, checkPageCount?: (count: number) => void): Promise<ReturnType<typeof projectBatchPrintSnapshot>> {
  const snapshot = await parseCapturedBatchPrintSnapshot(input, beforeRecord);
  const problems = sourceProblems(snapshot);
  checkPageCount?.(problems.length);
  return { snapshot, problems, questions: includeAnswers ? savedQuestions(snapshot) : [] };
}

// Decision: .agents/notes/implemented/storage/2026-10-15-printable-variant-boundary.md
const sameOptions = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every(label => b.includes(label));
function referenceFor(question: BatchPrintQuestion, override?: BatchPrintReference) {
  const options = override?.referenceOptions !== undefined ? override.referenceOptions : question.candidate?.selectedOptions ?? null;
  const answer = override?.referenceAnswer !== undefined ? override.referenceAnswer : question.candidate?.answer ?? null;
  const allowed = override?.referenceOptions !== undefined ? question.printOptions ?? question.validOptions : question.validOptions;
  if (options && (options.some(label => !allowed.includes(label)) || (question.candidate?.problem.response?.type !== 'multiple-choice' && options.length !== 1))) throw new Error(`第${question.ordinal}题的参照选项无效。`);
  return { options, answer, wrongAnswer: override?.wrongAnswer ?? '' };
}
function alternativeOptions(question: BatchPrintQuestion, reference: string[], offset: number): string[] | null {
  const alternatives = (question.printOptions ?? question.validOptions).filter(label => !sameOptions([label], reference));
  const label = alternatives[offset % alternatives.length];
  return label ? [label] : null;
}
function adjustedAnswer(question: BatchPrintQuestion, incorrect: boolean, copyIndex: number, override?: BatchPrintReference): { answer: string; selectedOptions?: string[] } | null {
  const reference = referenceFor(question, override);
  if (question.validOptions.length) {
    if (!reference.options || (question.printOptionsComplete ?? question.candidate?.problem.optionsComplete) === false || reference.options.some(label => !(question.printOptions ?? question.validOptions).includes(label))) return null;
    const options = incorrect ? alternativeOptions(question, reference.options, copyIndex + question.ordinal) : reference.options;
    return options ? { answer: options.join('、'), selectedOptions: options } : null;
  }
  if (!question.candidate && !reference.answer) return { answer: reference.wrongAnswer };
  if (!reference.answer || (incorrect && (reference.wrongAnswer.trim() === reference.answer.trim() || reference.wrongAnswer.trim() === question.candidate?.answer.trim()))) return null;
  return { answer: incorrect ? reference.wrongAnswer : reference.answer };
}

// Decision: .agents/notes/implemented/storage/2026-10-21-export-error-distribution.md
/** Export counts are assumptions, independent of saved verification. A supplied seed freezes a dialog's plan. */
export function planBatchPrintCopies(questionInput: unknown, requestInput: unknown, referenceInput: unknown = [], seed = Math.floor(Math.random() * 0x100000000)): BatchPrintCopy[] {
  if (!Number.isSafeInteger(seed) || seed < 0 || seed > 0xffffffff) throw new Error('导出随机种子无效。');
  const questions = BatchPrintQuestionsSchema.parse(questionInput); const requests = BatchPrintCopyRequestsSchema.parse(requestInput); const references = BatchPrintReferencesSchema.parse(referenceInput);
  const keys = new Set(questions.map(question => question.key));
  if (references.some(reference => !keys.has(reference.key))) throw new Error('参照包含本批之外的题目。');
  const byKey = new Map(references.map(reference => [reference.key, reference]));
  for (const question of questions) referenceFor(question, byKey.get(question.key));
  const usage = new Map<string, number>(); const combinations = new Set<string>();
  return requests.map((request, index) => {
    if (request.correct + request.incorrect !== questions.length) throw new Error('答对和答错数量之和必须等于总题数。');
    const eligible = questions.filter(question => adjustedAnswer(question, true, index, byKey.get(question.key)) !== null);
    if (eligible.length < request.incorrect) throw new Error('可调整的题目不足；请确认选项或填写有效参照答案及错误作答。');
    const errors = selectPrintErrors(eligible, request.incorrect, seed + index, usage, combinations);
    const answers: BatchPrintCopyAnswer[] = questions.map(question => {
      const incorrect = errors.has(question.key); const override = byKey.get(question.key);
      const reference = referenceFor(question, override);
      const matches = question.validOptions.length ? reference.options ? sameOptions(question.candidate?.selectedOptions ?? [], reference.options) : true : reference.answer ? question.candidate?.answer.trim() === reference.answer.trim() : true;
      const adjust = incorrect || !matches;
      const adjusted = adjust ? adjustedAnswer(question, incorrect, index, override) : null;
      if (adjust && !adjusted) throw new Error('作答参照已变化，请重新规划。');
      const answer = adjusted?.answer ?? question.candidate?.answer ?? '';
      const selectedOptions = adjusted ? adjusted.selectedOptions : question.candidate?.selectedOptions;
      const changed = answer !== (question.candidate?.answer ?? '') || !sameOptions(selectedOptions ?? [], question.candidate?.selectedOptions ?? []);
      return { key: question.key, ordinal: question.ordinal, recordId: question.recordId, runId: question.runId, answer, ...(selectedOptions ? { selectedOptions } : {}), incorrect, changed };
    });
    return BatchPrintCopySchema.parse({ copyIndex: index + 1, total: questions.length, ...request, answers });
  });
}

function printFilename(batchName: string, suffix: string): string {
  const title = [...(batchName.normalize('NFKC').replace(/[<>:"/\\|?*\u0000-\u001f\u007f]/g, '_').replace(/[ .]+$/g, '').trim().slice(0, 100) || '批次')];
  while (new TextEncoder().encode(title.join('') + suffix).byteLength > 240) title.pop();
  return title.join('') + suffix;
}
// Decision: .agents/notes/implemented/storage/2026-10-22-export-copy-remarks.md
export function batchPrintFilename(batchName: string, input: unknown, options: { multiple?: boolean; markIncorrect?: boolean; exportedAt?: string } = {}): string {
  const copy = BatchPrintCopySchema.parse(input);
  if (copy.remark) {
    const at = new Date(options.exportedAt ?? Date.now());
    if (!Number.isFinite(at.getTime())) throw new Error('导出时间无效。');
    const pad = (value: number) => String(value).padStart(2, '0');
    const timestamp = `${at.getFullYear()}${pad(at.getMonth() + 1)}${pad(at.getDate())}-${pad(at.getHours())}${pad(at.getMinutes())}${pad(at.getSeconds())}`;
    return printFilename(copy.remark, `_${timestamp}.pdf`);
  }
  return printFilename(batchName, `_作答_第${String(copy.copyIndex).padStart(2, '0')}份_${copy.total}题_对${copy.correct}_错${copy.incorrect}${options.markIncorrect ? '_标记错题' : ''}.pdf`);
}
export function batchQuestionFilename(batchName: string, total: number): string {
  if (!Number.isInteger(total) || total < 1 || total > MAX_BATCH_PRINT_QUESTIONS) throw new Error('导出题目数量无效。');
  return printFilename(batchName, `_题目_${total}题.pdf`);
}
export function batchPrintArchiveFilename(batchName: string, copies: number, options: { markIncorrect?: boolean } = {}): string {
  if (!Number.isInteger(copies) || copies < 1 || copies > MAX_BATCH_PRINT_COPIES) throw new Error('导出份数无效。');
  return printFilename(batchName, `_作答_${copies}份${options.markIncorrect ? '_标记错题' : ''}.zip`);
}
