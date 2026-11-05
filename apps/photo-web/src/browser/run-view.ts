// Decision: .agents/notes/implemented/architecture/2026-11-04-photo-view-ordering.md
import { terminal, type RunView } from '@solveflow/contracts/http';

/** Run history is append-only here; delayed hydration must not rewind a displayed run. */
export function mergeRunViews(current: readonly RunView[], incoming: readonly RunView[]): RunView[] {
    const runs = [...current];
    for (const next of incoming) {
        const index = runs.findIndex(run => run.id === next.id);
        if (index === -1) { runs.push(next); continue; }
        const previous = runs[index]!;
        if (next.seq < previous.seq || previous.status === 'cancelled' && next.status !== 'cancelled'
            || terminal(previous.status) && !terminal(next.status)) continue;
        runs[index] = next;
    }
    return runs;
}
