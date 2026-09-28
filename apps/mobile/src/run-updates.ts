import type { RunView } from '@solveflow/contracts/http';

export function mergeRunUpdate(runs: readonly RunView[], update: RunView): RunView[] {
  // Repository order records causality. Wall-clock timestamps can move backwards,
  // and a late event for an older run must not make it the latest conversation.
  return runs.some(run => run.id === update.id)
    ? runs.map(run => run.id === update.id ? update : run)
    : [...runs, update];
}
