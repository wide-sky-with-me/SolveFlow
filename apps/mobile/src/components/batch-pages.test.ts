import { expect, it } from 'vitest';
import type { LocalHistorySummary } from '@solveflow/contracts/local';
import { batchPages } from './batch-pages';

it('keeps the 100-question axis stable through background status/title changes but applies membership and order changes', () => {
  const rows: LocalHistorySummary[] = Array.from({ length: 100 }, (_, index) => ({ schemaVersion: 1, id: String(index), subject: 'math', createdAt: '2026-10-03T00:00:00.000Z', text: '', pending: true, favorite: false, batch: { id: 'batch', title: '练习', exam: 'general', createdAt: '2026-10-03T00:00:00.000Z', position: index + 1 } }));
  const first = batchPages([], rows);
  const updated = rows.map(row => ({ ...row, pending: false, text: '已完成', batch: { ...row.batch!, title: '已命名' } }));
  expect(batchPages(first, updated)).toBe(first);
  const removed = batchPages(first, updated.slice(1));
  expect(removed).toHaveLength(99); expect(removed[0]).toEqual({ key: '1', number: 2 });
  const added = batchPages(removed, updated);
  expect(added).toHaveLength(100); expect(added[0]).toEqual({ key: '0', number: 1 });
  expect(batchPages(added, updated.toReversed())[0]).toEqual({ key: '99', number: 100 });
  expect(batchPages(added, updated.map((row, index) => ({ ...row, batch: { ...row.batch!, position: 100 - index } })))[0]?.number).toBe(100);
  expect(batchPages(added, [])).toEqual([]);
});
