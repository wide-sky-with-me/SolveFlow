import { BATCH_CONCURRENCY, MAX_BATCH_PHOTOS } from '@solveflow/contracts/local';
import { terminal, type RunView } from '@solveflow/contracts/http';
import type { LocalEngine } from './local-engine.js';
import type { DeviceSolve } from './local-engine.js';
/** Bounded business queue of photo IDs. Pi still owns each solve and verifier loop. */
export class LocalBatchQueue {
  private waiting: { id: string; batchId: string; execute: DeviceSolve }[] = [];
  private running = new Map<string, { batchId: string; started: Promise<RunView>; done: Promise<void> }>();
  private listeners = new Set<() => void>();
  private preparing = Promise.resolve();
  private stopping = false;
  private preparingCount = 0;
  private error: string | null = null;
  constructor(private readonly engine: LocalEngine) {}
  get busy() { return this.preparingCount > 0 || this.waiting.length > 0 || this.running.size > 0; }
  get message() { return this.error; }
  get ids() { return [...this.waiting.map(row => row.id), ...this.running.keys()]; }
  subscribe(listener: () => void) { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  private emit() { for (const listener of this.listeners) listener(); }
  enqueue(id: string, execute: DeviceSolve, retry = false): Promise<void> {
    if (this.stopping) return Promise.reject(new Error('正在停止批量任务。'));
    this.preparingCount++;
    const task = this.preparing.then(async () => {
      if (this.stopping) throw new Error('正在停止批量任务。');
      if (this.ids.includes(id)) return;
      if (this.ids.length >= MAX_BATCH_PHOTOS) throw new Error('批量队列已满。');
      const record = await this.engine.repository.read(id);
      if (!record.batch) throw new Error('这不是批量题目。');
      const last = record.session.runs.at(-1);
      if (last && (!retry || !['failed', 'cancelled'].includes(last.status))) throw new Error('题目已有作答，请使用本题追问或重新解答。');
      if (this.engine.actives.some(run => !this.running.has(run.sessionId))) throw new Error('请先等待当前单题或按需任务完成。');
      this.error = null; this.waiting.push({ id, batchId: record.batch.id, execute }); this.emit(); this.pump();
    });
    const completed = task.finally(() => { this.preparingCount--; this.emit(); });
    this.preparing = completed.catch(() => {}); return completed;
  }
  private pump() {
    if (this.stopping) return;
    while (this.running.size < BATCH_CONCURRENCY && this.waiting.length) {
      const item = this.waiting.shift()!;
      // Register before start() publishes, so callbacks see a complete queue snapshot.
      const started = this.engine.start(item.id, '', undefined, item.execute);
      const state = { batchId: item.batchId, started, done: Promise.resolve() }; this.running.set(item.id, state);
      state.done = (async () => {
        try {
          const run = await started;
          await this.engine.waitForRun(run.id);
        } catch { this.error = '部分题目未能启动，记录已保留，请检查配置或存储后手动继续。'; }
        finally { this.running.delete(item.id); this.emit(); this.pump(); }
      })();
    }
    this.emit();
  }
  async stop(batchId?: string) {
    this.stopping = true;
    try {
      await this.preparing;
      this.waiting = this.waiting.filter(row => batchId !== undefined && row.batchId !== batchId);
      const selected = [...this.running].filter(([, row]) => batchId === undefined || row.batchId === batchId);
      // Let accepted start preparations register their runs before cancelling them.
      await Promise.allSettled(selected.map(([, row]) => row.started));
      const sessions = new Set(selected.map(([id]) => id));
      await Promise.all(this.engine.actives.filter(run => sessions.has(run.sessionId) && !terminal(run.status)).map(run => this.engine.cancelRun(run.id)));
      await Promise.all(selected.map(([, row]) => row.done));
    } finally { this.stopping = false; this.emit(); this.pump(); }
  }
  async waitForIdle() { await this.preparing; while (this.busy) await Promise.all([...this.running.values()].map(row => row.done)); }
}
