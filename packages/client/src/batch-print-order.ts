import { BatchPrintRecordOrderSchema, BatchPrintCopySchema, type BatchPrintSnapshot, type BatchPrintCopy } from '@solveflow/contracts/local';

// Decision: .agents/notes/implemented/storage/2026-10-26-batch-insertion-export-order.md

/** Export-only positions: never writes the saved batch or changes stable question keys. */
export function orderBatchPrintSnapshot(snapshot: BatchPrintSnapshot, value: readonly string[]): BatchPrintSnapshot {
  const ids = BatchPrintRecordOrderSchema.parse(value); const records = new Map(snapshot.records.map(record => [record.session.id, record]));
  if (ids.length !== records.size || ids.some(id => !records.has(id))) throw new Error('导出题图已变化，请重新设置顺序。');
  return { ...snapshot, records: ids.map((id, index) => {
    const record = records.get(id); if (!record?.batch || record.batch.id !== snapshot.batch.id) throw new Error('导出题图归属不一致。');
    return { ...record, batch: { ...record.batch, position: index + 1 } };
  }) };
}
export function orderBatchPrintItems<T extends { recordId: string; ordinal: number }>(items: readonly T[], snapshot: BatchPrintSnapshot): T[] {
  const rank = new Map(snapshot.records.map((record, index) => [record.session.id, index]));
  if (items.some(item => !rank.has(item.recordId))) throw new Error('导出题目没有对应题图。');
  return [...items].sort((a, b) => rank.get(a.recordId)! - rank.get(b.recordId)! || a.ordinal - b.ordinal).map((item, index) => ({ ...item, ordinal: index + 1 }));
}
export function orderBatchPrintCopy(copy: BatchPrintCopy, questions: readonly { key: string; recordId: string; ordinal: number }[]): BatchPrintCopy {
  const answers = new Map(copy.answers.map(answer => [answer.key, answer]));
  if (questions.length !== answers.size) throw new Error('导出题目和作答数量不一致。');
  return BatchPrintCopySchema.parse({ ...copy, answers: questions.map(question => {
    const answer = answers.get(question.key); if (!answer || answer.recordId !== question.recordId) throw new Error('导出作答与题目不对应。');
    return { ...answer, ordinal: question.ordinal };
  }) });
}
