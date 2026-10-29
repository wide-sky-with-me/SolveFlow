import { expect, it } from 'vitest';
import type { LocalBatchQueueSnapshot, LocalHistorySummary } from '@solveflow/contracts/local';
import { summarizeBatchTasks } from './batch-task-summary';

const empty: LocalBatchQueueSnapshot = { tasks: [], stoppingBatchIds: [], stoppingAll: false, errors: {}, globalError: null };
function row(id: string, batchId: string, answerState: LocalHistorySummary['answerState'] = 'unanswered'): LocalHistorySummary {
  return { schemaVersion: 1, id, subject: 'math', createdAt: '2026-10-28T01:00:00Z', text: '', pending: false, favorite: false, ...(answerState ? { answerState } : {}), batch: { id: batchId, title: batchId, createdAt: '2026-10-28T01:00:00Z', exam: 'act', position: 1 } };
}
it('counts each photo once, prioritizes live phases over older answers, and isolates batch errors', () => {
  const rows = [row('1', 'A', 'verified'), row('2', 'A', 'answered'), row('3', 'A', 'failed'), row('4', 'A'), row('5', 'A', 'verified'), row('6', 'A', 'verified'), row('7', 'A'), row('8', 'B', 'verified')];
  const result = summarizeBatchTasks(rows, { ...empty, tasks: [{ sessionId: '5', batchId: 'A', phase: 'waiting' }, { sessionId: '6', batchId: 'A', phase: 'solving' }, { sessionId: '7', batchId: 'A', phase: 'verifying' }], errors: { A: 'scope failure' } });
  expect(result[0]).toMatchObject({ total: 7, verified: 1, answered: 1, failed: 1, unanswered: 1, waiting: 1, solving: 1, verifying: 1, preparing: 0, active: true, error: 'scope failure' });
  expect(result[1]).toMatchObject({ total: 1, verified: 1, active: false, error: null });
});
it('handles preparing, scoped stops, unknown legacy states and absent batches without image reads', () => {
  const legacy = row('1', 'A'); delete legacy.answerState;
  const single = row('3', 'B'); delete single.batch;
  const result = summarizeBatchTasks([legacy, row('2', 'A'), single], { ...empty, tasks: [{ sessionId: '2', batchId: 'A', phase: 'preparing' }], stoppingBatchIds: ['A'] });
  expect(result).toHaveLength(1); expect(result[0]).toMatchObject({ total: 2, unanswered: 1, preparing: 1, stopping: true, active: true });
  expect(summarizeBatchTasks([], empty)).toEqual([]);
});
it('retains a shared storage failure across batches and counts pending metadata conservatively', () => {
  const pending = row('1', 'A', 'verified'); pending.pending = true;
  const result = summarizeBatchTasks([pending, row('2', 'B')], { ...empty, globalError: 'save required' });
  expect(result[0]).toMatchObject({ active: true, verified: 0, preparing: 1, error: 'save required' });
  expect(result[1]?.error).toBe('save required');
});

it('counts a saved answer during verification and distinguishes stopping from a solve failure', () => {
  const ready = { ...row('1', 'A', 'answered'), pending: true };
  const stopped = { ...row('2', 'A', 'failed'), taskState: 'cancelled' as const };
  const failed = { ...row('3', 'A', 'failed'), taskState: 'failed' as const };
  const [summary] = summarizeBatchTasks([ready, stopped, failed], { ...empty, tasks: [{ sessionId: '1', batchId: 'A', phase: 'verifying' }] });
  expect(summary).toMatchObject({ answersReady: 1, verifying: 1, cancelled: 1, failed: 1 });
});
