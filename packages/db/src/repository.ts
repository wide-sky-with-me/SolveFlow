import { randomUUID, createHash } from "node:crypto";
import { and, asc, desc, eq, gt, isNull, lt, sql } from "drizzle-orm";
import { PublicAgentEventSchema, SolveOutcomeSchema, makeSafeAgentError, type PublicAgentEvent, type SolveOutcome } from "@solveflow/contracts/agent";
import { ApiError, resolveQuestionThread, CreateRunSchema, CreateSessionSchema, IdempotencyKeySchema, RunViewSchema, SessionViewSchema, UploadViewSchema, parseRunEvent, terminal, type RunEvent } from "@solveflow/contracts/http";
import type { Database } from "./index.js";
import { owners, uploads, sessions, runs, runEvents } from "./schema.js";
type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];
type RunRow = typeof runs.$inferSelect;
const active = sql`${runs.status} not in ('completed','needs_clarification','failed','cancelled')`;
const visible = (ownerId: string, sessionId: string) => and(eq(sessions.id, sessionId), eq(sessions.ownerId, ownerId), isNull(sessions.deletedAt));
const runView = (row: RunRow) => RunViewSchema.parse({ schemaVersion: 1, id: row.id, sessionId: row.sessionId, status: row.status, message: row.message, createdAt: row.createdAt.toISOString(), seq: row.seq, outcome: row.outcome, ...(row.context ? { context: row.context } : {}) });
const uploadView = (row: typeof uploads.$inferSelect) => UploadViewSchema.parse({ schemaVersion: 1, id: row.id, mimeType: row.mimeType, bytes: row.bytes, width: row.width, height: row.height, expiresAt: row.expiresAt.toISOString(), previewUrl: `/api/v1/uploads/${row.id}/image` });
const failure = (id: string, code: "WORKER_LOST" | "CANCELLED" | "RUN_TIMEOUT"): SolveOutcome => ({ schemaVersion: 1, status: code === "CANCELLED" ? "cancelled" : "failed", verified: false, error: makeSafeAgentError(code, id) });
const stages: Record<string, readonly string[]> = { queued: ["understanding"], understanding: ["solving"], solving: ["verifying"], verifying: ["revising"], revising: ["verifying"] };

export class Repository {
  constructor(readonly db: Database) {}
  async ensureOwner(id: string) { await this.db.insert(owners).values({ id }).onConflictDoNothing(); }
  async addUpload(ownerId: string, data: { id: string; objectKey: string; bytes: number; width: number; height: number; hash: string }) {
    const [row] = await this.db.insert(uploads).values({ ...data, ownerId, mimeType: "image/jpeg", expiresAt: new Date(Date.now() + 3600_000) }).returning();
    if (!row) throw new Error("UPLOAD_INSERT_FAILED");
    return uploadView(row);
  }
  async getUpload(ownerId: string, id: string) {
    const [row] = await this.db.select().from(uploads).where(and(eq(uploads.id, id), eq(uploads.ownerId, ownerId), eq(uploads.state, "ready"), gt(uploads.expiresAt, new Date()))).limit(1);
    if (!row) throw new ApiError("NOT_FOUND");
    return row;
  }
  async deleteUpload(ownerId: string, id: string) {
    await this.db.transaction(async tx => {
      const [row] = await tx.select().from(uploads).where(and(eq(uploads.id, id), eq(uploads.ownerId, ownerId), eq(uploads.state, "ready"))).for("update");
      if (!row) throw new ApiError("NOT_FOUND");
      const bound = await tx.select({ id: sessions.id }).from(sessions).where(eq(sessions.uploadId, id)).limit(1);
      if (bound.length) throw new ApiError("CONFLICT");
      await tx.update(uploads).set({ state: "deleting" }).where(eq(uploads.id, id));
    });
  }
  async createSession(ownerId: string, input: unknown) {
    const data = CreateSessionSchema.parse(input);
    return this.db.transaction(async tx => {
      await tx.select({ id: owners.id }).from(owners).where(eq(owners.id, ownerId)).for("update");
      const [image] = await tx.select().from(uploads).where(and(eq(uploads.id, data.uploadId), eq(uploads.ownerId, ownerId), eq(uploads.state, "ready"), gt(uploads.expiresAt, new Date()))).for("update");
      if (!image) throw new ApiError("NOT_FOUND");
      const bound = await tx.select({ id: sessions.id }).from(sessions).where(eq(sessions.uploadId, image.id)).limit(1);
      if (bound.length) throw new ApiError("CONFLICT");
      const count = await tx.$count(sessions, and(eq(sessions.ownerId, ownerId), isNull(sessions.deletedAt)));
      if (count >= 100) throw new ApiError("STORAGE_LIMIT");
      const id = randomUUID();
      await tx.insert(sessions).values({ id, ownerId, uploadId: image.id, subject: data.subject });
      await tx.update(uploads).set({ expiresAt: new Date(Date.now() + 7 * 86400_000) }).where(eq(uploads.id, image.id));
      return { schemaVersion: 1 as const, id };
    });
  }
  async listSessions(ownerId: string) {
    const rows = await this.db.select().from(sessions).where(and(eq(sessions.ownerId, ownerId), isNull(sessions.deletedAt))).orderBy(desc(sessions.createdAt)).limit(50);
    return { schemaVersion: 1 as const, sessions: rows.map(row => ({ id: row.id, subject: row.subject, createdAt: row.createdAt.toISOString(), title: "拍照解题" })) };
  }
  async getSession(ownerId: string, id: string) {
    return this.db.transaction(async tx => {
      const [session] = await tx.select().from(sessions).where(visible(ownerId, id)).limit(1);
      if (!session) throw new ApiError("NOT_FOUND");
      const [image] = await tx.select().from(uploads).where(and(eq(uploads.id, session.uploadId), eq(uploads.ownerId, ownerId), eq(uploads.state, "ready"), gt(uploads.expiresAt, new Date()))).limit(1);
      if (!image) throw new ApiError("NOT_FOUND");
      const history = await tx.select().from(runs).where(and(eq(runs.sessionId, id), eq(runs.ownerId, ownerId))).orderBy(asc(runs.createdAt), asc(runs.id)).limit(10);
      return SessionViewSchema.parse({ schemaVersion: 1, id, subject: session.subject, createdAt: session.createdAt.toISOString(), upload: uploadView(image), runs: history.map(runView) });
    }, { isolationLevel: "repeatable read", accessMode: "read only" });
  }
  async createRun(ownerId: string, sessionId: string, key: string, input: unknown, allowed: () => boolean = () => true) {
    const data = CreateRunSchema.parse(input); IdempotencyKeySchema.parse(key);
    return this.db.transaction(async tx => {
      await tx.select({ id: owners.id }).from(owners).where(eq(owners.id, ownerId)).for("update");
      const [session] = await tx.select().from(sessions).where(visible(ownerId, sessionId)).for("update");
      if (!session) throw new ApiError("NOT_FOUND");
      if (data.uploadId && data.uploadId !== session.uploadId) throw new ApiError("CONFLICT");
      const hash = createHash("sha256").update(JSON.stringify({ message: data.message, uploadId: session.uploadId, ...(data.context ? { context: data.context } : {}) })).digest("hex");
      const [prior] = await tx.select().from(runs).where(and(eq(runs.ownerId, ownerId), eq(runs.sessionId, sessionId), eq(runs.idempotencyKey, key))).limit(1);
      if (prior) { if (prior.inputHash !== hash) throw new ApiError("CONFLICT"); return runView(prior); }
      if (data.context) {
        const context = data.context;
        const [source] = await tx.select().from(runs).where(and(eq(runs.id, context.sourceRunId), eq(runs.sessionId, sessionId), eq(runs.ownerId, ownerId))).limit(1);
        if (!source) throw new ApiError("NOT_FOUND");
        const result = source.outcome;
        if (!result || (result.status !== "completed" && result.status !== "needs_clarification")) throw new ApiError("INVALID_INPUT");
        const history = await tx.select().from(runs).where(and(eq(runs.sessionId, sessionId), eq(runs.ownerId, ownerId))).orderBy(asc(runs.createdAt), asc(runs.id)).limit(10);
        if (!resolveQuestionThread(history.map(runView), context)) throw new ApiError("INVALID_INPUT");
      }
      if (!allowed()) throw new ApiError("SERVICE_UNAVAILABLE");
      const current = await tx.select({ id: runs.id }).from(runs).where(and(eq(runs.sessionId, sessionId), active)).limit(1);
      if (current.length) throw new ApiError("CONFLICT");
      if (await tx.$count(runs, eq(runs.sessionId, sessionId)) >= 10) throw new ApiError("SESSION_LIMIT");
      if (await tx.$count(runs, and(eq(runs.ownerId, ownerId), gt(runs.createdAt, new Date(Date.now() - 86400_000)))) >= 30) throw new ApiError("DAILY_LIMIT");
      const image = await tx.select({ id: uploads.id }).from(uploads).where(and(eq(uploads.id, session.uploadId), eq(uploads.ownerId, ownerId), eq(uploads.state, "ready"), gt(uploads.expiresAt, new Date()))).limit(1);
      if (!image.length) throw new ApiError("NOT_FOUND");
      const id = randomUUID();
      const [row] = await tx.insert(runs).values({ id, ownerId, sessionId, message: data.message, context: data.context ?? null, idempotencyKey: key, inputHash: hash, seq: 1 }).returning();
      await tx.insert(runEvents).values({ runId: id, seq: 1, payload: parseRunEvent({ schemaVersion: 1, runId: id, seq: 1, type: "run.status", status: "queued" }) });
      if (!row) throw new Error("RUN_INSERT_FAILED");
      return runView(row);
    });
  }
  async findSubmission(ownerId: string, sessionId: string, key: string) {
    IdempotencyKeySchema.parse(key);
    const [session] = await this.db.select({ id: sessions.id }).from(sessions).where(visible(ownerId, sessionId)).limit(1);
    if (!session) throw new ApiError("NOT_FOUND");
    const [row] = await this.db.select({ run: runs }).from(runs).innerJoin(sessions, eq(runs.sessionId, sessions.id)).where(and(visible(ownerId, sessionId), eq(runs.ownerId, ownerId), eq(runs.idempotencyKey, key))).limit(1);
    return row ? runView(row.run) : null;
  }
  async getRun(ownerId: string, id: string) {
    const [row] = await this.db.select({ run: runs }).from(runs).innerJoin(sessions, eq(runs.sessionId, sessions.id)).where(and(eq(runs.id, id), eq(runs.ownerId, ownerId), eq(sessions.ownerId, ownerId), isNull(sessions.deletedAt))).limit(1);
    if (!row) throw new ApiError("NOT_FOUND");
    return runView(row.run);
  }
  async events(ownerId: string, id: string, after: number) {
    const run = await this.getRun(ownerId, id);
    if (after > run.seq) throw new ApiError("INVALID_INPUT");
    if (Date.now() - Date.parse(run.createdAt) >= 86400_000) throw new ApiError("CURSOR_EXPIRED");
    const rows = await this.db.select().from(runEvents).where(and(eq(runEvents.runId, id), gt(runEvents.seq, after))).orderBy(asc(runEvents.seq)).limit(128);
    return { run, events: rows.map(row => parseRunEvent(row.payload)) };
  }
  async claim(workerId: string) {
    return this.db.transaction(async tx => {
      const [row] = await tx.select().from(runs).where(eq(runs.status, "queued")).orderBy(asc(runs.createdAt)).limit(1).for("update", { skipLocked: true });
      if (!row) return null;
      if (Date.now() - row.createdAt.getTime() > 120_000) { await this.finishTx(tx, row, failure(row.id, "RUN_TIMEOUT")); return null; }
      const [claimed] = await tx.update(runs).set({ status: "understanding", leaseOwner: workerId, leaseExpiresAt: new Date(Date.now() + 30_000), seq: row.seq + 1 }).where(eq(runs.id, row.id)).returning();
      await tx.insert(runEvents).values({ runId: row.id, seq: row.seq + 1, payload: parseRunEvent({ schemaVersion: 1, type: "run.status", runId: row.id, seq: row.seq + 1, status: "understanding" }) });
      return claimed ?? null;
    });
  }
  async heartbeat(id: string, workerId: string) {
    const changed = await this.db.update(runs).set({ leaseExpiresAt: new Date(Date.now() + 30_000) }).where(and(eq(runs.id, id), eq(runs.leaseOwner, workerId), gt(runs.leaseExpiresAt, new Date()), active)).returning({ id: runs.id });
    return changed.length === 1;
  }
  async appendEvent(id: string, workerId: string, raw: PublicAgentEvent) {
    const event = PublicAgentEventSchema.parse(raw);
    if (event.runId !== id || event.type === "run.error") throw new Error("INVALID_PROGRESS");
    return this.db.transaction(async tx => {
      const [row] = await tx.select().from(runs).where(eq(runs.id, id)).for("update");
      if (!row || terminal(row.status) || row.leaseOwner !== workerId || !row.leaseExpiresAt || row.leaseExpiresAt.getTime() <= Date.now()) return false;
      if (row.seq >= 124) throw new Error("EVENT_LIMIT");
      if (event.type === "run.status" && !stages[row.status]?.includes(event.status)) throw new Error("INVALID_RUN_TRANSITION");
      const seq = row.seq + 1;
      await tx.update(runs).set({ seq, ...(event.type === "run.status" ? { status: event.status } : {}) }).where(eq(runs.id, id));
      await tx.insert(runEvents).values({ runId: id, seq, payload: parseRunEvent({ ...event, seq }) });
      return true;
    });
  }
  private async finishTx(tx: Tx, row: RunRow, raw: SolveOutcome) {
    const outcome = SolveOutcomeSchema.parse(raw);
    if (terminal(row.status)) return false;
    const seq = row.seq;
    const events: RunEvent[] = [parseRunEvent({ schemaVersion: 1, type: "run.status", runId: row.id, seq: seq + 1, status: outcome.status }),
      parseRunEvent(outcome.status === "failed" || outcome.status === "cancelled"
        ? { schemaVersion: 1, type: "run.error", runId: row.id, seq: seq + 2, error: outcome.error }
        : { schemaVersion: 1, type: "answer.final", runId: row.id, seq: seq + 2, result: outcome }),
      parseRunEvent({ schemaVersion: 1, type: "run.done", runId: row.id, seq: seq + 3, status: outcome.status })];
    await tx.update(runs).set({ status: outcome.status, outcome, seq: seq + 3, leaseOwner: null, leaseExpiresAt: null }).where(eq(runs.id, row.id));
    if (outcome.status === "completed" || outcome.status === "needs_clarification") {
      await tx.update(sessions).set({ subject: outcome.candidate.problem.subject }).where(and(eq(sessions.id, row.sessionId), eq(sessions.ownerId, row.ownerId), isNull(sessions.deletedAt)));
    }
    await tx.insert(runEvents).values(events.map(payload => ({ runId: row.id, seq: payload.seq, payload })));
    return true;
  }
  async finish(id: string, workerId: string, outcome: SolveOutcome) {
    return this.db.transaction(async tx => {
      // Match delete/create lock order: session before run, including subject correction.
      const [reference] = await tx.select({ sessionId: runs.sessionId }).from(runs).where(eq(runs.id, id)).limit(1);
      if (!reference) return false;
      await tx.select({ id: sessions.id }).from(sessions).where(eq(sessions.id, reference.sessionId)).for("update");
      const [row] = await tx.select().from(runs).where(eq(runs.id, id)).for("update");
      if (!row || row.leaseOwner !== workerId || !row.leaseExpiresAt || row.leaseExpiresAt.getTime() <= Date.now()) return false;
      return this.finishTx(tx, row, outcome);
    });
  }
  async cancel(ownerId: string, id: string) {
    await this.getRun(ownerId, id);
    await this.db.transaction(async tx => {
      const [row] = await tx.select().from(runs).where(and(eq(runs.id, id), eq(runs.ownerId, ownerId))).for("update");
      if (!row) throw new ApiError("NOT_FOUND");
      await this.finishTx(tx, row, failure(id, "CANCELLED"));
    });
    return this.getRun(ownerId, id);
  }
  async recoverLost() {
    const stale = await this.db.select({ id: runs.id }).from(runs).where(and(active, lt(runs.leaseExpiresAt, new Date()))).limit(20);
    for (const item of stale) await this.db.transaction(async tx => {
      const [row] = await tx.select().from(runs).where(and(eq(runs.id, item.id), active, lt(runs.leaseExpiresAt, new Date()))).for("update");
      if (row) await this.finishTx(tx, row, failure(row.id, "WORKER_LOST"));
    });
  }
  async deleteSession(ownerId: string, id: string) {
    await this.db.transaction(async tx => {
      const [session] = await tx.select().from(sessions).where(visible(ownerId, id)).for("update");
      if (!session) throw new ApiError("NOT_FOUND");
      const pending = await tx.select().from(runs).where(and(eq(runs.sessionId, id), active)).for("update");
      for (const row of pending) await this.finishTx(tx, row, failure(row.id, "CANCELLED"));
      await tx.update(sessions).set({ deletedAt: new Date() }).where(eq(sessions.id, id));
      await tx.update(uploads).set({ state: "deleting" }).where(and(eq(uploads.id, session.uploadId), eq(uploads.ownerId, ownerId)));
    });
  }
  async cleanupBatch(remove: (key: string) => Promise<void>) {
    const expired = await this.db.select().from(uploads).where(and(eq(uploads.state, "ready"), lt(uploads.expiresAt, new Date()))).limit(20);
    for (const row of expired) {
      const [session] = await this.db.select().from(sessions).where(and(eq(sessions.uploadId, row.id), isNull(sessions.deletedAt))).limit(1);
      if (session) await this.deleteSession(row.ownerId, session.id);
      else await this.deleteUpload(row.ownerId, row.id);
    }
    const pending = await this.db.select().from(uploads).where(and(eq(uploads.state, "deleting"), lt(uploads.deleteAttempts, 5))).limit(20);
    for (const row of pending) {
      await this.db.update(uploads).set({ deleteAttempts: sql`${uploads.deleteAttempts} + 1` }).where(eq(uploads.id, row.id));
      await remove(row.objectKey);
      await this.db.transaction(async tx => {
        const bound = await tx.select({ id: sessions.id }).from(sessions).where(and(eq(sessions.uploadId, row.id), sql`${sessions.deletedAt} is not null`));
        for (const session of bound) { await tx.delete(runs).where(eq(runs.sessionId, session.id)); await tx.delete(sessions).where(eq(sessions.id, session.id)); }
        await tx.update(uploads).set({ state: "deleted", objectKey: `deleted/${row.id}`, hash: "deleted" }).where(eq(uploads.id, row.id));
      });
    }
    await this.db.delete(runEvents).where(lt(runEvents.createdAt, new Date(Date.now() - 86400_000)));
  }
}
