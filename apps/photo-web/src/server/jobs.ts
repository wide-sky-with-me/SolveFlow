import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, readFile, readdir, rename, stat, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { PhotoJobSnapshotSchema, PhotoSolveRequestSchema, type PhotoJobSnapshot, type PhotoSolveRequest } from '@solveflow/contracts/photo';
import { makeSafeAgentError, PublicAgentEventSchema, SolveOutcomeSchema, type PublicAgentEvent, type SolveOutcome } from '@solveflow/contracts/agent';
import type { PhotoLedger } from './ledger.js';
type Solve = (request: PhotoSolveRequest, account: string, signal: AbortSignal, event: (value: PublicAgentEvent) => void) => Promise<SolveOutcome>;
const State = z.strictObject({ schemaVersion: z.literal(1), account: z.string(), hash: z.string(), createdAt: z.number().int(), snapshot: PhotoJobSnapshotSchema });
type State = z.infer<typeof State>;
type Active = { record: State; nonce: string; controller: AbortController; pending: boolean; done: Promise<void> };
const retention = 24 * 60 * 60 * 1000, fileLimit = 512 * 1024;
const cancellationWindow = 6 * 60 * 1000, cancellationLimit = 2000, queueLimit = 128;
export class PhotoJobError extends Error { constructor(readonly status: number, message: string) { super(message); } }
// Decision: .agents/notes/implemented/architecture/2026-11-03-photo-job-recovery.md
// Decision: .agents/notes/implemented/architecture/2026-11-03-photo-cancellation-admission.md
/** Persist admission before dispatch, terminal results before publication. Restart never dispatches old jobs. */
export class PhotoJobs {
  private active = new Map<string, Active>();
  private serial: Promise<unknown> = Promise.resolve();
  private queued = 0;
  private cancellations = new Map<string, number>();
  private admitting = new Map<string, number>();
  private closing = false;
  constructor(private readonly directory: string, private readonly ledger: PhotoLedger, private readonly solve: Solve, private readonly limit = 4, private readonly now = Date.now) {}
  get activeCount() { return this.active.size; }
  accountCount(account: string) { return [...this.active.values()].filter(job => job.record.account === account).length; }
  private key(account: string, id: string) { return createHash('sha256').update(account).digest('hex').slice(0, 32) + '-' + z.uuid().parse(id); }
  private enqueue<T>(work: () => Promise<T>): Promise<T> {
    if (this.queued >= queueLimit) return Promise.reject(new PhotoJobError(429, '同步请求较多，请稍后重试。'));
    this.queued++;
    const task = this.serial.then(work); this.serial = task.catch(() => undefined);
    return task.finally(() => { this.queued--; });
  }
  private async load(key: string): Promise<State | null> {
    try { const path = join(this.directory, key + '.json'); if ((await stat(path)).size > fileLimit) throw new Error('JOB_FILE_TOO_LARGE'); const value = State.parse(JSON.parse(await readFile(path, 'utf8'))); return value; }
    catch (e) { if (e instanceof Error && 'code' in e && e.code === 'ENOENT') return null; throw e; }
  }
  private async write(key: string, record: State) {
    const bytes = JSON.stringify(State.parse(record)); if (Buffer.byteLength(bytes) > fileLimit) throw new Error('JOB_RESULT_TOO_LARGE');
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const temporary = join(this.directory, key + '-' + randomUUID() + '.pending');
    try {
      const file = await open(temporary, 'wx', 0o600);
      try { await file.writeFile(bytes); await file.sync(); } finally { await file.close(); }
      await rename(temporary, join(this.directory, key + '.json'));
    } catch (e) { await unlink(temporary).catch(() => undefined); throw e; }
  }
  private async sweep() {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const files = await readdir(this.directory); if (files.length > 3000) throw new PhotoJobError(503, '结果暂存空间已满，请联系管理员。');
    let count = 0;
    for (const file of files) {
      if (!/^[a-f0-9-]+\.(json|pending)$/.test(file)) continue;
      const path = join(this.directory, file); let info;
      try { info = await stat(path); } catch (e) { if (e instanceof Error && 'code' in e && e.code === 'ENOENT') continue; throw e; }
      if (this.now() - info.mtimeMs > retention && !this.active.has(file.replace(/\.json$/, ''))) await unlink(path);
      else count++;
    }
    if (count >= 2000) throw new PhotoJobError(503, '结果暂存空间已满，请稍后重试。');
  }
  async start(account: string, nonce: string, input: PhotoSolveRequest, allowed: () => boolean = () => true) {
    const request = PhotoSolveRequestSchema.parse(input), key = this.key(account, request.requestId);
    const hash = createHash('sha256').update(JSON.stringify(request)).digest('hex');
    this.admitting.set(key, (this.admitting.get(key) ?? 0) + 1);
    const task = this.enqueue(async () => {
      const old = this.active.get(key)?.record ?? await this.load(key);
      if (old) { if (this.now() - old.createdAt > retention) throw new PhotoJobError(410, '本次结果已过期，请重新提交。'); if (old.account !== account || old.hash !== hash) throw new PhotoJobError(409, '本次请求标识已被其他内容使用。'); return this.readStatus(account, key); }
      if (this.closing || this.active.size >= this.limit || this.accountCount(account) >= 2) throw new PhotoJobError(429, '当前答题较多，请稍后再试。');
      await this.sweep();
      const record: State = { schemaVersion: 1, account, hash, createdAt: this.now(), snapshot: { schemaVersion: 1, requestId: request.requestId, sessionId: request.sessionId, status: 'running', event: null, outcome: null } };
      if (this.cancellations.has(key) || !allowed()) record.snapshot.status = 'cancelled';
      if (record.snapshot.status === 'running') await this.ledger.claim(account, request.requestId);
      if (this.cancellations.has(key) || !allowed()) record.snapshot.status = 'cancelled';
      await this.write(key, record);
      if (record.snapshot.status === 'running' && (this.closing || this.cancellations.has(key) || !allowed())) { record.snapshot.status = 'cancelled'; await this.write(key, record); }
      if (record.snapshot.status === 'running') {
        const job: Active = { record, nonce, controller: new AbortController(), pending: false, done: Promise.resolve() };
        this.active.set(key, job); job.done = this.run(key, job, request);
      }
      return PhotoJobSnapshotSchema.parse(record.snapshot);
    });
    return task.finally(() => {
      const count = (this.admitting.get(key) ?? 1) - 1;
      if (count) this.admitting.set(key, count); else this.admitting.delete(key);
    });
  }
  private async run(key: string, job: Active, request: PhotoSolveRequest) {
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; job.controller.abort(); }, 6 * 60000);
    let removeAbort = () => {};
    const aborted = new Promise<never>((_, reject) => { const stop = () => reject(new Error('ABORTED')); job.controller.signal.addEventListener('abort', stop, { once: true }); removeAbort = () => job.controller.signal.removeEventListener('abort', stop); });
    try {
      const outcome = await Promise.race([this.solve(request, job.record.account, job.controller.signal, event => {
        if (!job.controller.signal.aborted && job.record.snapshot.status === 'running') job.record.snapshot.event = PublicAgentEventSchema.parse(event);
      }), aborted]);
      if (job.controller.signal.aborted) throw new Error('ABORTED');
      const parsed = SolveOutcomeSchema.parse(outcome); if (Buffer.byteLength(JSON.stringify(parsed)) > fileLimit - 4096) throw new Error('RESULT_TOO_LARGE');
      job.record.snapshot = { ...job.record.snapshot, status: 'finished', outcome: parsed };
    } catch {
      job.record.snapshot = { ...job.record.snapshot, event: null, status: job.controller.signal.aborted && !timedOut ? 'cancelled' : 'finished', outcome: job.controller.signal.aborted && !timedOut ? null : { schemaVersion: 1, status: 'failed', verified: false, error: makeSafeAgentError(timedOut ? 'RUN_TIMEOUT' : 'MODEL_UNAVAILABLE', request.requestId) } };
    } finally {
      clearTimeout(timer); removeAbort(); job.pending = true;
      try { await this.write(key, job.record); job.pending = false; this.active.delete(key); } catch { /* Keep the bounded result in memory; status() retries persistence, never the model. */ }
    }
  }
  status(account: string, id: string): Promise<PhotoJobSnapshot | null> {
    const key = this.key(account, id); return this.enqueue(() => this.readStatus(account, key));
  }
  private async readStatus(account: string, key: string): Promise<PhotoJobSnapshot | null> {
    const active = this.active.get(key);
    let record = active?.record ?? await this.load(key);
    if (!record || record.account !== account || this.now() - record.createdAt > retention) return null;
    if (active?.pending) { await this.write(key, active.record); active.pending = false; this.active.delete(key); }
    if (!active && record.snapshot.status === 'running') { record = { ...record, snapshot: { ...record.snapshot, status: 'interrupted', event: null } }; await this.write(key, record); }
    return PhotoJobSnapshotSchema.parse(record.snapshot);
  }
  async cancel(account: string, id: string) {
    const key = this.key(account, id);
    for (const [cancelled, at] of this.cancellations) if (this.now() - at > cancellationWindow && !this.admitting.has(cancelled)) this.cancellations.delete(cancelled);
    if (!this.cancellations.has(key) && this.cancellations.size >= cancellationLimit && !this.admitting.has(key) && !this.active.has(key)) throw new PhotoJobError(429, '停止请求较多，请稍后重试。');
    // Register synchronously: cancellation can precede the body, quota write or admission commit.
    this.cancellations.set(key, this.now());
    const active = this.active.get(key); if (active?.record.snapshot.status === 'running') active.controller.abort();
    return this.enqueue(async () => {
      const job = this.active.get(key);
      if (job) { if (job.record.snapshot.status === 'running') job.controller.abort(); await job.done; }
      return this.readStatus(account, key);
    });
  }
  async cancelSession(nonce: string) { const jobs = [...this.active.values()].filter(job => job.nonce === nonce); jobs.forEach(job => job.controller.abort()); await Promise.all(jobs.map(job => job.done)); }
  async close() { this.closing = true; await this.serial; const jobs = [...this.active.values()]; jobs.forEach(job => job.controller.abort()); await Promise.all(jobs.map(job => job.done)); }
}
