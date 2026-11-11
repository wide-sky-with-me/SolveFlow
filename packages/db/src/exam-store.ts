// Decision: .agents/notes/implemented/architecture/2026-11-09-managed-backend-performance.md
// Decision: .agents/notes/implemented/architecture/2026-11-04-managed-exam-audit-fixes.md
// Decision: .agents/notes/implemented/architecture/2026-11-03-exam-review-hardening.md
// Decision: .agents/notes/implemented/architecture/2026-11-02-managed-exam-foundation.md
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type pg from 'pg';
import { z } from 'zod';
import { ExamUserSchema, type ExamUser } from '@solveflow/contracts/managed-exam';
export type Queryable = Pick<pg.Pool, 'query'> | Pick<pg.PoolClient, 'query'>;
export class ExamError extends Error {
    constructor(readonly status: number, readonly code: string, message: string) { super(message); }
}
export const forbidden = () => new ExamError(404, 'NOT_FOUND', '记录不存在或无权访问。');
export const conflict = (message: string) => new ExamError(409, 'CONFLICT', message);
export async function rows<T>(db: Queryable, schema: z.ZodType<T>, sql: string, params: unknown[] = []): Promise<T[]> {
    const result = await db.query<{
        value: unknown;
    }>(sql, params);
    return result.rows.map(row => schema.parse(row.value));
}
export async function one<T>(db: Queryable, schema: z.ZodType<T>, sql: string, params: unknown[] = []): Promise<T> {
    const value = (await rows(db, schema, sql, params))[0];
    if (value === undefined)
        throw forbidden();
    return value;
}
export async function tx<T>(pool: pg.Pool, action: (c: pg.PoolClient) => Promise<T>, snapshot = false): Promise<T> {
    const c = await pool.connect();
    try {
        await c.query(snapshot ? 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY' : 'BEGIN');
        const result = await action(c);
        await c.query('COMMIT');
        return result;
    }
    catch (error) {
        await c.query('ROLLBACK');
        throw error;
    }
    finally {
        c.release();
    }
}
export const hash = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex');
export const isAdmin = (actor: ExamUser) => actor.state === 'active' && actor.roles.includes('admin');
export const isManager = (actor: ExamUser) => isAdmin(actor) || actor.state === 'active' && actor.roles.includes('manager');
export function requireManager(actor: ExamUser) { if (!isManager(actor))
    throw forbidden(); }
export const userJson = `jsonb_build_object('id',u.id,'username',u.username,'displayName',u.display_name,'state',u.state,'roles',(SELECT jsonb_agg(r.code ORDER BY r.code) FROM exam_app.user_roles ur JOIN exam_app.roles r ON r.id=ur.role_id WHERE ur.user_id=u.id))`;
export async function userById(db: Queryable, id: string) { return one(db, ExamUserSchema, `SELECT ${userJson} AS value FROM exam_app.users u WHERE u.id=$1`, [id]); }
/** Serialize a write against account updates, then reject a stale role/state snapshot. */
export async function lockActor(c: pg.PoolClient, actor: ExamUser) {
    await c.query('SELECT id FROM exam_app.users WHERE id=$1 FOR SHARE', [actor.id]);
    const current = await userById(c, actor.id);
    if (current.state !== 'active' || current.roles.length !== actor.roles.length || current.roles.some(role => !actor.roles.includes(role)))
        throw forbidden();
    return current;
}
// Fixed trusted aliases a/s; used by scoped assignment, image and sequence reads.
export const assignmentAccessSql = `($2::boolean OR a.student_id=$3 OR ($4::boolean AND s.manager_id=$3) OR ($5::boolean AND EXISTS(SELECT 1 FROM exam_app.staff_assignments f WHERE f.assignment_id=a.id AND f.staff_id=$3 AND f.revoked_at IS NULL)))`;
export async function scope(db: Queryable, actor: ExamUser, assignmentId: string, studentOnly = false) {
    const allowed = await one(db, z.boolean(), `SELECT EXISTS(SELECT 1 FROM exam_app.exam_assignments a JOIN exam_app.exam_sittings s ON s.id=a.sitting_id WHERE a.id=$1 AND ${assignmentAccessSql}) AS value`, [assignmentId, !studentOnly && isAdmin(actor), actor.id, !studentOnly && actor.roles.includes('manager'), !studentOnly && actor.roles.includes('support')]);
    if (!allowed)
        throw forbidden();
}
export async function event(c: pg.PoolClient, attemptId: string, type: string) {
    await c.query('INSERT INTO exam_app.attempt_streams(attempt_id) VALUES($1) ON CONFLICT DO NOTHING', [attemptId]);
    const seq = await one(c, z.coerce.number().int().positive(), 'UPDATE exam_app.attempt_streams SET last_seq=last_seq+1 WHERE attempt_id=$1 RETURNING last_seq AS value', [attemptId]);
    await c.query(`INSERT INTO exam_app.attempt_events(attempt_id,seq,aggregate_version,event_type,payload) VALUES($1,$2,$2,$3,'{}')`, [attemptId, seq, type]);
}
export async function audit(c: Queryable, actorId: string, action: string, targetId: string, targetType = 'assignment') {
    await c.query('INSERT INTO exam_app.audit_logs(id,actor_id,action,target_type,target_id,correlation_id) VALUES($1,$2,$3,$4,$5,$6)', [randomUUID(), actorId, action, targetType, targetId, randomUUID()]);
}
export async function loginThrottle(pool: pg.Pool, address: string) {
    await tx(pool, async (c) => {
        for (const key of ['global', hash(address)]) {
            const count = await one(c, z.number(), `INSERT INTO exam_app.login_throttle(key,window_start,attempts) VALUES($1,date_trunc('minute',now()),1) ON CONFLICT(key) DO UPDATE SET attempts=CASE WHEN exam_app.login_throttle.window_start=date_trunc('minute',now()) THEN exam_app.login_throttle.attempts+1 ELSE 1 END,window_start=date_trunc('minute',now()) RETURNING attempts AS value`, [key]);
            if (count > (key === 'global' ? 100 : 20))
                throw new ExamError(429, 'RATE_LIMIT', '尝试过于频繁，请稍后再试。');
        }
    });
}
export async function createSession(pool: pg.Pool, user: ExamUser, expectedAuthVersion: number) {
    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + 12 * 3600000).toISOString();
    const inserted = await pool.query(`INSERT INTO exam_app.auth_sessions(id,user_id,token_hash,auth_version,scope,expires_at) SELECT $1,id,decode($2,'hex'),auth_version,'account',$3 FROM exam_app.users WHERE id=$4 AND state='active' AND auth_version=$5`, [randomUUID(), hash(token), expiresAt, user.id, expectedAuthVersion]);
    if (inserted.rowCount !== 1)
        throw new ExamError(401, 'LOGIN_FAILED', '用户名或密码不正确。');
    return { token, expiresAt };
}
export async function authenticate(pool: pg.Pool, token: string | undefined) {
    if (!token || !/^[\w-]{43}$/.test(token))
        throw new ExamError(401, 'UNAUTHORIZED', '请先登录。');
    const sessionSchema = z.strictObject({ user: ExamUserSchema, expiresAt: z.coerce.date().transform(v => v.toISOString()) });
    const predicate = `s.user_id=u.id AND s.token_hash=decode($1,'hex') AND s.revoked_at IS NULL AND s.expires_at>now() AND s.auth_version=u.auth_version AND u.state='active'`;
    const params = [hash(token)];
    const found = (await rows(pool, sessionSchema.extend({ touch: z.boolean() }), `SELECT jsonb_build_object('user',${userJson},'expiresAt',s.expires_at,'touch',s.last_seen_at<=now()-interval '5 seconds') AS value FROM exam_app.auth_sessions s JOIN exam_app.users u ON ${predicate}`, params))[0];
    if (!found)
        throw new ExamError(401, 'UNAUTHORIZED', '登录已失效，请重新登录。');
    if (!found.touch) return { user: found.user, expiresAt: found.expiresAt };
    // Recheck revocation after any lock wait. Concurrent readers may already have touched it.
    const touched = (await rows(pool, sessionSchema, `UPDATE exam_app.auth_sessions s SET last_seen_at=now() FROM exam_app.users u WHERE ${predicate} AND s.last_seen_at<=now()-interval '5 seconds' RETURNING jsonb_build_object('user',${userJson},'expiresAt',s.expires_at) AS value`, params))[0];
    if (touched) return touched;
    const current = (await rows(pool, sessionSchema, `SELECT jsonb_build_object('user',${userJson},'expiresAt',s.expires_at) AS value FROM exam_app.auth_sessions s JOIN exam_app.users u ON ${predicate}`, params))[0];
    if (!current) throw new ExamError(401, 'UNAUTHORIZED', '登录已失效，请重新登录。');
    return current;
}
