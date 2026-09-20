import { z } from 'zod';
import { LocalRecordSchema, LocalDiagnosticSchema, type LocalDiagnostic, type LocalRecord } from '@solveflow/contracts/local';
import { isAuxiliaryContext, RunContextSchema, projectQuestionRun, questionThreadHistory, terminal, type RunContext, type RunView } from '@solveflow/contracts/http';
import { SolveOutcomeSchema, makeSafeAgentError, type SolverInput, type PublicAgentEvent, type SolveOutcome } from '@solveflow/contracts/agent';
import { LocalRepository } from './local-repository.js';
import { conversationHistory, resolveLearningContext } from './learning-history.js';
export type DeviceSolve = (input: SolverInput, signal: AbortSignal, event: (event: PublicAgentEvent) => void, diagnostic: (entry: LocalDiagnostic) => void) => Promise<SolveOutcome>;
type ActiveRun = { run: RunView; controller: AbortController; done: Promise<void>; cancellation: 'user' | 'deadline' };
/** One-shot on-demand requests run beside the conversation; the contract owns the kind list. */
const MAX_AUXILIARY = 3;
export class LocalEngine {
  private current: ActiveRun | null = null;
  private readonly auxiliary = new Map<string, ActiveRun>();
  /** Preparation and result writes are serialized; executions overlap afterwards. */
  private queue: Promise<unknown> = Promise.resolve();
  private listeners = new Set<(run: RunView) => void>();
  private errors = new Set<(message: string) => void>();
  constructor(readonly repository: LocalRepository, private readonly uuid: () => string, private readonly background?: { start: (runId: string) => Promise<void>; stop: (runId: string) => Promise<void>; diagnostic?: (entry: LocalDiagnostic) => void }) {}
  get active() { return this.current?.run ?? null; }
  /** Every in-flight run, conversation first, so the UI can merge them into the stored session. */
  get actives(): RunView[] { return [...(this.current ? [this.current.run] : []), ...[...this.auxiliary.values()].map(item => item.run)]; }
  subscribe(listener: (run: RunView) => void) { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  onError(listener: (message: string) => void) { this.errors.add(listener); return () => { this.errors.delete(listener); }; }
  async create(image: string, width: number, height: number): Promise<LocalRecord> {
    if ((await this.repository.list()).length >= 100) throw new Error('已保存100道题，请删除不需要的题目后继续。');
    const id = this.uuid(); const createdAt = new Date().toISOString();
    const raw = image.split(',')[1] ?? ''; const bytes = Math.floor(raw.length * 3 / 4) - (raw.endsWith('==') ? 2 : raw.endsWith('=') ? 1 : 0);
    const record = LocalRecordSchema.parse({ schemaVersion: 1, image, session: { schemaVersion: 1, id, subject: 'general', createdAt, runs: [],
      upload: { schemaVersion: 1, id, mimeType: 'image/jpeg', width, height, bytes, expiresAt: '9999-12-31T00:00:00.000Z', previewUrl: `/api/v1/uploads/${id}/image` } } });
    await this.repository.save(record); return record;
  }
  private lock<T>(task: () => Promise<T>): Promise<T> {
    const previous = this.queue; let release!: () => void;
    this.queue = new Promise<void>(resolve => { release = resolve; });
    return previous.catch(() => {}).then(task).finally(() => release());
  }
  async start(id: string, message: string, context: RunContext | undefined, execute: DeviceSolve): Promise<RunView> {
    const auxiliary = isAuxiliaryContext(context?.kind);
    if (auxiliary) { if (this.auxiliary.size >= MAX_AUXILIARY) throw new Error('同时进行的按需请求过多，请稍候。'); }
    else if (this.current) throw new Error('请等待当前解题完成，或先取消它。');
    return this.lock(async () => {
      const record = await this.repository.read(id); z.string().max(2000).parse(message); if (context) RunContextSchema.parse(context);
      if (record.session.runs.length >= 10) throw new Error('本题已完成10轮对话，请新建题目继续。');
      const pending = record.session.runs.filter(run => !terminal(run.status));
      if (auxiliary) {
        const wantedNumber = context && 'number' in context ? context.number : undefined;
        const same = pending.some(run => { const other = run.context; return !!other && !!context && other.kind === context.kind && other.sourceRunId === context.sourceRunId && ('number' in other ? other.number : undefined) === wantedNumber; });
        if (same) throw new Error('该按需请求正在进行中。');
      } else if (pending.length) throw new Error('本题已有进行中的任务。');
      if (context?.kind === 'explanation' && record.session.runs.some(run => run.context?.kind === 'explanation' && run.context.sourceRunId === context.sourceRunId && run.context.number === context.number && run.outcome?.status === 'completed')) throw new Error('EXPLANATION_ALREADY_SAVED');
      if (context?.kind === 'knowledge-list' && record.session.runs.some(run => run.context?.kind === 'knowledge-list' && run.context.sourceRunId === context.sourceRunId && run.context.number === context.number && run.outcome?.status === 'completed')) throw new Error('KNOWLEDGE_ALREADY_SAVED');
      const source = context?.kind === 'verification' ? record.session.runs.find(run => run.id === context.sourceRunId) : undefined;
      const target = source ? projectQuestionRun(source, context?.kind === 'verification' ? context.number : undefined).outcome : undefined;
      if (context?.kind === 'verification' && target?.status !== 'completed') throw new Error('INVALID_SAVED_CONTEXT');
      if (context?.kind === 'verification' && record.session.runs.some(run => run.context?.kind === 'verification' && run.context.sourceRunId === context.sourceRunId && run.context.number === context.number && (run.outcome?.status === 'completed' || run.outcome?.status === 'needs_clarification'))) throw new Error('VERIFICATION_ALREADY_SAVED');
      const learning = resolveLearningContext(record.session.runs, context ?? null);
      const history = conversationHistory(context ? questionThreadHistory(record.session.runs, context) : record.session.runs, learning.focus ? 4096 : 12288);
      const run: RunView = { schemaVersion: 1, id: this.uuid(), sessionId: id, status: 'queued', message, createdAt: new Date().toISOString(), seq: 0, outcome: null, ...(context ? { context } : {}) };
      record.session.runs.push(run); await this.repository.save(record);
      const controller = new AbortController();
      const active: ActiveRun = { run, controller, done: Promise.resolve(), cancellation: 'user' };
      if (auxiliary) this.auxiliary.set(run.id, active); else this.current = active;
      const binary = atob(record.image.slice(record.image.indexOf(',') + 1)); const bytes = Uint8Array.from(binary, character => character.charCodeAt(0));
      const input: SolverInput = { schemaVersion: 1, role: 'solver', identity: { ownerId: 'local-device', sessionId: id, runId: run.id }, message, image: { bytes, mimeType: 'image/jpeg' }, evidence: [], ...learning, history, verificationMode: 'manual', ...(target?.status === 'completed' ? { verificationTarget: target.candidate } : {}), answerMode: context && ['explanation', 'step', 'knowledge', 'knowledge-list'].includes(context.kind) ? 'detailed' : 'brief' };
      const publish = () => { for (const listener of this.listeners) listener({ ...active.run }); };
      publish();
      const entries: LocalDiagnostic[] = []; let writes = Promise.resolve();
      const diagnose = (value: LocalDiagnostic) => {
        const entry = LocalDiagnosticSchema.parse(value); if (entry.runId !== run.id || entries.length >= 64) return;
        entries.push(entry); const snapshot = [...entries];
        writes = writes.then(() => this.repository.saveDiagnostics(run.id, snapshot)).catch(() => { for (const listener of this.errors) listener('诊断信息未能保存。'); });
        this.background?.diagnostic?.(entry);
      };
      const lifecycle = (reason: LocalDiagnostic['reason']) => diagnose({ schemaVersion: 1, runId: run.id, role: 'runtime', event: 'lifecycle', attempt: 0, elapsedMs: Math.max(0, Math.min(1_000_000, Date.now() - Date.parse(run.createdAt))), reason });
      active.done = (async () => {
        let outcome: SolveOutcome;
        try {
          try { await this.background?.start(run.id); } catch { lifecycle('background_start'); throw new Error('BACKGROUND_START_FAILED'); }
          lifecycle('started');
          if (controller.signal.aborted) throw new Error('CANCELLED');
          outcome = SolveOutcomeSchema.parse(await execute(input, controller.signal, event => {
            if (controller.signal.aborted || terminal(active.run.status)) return;
            if (event.type === 'run.status' && event.runId === run.id) { active.run = { ...active.run, status: event.status, seq: active.run.seq + 1 }; publish(); }
          }, diagnose));
        } catch { outcome = { schemaVersion: 1, status: controller.signal.aborted ? 'cancelled' : 'failed', verified: false, error: makeSafeAgentError(controller.signal.aborted ? 'CANCELLED' : 'INTERNAL_ERROR', run.id) }; }
        if (controller.signal.aborted) outcome = { schemaVersion: 1, status: active.cancellation === 'deadline' ? 'failed' : 'cancelled', verified: false, error: makeSafeAgentError(active.cancellation === 'deadline' ? 'RUN_TIMEOUT' : 'CANCELLED', run.id) };
        lifecycle(controller.signal.aborted ? active.cancellation === 'deadline' ? 'deadline' : 'cancelled' : outcome.status === 'failed' ? 'failed' : 'completed');
        await writes;
        active.run = { ...active.run, status: outcome.status, outcome, seq: active.run.seq + 1 };
        try {
          // Re-read under the lock: concurrent runs may have appended their own records meanwhile.
          await this.lock(async () => {
            const latest = await this.repository.read(id);
            const replaced = latest.session.runs.map(value => value.id === run.id ? active.run : value);
            latest.session.runs = replaced.some(value => value.id === run.id) ? replaced : [...replaced, active.run];
            if (outcome.status === 'completed' || outcome.status === 'needs_clarification') latest.session.subject = outcome.candidate.problem.subject;
            await this.repository.save(latest);
          });
          publish();
        } catch { for (const listener of this.errors) listener('解题结果未能保存到本地，请检查存储空间。'); }
      })().finally(async () => { try { await this.background?.stop(run.id); } catch { for (const listener of this.errors) listener('后台服务未能正常结束，请重新打开应用。'); } finally { if (auxiliary) this.auxiliary.delete(run.id); else if (this.current === active) this.current = null; } });
      return active.run;
    });
  }
  async cancel(reason: 'user' | 'deadline' = 'user') {
    const targets = [...(this.current ? [this.current] : []), ...this.auxiliary.values()];
    for (const item of targets) item.cancellation = reason;
    for (const item of targets) item.controller.abort();
    await Promise.all(targets.map(item => item.done));
  }
  async remove(id: string) { if (this.current?.run.sessionId === id || [...this.auxiliary.values()].some(item => item.run.sessionId === id)) await this.cancel(); await this.repository.remove(id); }
  async waitForIdle() { await Promise.all([...(this.current ? [this.current] : []), ...this.auxiliary.values()].map(item => item.done)); }
}
