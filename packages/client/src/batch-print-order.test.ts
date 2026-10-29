import { randomUUID } from 'node:crypto';
import { expect, it } from 'vitest';
import { BatchPrintSnapshotSchema } from '@solveflow/contracts/local';
import { orderBatchPrintSnapshot, orderBatchPrintItems, orderBatchPrintCopy } from './batch-print-order.js';

function fixture() {
  const batch = { id: randomUUID(), title: 'Export order', createdAt: new Date().toISOString(), exam: 'act' };
  const records = [1, 2, 3].map(position => { const id = randomUUID(); return { schemaVersion: 1, image: 'data:image/jpeg;base64,AQID', batch: { ...batch, position }, session: { schemaVersion: 1, id, subject: 'math', createdAt: batch.createdAt, runs: [], upload: { schemaVersion: 1, id, mimeType: 'image/jpeg', width: 30, height: 20, bytes: 3, expiresAt: '9999-12-31T00:00:00.000Z', previewUrl: `/api/v1/uploads/${id}/image` } } }; });
  return BatchPrintSnapshotSchema.parse({ schemaVersion: 1, batch, exportedAt: batch.createdAt, records });
}
it('reorders only the export snapshot and keeps grouped questions and per-key wrong answers associated', () => {
  const source = fixture(); const ids = source.records.map(record => record.session.id); const original = JSON.stringify(source);
  const snapshot = orderBatchPrintSnapshot(source, [ids[2]!, ids[0]!, ids[1]!]);
  const questions = [{ key: 'a1', recordId: ids[0]!, ordinal: 1 }, { key: 'a2', recordId: ids[0]!, ordinal: 2 }, { key: 'b', recordId: ids[1]!, ordinal: 3 }, { key: 'c', recordId: ids[2]!, ordinal: 4 }];
  const ordered = orderBatchPrintItems(questions, snapshot);
  expect(ordered.map(item => item.key)).toEqual(['c', 'a1', 'a2', 'b']); expect(ordered.map(item => item.ordinal)).toEqual([1, 2, 3, 4]);
  const copy = { remark: 'Keep this note', copyIndex: 1, total: 4, correct: 3, incorrect: 1, answers: questions.map(question => ({ ...question, runId: null, answer: question.key, selectedOptions: ['A'], incorrect: question.key === 'a2', changed: question.key === 'a2' })) };
  const result = orderBatchPrintCopy(copy, ordered);
  expect(result.answers.map(item => item.answer)).toEqual(['c', 'a1', 'a2', 'b']); expect(result.answers.filter(item => item.incorrect).map(item => item.key)).toEqual(['a2']); expect(result.remark).toBe(copy.remark);
  expect(snapshot.records.map(record => record.batch?.position)).toEqual([1, 2, 3]); expect(JSON.stringify(source)).toBe(original);
});
it('rejects missing, foreign and duplicate export members instead of silently dropping questions', () => {
  const source = fixture(); const ids = source.records.map(record => record.session.id);
  for (const order of [ids.slice(1), [ids[0]!, ids[0]!, ids[2]!], [ids[0]!, ids[1]!, randomUUID()]]) expect(() => orderBatchPrintSnapshot(source, order)).toThrow();
});
