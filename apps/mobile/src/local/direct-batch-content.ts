// Decision: .agents/notes/implemented/storage/2026-10-22-direct-parsed-pdf.md
import type { BatchPrintProblem, BatchPrintQuestion, BatchPrintCopy } from '@solveflow/contracts/local';
import type { PreparedExportContent } from './prepare-batch-export.web';

export interface DirectHighlight { start: number; end: number }
export interface DirectAnswerEntry { key: string; ordinal: number; sourceNumber?: string; answer: string; incorrect: boolean; choice?: boolean }
export const DIRECT_ANSWER_GROUP_SIZE = 5;
export function directAnswerGroups(entries: DirectAnswerEntry[]): DirectAnswerEntry[][] {
  const groups: DirectAnswerEntry[][] = [];
  for (let index = 0; index < entries.length; index += DIRECT_ANSWER_GROUP_SIZE) groups.push(entries.slice(index, index + DIRECT_ANSWER_GROUP_SIZE));
  return groups;
}
export type DirectPrintBlock =
  | { kind: 'text'; text: string; heading?: boolean; incorrect?: boolean; anchor?: { key: string; title: string }; highlights?: DirectHighlight[] }
  | { kind: 'answer-table'; entries: DirectAnswerEntry[] }
  | { kind: 'image'; key: string; image: string; label: string };
export type DirectBatchContent = { title: string; problems: BatchPrintProblem[]; prepared: PreparedExportContent } & (
  { mode: 'questions'; copy?: never; questions?: never; markIncorrect?: never } |
  { mode: 'answers'; copy: BatchPrintCopy; questions: BatchPrintQuestion[]; markIncorrect?: boolean }
);

/** The pure projection never reads saved answers, and image groups are retained only once. */
export function directBatchBlocks(input: DirectBatchContent): DirectPrintBlock[] {
  const blocks: DirectPrintBlock[] = [{ kind: 'text', text: input.title, heading: true }];
  blocks.push({ kind: 'text', text: input.mode === 'questions' ? `共 ${input.problems.length} 题` : `第 ${input.copy.copyIndex} 份 · 对 ${input.copy.correct} / 错 ${input.copy.incorrect}${input.copy.remark ? ` · ${input.copy.remark}` : ''}` });
  if (input.mode === 'answers') blocks.push({ kind: 'answer-table', entries: input.problems.map(question => {
    const answer = input.copy.answers.find(item => item.key === question.key);
    const sourceNumber = input.prepared.layouts[question.key]?.problem.sourceNumber;
    const original = input.questions.find(item => item.key === question.key)?.candidate;
    const problem = input.prepared.layouts[question.key]?.problem;
    const positions = answer?.selectedOptions?.map(label => (problem?.options?.findIndex(option => option.label === label) ?? -1) + 1);
    const choice = Boolean(positions?.length && positions.every(position => position > 0) && problem?.optionsComplete !== false);
    return { key: question.key, ordinal: question.ordinal, ...(sourceNumber ? { sourceNumber } : {}), answer: positions?.length ? choice ? positions.join('+') : '待核对' : !answer?.answer ? '未保存作答' : !answer.changed && original?.responseValue && original.responseValue.length <= 80 ? original.responseValue : '见本题作答', incorrect: input.markIncorrect === true && answer?.incorrect === true, choice };
  }) });
  const included = new Set<string>();
  for (const question of input.problems) {
    const layout = input.prepared.layouts[question.key];
    const problem = layout?.problem;
    if (!problem) throw new Error(`第${question.ordinal}题尚无已解析题干，请改用其他导出版式。`);
    const answer = input.mode === 'answers' ? input.copy.answers.find(item => item.key === question.key) : undefined;
    const incorrect = input.mode === 'answers' && input.markIncorrect === true && answer?.incorrect === true;
    const title = `第 ${question.ordinal} 题${problem.sourceNumber ? `（原题 ${problem.sourceNumber}）` : ''}`;
    blocks.push({ kind: 'text', text: `${title}${incorrect ? '  × 作答错误' : ''}`, heading: true, incorrect, anchor: { key: question.key, title } });
    blocks.push({ kind: 'text', text: problem.text });
    for (const option of problem.options ?? []) blocks.push({ kind: 'text', text: `${option.label}. ${option.text}` });
    if (problem.uncertainties.length) blocks.push({ kind: 'text', text: `识别待核对：${problem.uncertainties.join('；')}` });
    // An absent illustration declaration is unknown, not evidence that all source diagrams are disposable.
    if (problem.illustrations?.length !== 0 || problem.uncertainties.length) for (const asset of layout.assets) {
      if (included.has(asset.key)) continue;
      const image = input.prepared.images[asset.key];
      if (!image) throw new Error(`第${question.ordinal}题缺少保存的原题图。`);
      blocks.push({ kind: 'image', image, key: asset.key, label: '保存的原题图（同源题组共用）' }); included.add(asset.key);
    }
    if (input.mode === 'answers') {
      const original = input.questions.find(item => item.key === question.key)?.candidate;
      const selected = answer?.selectedOptions?.map(label => `（${label}）`);
      const text = selected?.length ? `${selected.join('、')}${!answer?.changed && original?.answer ? `\n${original.answer}` : ''}` : answer?.answer ? !answer.changed && original?.responseValue ? original.responseValue : answer.answer : '未保存作答';
      let start = 3;
      const highlights = selected?.map(label => { const range = { start, end: start + label.length }; start += label.length + 1; return range; });
      blocks.push({ kind: 'text', text: `作答：${text}`, incorrect, ...(highlights?.length ? { highlights } : {}) });
    }
  }
  return blocks;
}
