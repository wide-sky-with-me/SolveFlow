import type { LocalHistorySummary } from '@solveflow/contracts/local';
export type BatchPage = { key: string; number: number };

/** Status/title changes must not invalidate every pager tab or its preload timer. */
export function batchPages(previous: BatchPage[], rows: LocalHistorySummary[]): BatchPage[] {
  if (previous.length === rows.length && rows.every((row, index) => previous[index]?.key === row.id && previous[index]?.number === row.batch?.position)) return previous;
  return rows.map(row => ({ key: row.id, number: row.batch!.position }));
}
