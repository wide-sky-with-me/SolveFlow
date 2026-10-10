import { expect, it } from 'vitest';
import type { RunView } from '@solveflow/contracts/http';
import { mergeRunSnapshot, mergeRunUpdate } from './run-updates';

function run(id: string, createdAt: string, seq = 0): RunView {
  return { schemaVersion: 1, id, sessionId: 'session', status: 'solving', message: '', seq, createdAt, outcome: null };
}
const now = '2026-09-22T00:01:00.000Z';
it('retains events received before the initial disk read resolves, including terminal state', () => {
  const stale = run('first', now);
  const ended: RunView = { ...stale, seq: 3, status: 'cancelled', outcome: { schemaVersion: 1, status: 'cancelled', verified: false, error: { code: 'CANCELLED', message: '已取消', retryable: true, traceId: 'test' } } };
  expect(mergeRunSnapshot([stale], [ended])).toEqual([ended]);
  expect(mergeRunSnapshot([], [ended])).toEqual([ended]);
  expect(mergeRunSnapshot([ended], [stale, { ...stale, seq: 4 }])).toEqual([ended]);
});
it('keeps a newly appended follow-up last even after the device clock moves backwards', () => {
  const first = run('first', now); const followUp = run('follow-up', '2026-09-22T00:00:00.000Z');
  expect(mergeRunUpdate([first], followUp).map(item => item.id)).toEqual(['first', 'follow-up']);
});
it('updates an existing run in place when two runs share a timestamp', () => {
  const first = run('first', now); const followUp = run('follow-up', now);
  const rows = [first, followUp]; const update = run('first', now, 2);
  const merged = mergeRunUpdate(rows, update);
  expect(merged).toEqual([update, followUp]); expect(rows).toEqual([first, followUp]);
});
it('does not move an older auxiliary run after a newer answer when its event arrives later', () => {
  const root = run('root', now); const details = run('details', now); const verification = run('verification', now); const followUp = run('follow-up', now);
  const update = run('details', now, 3);
  expect(mergeRunUpdate([root, details, verification, followUp], update)).toEqual([root, update, verification, followUp]);
});
