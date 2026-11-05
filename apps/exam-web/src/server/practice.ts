// Decision: .agents/notes/implemented/architecture/2026-11-04-temporary-photo-practice.md
import { createHash } from 'node:crypto';
import { ExamError } from '@solveflow/db';
import { makeSafeAgentError, SolveOutcomeSchema, type NormalizedImage, type PublicAgentEvent, type SolveOutcome } from '@solveflow/contracts/agent';
import { ExamPracticeSnapshotSchema, type ExamPracticeRequest, type ExamPracticeSnapshot } from '@solveflow/contracts/exam-practice';
import { normalizeImages } from './images.js';

export type PracticeSolve = (input: ExamPracticeRequest & { ownerId: string; image: NormalizedImage }, signal: AbortSignal, report: (event: PublicAgentEvent) => void, authorize: () => Promise<void>) => Promise<SolveOutcome>;
type Job = { owner: string; hash: string | null; controller: AbortController; expiresAt: number; snapshot: ExamPracticeSnapshot; done: Promise<void> };
const retention = 10 * 60_000, deadline = 6 * 60_000;

/** Content lives only in this bounded process heap. No storage, database or replay path. */
export class PracticeJobs {
  private readonly jobs = new Map<string, Job>();
  private readonly cancelled = new Map<string, number>();
  private closing = false;
  private readonly sweeper: ReturnType<typeof setInterval>;
  constructor(private readonly solve: PracticeSolve, private readonly now = Date.now, private readonly limit = 4) {
    this.sweeper = setInterval(() => this.sweep(), 30_000); this.sweeper.unref();
  }
  private key(owner: string, id: string) { return owner + ':' + id; }
  private sweep() {
    for (const [key, job] of this.jobs) if (job.snapshot.status !== 'running' && job.expiresAt <= this.now()) this.jobs.delete(key);
    for (const [key, expires] of this.cancelled) if (expires <= this.now()) this.cancelled.delete(key);
  }
  async start(owner: string, request: ExamPracticeRequest, read: () => Promise<Uint8Array>, authorize: () => Promise<void>) {
    this.sweep();
    const key = this.key(owner, request.requestId), previous = this.jobs.get(key);
    if (previous) {
      if (previous.hash === null) throw new ExamError(409, 'PRACTICE_PREPARING', '题图正在处理，请稍后查看结果。');
      const hash = createHash('sha256').update(request.exam).update(await read()).digest('hex');
      if (hash !== previous.hash) throw new ExamError(409, 'PRACTICE_CONFLICT', '本次标识已用于其他题图，请重新拍摄。');
      return this.status(owner, request.requestId);
    }
    const snapshot: ExamPracticeSnapshot = { schemaVersion: 1, requestId: request.requestId, status: this.cancelled.has(key) ? 'cancelled' : 'running', phase: 'preparing', outcome: null };
    if (snapshot.status === 'cancelled') return snapshot;
    const active = [...this.jobs.values()].filter(job => job.snapshot.status === 'running');
    if (this.closing || this.jobs.size >= 128 || active.length >= this.limit || active.some(job => job.owner === owner)) throw new ExamError(429, 'PRACTICE_BUSY', '当前答题较多，请稍后重试。');
    const job: Job = { owner, hash: null, controller: new AbortController(), expiresAt: this.now() + retention, snapshot, done: Promise.resolve() };
    this.jobs.set(key, job);
    try {
      const raw = await read();
      job.hash = createHash('sha256').update(request.exam).update(raw).digest('hex');
      if (job.controller.signal.aborted) return this.status(owner, request.requestId);
      const images = await normalizeImages(raw);
      await authorize();
      if (job.controller.signal.aborted || this.closing) return this.cancel(owner, request.requestId);
      job.done = this.run(job, request, { bytes: Uint8Array.from(images.model.data), mimeType: 'image/jpeg' }, authorize);
      return this.status(owner, request.requestId);
    } catch (error) {
      if (job.controller.signal.aborted) return this.status(owner, request.requestId);
      this.jobs.delete(key);
      if (error instanceof ExamError) throw error;
      throw new ExamError(400, 'PRACTICE_IMAGE', '图片无法读取，请重新拍摄或选择图片。');
    }
  }
  private async run(job: Job, request: ExamPracticeRequest, image: NormalizedImage, authorize: () => Promise<void>) {
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; job.controller.abort(); }, deadline);
    let removeAbort = () => {};
    const aborted = new Promise<never>((_, reject) => {
      const abort = () => reject(new Error('ABORTED'));
      job.controller.signal.addEventListener('abort', abort, { once: true });
      removeAbort = () => job.controller.signal.removeEventListener('abort', abort);
    });
    try {
      const outcome = await Promise.race([this.solve({ ...request, ownerId: job.owner, image }, job.controller.signal, event => {
        if (!job.controller.signal.aborted && event.type === 'run.status' && ['understanding', 'solving', 'verifying', 'revising'].includes(event.status))
          job.snapshot.phase = ExamPracticeSnapshotSchema.shape.phase.parse(event.status);
      }, authorize), aborted]);
      if (job.controller.signal.aborted) return;
      const parsed = SolveOutcomeSchema.parse(outcome);
      if (Buffer.byteLength(JSON.stringify(parsed)) > 512 * 1024) throw new Error('RESULT_TOO_LARGE');
      job.snapshot = { ...job.snapshot, status: 'finished', outcome: parsed };
    } catch {
      if (!job.controller.signal.aborted || timedOut) job.snapshot = { ...job.snapshot, status: 'finished', outcome: { schemaVersion: 1, status: 'failed', verified: false, error: makeSafeAgentError(timedOut ? 'RUN_TIMEOUT' : 'MODEL_UNAVAILABLE', request.requestId) } };
    } finally {
      clearTimeout(timer); removeAbort();
      if (job.snapshot.status === 'running') job.snapshot = { ...job.snapshot, status: 'cancelled', outcome: null };
      job.expiresAt = this.now() + retention;
    }
  }
  status(owner: string, id: string) {
    this.sweep();
    const job = this.jobs.get(this.key(owner, id));
    if (!job) throw new ExamError(404, 'PRACTICE_EXPIRED', '临时答题已过期或服务已重启，请重新拍摄。');
    return ExamPracticeSnapshotSchema.parse(job.snapshot);
  }
  cancel(owner: string, id: string): ExamPracticeSnapshot {
    this.sweep();
    const key = this.key(owner, id), job = this.jobs.get(key);
    if (job && job.snapshot.status !== 'running') return this.status(owner, id);
    if (!this.cancelled.has(key) && this.cancelled.size >= 256) throw new ExamError(429, 'PRACTICE_BUSY', '停止请求较多，请稍后重试。');
    this.cancelled.set(key, this.now() + retention);
    job?.controller.abort();
    if (job) job.snapshot = { ...job.snapshot, status: 'cancelled', outcome: null };
    return { schemaVersion: 1, requestId: id, status: 'cancelled', phase: job?.snapshot.phase ?? 'preparing', outcome: null };
  }
  cancelOwner(owner: string) { for (const job of this.jobs.values()) if (job.owner === owner && job.snapshot.status === 'running') this.cancel(owner, job.snapshot.requestId); }
  close() { this.closing = true; clearInterval(this.sweeper); for (const job of this.jobs.values()) job.controller.abort(); this.jobs.clear(); this.cancelled.clear(); }
}
