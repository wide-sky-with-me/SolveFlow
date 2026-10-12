// Decision: .agents/notes/implemented/agent/2026-10-09-direct-answer-review.md
// Decision: .agents/notes/implemented/architecture/2026-10-09-batch-learning-admission.md
// Decision: .agents/notes/implemented/architecture/2026-10-08-answer-checkpoint-queues.md
// Decision: .agents/notes/implemented/architecture/2026-10-09-independent-batch-concurrency.md
import { z } from 'zod';
import { checkHistoryImage } from './history-image.js';
import {
  MAX_LOCAL_RECORDS, MAX_LOCAL_DIAGNOSTICS, MAX_LOCAL_AUXILIARY_RUNS, BATCH_VERIFICATION_CONCURRENCY, MAX_PENDING_VERIFICATIONS, LocalConcurrencySchema, LocalMaterialSchema, MAX_MATERIAL_IMAGES, LocalBatchSchema, LocalBatchEditSchema, LocalRecordSchema, LocalDiagnosticSchema,
  type LocalConcurrency, type LocalBatch, type LocalDiagnostic, type LocalRecord, type ExamType, type LocalImageEdit,
} from '@solveflow/contracts/local';
import { isAuxiliaryContext, questionThreadHistory, terminal, type RunContext, type RunView } from '@solveflow/contracts/http';
import { AnswerCandidateSchema, SolveOutcomeSchema, makeSafeAgentError, type AnswerCandidate, type SolverInput, type PublicAgentEvent, type SolveOutcome } from '@solveflow/contracts/agent';
import { LocalRepository } from './local-repository.js';
import { prepareLocalRunRequest } from './local-run-request.js';
import { PhaseQueue } from './phase-queue.js';
import { applyImageEdit, currentImageIds } from './local-image-selection.js';
export type DeviceSolveLifecycle = { candidate: (candidate: AnswerCandidate) => Promise<void>; verification: () => Promise<() => Promise<void>> };

/** One model execution; LocalEngine supplies validated input and owns persistence. */
export type DeviceSolve = (
  input: SolverInput,
  signal: AbortSignal,
  event: (event: PublicAgentEvent) => void,
  diagnostic: (entry: LocalDiagnostic) => void,
  lifecycle?: DeviceSolveLifecycle,
) => Promise<SolveOutcome>;

type ActiveRun = {
  run: RunView;
  controller: AbortController;
  done: Promise<void>;
  cancellation: 'user' | 'deadline';
  protected: boolean;
};

type PendingSave = { run: RunView; previousOutcome?: SolveOutcome | null };
type BackgroundLifecycle = {
  start: (runId: string) => Promise<void>;
  stop: (runId: string) => Promise<void>;
  diagnostic?: (entry: LocalDiagnostic) => void;
};

/** One-shot on-demand requests run beside the conversation; the contract owns the kind list. */
const MAX_AUXILIARY = MAX_LOCAL_AUXILIARY_RUNS;

/** Device task lifecycle. See docs/subsystems/local-run-lifecycle.md for lock boundaries. */
export class LocalEngine {
  // Slot kinds intentionally differ: one conversation may coexist with auxiliary requests;
  // batches exclude a new conversation but share admission with bounded learning requests.
  private current: ActiveRun | null = null;
  private readonly batchRuns = new Map<string, ActiveRun>();
  private readonly batchVerifications = new Map<string, ActiveRun>();
  private readonly verificationDispatch = new PhaseQueue(BATCH_VERIFICATION_CONCURRENCY, MAX_PENDING_VERIFICATIONS);
  private limits = LocalConcurrencySchema.parse({});
  private correctionGeneration = 0;
  invalidatePendingCorrections() { this.correctionGeneration++; }
  get concurrency(): Readonly<LocalConcurrency> { return { ...this.limits }; }
  configureConcurrency(value?: LocalConcurrency) {
    const parsed = LocalConcurrencySchema.parse(value ?? {});
    if (this.actives.length) throw new Error('请先等待解题结束或取消，再修改并发设置。');
    this.verificationDispatch.setConcurrency(parsed.verifier);
    this.limits = parsed;
    this.correctionGeneration++;
  }
  get batchSolvingIds() { return [...this.batchRuns.values()].map(item => item.run.sessionId); }
  private readonly auxiliary = new Map<string, ActiveRun>();
  // At most one accepted batch can reach this map. New work is blocked until these
  // terminal results are saved or explicitly deleted.
  // Decision: .agents/notes/implemented/storage/2026-10-03-pending-result-save.md
  private readonly unsaved = new Map<string, PendingSave>();
  private readonly storageListeners = new Set<() => void>();
  /** Preparation and result writes are serialized; executions overlap afterwards. */
  private queue: Promise<unknown> = Promise.resolve();
  private deleting = false;
  private listeners = new Set<(run: RunView) => void>();
  private errors = new Set<(message: string) => void>();
  constructor(
    readonly repository: LocalRepository,
    private readonly uuid: () => string,
    private readonly background?: BackgroundLifecycle,
  ) {}

  get active() {
    return this.current?.run ?? this.batchRuns.values().next().value?.run ?? this.batchVerifications.values().next().value?.run ?? null;
  }

  /** Snapshot membership, not live iteration: cancellation must target the accepted runs. */
  private activeRuns(): ActiveRun[] {
    return [...(this.current ? [this.current] : []), ...this.batchRuns.values(), ...this.batchVerifications.values(), ...this.auxiliary.values()];
  }

  /** Every in-flight run, conversation first, so the UI can merge them into the stored session. */
  get actives(): RunView[] {
    return this.activeRuns().map(item => item.run);
  }

  get unsavedRuns(): RunView[] {
    return [...this.unsaved.values()].map(({ run }) => ({ ...run }));
  }

  get storageBlocked() {
    return this.unsaved.size > 0;
  }

  subscribeStorage(listener: () => void) {
    this.storageListeners.add(listener);
    return () => {
      this.storageListeners.delete(listener);
    };
  }

  private storageChanged() {
    for (const listener of this.storageListeners)
      listener();
  }

  subscribe(listener: (run: RunView) => void) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  onError(listener: (message: string) => void) {
    this.errors.add(listener);
    return () => {
      this.errors.delete(listener);
    };
  }

  async create(image: string, width: number, height: number, exam: ExamType = 'general', batch?: LocalBatch): Promise<LocalRecord> {
    if (this.deleting)
      throw new Error('正在删除历史，请稍候。');
    return this.lock(async () => {
      if (this.storageBlocked)
        throw new Error('请先重试保存已有结果，再添加题目。');
      const history = await this.repository.listHistory({ cached: true });
      if (history.length >= MAX_LOCAL_RECORDS)
        throw new Error(`已保存${MAX_LOCAL_RECORDS}张题图，请删除不需要的记录后继续。`);
      if (batch) {
        LocalBatchSchema.parse(batch);
        const siblings = history.filter(row => row.batch?.id === batch.id);
        if (siblings.some(row => row.batch?.position === batch.position))
          throw new Error('批量序号已存在。');
        if (batch.exam !== exam)
          throw new Error('批量考试类型不一致。');
      }
      const id = this.uuid();
      const createdAt = new Date().toISOString();
      const raw = image.split(',')[1] ?? '';
      const bytes = Math.floor(raw.length * 3 / 4) - (raw.endsWith('==') ? 2 : raw.endsWith('=') ? 1 : 0);
      const record = LocalRecordSchema.parse({
        schemaVersion: 1,
        image,
        exam,
        ...(batch ? { batch } : {}),
        session: {
          schemaVersion: 1,
          id,
          subject: 'general',
          createdAt,
          runs: [],
          upload: {
            schemaVersion: 1,
            id,
            mimeType: 'image/jpeg',
            width,
            height,
            bytes,
            expiresAt: '9999-12-31T00:00:00.000Z',
            previewUrl: `/api/v1/uploads/${id}/image`,
          },
        },
      });
      await this.repository.save(record);
      return record;
    });
  }

  // Only preparation and persistence use this lock. Awaiting active.done here would deadlock.
  private lock<T>(task: () => Promise<T>): Promise<T> {
    const previous = this.queue;
    let release!: () => void;
    this.queue = new Promise<void>(resolve => {
      release = resolve;
    });
    return previous.catch(() => {}).then(task).finally(() => release());
  }

  /** Save material only; adding evidence never dispatches a paid request. */
  async addMaterial(id: string, image: string, width: number, height: number): Promise<LocalRecord> {
    this.correctionGeneration++;
    if (this.deleting) throw new Error('正在删除历史，请稍候。');
    return this.lock(async () => {
      if (this.storageBlocked || this.actives.some(run => run.sessionId === id)) throw new Error('请先结束本题解题并保存结果，再补充材料。');
      const record = await this.repository.read(id);
      if (currentImageIds(record).length >= MAX_MATERIAL_IMAGES + 1) throw new Error(`最多使用${MAX_MATERIAL_IMAGES + 1}张同题图片。`);
      const encoded = image.slice(image.indexOf(',') + 1);
      const material = LocalMaterialSchema.parse({ id: this.uuid(), image, width, height, bytes: atob(encoded).length });
      checkHistoryImage(image, material);
      if (record.activeImageIds) record.activeImageIds = [...record.activeImageIds, material.id];
      record.materials = [...(record.materials ?? []), material];
      await this.repository.save(record);
      return record;
    });
  }

  async start(id: string, message: string, context: RunContext | undefined, execute: DeviceSolve, imageEdit?: LocalImageEdit): Promise<RunView> {
    this.correctionGeneration++;
    if (imageEdit && context?.kind !== 'correction') throw new Error('图片更正只能用于重新解答。');
    return this.startRun(id, message, context, execute, undefined, imageEdit);
  }

  /** This continuation belongs only to an explicitly accepted check; it is never restored on startup. */
  async startVerification(id: string, message: string, context: RunContext, execute: DeviceSolve): Promise<RunView> {
    if (context.kind !== 'verification') throw new Error('INVALID_SAVED_CONTEXT');
    const generation = this.correctionGeneration + 1;
    const run = await this.start(id, message, context, execute);
    void this.waitForRun(run.id).then(() => this.startRun(id, '校验发现原答案错误，请结合原图和全部补图重新完整解答本题，并校验新答案。',
      { kind: 'regenerate', sourceRunId: context.sourceRunId, ...(context.number ? { number: context.number } : {}), useBackup: true },
      execute, { runId: run.id, generation })).catch(error => {
      if (error instanceof Error && error.message === 'AUTO_CORRECTION_OBSOLETE') return;
      for (const listener of this.errors) listener('备用自动解答未能启动，原答案和校验记录已保留，请检查当前任务或存储状态。');
    });
    return run;
  }

  private async startRun(id: string, message: string, context: RunContext | undefined, execute: DeviceSolve,
    correction?: { runId: string; generation: number }, imageEdit?: LocalImageEdit): Promise<RunView> {
    if (correction && correction.generation !== this.correctionGeneration) throw new Error('AUTO_CORRECTION_OBSOLETE');
    if (this.deleting)
      throw new Error('正在删除历史，请稍候。');
    const auxiliary = isAuxiliaryContext(context?.kind);
    if (auxiliary) {
      if (this.auxiliary.size >= MAX_AUXILIARY)
        throw new Error('同时进行的按需请求过多，请稍候。');
    }
    return this.lock(async () => {
      if (correction && correction.generation !== this.correctionGeneration) throw new Error('AUTO_CORRECTION_OBSOLETE');
      if (this.storageBlocked)
        throw new Error('请先重试保存已有结果，再开始解题。');
      const stored = await this.repository.read(id);
      const record = imageEdit ? applyImageEdit(stored, imageEdit) : stored;
      if (correction) {
        const check = record.session.runs.find(item => item.id === correction.runId);
        const latest = (context ? questionThreadHistory(record.session.runs, context) : record.session.runs)
          .filter(item => !isAuxiliaryContext(item.context?.kind)).at(-1);
        if (correction.generation !== this.correctionGeneration || check?.status !== 'completed'
          || check.outcome?.status !== 'completed' || check.outcome.verification?.verdict !== 'fail'
          || check.outcome.verification.issues.some(issue => issue.code === 'POLICY_VIOLATION')
          || latest?.id !== context?.sourceRunId)
          throw new Error('AUTO_CORRECTION_OBSOLETE');
      }
      const batch = !!record.batch && !auxiliary;
      if (auxiliary && this.auxiliary.size >= MAX_AUXILIARY)
        throw new Error('同时进行的按需请求过多，请稍候。');
      if (batch && (this.current || this.batchRuns.size >= this.limits.solver))
        throw new Error('解题并发已满。');
      if (batch && this.batchRuns.size + this.batchVerifications.size >= MAX_PENDING_VERIFICATIONS)
        throw new Error('批量队列已满。');
      if (!auxiliary && !batch && (this.current || this.batchRuns.size || this.batchVerifications.size))
        throw new Error('请等待当前解题完成，或先取消它。');
      // Admission remains locked until queued is durable and the slot is reserved.
      const { imageIds, ...request } = prepareLocalRunRequest(record, message, context);
      const run: RunView = {
        schemaVersion: 1,
        id: this.uuid(),
        sessionId: id,
        status: 'queued',
        message,
        createdAt: new Date().toISOString(),
        seq: 0,
        outcome: null,
        imageIds,
        ...(context ? { context } : {}),
        ...(imageIds[0] === record.session.upload.id && request.materials?.length ? { materialIds: request.materials.map(item => item.id) } : {}),
      };
      record.session.runs.push(run);
      await this.repository.save(record);
      const controller = new AbortController();
      const active: ActiveRun = { run, controller, done: Promise.resolve(), cancellation: 'user', protected: false };
      if (auxiliary)
        this.auxiliary.set(run.id, active);
      else if (batch)
        this.batchRuns.set(run.id, active);
      else
        this.current = active;
      // Decision: .agents/notes/implemented/agent/2026-10-03-answer-and-exam-context.md
      const input: SolverInput = {
        schemaVersion: 1,
        role: 'solver',
        exam: record.exam ?? 'general',
        identity: { ownerId: 'local-device', sessionId: id, runId: run.id },
        message,
        evidence: [],
        ...request,
        verificationMode: batch ? 'automatic' : 'manual',
      };
      const publish = () => {
        for (const listener of this.listeners)
          listener({ ...active.run });
      };
      publish();
      const entries: LocalDiagnostic[] = [];
      let writes = Promise.resolve();
      const diagnose = (value: LocalDiagnostic) => {
        const entry = LocalDiagnosticSchema.parse(value);
        if (entry.runId !== run.id || entries.length >= MAX_LOCAL_DIAGNOSTICS)
          return;
        entries.push(entry);
        const snapshot = [...entries];
        writes = writes.then(() => this.repository.saveDiagnostics(run.id, snapshot)).catch(() => {
          for (const listener of this.errors)
            listener('诊断信息未能保存。');
        });
        this.background?.diagnostic?.(entry);
      };
      const lifecycle = (reason: LocalDiagnostic['reason']) => diagnose({
        schemaVersion: 1,
        runId: run.id,
        role: 'runtime',
        event: 'lifecycle',
        attempt: 0,
        elapsedMs: Math.max(0, Math.min(1_000_000, Date.now() - Date.parse(run.createdAt))),
        reason,
      });
      // Dispatch outside the admission promise: start() returns while the accepted run continues.
      active.done = (async () => {
        let outcome: SolveOutcome;
        try {
          try {
            active.protected = true;
            await this.background?.start(run.id);
          } catch {
            lifecycle('background_start');
            throw new Error('BACKGROUND_START_FAILED');
          }
          lifecycle('started');
          if (controller.signal.aborted)
            throw new Error('CANCELLED');
          outcome = SolveOutcomeSchema.parse(await execute(input, controller.signal, event => {
            if (controller.signal.aborted || terminal(active.run.status))
              return;
            if (event.type === 'run.status' && event.runId === run.id) {
              active.run = { ...active.run, status: event.status, seq: active.run.seq + 1 };
              publish();
            }
          }, diagnose, {
            candidate: async value => {
              const candidate = AnswerCandidateSchema.parse(value);
              await this.lock(async () => {
                if (controller.signal.aborted || terminal(active.run.status)) throw new Error('CANCELLED');
                const latest = await this.repository.read(id);
                const pending = SolveOutcomeSchema.parse({ schemaVersion: 1, status: 'completed', candidate, verified: false, verification: null, warning: null, verificationStatus: 'pending' });
                const next = { ...active.run, outcome: pending, status: 'verifying' as const, seq: active.run.seq + 1 };
                latest.session.runs = latest.session.runs.map(item => item.id === run.id ? next : item);
                latest.session.subject = candidate.problem.subject;
                await this.repository.save(latest);
                if (controller.signal.aborted) throw new Error('CANCELLED');
                active.run = next; publish();
              });
              if (batch && !this.batchVerifications.has(run.id)) {
                await this.background?.stop(run.id); active.protected = false;
                if (controller.signal.aborted) throw new Error('CANCELLED');
                // Admission already bounds the whole batch. Waiting for verification must
                // never occupy a solver slot, even when every verifier is busy.
                this.batchRuns.delete(run.id); this.batchVerifications.set(run.id, active);
                active.run = { ...active.run, seq: active.run.seq + 1 }; publish();
              }
            },
            verification: async () => {
              if (!batch) return async () => {};
              const queuedAt = performance.now();
              const release = await this.verificationDispatch.acquire(controller.signal);
              if (controller.signal.aborted) { release(); throw new Error('CANCELLED'); }
              try {
                diagnose({ schemaVersion: 1, runId: run.id, role: 'runtime', event: 'queue', attempt: 0,
                  elapsedMs: Math.max(0, Math.min(1_000_000, Date.now() - Date.parse(run.createdAt))), durationMs: Math.max(0, Math.min(1_000_000, Math.round(performance.now() - queuedAt))) });
                active.protected = true; await this.background?.start(run.id);
              }
              catch { release(); throw new Error('BACKGROUND_START_FAILED'); }
              return async () => {
                try { await this.background?.stop(run.id); active.protected = false; }
                catch { for (const listener of this.errors) listener('后台服务未能正常结束，请重新打开应用。'); }
                finally { release(); }
              };
            },
          }));
        } catch {
          outcome = {
            schemaVersion: 1,
            status: controller.signal.aborted ? 'cancelled' : 'failed',
            verified: false,
            error: makeSafeAgentError(controller.signal.aborted ? 'CANCELLED' : 'INTERNAL_ERROR', run.id),
          };
        }
        if (controller.signal.aborted)
          outcome = {
            schemaVersion: 1,
            status: active.cancellation === 'deadline' ? 'failed' : 'cancelled',
            verified: false,
            error: makeSafeAgentError(active.cancellation === 'deadline' ? 'RUN_TIMEOUT' : 'CANCELLED', run.id),
          };
        lifecycle(controller.signal.aborted ? active.cancellation === 'deadline' ? 'deadline' : 'cancelled' : outcome.status === 'failed' ? 'failed' : 'completed');
        await writes;
        let committed: RunView | undefined;
        try {
          // Re-read under the lock: concurrent runs may have appended their own records meanwhile.
          await this.lock(async () => {
            const latest = await this.repository.read(id);
            const subject = latest.session.subject;
            const applyCancellation = () => {
              if (!controller.signal.aborted)
                return false;
              const status = active.cancellation === 'deadline' ? 'failed' : 'cancelled';
              const code = active.cancellation === 'deadline' ? 'RUN_TIMEOUT' : 'CANCELLED';
              if (outcome.status === status && 'error' in outcome && outcome.error.code === code)
                return false;
              lifecycle(active.cancellation === 'deadline' ? 'deadline' : 'cancelled');
              outcome = { schemaVersion: 1, status, verified: false, error: makeSafeAgentError(code, run.id) };
              return true;
            };
            const persist = async () => {
              const finalRun = { ...active.run, status: outcome.status, outcome, seq: active.run.seq + 1 };
              const replaced = latest.session.runs.map(value => value.id === run.id ? finalRun : value);
              latest.session.runs = replaced.some(value => value.id === run.id) ? replaced : [...replaced, finalRun];
              latest.session.subject = outcome.status === 'completed' || outcome.status === 'needs_clarification' ? outcome.candidate.problem.subject : subject;
              await this.repository.save(latest);
              return finalRun;
            };
            applyCancellation();
            let saved = await persist();
            committed = saved;
            // A storage transaction cannot be aborted here. Correct a cancellation received during
            // that write before publishing; the first cancellation reason is fixed, so this is bounded.
            if (applyCancellation())
              saved = await persist();
            active.run = saved;
          });
          await writes;
          publish();
        } catch {
          if (controller.signal.aborted)
            outcome = {
              schemaVersion: 1,
              status: active.cancellation === 'deadline' ? 'failed' : 'cancelled',
              verified: false,
              error: makeSafeAgentError(active.cancellation === 'deadline' ? 'RUN_TIMEOUT' : 'CANCELLED', run.id),
            };
          this.unsaved.set(run.id, {
            run: { ...active.run, status: outcome.status, outcome, seq: active.run.seq + 1 },
            ...(committed ? { previousOutcome: committed.outcome } : {}),
          });
          this.storageChanged();
          for (const listener of this.errors)
            listener('结果暂未保存，请释放存储空间后重试保存。请保持应用打开，关闭后未保存结果可能丢失。');
        }
      })().finally(async () => {
        try {
          if (active.protected) await this.background?.stop(run.id);
        } catch {
          for (const listener of this.errors)
            listener('后台服务未能正常结束，请重新打开应用。');
        } finally {
          this.batchVerifications.delete(run.id);
          if (auxiliary)
            this.auxiliary.delete(run.id);
          else if (batch)
            this.batchRuns.delete(run.id);
          else if (this.current === active)
            this.current = null;
          this.storageChanged();
        }
      });
      return active.run;
    });
  }

  async waitForRun(id: string) {
    const run = this.activeRuns().find(item => item.run.id === id);
    await run?.done;
  }

  /** User-triggered persistence retry. Never invokes a model or resumes a queue. */
  async retryPendingSaves() {
    if (this.deleting)
      throw new Error('正在删除历史，请稍候。');
    return this.lock(async () => {
      for (const [id, pending] of this.unsaved) {
        const { run } = pending;
        try {
          const record = await this.repository.read(run.sessionId);
          const stored = record.session.runs.find(value => value.id === id);
          if (!stored)
            throw new Error('MISSING_RUN');
          // A successfully committed write may have lost its acknowledgement.
          // Never overwrite another terminal outcome on a later retry.
          const conflictsWithSavedOutcome = terminal(stored.status)
            && JSON.stringify(stored.outcome) !== JSON.stringify(run.outcome)
            && JSON.stringify(stored.outcome) !== JSON.stringify(pending.previousOutcome);
          if (conflictsWithSavedOutcome)
            throw new Error('TERMINAL_CONFLICT');
          const finalRun = { ...run, seq: Math.max(stored.seq, run.seq) };
          record.session.runs = record.session.runs.map(value => value.id === id ? finalRun : value);
          if (run.outcome?.status === 'completed' || run.outcome?.status === 'needs_clarification')
            record.session.subject = run.outcome.candidate.problem.subject;
          await this.repository.save(record);
          this.unsaved.delete(id);
          this.storageChanged();
          for (const listener of this.listeners)
            listener(finalRun);
        } catch {
          throw new Error('结果仍未能保存，请检查存储空间后重试；不会再次调用模型。');
        }
      }
    });
  }

  private abort(run: ActiveRun, reason: 'user' | 'deadline') {
    if (terminal(run.run.status) || run.controller.signal.aborted)
      return;
    run.cancellation = reason;
    run.controller.abort();
  }

  async cancelRun(id: string, reason: 'user' | 'deadline' = 'user') {
    this.correctionGeneration++;
    const run = this.activeRuns().find(item => item.run.id === id);
    if (run) {
      this.abort(run, reason);
      await run.done;
    }
  }

  async cancel(reason: 'user' | 'deadline' = 'user') {
    this.correctionGeneration++;
    const targets = this.activeRuns();
    for (const item of targets)
      this.abort(item, reason);
    await Promise.all(targets.map(item => item.done));
  }

  async remove(id: string) {
    const selected = new Set([z.uuid().parse(id)]);
    return this.deleteRecords(selected, () => this.repository.remove(id));
  }

  async removeMany(ids: readonly string[]) {
    const parsed = z.array(z.uuid()).max(MAX_LOCAL_RECORDS).parse(ids);
    if (!parsed.length) return;
    const selected = new Set(parsed);
    return this.deleteRecords(selected, () => this.repository.removeMany([...selected]));
  }

  async editBatch(value: import('@solveflow/contracts/local').LocalBatchEdit) {
    if (this.storageBlocked) throw new Error('请先保存或处理未保存的解答，再调整批次。');
    const edit = LocalBatchEditSchema.parse(value);
    for (const id of edit.expectedIds) if ((await this.repository.readMetadata(id)).batch?.id !== edit.batchId) throw new Error('批次包含其他题目，请重新打开调整。');
    const deleted = new Set(edit.expectedIds.filter(id => !edit.orderedIds.includes(id)));
    return this.deleteRecords(new Set(edit.expectedIds), async () => {
      if (this.storageBlocked) throw new Error('本批解答未能保存，请先处理保存错误。');
      await this.repository.editBatch(edit);
    }, deleted);
  }

  async removeAll() {
    return this.deleteRecords();
  }

  private async deleteRecords(ids?: ReadonlySet<string>, mutation?: () => Promise<void>, removed = ids) {
    this.correctionGeneration++;
    if (this.deleting)
      throw new Error('正在删除历史，请稍候。');
    this.deleting = true;
    try {
      // Finish accepted preparation first; result persistence needs this lock during cancellation.
      await this.lock(async () => {});
      const targets = this.activeRuns().filter(item => !ids || ids.has(item.run.sessionId));
      for (const item of targets)
        this.abort(item, 'user');
      await Promise.all(targets.map(item => item.done));
      await this.lock(async () => {
        await (mutation ? mutation() : this.repository.removeAll());
        for (const [runId, { run }] of this.unsaved)
          if (!removed || removed.has(run.sessionId))
            this.unsaved.delete(runId);
        this.storageChanged();
      });
    } finally {
      this.deleting = false;
    }
  }

  async waitForIdle() {
    await Promise.all(this.activeRuns().map(item => item.done));
  }
}
