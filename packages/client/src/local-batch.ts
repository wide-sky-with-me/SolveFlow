// Decision: .agents/notes/implemented/architecture/2026-10-09-batch-learning-admission.md
// Decision: .agents/notes/implemented/architecture/2026-10-28-multi-batch-task-isolation.md
// Decision: .agents/notes/implemented/architecture/2026-10-28-batch-stop-and-export-preflight.md
import { MAX_BATCH_PHOTOS, MAX_QUEUED_BATCH_PHOTOS, MAX_PENDING_VERIFICATIONS, LocalBatchMaterialsSchema, type LocalBatchQueueSnapshot, type LocalBatchQueueTask } from '@solveflow/contracts/local';
import { isAuxiliaryContext, terminal, RunContextSchema, type RunContext, type RunView } from '@solveflow/contracts/http';
import type { LocalEngine } from './local-engine.js';
import type { DeviceSolve } from './local-engine.js';
import { batchMaterialRequests } from './local-batch-materials.js';
type BatchRequest = { message: string; context?: RunContext };
type WaitingItem = { id: string; batchId: string; execute: DeviceSolve; request?: BatchRequest; followUps?: BatchRequest[] };
type RunningItem = { batchId: string; started: Promise<RunView>; done: Promise<void>; solving: boolean; status: RunView['status']; continuePlan: boolean };
/** Bounded business queue of photo IDs. Pi still owns each solve and verifier loop. */
export class LocalBatchQueue {
  private waiting: WaitingItem[] = [];
  private running = new Map<string, RunningItem>();
  private listeners = new Set<() => void>();
  private preparing = Promise.resolve();
  private materialPreparing = Promise.resolve();
  private stoppingAll = false;
  private stoppingBatches = new Set<string>();
  private stops = new Map<string, Promise<void>>();
  private preparingCount = 0;
  private stopRevision = 0;
  private stopAllRevision = 0;
  private stopRevisions = new Map<string, number>();
  private materialFlight: { batchId: string; done: Promise<void> } | null = null;
  private error: string | null = null;
  private errors = new Map<string, string>();
  private materialBatchId: string | null = null;
  private snapshot: LocalBatchQueueSnapshot = Object.freeze({ tasks: Object.freeze([]), stoppingBatchIds: Object.freeze([]), stoppingAll: false, errors: Object.freeze({}), globalError: null });
  private materialRecipients = new Set<string>();
  constructor(private readonly engine: LocalEngine) {
    engine.subscribe(run => {
      const row = this.running.get(run.sessionId);
      if (row && !isAuxiliaryContext(run.context?.kind)) row.status = run.status;
      if (row?.solving && run.outcome?.status === 'completed' && !engine.batchSolvingIds.includes(run.sessionId)) {
        row.solving = false; this.emit(); this.pump();
      }
    });
  }
  get busy() { return this.preparingCount > 0 || this.waiting.length > 0 || this.running.size > 0; }
  get message() { return this.error ?? [...this.errors.values()].at(-1) ?? null; }
  messageFor(batchId: string) { return this.error ?? this.errors.get(batchId) ?? null; }
  isBusy(batchId: string) { return this.stoppingBatches.has(batchId) || this.snapshot.tasks.some(row => row.batchId === batchId); }
  private isStopping(batchId: string) { return this.stoppingAll || this.stoppingBatches.has(batchId); }
  private wasStopped(batchId: string, revision: number) { return this.isStopping(batchId) || this.stopAllRevision > revision || (this.stopRevisions.get(batchId) ?? 0) > revision; }
  private prepared() { this.preparingCount--; if (!this.preparingCount) this.stopRevisions.clear(); this.emit(); }
  getSnapshot = (): LocalBatchQueueSnapshot => this.snapshot;
  get ids() { return [...new Set([...this.waiting.map(row => row.id), ...this.running.keys(), ...this.materialRecipients])]; }
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private emit() {
    const tasks = new Map<string, LocalBatchQueueTask>();
    for (const row of this.waiting) tasks.set(row.id, { sessionId: row.id, batchId: row.batchId, phase: 'waiting' });
    for (const [id, row] of this.running) tasks.set(id, { sessionId: id, batchId: row.batchId, phase: row.solving ? 'solving' : 'verifying' });
    if (this.materialBatchId) for (const id of this.materialRecipients) tasks.set(id, { sessionId: id, batchId: this.materialBatchId, phase: 'preparing' });
    this.snapshot = Object.freeze({ tasks: Object.freeze([...tasks.values()].map(row => Object.freeze(row))), stoppingBatchIds: Object.freeze([...this.stoppingBatches]), stoppingAll: this.stoppingAll, errors: Object.freeze(Object.fromEntries(this.errors)), globalError: this.error });
    for (const listener of this.listeners) listener();
  }
  // Decision: .agents/notes/implemented/architecture/2026-10-09-batch-retry-and-phase-time.md
  enqueue(id: string, execute: DeviceSolve, retry = false, request?: { message: string; context: RunContext }, failedRunId?: string): Promise<void> {
    if (request) { RunContextSchema.parse(request.context); if (request.context.kind !== 'regenerate') return Promise.reject(new Error('批量补图仅可重新解答本题。')); }
    if (this.stoppingAll) return Promise.reject(new Error('正在停止批量任务。'));
    if (this.engine.storageBlocked) return Promise.reject(new Error('请先重试保存已有结果，再继续批量解题。'));
    if (this.preparingCount >= MAX_QUEUED_BATCH_PHOTOS) return Promise.reject(new Error('批量等待队列已满，请稍候。'));
    const revision = this.stopRevision;
    this.preparingCount++;
    const task = this.preparing.then(async () => {
      if (this.stoppingAll) throw new Error('正在停止批量任务。');
      if (this.engine.storageBlocked) throw new Error('请先重试保存已有结果，再继续批量解题。');
      if (this.ids.includes(id)) return;
      if (this.ids.length >= MAX_QUEUED_BATCH_PHOTOS) throw new Error('批量队列已满。');
      const record = await this.engine.repository.readMetadata(id);
      if (!record.batch) throw new Error('这不是批量题目。');
      if (this.wasStopped(record.batch.id, revision)) throw new Error('正在停止本批任务。');
      const last = record.session.runs.at(-1);
      if (last && !request && (!retry || !['failed', 'cancelled'].includes(last.status))) throw new Error('题目已有作答，请使用本题追问或重新解答。');
      if (failedRunId && last?.id !== failedRunId) throw new Error('这道题已有新的任务，请查看最新解答。');
      if (retry && last && isAuxiliaryContext(last.context?.kind)) throw new Error('请在本题中重试对应的辅助请求。');
      if (this.engine.actives.some(run => !isAuxiliaryContext(run.context?.kind) && !this.running.has(run.sessionId))) throw new Error('请先等待当前单题任务完成。');
      // 保留失败任务的补图版本与备用模型选择，避免重试退回默认解题路径。
      const retryRequest = retry && last ? { message: last.message, ...(last.context ? { context: last.context } : {}) } : undefined;
      const acceptedRequest = request ?? retryRequest;
      this.error = null; this.errors.delete(record.batch.id); this.waiting.push({ id, batchId: record.batch.id, execute, ...(acceptedRequest ? { request: acceptedRequest } : {}) }); this.emit(); this.pump();
    });
    const completed = task.finally(() => this.prepared());
    this.preparing = completed.catch(() => {}); return completed;
  }
  // Decision: .agents/notes/implemented/storage/2026-10-27-asynchronous-batch-materials.md
  async addMaterials(input: unknown, execute: DeviceSolve, signal?: AbortSignal): Promise<{ savedIds: string[]; queuedIds: string[] }> {
    signal?.throwIfAborted();
    const plan = LocalBatchMaterialsSchema.parse(input);
    const recipients = new Set(plan.images.flatMap(image => image.sessionIds));
    if (this.isStopping(plan.batchId) || this.engine.storageBlocked) throw new Error('请先结束停止操作或保存已有结果，再批量补图。');
    if (this.preparingCount >= MAX_BATCH_PHOTOS) throw new Error('补图等待队列已满，请稍候。');
    const revision = this.stopRevision;
    this.preparingCount++; this.emit();
    const task = this.materialPreparing.then(async () => {
      await this.preparing;
      signal?.throwIfAborted();
      if (this.wasStopped(plan.batchId, revision)) throw new Error('正在停止本批任务。');
      if (new Set([...this.ids, ...recipients]).size > MAX_QUEUED_BATCH_PHOTOS) throw new Error('批量队列已满。');
      // Hold only recipients: pump may continue dispatching every other question.
      this.materialFlight = { batchId: plan.batchId, done: task.then(() => {}, () => {}) };
      this.materialRecipients = recipients; this.materialBatchId = plan.batchId; this.emit();
      try {
        const records = await this.engine.addBatchMaterials(plan, signal, async ids => {
          signal?.throwIfAborted(); if (this.wasStopped(plan.batchId, revision)) throw new Error('正在停止本批任务。');
          const running = [...this.running].filter(([id]) => recipients.has(id));
          running.forEach(([, row]) => { row.continuePlan = false; });
          await Promise.allSettled(running.map(([, row]) => row.started));
          await Promise.all(this.engine.actives.filter(run => ids.includes(run.sessionId)).map(run => this.engine.cancelRun(run.id)));
          await Promise.all(running.map(([, row]) => row.done));
        });
        const savedIds = records.map(record => record.session.id);
        this.waiting = this.waiting.filter(row => !recipients.has(row.id));
        if (signal?.aborted || this.wasStopped(plan.batchId, revision)) return { savedIds, queuedIds: [] };
        this.error = null; this.errors.delete(plan.batchId);
        for (const record of records) {
          if (!record.batch) throw new Error('批次归属已变化。');
          const [request, ...followUps] = batchMaterialRequests(record);
          if (!request) throw new Error('补图重答计划为空。');
          this.waiting.push({ id: record.session.id, batchId: record.batch.id, execute, request, followUps });
        }
        this.emit(); return { savedIds, queuedIds: savedIds };
      } finally { this.materialFlight = null; this.materialRecipients = new Set(); this.materialBatchId = null; this.pump(); }
    });
    const completed = task.finally(() => this.prepared());
    this.materialPreparing = completed.then(() => {}, () => {}); return completed;
  }
  private pump() {
    if (this.stoppingAll) return;
    if (this.engine.storageBlocked) {
      this.waiting = [];
      this.error = '结果未能保存，批量任务已停止。请先重试保存，再手动继续待解题。';
      this.emit(); return;
    }
    while ([...this.running.values()].filter(row => row.solving).length < this.engine.concurrency.solver && this.running.size < MAX_PENDING_VERIFICATIONS && this.waiting.length) {
      const index = this.waiting.findIndex(row => !this.isStopping(row.batchId) && !this.materialRecipients.has(row.id) && !this.running.has(row.id));
      if (index < 0) break;
      const item = this.waiting.splice(index, 1)[0]!;
      // Register before start() publishes, so callbacks see a complete queue snapshot.
      const started = this.engine.start(item.id, item.request?.message ?? '', item.request?.context, item.execute);
      const state: RunningItem = { batchId: item.batchId, started, done: Promise.resolve(), solving: true, status: 'queued', continuePlan: true }; this.running.set(item.id, state);
      state.done = (async () => {
        try {
          const run = await started;
          await this.engine.waitForRun(run.id);
        } catch {
          this.waiting = this.waiting.filter(row => row.batchId !== item.batchId);
          this.errors.delete(item.batchId);
          this.errors.set(item.batchId, '题目未能启动，已停止本批后续任务。记录已保留，请检查配置或存储后手动继续。');
          if (this.errors.size > MAX_QUEUED_BATCH_PHOTOS) this.errors.delete(this.errors.keys().next().value!);
        }
        finally {
          this.running.delete(item.id);
          // Same-photo questions must finish one at a time and keep their original thread IDs.
          if (state.continuePlan && state.status === 'completed' && !this.isStopping(item.batchId) && !this.engine.storageBlocked && item.followUps?.length) {
            const [request, ...followUps] = item.followUps;
            if (request) this.waiting.unshift({ ...item, request, followUps });
          }
          this.emit(); this.pump();
        }
      })();
    }
    this.emit();
  }
  stop(batchId?: string): Promise<void> {
    const key = batchId ?? '*'; const pending = this.stops.get(key); if (pending) return pending;
    if (batchId && this.preparingCount && !this.stopRevisions.has(batchId) && this.stopRevisions.size >= MAX_QUEUED_BATCH_PHOTOS) return Promise.reject(new Error('等待中的批次操作过多，请稍候再停止。'));
    const revision = ++this.stopRevision;
    if (batchId) { this.stoppingBatches.add(batchId); if (this.preparingCount) this.stopRevisions.set(batchId, revision); }
    else { this.stoppingAll = true; this.stopAllRevision = revision; }
    this.emit();
    const task = this.stopSelected(batchId).finally(() => {
      this.stops.delete(key);
      if (batchId) this.stoppingBatches.delete(batchId); else this.stoppingAll = false;
      this.emit(); this.pump();
    });
    this.stops.set(key, task); return task;
  }
  private async cancelSessions(sessions: ReadonlySet<string>) {
    await Promise.all(this.engine.actives.filter(run => sessions.has(run.sessionId) && !terminal(run.status)).map(run => this.engine.cancelRun(run.id)));
  }
  private async stopSelected(batchId?: string) {
    this.waiting = this.waiting.filter(row => batchId !== undefined && row.batchId !== batchId);
    const selected = [...this.running].filter(([, row]) => batchId === undefined || row.batchId === batchId);
    for (const [, row] of selected) row.continuePlan = false;
    const material = this.materialFlight && (batchId === undefined || this.materialFlight.batchId === batchId) ? this.materialFlight.done : null;
    const sessions = new Set(selected.map(([id]) => id));
    // Abort registered runs now, before waiting for any start or persistence preparation.
    const cancelling = this.cancelSessions(sessions);
    this.emit(); this.pump();
    await Promise.all([cancelling, ...selected.map(([, row]) => row.started.catch(() => undefined))]);
    // start() may have registered after the first cancellation pass.
    await this.cancelSessions(sessions);
    await Promise.all([...(material ? [material] : []), ...selected.map(([, row]) => row.done)]);
    if (batchId === undefined) await Promise.all([this.preparing, this.materialPreparing]);
  }
  async waitForIdle() {
    while (this.busy) await Promise.all([this.preparing, this.materialPreparing, ...[...this.running.values()].map(row => row.done)]);
  }
}
