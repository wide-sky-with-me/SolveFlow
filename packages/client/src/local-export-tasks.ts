import {
  ExportTaskFileSchema, ExportTaskMetadataSchema, ExportTaskProgressSchema, ExportTaskSchema,
  isExportTaskTerminal, MAX_EXPORT_QUEUED_TASKS, MAX_EXPORT_TASK_RECORDS,
  MAX_PENDING_EXPORT_ARTIFACTS, MAX_PENDING_EXPORT_SAVES, MAX_EXPORT_TASK_TIMEOUT_MS, MAX_EXPORT_ERROR_CHARACTERS,
  type ExportTask, type ExportTaskFile, type ExportTaskMetadata,
} from '@solveflow/contracts/local';

/** Explicitly classified local validation errors; arbitrary runner errors stay redacted. */
export class ExportTaskFailure extends Error {}

export interface ExportArtifact {
  name: string;
  mimeType: ExportTaskFile['mimeType'];
  data: Uint8Array;
}
export interface LocalExportTaskStore {
  list(): Promise<unknown[]>;
  save(task: ExportTask): Promise<void>;
  /** Atomically removes the record, file and accounting; failure preserves all three. */
  remove(id: string): Promise<void>;
  writeFile(id: string, file: ExportArtifact): Promise<void>;
  readFile(id: string): Promise<ExportArtifact | null>;
  removeFile(id: string): Promise<void>;
}
export type ExportTaskSnapshot = Readonly<Omit<ExportTask, 'file'>> & { readonly file: Readonly<ExportTaskFile> | null };
export type ExportTaskRunner = (signal: AbortSignal, progress: (value: string) => void) => Promise<ExportArtifact>;
export interface LocalExportTasksOptions {
  store: LocalExportTaskStore;
  uuid: () => string;
  now?: () => Date;
  timeoutMs?: number;
  onSettled?: (task: ExportTaskSnapshot) => void;
}
interface Execution {
  id: string;
  runner: ExportTaskRunner;
  controller: AbortController;
  done: Promise<void>;
}
interface PendingSave {
  task: ExportTask;
  artifact?: ExportArtifact;
  cleanup: boolean;
  notify: boolean;
  create?: boolean;
  committedTask?: ExportTask;
}
const SAVE_ERROR = '导出结果保存失败，请保持应用打开并重试保存。';
const INTERRUPTED_ERROR = '应用重载或存储故障，导出已中断；请明确重新提交导出。';
const TIMEOUT_ERROR = '导出超过执行期限，请检查题量后明确重新提交。';

function freezeTask(task: ExportTask): ExportTaskSnapshot {
  return Object.freeze({ ...task, file: task.file ? Object.freeze({ ...task.file }) : null });
}
function checkArtifact(value: ExportArtifact): ExportArtifact {
  if (!(value.data instanceof Uint8Array)) throw new Error('导出文件字节格式错误。');
  const file = ExportTaskFileSchema.parse({ name: value.name, mimeType: value.mimeType, bytes: value.data.byteLength });
  return { name: file.name, mimeType: file.mimeType, data: value.data.slice() };
}

/** Runners live only in this instance. Recovery and save retries never reconstruct them. */
export class LocalExportTasks {
  private readonly store: LocalExportTaskStore;
  private readonly uuid: () => string;
  private readonly now: () => Date;
  private readonly timeoutMs: number;
  private readonly records = new Map<string, ExportTaskSnapshot>();
  private readonly executions = new Map<string, Execution>();
  private readonly pending = new Map<string, PendingSave>();
  private readonly cancellations = new Set<string>();
  private readonly timeouts = new Set<string>();
  private readonly listeners = new Set<() => void>();
  private readonly settledListeners = new Set<(task: ExportTaskSnapshot) => void>();
  private readonly notified = new Set<string>();
  private snapshot: readonly ExportTaskSnapshot[] = Object.freeze([]);
  private waiting: Execution[] = [];
  private active: Execution | null = null;
  private serial: Promise<void> = Promise.resolve();
  private initialization: Promise<void> | null = null;
  private initialized = false;
  private observerError: string | null = null;

  constructor(options: LocalExportTasksOptions) {
    this.store = options.store; this.uuid = options.uuid; this.now = options.now ?? (() => new Date());
    this.timeoutMs = options.timeoutMs ?? MAX_EXPORT_TASK_TIMEOUT_MS;
    if (!Number.isInteger(this.timeoutMs) || this.timeoutMs < 1 || this.timeoutMs > MAX_EXPORT_TASK_TIMEOUT_MS) throw new Error('导出执行期限超出允许范围。');
    if (options.onSettled) this.settledListeners.add(options.onSettled);
  }
  getSnapshot = (): readonly ExportTaskSnapshot[] => this.snapshot;
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener); return () => { this.listeners.delete(listener); };
  };
  onSettled(listener: (task: ExportTaskSnapshot) => void): () => void {
    this.settledListeners.add(listener); return () => { this.settledListeners.delete(listener); };
  }
  get pendingSaveIds(): readonly string[] { return Object.freeze([...this.pending.keys()]); }
  get storageBlocked(): boolean { return this.pending.size > 0; }
  get notificationError(): string | null { return this.observerError; }

  initialize(): Promise<void> {
    if (this.initialization) return this.initialization;
    if (this.initialized) return Promise.resolve();
    this.initialization = this.lock(async () => {
      const rows = await this.store.list();
      if (rows.length > MAX_EXPORT_TASK_RECORDS) throw new Error('导出记录数量超过上限。');
      const tasks = rows.map(row => ExportTaskSchema.parse(row));
      if (new Set(tasks.map(task => task.id)).size !== tasks.length) throw new Error('导出记录标识符重复。');
      if (tasks.filter(task => !isExportTaskTerminal(task.status)).length > MAX_PENDING_EXPORT_SAVES || tasks.filter(task => task.status === 'running').length > 1) throw new Error('导出记录中的活动任务数量异常。');
      for (const task of tasks) this.records.set(task.id, freezeTask(task));
      for (const task of tasks) {
        if (isExportTaskTerminal(task.status)) continue;
        const interrupted = this.terminal(task, 'interrupted', INTERRUPTED_ERROR);
        try { await this.store.removeFile(task.id); await this.store.save(interrupted); this.records.set(task.id, freezeTask(interrupted)); }
        catch { this.retain({ task: interrupted, cleanup: true, notify: false }); }
      }
      this.initialized = true; this.emit();
      if (this.storageBlocked) throw new Error(SAVE_ERROR);
    }).finally(() => { this.initialization = null; });
    return this.initialization;
  }

  // Decision: .agents/notes/implemented/storage/2026-10-17-pdf-admission-cancellation.md
  async enqueue(metadata: ExportTaskMetadata, runner: ExportTaskRunner, signal?: AbortSignal): Promise<ExportTaskSnapshot> {
    signal?.throwIfAborted();
    const checked = ExportTaskMetadataSchema.parse(metadata);
    const task = await this.lock(async () => {
      signal?.throwIfAborted();
      this.requireInitialized();
      if (this.storageBlocked) throw new Error(SAVE_ERROR);
      if (this.waiting.length >= MAX_EXPORT_QUEUED_TASKS) throw new Error('后台导出排队已满，请等待或取消已有任务。');
      if (this.records.size >= MAX_EXPORT_TASK_RECORDS) throw new Error('导出记录已满，请手动删除旧记录。');
      const created = ExportTaskSchema.parse({ ...checked, schemaVersion: 1, id: this.uuid(), createdAt: this.timestamp(), startedAt: null, finishedAt: null, status: 'queued', progress: '等待导出', error: null, file: null });
      if (this.records.has(created.id) || this.executions.has(created.id)) throw new Error('导出任务标识符重复。');
      try { await this.store.save(created); }
      catch {
        const pending: PendingSave = { task: signal?.aborted ? this.terminal(created, 'cancelled') : this.terminal(created, 'interrupted', SAVE_ERROR), cleanup: true, notify: false, create: true };
        this.retain(pending);
        await this.interruptWaiting();
        if (signal?.aborted) {
          if (pending.task.status !== 'cancelled') this.retain({ ...pending, task: this.terminal(created, 'cancelled') });
          signal.throwIfAborted();
        }
        throw new Error(SAVE_ERROR);
      }
      // Keep ownership of the write until it settles; cancellation never admits a runner.
      if (signal?.aborted) {
        await this.commit({ task: this.terminal(created, 'cancelled'), cleanup: false, notify: true });
        signal.throwIfAborted();
      }
      const execution: Execution = { id: created.id, runner, controller: new AbortController(), done: Promise.resolve() };
      this.records.set(created.id, freezeTask(created)); this.executions.set(created.id, execution); this.waiting.push(execution); this.emit();
      return freezeTask(created);
    });
    // A queued subscriber may cancel synchronously or in the publication microtask.
    if (signal?.aborted) {
      try { await this.cancel(task.id); } finally { signal.throwIfAborted(); }
    }
    this.pump(); return task;
  }

  async cancel(id: string): Promise<void> {
    this.requireInitialized();
    const task = this.records.get(id);
    if (!task) throw new Error('导出记录不存在。');
    if (isExportTaskTerminal(task.status)) return;
    // Set the intent before taking the I/O lock: an in-flight successful save must see it.
    this.cancellations.add(id); this.executions.get(id)?.controller.abort();
    await this.lock(async () => {
      const current = this.records.get(id);
      if (!current || isExportTaskTerminal(current.status)) return;
      this.waiting = this.waiting.filter(execution => execution.id !== id);
      if (this.active?.id !== id) this.executions.delete(id);
      const buffered = this.pending.get(id);
      const committedTask = buffered?.task.status === 'succeeded' ? buffered.task : buffered?.committedTask;
      await this.commit({ task: this.terminal(current, 'cancelled'), ...(committedTask ? { committedTask } : {}), cleanup: this.pending.has(id), notify: true });
    });
    this.pump();
  }

  async remove(id: string): Promise<void> {
    await this.lock(async () => {
      this.requireInitialized(); const task = this.records.get(id);
      if (!task) throw new Error('导出记录不存在。');
      if (!isExportTaskTerminal(task.status)) throw new Error('请先取消或等待导出结束，再删除记录。');
      // The store owns the cross-record/file transaction; an early file delete breaks rollback.
      await this.store.remove(id);
      this.records.delete(id); this.pending.delete(id); this.notified.delete(id);
      if (!this.executions.has(id)) { this.cancellations.delete(id); this.timeouts.delete(id); }
      this.emit();
    });
  }

  async retrySave(id: string): Promise<void> {
    await this.lock(async () => {
      this.requireInitialized(); const pending = this.pending.get(id);
      if (!pending) throw new Error('该任务没有待保存结果。');
      const rows = await this.store.list();
      const persisted = rows.map(row => ExportTaskSchema.parse(row)).find(task => task.id === id);
      if (!persisted && !pending.create) throw new Error('导出记录已被删除，待保存结果已保留，请刷新后处理。');
      if (persisted && isExportTaskTerminal(persisted.status)) {
        const same = JSON.stringify(persisted) === JSON.stringify(pending.task);
        const correction = pending.task.status === 'cancelled' && pending.committedTask?.status === 'succeeded' && JSON.stringify(persisted) === JSON.stringify(pending.committedTask);
        if (!same && !correction) throw new Error('导出记录已有其他终态，保留待保存结果并停止覆盖。');
      }
      await this.commit(pending);
      if (this.pending.has(id)) throw new Error(SAVE_ERROR);
    });
  }

  async readFile(id: string): Promise<ExportArtifact | null> {
    return this.lock(async () => {
      this.requireInitialized(); const task = this.records.get(id);
      if (!task || task.status !== 'succeeded' || !task.file) return null;
      const value = await this.store.readFile(id);
      if (!value) return null;
      const artifact = checkArtifact(value);
      if (artifact.name !== task.file.name || artifact.mimeType !== task.file.mimeType || artifact.data.byteLength !== task.file.bytes) throw new Error('已保存导出文件与记录不一致。');
      return artifact;
    });
  }

  async waitForIdle(): Promise<void> {
    await this.serial;
    while (this.active) { await this.active.done; await this.serial; }
  }

  private requireInitialized(): void { if (!this.initialized) throw new Error('请先初始化后台导出队列。'); }
  private lock<T>(work: () => Promise<T>): Promise<T> {
    const result = this.serial.then(work); this.serial = result.then(() => {}, () => {}); return result;
  }
  private timestamp(task?: ExportTaskSnapshot): string {
    const minimum = task ? Date.parse(task.finishedAt ?? task.startedAt ?? task.createdAt) : 0;
    return new Date(Math.max(this.now().getTime(), minimum)).toISOString();
  }
  private terminal(task: ExportTaskSnapshot, status: 'failed' | 'cancelled' | 'interrupted', error: string | null = null): ExportTask {
    return ExportTaskSchema.parse({ ...task, status, finishedAt: this.timestamp(task), file: null, error, progress: status === 'cancelled' ? '已取消' : status === 'failed' ? '导出失败' : '导出已中断' });
  }
  private emit(): void {
    this.snapshot = Object.freeze([...this.records.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
    for (const listener of this.listeners) {
      try { listener(); } catch { this.observerError = '导出列表订阅回调发生错误。'; }
    }
  }
  private notify(task: ExportTaskSnapshot): void {
    if (this.notified.has(task.id)) return;
    this.notified.add(task.id);
    for (const listener of this.settledListeners) {
      try { listener(task); } catch { this.observerError = '导出完成通知回调发生错误。'; }
    }
  }
  private pump(): void {
    if (!this.initialized || this.active || this.storageBlocked) return;
    const execution = this.waiting.shift();
    if (!execution) return;
    this.active = execution; execution.done = this.run(execution);
  }
  // Decision: .agents/notes/implemented/storage/2026-10-17-pdf-dispatch-cancellation.md
  private async run(execution: Execution): Promise<void> {
    let deadline: ReturnType<typeof setTimeout> | undefined;
    try {
      const started = await this.lock(async () => {
        const task = this.records.get(execution.id);
        if (!task || isExportTaskTerminal(task.status)) return false;
        if (this.cancellations.has(task.id)) { await this.commit({ task: this.terminal(task, 'cancelled'), cleanup: false, notify: true }); return false; }
        const running = ExportTaskSchema.parse({ ...task, status: 'running', startedAt: this.timestamp(task), progress: '正在导出' });
        try { await this.store.save(running); }
        catch {
          this.retain({ task: this.cancellations.has(task.id) ? this.terminal(task, 'cancelled') : this.terminal(task, 'failed', SAVE_ERROR), cleanup: false, notify: true });
          await this.interruptWaiting(); return false;
        }
        if (this.cancellations.has(task.id)) { await this.commit({ task: this.terminal(running, 'cancelled'), cleanup: false, notify: true }); return false; }
        this.records.set(task.id, freezeTask(running)); this.emit(); return true;
      });
      if (!started) return;
      // Publishing running may synchronously cancel, or queue cancellation before this continuation.
      if (execution.controller.signal.aborted) { await this.lock(() => this.finishStopped(execution.id)); return; }
      deadline = setTimeout(() => {
        const task = this.records.get(execution.id);
        if (!task || isExportTaskTerminal(task.status)) return;
        this.timeouts.add(execution.id); execution.controller.abort();
        void this.lock(() => this.finishStopped(execution.id)).catch(() => { this.observerError = '导出超时收尾发生错误。'; });
      }, this.timeoutMs);
      let artifact: ExportArtifact;
      try {
        const output = await execution.runner(execution.controller.signal, value => this.progress(execution.id, value));
        if (this.cancellations.has(execution.id) || this.timeouts.has(execution.id)) { await this.lock(() => this.finishStopped(execution.id)); return; }
        artifact = checkArtifact(output);
      } catch (cause) {
        await this.lock(async () => {
          const task = this.records.get(execution.id);
          if (!task || isExportTaskTerminal(task.status)) return;
          const cancelled = this.cancellations.has(task.id);
          const message = cause instanceof ExportTaskFailure ? cause.message.trim() : '';
          const failure = message && message.length <= MAX_EXPORT_ERROR_CHARACTERS ? message : '导出失败，请检查内容后重新提交。';
          await this.commit({ task: this.terminal(task, cancelled ? 'cancelled' : 'failed', cancelled ? null : this.timeouts.has(task.id) ? TIMEOUT_ERROR : failure), cleanup: false, notify: true });
        });
        return;
      }
      await this.lock(async () => {
        const task = this.records.get(execution.id);
        if (!task || isExportTaskTerminal(task.status)) return;
        const succeeded = ExportTaskSchema.parse({ ...task, status: 'succeeded', progress: '导出完成', error: null, finishedAt: this.timestamp(task), file: { name: artifact.name, mimeType: artifact.mimeType, bytes: artifact.data.byteLength } });
        await this.commit({ task: succeeded, artifact, cleanup: false, notify: true });
      });
    } finally {
      if (deadline !== undefined) clearTimeout(deadline);
      this.executions.delete(execution.id);
      if (!this.pending.has(execution.id)) { this.cancellations.delete(execution.id); this.timeouts.delete(execution.id); }
      this.active = null; this.pump();
    }
  }
  private progress(id: string, value: string): void {
    const task = this.records.get(id);
    if (!task || task.status !== 'running' || this.cancellations.has(id) || this.timeouts.has(id) || this.pending.has(id)) return;
    this.records.set(id, freezeTask({ ...task, progress: ExportTaskProgressSchema.parse(value) })); this.emit();
  }
  private async finishStopped(id: string): Promise<void> {
    const task = this.records.get(id);
    if (!task || isExportTaskTerminal(task.status)) return;
    const cancelled = this.cancellations.has(id);
    await this.commit({ task: this.terminal(task, cancelled ? 'cancelled' : 'failed', cancelled ? null : TIMEOUT_ERROR), cleanup: false, notify: true });
  }
  private retain(pending: PendingSave): void {
    if (!this.records.has(pending.task.id) && this.records.size >= MAX_EXPORT_TASK_RECORDS) throw new Error('导出记录已满。');
    if (!this.pending.has(pending.task.id) && this.pending.size >= MAX_PENDING_EXPORT_SAVES) throw new Error('待保存导出记录超过上限。');
    if (pending.artifact && [...this.pending.values()].filter(value => value.artifact && value.task.id !== pending.task.id).length >= MAX_PENDING_EXPORT_ARTIFACTS) throw new Error('待保存导出文件超过上限。');
    this.pending.set(pending.task.id, pending);
    const visible = pending.task.status === 'succeeded'
      ? ExportTaskSchema.parse({ ...pending.task, status: 'running', progress: '导出完成，等待保存', finishedAt: null, file: null, error: SAVE_ERROR })
      : pending.task;
    this.records.set(pending.task.id, freezeTask(visible)); this.emit();
  }
  private async interruptWaiting(): Promise<void> {
    const waiting = this.waiting; this.waiting = [];
    for (const execution of waiting) {
      this.executions.delete(execution.id);
      const task = this.records.get(execution.id);
      if (task && !isExportTaskTerminal(task.status)) await this.commit({ task: this.terminal(task, 'interrupted', INTERRUPTED_ERROR), cleanup: false, notify: true });
    }
  }
  private async commit(pending: PendingSave): Promise<void> {
    const id = pending.task.id;
    let desired = pending.task;
    let cleanup = pending.cleanup;
    let committedTask = pending.committedTask;
    const applyCancellation = () => {
      // Preserve terminal identity across lost acknowledgements and persistence-only retries.
      if (this.cancellations.has(id)) { if (desired.status !== 'cancelled') desired = this.terminal(desired, 'cancelled'); }
      else if (this.timeouts.has(id) && (desired.status !== 'failed' || desired.error !== TIMEOUT_ERROR)) desired = this.terminal(desired, 'failed', TIMEOUT_ERROR);
    };
    applyCancellation();
    try {
      if (desired.status === 'succeeded' && pending.artifact) {
        cleanup = true;
        await this.store.writeFile(id, pending.artifact); applyCancellation();
      }
      if (desired.status !== 'succeeded' && cleanup) await this.store.removeFile(id);
      await this.store.save(desired); committedTask = desired;
      // Cancellation may arrive during the final metadata write after the file is durable.
      if ((desired.status !== 'cancelled' && this.cancellations.has(id)) || (desired.status === 'succeeded' && this.timeouts.has(id))) {
        applyCancellation();
        if (cleanup) await this.store.removeFile(id);
        await this.store.save(desired);
      }
      this.pending.delete(id); this.records.set(id, freezeTask(desired)); this.emit();
      if (pending.notify) this.notify(freezeTask(desired));
    } catch {
      applyCancellation();
      this.retain({ task: desired, ...(desired.status === 'succeeded' && pending.artifact ? { artifact: pending.artifact } : {}), ...(pending.create ? { create: true } : {}), ...(committedTask ? { committedTask } : {}), cleanup, notify: pending.notify });
      await this.interruptWaiting();
    }
  }
}
