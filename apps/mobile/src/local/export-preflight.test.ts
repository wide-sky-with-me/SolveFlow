import { expect, it } from 'vitest';
import type { BatchPrintProblem, ExportStorageUsage } from '@solveflow/contracts/local';
import { inspectExportQuestions, requireExportQuestions, exportStorageBlock } from './export-preflight';
const problem: BatchPrintProblem = { key: 'one', ordinal: 1, recordId: 'record', problem: { text: 'Choose one', subject: 'math', uncertainties: [], options: [{ label: 'A', text: '1' }] } };
it('lists all missing stems before direct generation and keeps original-image layouts available', () => {
  const rows = [problem, { ...problem, key: 'two', ordinal: 2, problem: null }, { ...problem, key: 'three', ordinal: 3, problem: null }];
  expect(inspectExportQuestions(rows, 'questions', 'direct').map(issue => issue.ordinal)).toEqual([2, 3]);
  expect(() => requireExportQuestions(rows, 'questions', 'direct')).toThrow('第2、3题');
  expect(() => requireExportQuestions(rows, 'questions', 'paper')).not.toThrow();
  expect(inspectExportQuestions(rows, 'reading', 'saved')).toEqual([]);
});
it('reports incomplete choices and uncertainties as review items without blocking faithful export', () => {
  const row = { ...problem, problem: { ...problem.problem!, optionsComplete: false, uncertainties: ['unclear punctuation'] } };
  const [issue] = inspectExportQuestions([row], 'questions', 'direct');
  expect(issue).toMatchObject({ ordinal: 1, blocking: false }); expect(issue?.messages).toHaveLength(2);
});
it('blocks only known exhaustion; unknown browser estimates are not treated as zero', () => {
  const usage: ExportStorageUsage = { usedBytes: 0, limitBytes: 536870912, availableBytes: 536870912, fileCount: 0, browserAvailableBytes: null };
  expect(exportStorageBlock(usage)).toBeNull(); expect(exportStorageBlock(null)).toBeNull();
  expect(exportStorageBlock({ ...usage, usedBytes: usage.limitBytes, availableBytes: 0 })).toContain('缓存已满');
  expect(exportStorageBlock({ ...usage, browserAvailableBytes: 0 })).toContain('浏览器存储空间不足');
});
