// Decision: .agents/notes/implemented/architecture/2026-10-09-batch-learning-admission.md
import { MAX_BATCH_PHOTOS } from '@solveflow/contracts/local';
import { isAuxiliaryContext, terminal, RunContextSchema, type RunContext, type RunView } from '@solveflow/contracts/http';
import type { LocalEngine } from './local-engine.js';
import type { DeviceSolve } from './local-engine.js';
/** Bounded business queue of photo IDs. Pi still owns each solve and verifier loop. */
export class LocalBatchQueue {
  private waiting: { id: string; batchId: string; execute: DeviceSolve; request?: { message: string; context?: RunContext } }[] = [];
  private running = new Map<string, { batchId: string; started: Promise<RunView>; done: Promise<void>; solving: boolean }>();
  private listeners = new Set<() => void>();
  private preparing = Promise.resolve();
  private stopping = false;
  private preparingCount = 0;
  private error: string | null = null;
  constructor(private readonly engine: LocalEngine) {
    engine.subscribe(run => {
      const row = this.running.get(run.sessionId);
      if (row?.solving && run.outcome?.status === 'completed' && !engine.batchSolvingIds.includes(run.sessionId)) {
        row.solving = false; this.emit(); this.pump();
      }
    });
  }
  get busy() { return this.preparingCount > 0 || this.waiting.length > 0 || this.running.size > 0; }
  get message() { return this.error; }
  get ids() { return [...this.waiting.map(row => row.id), ...this.running.keys()]; }
  subscribe(listener: () => void) { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  private emit() { for (const listener of this.listeners) listener(); }
  // Decision: .agents/notes/implemented/architecture/2026-10-09-batch-retry-and-phase-time.md
  enqueue(id: string, execute: DeviceSolve, retry = false, request?: { message: string; context: RunContext }, failedRunId?: string): Promise<void> {
    if (request) { RunContextSchema.parse(request.context); if (request.context.kind !== 'regenerate') return Promise.reject(new Error('批量补图仅可重新解答本题。')); }
    if (this.stopping) return Promise.reject(new Error('正在停止批量任务。'));
    if (this.engine.storageBlocked) return Promise.reject(new Error('请先重试保存已有结果，再继续批量解题。'));
    this.preparingCount++;
    const task = this.preparing.then(async () => {
      if (this.stopping) throw new Error('正在停止批量任务。');
      if (this.engine.storageBlocked) throw new Error('请先重试保存已有结果，再继续批量解题。');
      if (this.ids.includes(id)) return;
      if (this.ids.length >= MAX_BATCH_PHOTOS) throw new Error('批量队列已满。');
      const record = await this.engine.repository.readMetadata(id);
      if (!record.batch) throw new Error('这不是批量题目。');
      const last = record.session.runs.at(-1);
      if (last && !request && (!retry || !['failed', 'cancelled'].includes(last.status))) throw new Error('题目已有作答，请使用本题追问或重新解答。');
      if (failedRunId && last?.id !== failedRunId) throw new Error('这道题已有新的任务，请查看最新解答。');
      if (retry && last && isAuxiliaryContext(last.context?.kind)) throw new Error('请在本题中重试对应的辅助请求。');
      if (this.engine.actives.some(run => !isAuxiliaryContext(run.context?.kind) && !this.running.has(run.sessionId))) throw new Error('请先等待当前单题任务完成。');
      // 保留失败任务的补图版本与备用模型选择，避免重试退回默认解题路径。
      const retryRequest = retry && last ? { message: last.message, ...(last.context ? { context: last.context } : {}) } : undefined;
      const acceptedRequest = request ?? retryRequest;
      this.error = null; this.waiting.push({ id, batchId: record.batch.id, execute, ...(acceptedRequest ? { request: acceptedRequest } : {}) }); this.emit(); this.pump();
    });
    const completed = task.finally(() => { this.preparingCount--; this.emit(); });
    this.preparing = completed.catch(() => {}); return completed;
  }
  private pump() {
    if (this.stopping) return;
    if (this.engine.storageBlocked) {
      this.waiting = [];
      this.error = '结果未能保存，批量任务已停止。请先重试保存，再手动继续待解题。';
      this.emit(); return;
    }
    while ([...this.running.values()].filter(row => row.solving).length < this.engine.concurrency.solver && this.waiting.length) {
      const item = this.waiting.shift()!;
      // Register before start() publishes, so callbacks see a complete queue snapshot.
      const started = this.engine.start(item.id, item.request?.message ?? '', item.request?.context, item.execute);
      const state = { batchId: item.batchId, started, done: Promise.resolve(), solving: true }; this.running.set(item.id, state);
      state.done = (async () => {
        try {
          const run = await started;
          await this.engine.waitForRun(run.id);
        } catch { this.waiting = []; this.error = '题目未能启动，已停止后续任务。记录已保留，请检查配置或存储后手动继续。'; }
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
