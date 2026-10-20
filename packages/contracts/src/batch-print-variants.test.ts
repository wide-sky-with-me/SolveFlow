import { expect, it } from 'vitest';
import { BatchPrintCopyRequestSchema, BatchPrintCopyRequestsSchema, BatchPrintReferencesSchema, BatchPrintCopySchema } from './batch-print-variants.js';

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
