import { expect, it } from 'vitest';
import { RunViewSchema, type RunView } from '@solveflow/contracts/http';
import { mergeRunViews } from './run-view.js';

const sessionId = '10000000-0000-4000-8000-000000000001';
function run(id: string, status: RunView['status'], seq: number) {
    return RunViewSchema.parse({ schemaVersion: 1, id, sessionId, status, seq, outcome: null, message: '', createdAt: '2026-11-04T00:00:00.000Z' });
}
const first = '20000000-0000-4000-8000-000000000001', second = '20000000-0000-4000-8000-000000000002';

it('does not rewind a completed local write when older photo hydration arrives', () => {
    const saved = run(first, 'failed', 3), delayed = run(first, 'queued', 0);
    expect(mergeRunViews([saved], [delayed])).toEqual([saved]);
    expect(mergeRunViews([saved], [run(first, 'solving', 1)])).toEqual([saved]);
});
it('does not erase a newer retry when an older history prefix arrives', () => {
    const old = run(first, 'completed', 2), retry = run(second, 'queued', 0);
    expect(mergeRunViews([old, retry], [old])).toEqual([old, retry]);
    expect(mergeRunViews([old], [old, retry])).toEqual([old, retry]);
});
it('preserves cancellation against a late result while accepting a new explicit retry', () => {
    const cancelled = run(first, 'cancelled', 3), late = run(first, 'completed', 4), retry = run(second, 'queued', 0);
    expect(mergeRunViews([cancelled], [late, retry])).toEqual([cancelled, retry]);
});
it('accepts forward terminal recovery and keeps the input snapshots immutable', () => {
    const interrupted = run(first, 'failed', 3), recovered = run(first, 'completed', 4), current = [interrupted];
    expect(mergeRunViews(current, [recovered])).toEqual([recovered]);
    expect(current).toEqual([interrupted]);
});
