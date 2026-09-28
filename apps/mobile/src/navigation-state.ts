import type { LocalBatch } from '@solveflow/contracts/local';
export type CurrentPage = { page: 'current'; questionId?: string; batch?: Omit<LocalBatch, 'position'> & { selectedId?: string } };
export type WorkspacePage = CurrentPage | { page: 'history' | 'profile' | 'favorites' };
export const EXIT_BACK_INTERVAL_MS = 2000;
export function forgetCurrentRecords(route: CurrentPage, records: ReadonlySet<string>, batches: ReadonlySet<string>): CurrentPage {
  if (route.questionId && records.has(route.questionId) || route.batch && batches.has(route.batch.id)) return { page: 'current' };
  if (route.batch?.selectedId && records.has(route.batch.selectedId)) {
    const { selectedId: _selected, ...batch } = route.batch;
    return { ...route, batch };
  }
  return route;
}
/** Bounded view history contains IDs and batch labels, never photos or model state. */
export class NavigationState {
  private entries: { key: number; route: WorkspacePage }[] = [{ key: 0, route: { page: 'current' } }];
  private cursor = 0; private nextKey = 1; private exitAt: number | null = null;
  get route() { return this.entries[this.cursor]!.route; }
  get key() { return this.entries[this.cursor]!.key; }
  get canBack() { return this.cursor > 0; }
  navigate(route: WorkspacePage, replace = false) {
    this.exitAt = null;
    if (JSON.stringify(route) === JSON.stringify(this.route)) return false;
    if (replace) this.entries[this.cursor] = { key: this.key, route };
    else { this.entries = [...this.entries.slice(0, this.cursor + 1), { key: this.nextKey++, route }].slice(-32); this.cursor = this.entries.length - 1; }
    return true;
  }
  restore(key: number) { const index = this.entries.findIndex(entry => entry.key === key); if (index < 0) return false; this.cursor = index; this.exitAt = null; return true; }
  forgetRecords(records: ReadonlySet<string>, batches: ReadonlySet<string>) {
    this.entries = this.entries.map(entry => ({ ...entry, route: entry.route.page === 'current' ? forgetCurrentRecords(entry.route, records, batches) : entry.route }));
    this.exitAt = null;
  }
  back(now: number): 'page' | 'hint' | 'exit' {
    if (this.canBack) { this.cursor--; this.exitAt = null; return 'page'; }
    if (this.exitAt !== null && now >= this.exitAt && now - this.exitAt <= EXIT_BACK_INTERVAL_MS) { this.exitAt = null; return 'exit'; }
    this.exitAt = now; return 'hint';
  }
  resetExit() { this.exitAt = null; }
}
