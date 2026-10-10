import { MAX_LOCAL_MODEL_RUNS } from '@solveflow/contracts/local';
/** Holds bounded existing jobs; never starts or replays a solve. */
export class BackgroundLifetime {
  private readonly current = new Map<string, { done: Promise<void>; finish: () => void }>();
  begin(id: string) {
    if (this.current.has(id) || this.current.size >= MAX_LOCAL_MODEL_RUNS) throw new Error('后台任务重复或超限。');
    let finish = () => {};
    const done = new Promise<void>(resolve => { finish = resolve; }); this.current.set(id, { done, finish });
  }
  wait(id: string): Promise<void> { return this.current.get(id)?.done ?? Promise.resolve(); }
  end(id: string) { const entry = this.current.get(id); if (entry) { this.current.delete(id); entry.finish(); } }
}
