import { BatchPrintSnapshotSchema, BatchPrintQuestionsSchema, BatchPrintCopyRequestsSchema, BatchPrintReferencesSchema, BatchPrintCopySchema, MAX_BATCH_PRINT_QUESTIONS, type BatchPrintQuestion, type BatchPrintReference, type BatchPrintCopy, type BatchPrintCopyAnswer } from '@solveflow/contracts/local';
import { isAuxiliaryContext } from '@solveflow/contracts/http';
import { questionConversations } from './question-conversations.js';

/** An export assumption never changes the saved independent verification. */
export function questionsForBatchPrint(input: unknown): BatchPrintQuestion[] {
  const snapshot = BatchPrintSnapshotSchema.parse(input); const questions: BatchPrintQuestion[] = [];
  for (const record of [...snapshot.records].sort((a, b) => (a.batch?.position ?? 0) - (b.batch?.position ?? 0))) {
    const threads = questionConversations(record.session.runs);
    if (!threads.length) throw new Error('作答调整只对有完整已保存回答的批次开放。');
    for (const thread of threads) {
      const primary = thread.runs.filter(run => !isAuxiliaryContext(run.context?.kind));
      const run = primary.findLast(item => item.outcome?.status === 'completed' || item.outcome?.status === 'needs_clarification');
      if (run?.outcome?.status !== 'completed') throw new Error('作答调整只对有完整已保存回答的批次开放。');
      const check = thread.runs.findLast(item => item.context?.kind === 'verification' && item.context.sourceRunId === run.id && item.outcome?.status === 'completed');
      const result = check?.outcome?.status === 'completed' ? check.outcome : run.outcome;
      questions.push({ key: `${record.session.id}/${thread.key}`, ordinal: questions.length + 1, recordId: record.session.id, runId: run.id, ...(thread.number !== undefined ? { number: thread.number } : {}), candidate: run.outcome.candidate, baselineWrong: result.verification?.verdict === 'fail' || primary.at(-1)?.outcome?.status === 'failed', validOptions: run.outcome.candidate.problem.options?.map(option => option.label) ?? [] });
    }
  }
  return BatchPrintQuestionsSchema.parse(questions);
}

const sameOptions = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every(label => b.includes(label));
function referenceFor(question: BatchPrintQuestion, override?: BatchPrintReference) {
  const options = override?.referenceOptions !== undefined ? override.referenceOptions : question.baselineWrong ? null : question.candidate.selectedOptions ?? null;
  const answer = override?.referenceAnswer !== undefined ? override.referenceAnswer : question.baselineWrong ? null : question.candidate.answer;
  if (options && (options.some(label => !question.validOptions.includes(label)) || (question.candidate.problem.response?.type !== 'multiple-choice' && options.length !== 1))) throw new Error(`第${question.ordinal}题的参照选项无效。`);
  return { options, answer, wrongAnswer: override?.wrongAnswer ?? '' };
}
function alternativeOptions(question: BatchPrintQuestion, reference: string[], offset: number): string[] | null {
  const alternatives = question.validOptions.filter(label => !sameOptions([label], reference) && !sameOptions([label], question.candidate.selectedOptions ?? []));
  const label = alternatives[offset % alternatives.length];
  return label ? [label] : null;
}
function adjustedAnswer(question: BatchPrintQuestion, incorrect: boolean, copyIndex: number, override?: BatchPrintReference): { answer: string; selectedOptions?: string[] } | null {
  const reference = referenceFor(question, override);
  if (question.validOptions.length) {
    if (!reference.options || question.candidate.problem.optionsComplete === false) return null;
    const options = incorrect ? alternativeOptions(question, reference.options, copyIndex + question.ordinal) : reference.options;
    return options ? { answer: options.join('、'), selectedOptions: options } : null;
  }
  if (!reference.answer || (incorrect && (reference.wrongAnswer.trim() === reference.answer.trim() || reference.wrongAnswer.trim() === question.candidate.answer.trim()))) return null;
  return { answer: incorrect ? reference.wrongAnswer : reference.answer };
}

// Ranks never exceed the 20-copy limit, so large binomial counts need not grow.
function combinationCount(size: number, selected: number) {
  let count = 1;
  for (let index = 1; index <= Math.min(selected, size - selected); index++) {
    count = count * (size - index + 1) / index;
    if (count >= 20) return 20;
  }
  return Math.round(count);
}
function selectedKeys(eligible: BatchPrintQuestion[], needed: number, copyIndex: number) {
  const keys = new Set<string>(); let rank = copyIndex % combinationCount(eligible.length, needed); let remaining = needed;
  for (let index = 0; index < eligible.length && remaining > 0; index++) {
    const block = combinationCount(eligible.length - index - 1, remaining - 1);
    if (rank < block) { const question = eligible[index]; if (question) keys.add(question.key); remaining--; }
    else rank -= block;
  }
  return keys;
}
function stableOrder(key: string) {
  let hash = 2166136261;
  for (const character of key) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
  return hash >>> 0;
}

/** Enumerate bounded distinct question combinations without retries or source mutations. */
export function planBatchPrintCopies(questionInput: unknown, requestInput: unknown, referenceInput: unknown = []): BatchPrintCopy[] {
  const questions = BatchPrintQuestionsSchema.parse(questionInput); const requests = BatchPrintCopyRequestsSchema.parse(requestInput); const references = BatchPrintReferencesSchema.parse(referenceInput);
  const keys = new Set(questions.map(question => question.key));
  if (references.some(reference => !keys.has(reference.key))) throw new Error('参照包含本批之外的题目。');
  const byKey = new Map(references.map(reference => [reference.key, reference]));
  for (const question of questions) referenceFor(question, byKey.get(question.key));
  const baselineWrong = questions.filter(question => question.baselineWrong).length;
  return requests.map((request, index) => {
    if (request.correct + request.incorrect !== questions.length) throw new Error('答对和答错数量之和必须等于总题数。');
    const addErrors = request.incorrect > baselineWrong; const needed = Math.abs(request.incorrect - baselineWrong);
    const eligible = questions.filter(question => question.baselineWrong !== addErrors && adjustedAnswer(question, addErrors, index, byKey.get(question.key)) !== null).sort((a, b) => stableOrder(a.key) - stableOrder(b.key) || a.ordinal - b.ordinal);
    if (eligible.length < needed) throw new Error(addErrors ? '可调整的题目不足；请确认选项或填写有效参照答案及错误作答。' : '减少原有红色警告题的错误数前，请逐题填写有效参照答案。');
    const changes = selectedKeys(eligible, needed, index);
    const answers: BatchPrintCopyAnswer[] = questions.map(question => {
      let changed = changes.has(question.key); const incorrect = changed ? addErrors : question.baselineWrong;
      const override = byKey.get(question.key); const reference = referenceFor(question, override);
      if (!changed && override) {
        const matches = question.validOptions.length ? reference.options ? sameOptions(question.candidate.selectedOptions ?? [], reference.options) : null : reference.answer ? question.candidate.answer.trim() === reference.answer.trim() : null;
        if (matches !== null && matches === incorrect) changed = true;
      }
      const adjusted = changed ? adjustedAnswer(question, incorrect, index, byKey.get(question.key)) : null;
      if (changed && !adjusted) throw new Error('作答参照已变化，请重新规划。');
      return { key: question.key, ordinal: question.ordinal, recordId: question.recordId, runId: question.runId, answer: adjusted?.answer ?? question.candidate.answer, ...(adjusted?.selectedOptions ? { selectedOptions: adjusted.selectedOptions } : !changed && question.candidate.selectedOptions ? { selectedOptions: question.candidate.selectedOptions } : {}), incorrect, changed };
    });
    return BatchPrintCopySchema.parse({ copyIndex: index + 1, total: questions.length, ...request, answers });
  });
}

function printFilename(batchName: string, suffix: string): string {
  const title = [...(batchName.normalize('NFKC').replace(/[<>:"/\\|?*\u0000-\u001f\u007f]/g, '_').replace(/[ .]+$/g, '').trim().slice(0, 100) || '批次')];
  while (new TextEncoder().encode(title.join('') + suffix).byteLength > 240) title.pop();
  return title.join('') + suffix;
}
export function batchPrintFilename(batchName: string, input: unknown, options: { multiple?: boolean } = {}): string {
  const copy = BatchPrintCopySchema.parse(input);
  return printFilename(batchName, `_总${copy.total}_对${copy.correct}_错${copy.incorrect}${options.multiple ? `_${String(copy.copyIndex).padStart(2, '0')}` : ''}.pdf`);
}
export function batchQuestionFilename(batchName: string, total: number): string {
  if (!Number.isInteger(total) || total < 1 || total > MAX_BATCH_PRINT_QUESTIONS) throw new Error('导出题目数量无效。');
  return printFilename(batchName, `_总${total}_纯题目.pdf`);
}
