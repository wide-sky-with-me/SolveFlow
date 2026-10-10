import type { RunView } from '@solveflow/contracts/http';

export function mergeRunUpdate(runs: readonly RunView[], update: RunView): RunView[] {
  // Repository order records causality. Wall-clock timestamps can move backwards,
  // and a late event for an older run must not make it the latest conversation.
  return runs.some(run => run.id === update.id)
    ? runs.map(run => run.id === update.id ? update : run)
    : [...runs, update];
}

/** A slow disk snapshot must not overwrite events received while it was loading. */
export function mergeRunSnapshot(runs: readonly RunView[], updates: Iterable<RunView>): RunView[] {
  let merged = [...runs];
  for (const update of updates) {
    const saved = merged.find(run => run.id === update.id);
    if (saved && (saved.seq > update.seq || saved.outcome && !update.outcome)) continue;
    merged = mergeRunUpdate(merged, update);
  }
  return merged;
}
