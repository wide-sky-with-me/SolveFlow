import { expect, it } from 'vitest';
import { BatchPrintCopyRequestSchema, BatchPrintCopyRequestsSchema, BatchPrintReferencesSchema, BatchPrintCopySchema, BatchPrintQuestionSchema } from './batch-print-variants.js';

it('rejects fractional counts, extra UI fields, duplicate reference keys and excessive copies', () => {
  expect(BatchPrintCopyRequestSchema.safeParse({ correct: 2, incorrect: 1, verified: true }).success).toBe(false);
  expect(BatchPrintCopyRequestSchema.safeParse({ correct: 2.5, incorrect: .5 }).success).toBe(false);
  expect(BatchPrintCopyRequestsSchema.safeParse(Array.from({ length: 21 }, () => ({ correct: 2, incorrect: 1 }))).success).toBe(false);
  expect(BatchPrintReferencesSchema.safeParse([{ key: 'same', referenceOptions: ['A'] }, { key: 'same', referenceOptions: ['B'] }]).success).toBe(false);
});
it('rejects a forged PDF summary whose actual answer flags disagree with its counts', () => {
  const id = '00000000-0000-4000-8000-000000000001';
  expect(BatchPrintCopySchema.safeParse({ copyIndex: 1, total: 1, correct: 0, incorrect: 1, answers: [{ key: 'test', ordinal: 1, recordId: id, runId: id, answer: 'A', selectedOptions: ['A'], incorrect: false, changed: false }] }).success).toBe(false);
});
it('accepts an explicit missing export answer without inventing a candidate, and still rejects fabricated option metadata', () => {
  const id = '00000000-0000-4000-8000-000000000001';
  const missing = { key: 'missing', ordinal: 1, recordId: id, runId: null, candidate: null, baselineWrong: false, validOptions: [] };
  expect(BatchPrintQuestionSchema.parse(missing)).toEqual(missing);
  expect(BatchPrintQuestionSchema.safeParse({ ...missing, validOptions: ['A'] }).success).toBe(false);
  const answers = [{ key: missing.key, ordinal: 1, recordId: id, runId: null, answer: '', incorrect: false, changed: false }];
  expect(BatchPrintCopySchema.parse({ copyIndex: 1, total: 1, correct: 1, incorrect: 0, answers }).answers).toEqual(answers);
});

it('accepts bounded optional per-copy remarks without requiring them for old plans', () => {
  expect(BatchPrintCopyRequestSchema.parse({ correct: 2, incorrect: 0, remark: '  第一组  ' })).toEqual({ correct: 2, incorrect: 0, remark: '第一组' });
  expect(BatchPrintCopyRequestSchema.safeParse({ correct: 2, incorrect: 0, remark: '题'.repeat(81) }).success).toBe(false);
  expect(BatchPrintCopyRequestSchema.safeParse({ correct: 2, incorrect: 0, remark: 123 }).success).toBe(false);
});
