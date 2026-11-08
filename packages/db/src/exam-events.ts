// Decision: .agents/notes/implemented/architecture/2026-11-07-archived-exam-visibility.md
// Decision: .agents/notes/implemented/architecture/2026-11-07-exam-event-hierarchy.md
import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { z } from 'zod';
import { ExamTemplateSchema, ExamPageQuerySchema, ExamUserPageSchema, ExamUserSchema, type ExamUser } from '@solveflow/contracts/managed-exam';
import { ExamEventCreateSchema, ExamEventUpdateSchema, ExamEventMutationSchema, ExamEventSchema, ExamEventPageSchema, ExamEventPageQuerySchema, ExamEventMembersQuerySchema, ExamEventDetailSchema, ExamConcreteCreateSchema, ExamConcreteUpdateSchema, ExamConcreteSchema, ExamConcretePageSchema } from '@solveflow/contracts/exam-events';
import { audit, conflict, event, hash, isAdmin, lockActor, one, requireManager, rows, tx, userJson, type Queryable } from './exam-store.js';
import { insertSitting, insertAssignment, templateJson } from './exam-catalog.js';
const count = z.coerce.number().int().nonnegative();
const eventRow = z.object({ id: z.uuid(), templateId: z.uuid(), version: z.number().int().positive(), archived: z.boolean() });
const eventProjection = `jsonb_build_object('id',e.id,'title',e.title,'templateId',e.template_id,'templateTitle',t.title,'exam',t.exam_type,'version',e.version,'examCount',(SELECT count(*) FROM exam_app.exam_sittings s WHERE s.event_id=e.id AND s.archived_at IS NULL),'studentCount',(SELECT count(DISTINCT a.student_id) FROM exam_app.exam_assignments a JOIN exam_app.exam_sittings s ON s.id=a.sitting_id WHERE s.event_id=e.id AND s.archived_at IS NULL AND a.state<>'revoked'),'teacherCount',(SELECT count(DISTINCT f.staff_id) FROM exam_app.staff_assignments f JOIN exam_app.exam_assignments a ON a.id=f.assignment_id JOIN exam_app.exam_sittings s ON s.id=a.sitting_id WHERE s.event_id=e.id AND s.archived_at IS NULL AND a.state<>'revoked' AND f.revoked_at IS NULL),'hasStarted',EXISTS(SELECT 1 FROM exam_app.exam_attempts x JOIN exam_app.exam_assignments a ON a.id=x.assignment_id JOIN exam_app.exam_sittings s ON s.id=a.sitting_id WHERE s.event_id=e.id))`;
const concreteProjection = `jsonb_build_object('id',s.id,'eventId',s.event_id,'templateId',s.template_id,'title',s.title,'opensAt',s.opens_at,'closesAt',s.closes_at,'state',s.state,'version',s.version,'assignmentCount',(SELECT count(*) FROM exam_app.exam_assignments a WHERE a.sitting_id=s.id AND a.state<>'revoked'),'started',EXISTS(SELECT 1 FROM exam_app.exam_attempts x JOIN exam_app.exam_assignments a ON a.id=x.assignment_id WHERE a.sitting_id=s.id))`;
async function access(c: Queryable, actor: ExamUser, id: string, lock = false) { requireManager(actor); return one(c, eventRow, `SELECT jsonb_build_object('id',id,'templateId',template_id,'version',version,'archived',archived_at IS NOT NULL) AS value FROM exam_app.exam_events WHERE id=$1 AND ($2::boolean OR manager_id=$3)${lock ? ' FOR UPDATE' : ''}`, [id, isAdmin(actor), actor.id]); }
function currentVersion(actual: number, expected: number) { if (actual !== expected)
    throw conflict('记录已被更新，请刷新后重试。'); }
function active(parent: z.infer<typeof eventRow>) { if (parent.archived)
    throw conflict('场次已删除，不能继续修改。'); }
async function mutate(pool: pg.Pool, actor: ExamUser, operation: string, requestId: string, input: unknown, action: (c: pg.PoolClient, parent: z.infer<typeof eventRow> | null) => Promise<{
    id: string;
}>, eventId?: string) {
    requireManager(actor);
    return tx(pool, async (c) => {
        await lockActor(c, actor);
        const parent = eventId ? await access(c, actor, eventId, true) : null;
        await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,3))', [actor.id + ':' + operation + ':' + requestId]);
        const digest = hash(JSON.stringify(input)), saved = (await rows(c, z.object({ digest: z.string(), id: z.uuid() }), `SELECT jsonb_build_object('digest',input_sha256,'id',response->>'id') AS value FROM exam_app.idempotency_requests WHERE actor_id=$1 AND operation=$2 AND request_id=$3`, [actor.id, operation, requestId]))[0];
        if (saved) {
            if (saved.digest !== digest)
                throw conflict('操作内容已变化，请重新提交。');
            return { id: saved.id };
        }
        if (parent)
            active(parent);
        const result = await action(c, parent);
        await c.query(`INSERT INTO exam_app.idempotency_requests(actor_id,operation,request_id,input_sha256,status,response_status,response,expires_at) VALUES($1,$2,$3,$4,'completed',200,$5,now()+interval '1 day')`, [actor.id, operation, requestId, digest, JSON.stringify(result)]);
        return result;
    });
}
async function lockExams(c: pg.PoolClient, eventId: string, examId?: string, archiving = false) {
    const ids = await rows(c, z.uuid(), `SELECT id AS value FROM exam_app.exam_sittings WHERE event_id=$1${examId ? ' AND id=$2' : ''} ORDER BY id FOR UPDATE`, examId ? [eventId, examId] : [eventId]);
    if (examId && !ids.length)
        throw conflict('具体考试不存在。');
    // Teacher actions and worker completions lock existing attempts before assignments.
    // Archive uses the same order so admission and archival cannot interleave.
    if (archiving) await c.query('SELECT x.id FROM exam_app.exam_attempts x JOIN exam_app.exam_assignments a ON a.id=x.assignment_id WHERE a.sitting_id=ANY($1::uuid[]) ORDER BY x.id FOR UPDATE OF x', [ids]);
    // Entry locks assignments before creating attempts. Holding these rows makes the
    // no-attempt check and edits atomic without reversing the entry's user lock order.
    await c.query('SELECT id FROM exam_app.exam_assignments WHERE sitting_id=ANY($1::uuid[]) ORDER BY id FOR UPDATE', [ids]);
    return ids;
}
async function started(c: Queryable, ids: string[]) { return one(c, z.boolean(), `SELECT EXISTS(SELECT 1 FROM exam_app.exam_attempts x JOIN exam_app.exam_assignments a ON a.id=x.assignment_id WHERE a.sitting_id=ANY($1::uuid[])) AS value`, [ids]); }
async function archive(c: pg.PoolClient, actor: ExamUser, ids: string[]) {
    const busy = await one(c, z.boolean(), `SELECT EXISTS(SELECT 1 FROM exam_app.exam_attempts x JOIN exam_app.exam_assignments a ON a.id=x.assignment_id WHERE a.sitting_id=ANY($1::uuid[]) AND (x.ended_at IS NULL AND x.state IN ('in_progress','completed') OR EXISTS(SELECT 1 FROM exam_app.answer_runs r JOIN exam_app.question_slots q ON q.id=r.slot_id WHERE q.attempt_id=x.id AND r.finished_at IS NULL))) AS value`, [ids]);
    if (busy)
        throw conflict('仍有考试或答题任务进行中，请先结束后再删除。');
    await c.query(`UPDATE exam_app.exam_sittings SET archived_at=coalesce(archived_at,now()),state='cancelled',version=version+1 WHERE id=ANY($1::uuid[]) AND archived_at IS NULL`, [ids]);
    for (const id of ids)
        await audit(c, actor.id, 'exam.archive', id, 'sitting');
}
export async function createExamEvent(pool: pg.Pool, actor: ExamUser, raw: unknown) { const input = ExamEventCreateSchema.parse(raw); return mutate(pool, actor, 'event.create', input.requestId, input, async (c) => { const id = randomUUID(); const inserted = await c.query(`INSERT INTO exam_app.exam_events(id,title,template_id,manager_id) SELECT $1,$2,id,$4 FROM exam_app.exam_templates WHERE id=$3 AND state='published'`, [id, input.title, input.templateId, actor.id]); if (!inserted.rowCount)
    throw conflict('请选择有效模板。'); await audit(c, actor.id, 'event.create', id, 'event'); return { id }; }); }
export async function examEventPage(pool: pg.Pool, actor: ExamUser, raw: unknown) {
    requireManager(actor);
    const input = ExamEventPageQuerySchema.parse(raw);
    return tx(pool, async (c) => {
        const values: unknown[] = [isAdmin(actor), actor.id, '%' + input.q.replace(/[\\%_]/g, '\\$&') + '%'];
        const where = `e.archived_at IS NULL AND ($1::boolean OR e.manager_id=$2) AND (e.title ILIKE $3 ESCAPE E'\\\\' OR t.title ILIKE $3 ESCAPE E'\\\\')` + (input.exam ? ' AND t.exam_type=$4' : '');
        if (input.exam)
            values.push(input.exam);
        const total = await one(c, count, `SELECT count(*) AS value FROM exam_app.exam_events e JOIN exam_app.exam_templates t ON t.id=e.template_id WHERE ${where}`, values), page = Math.min(input.page, Math.max(1, Math.ceil(total / input.pageSize)));
        const items = await rows(c, ExamEventSchema, `SELECT ${eventProjection} AS value FROM exam_app.exam_events e JOIN exam_app.exam_templates t ON t.id=e.template_id WHERE ${where} ORDER BY e.created_at DESC,e.id LIMIT $${values.length + 1} OFFSET $${values.length + 2}`, [...values, input.pageSize, (page - 1) * input.pageSize]);
        return ExamEventPageSchema.parse({ items, total, page, pageSize: input.pageSize, selected: null });
    }, true);
}
export async function examEventDetail(pool: pg.Pool, actor: ExamUser, id: string) { return tx(pool, async (c) => { const parent = await access(c, actor, id); active(parent); const value = await one(c, ExamEventSchema, `SELECT ${eventProjection} AS value FROM exam_app.exam_events e JOIN exam_app.exam_templates t ON t.id=e.template_id WHERE e.id=$1`, [id]); const template = await one(c, ExamTemplateSchema, `SELECT ${templateJson} AS value FROM exam_app.exam_templates t WHERE t.id=$1`, [parent.templateId]); return ExamEventDetailSchema.parse({ event: value, template }); }, true); }
export async function examEventMembers(pool: pg.Pool, actor: ExamUser, eventId: string, raw: unknown) {
    const input = ExamEventMembersQuerySchema.parse(raw);
    return tx(pool, async (c) => {
        active(await access(c, actor, eventId));
        const membership = input.role === 'student' ? 'a.student_id=u.id' : `EXISTS(SELECT 1 FROM exam_app.staff_assignments f WHERE f.assignment_id=a.id AND f.staff_id=u.id AND f.revoked_at IS NULL)`;
        const where = `EXISTS(SELECT 1 FROM exam_app.exam_assignments a JOIN exam_app.exam_sittings s ON s.id=a.sitting_id WHERE s.event_id=$1 AND s.archived_at IS NULL AND a.state<>'revoked' AND ${membership}) AND (u.display_name ILIKE $2 ESCAPE E'\\\\' OR u.username ILIKE $2 ESCAPE E'\\\\')`;
        const values = [eventId, '%' + input.q.replace(/[\\%_]/g, '\\$&') + '%'], total = await one(c, count, `SELECT count(*) AS value FROM exam_app.users u WHERE ${where}`, values), page = Math.min(input.page, Math.max(1, Math.ceil(total / input.pageSize)));
        const items = await rows(c, ExamUserSchema, `SELECT ${userJson} AS value FROM exam_app.users u WHERE ${where} ORDER BY u.display_name,u.id LIMIT $3 OFFSET $4`, [...values, input.pageSize, (page - 1) * input.pageSize]);
        return ExamUserPageSchema.parse({ items, total, page, pageSize: input.pageSize, selected: null });
    }, true);
}
export async function updateExamEvent(pool: pg.Pool, actor: ExamUser, id: string, raw: unknown) {
    const input = ExamEventUpdateSchema.parse(raw);
    return mutate(pool, actor, 'event.update', input.requestId, { id, ...input }, async (c, parent) => {
        if (!parent)
            throw conflict('场次不存在。');
        currentVersion(parent.version, input.expectedVersion);
        if (parent.templateId !== input.templateId) {
            const ids = await lockExams(c, id);
            if (await started(c, ids))
                throw conflict('已有学生参加，不能更改场次模板；名称仍可修改。');
            const template = await one(c, ExamTemplateSchema, `SELECT ${templateJson} AS value FROM exam_app.exam_templates t WHERE t.id=$1 AND state='published'`, [input.templateId]);
            const settings = await rows(c, z.object({ mode: z.string(), wrongCounts: z.array(z.number()) }), `SELECT settings_snapshot AS value FROM exam_app.exam_assignments WHERE sitting_id=ANY($1::uuid[])`, [ids]);
            if (settings.some(s => s.mode === 'practice_simulation' && (s.wrongCounts.length !== template.modules.length || s.wrongCounts.some((n, i) => n > (template.modules[i]?.questionCount ?? 0)))))
                throw conflict('现有错题配置与新模板不兼容，请先调整具体考试的错题配置。');
            await c.query('UPDATE exam_app.exam_events SET template_id=$2 WHERE id=$1', [id, input.templateId]);
            await c.query('UPDATE exam_app.exam_sittings SET template_id=$2,version=version+1 WHERE event_id=$1', [id, input.templateId]);
        }
        await c.query('UPDATE exam_app.exam_events SET title=$2,version=version+1 WHERE id=$1', [id, input.title]);
        await audit(c, actor.id, 'event.update', id, 'event');
        return { id };
    }, id);
}
export async function deleteExamEvent(pool: pg.Pool, actor: ExamUser, id: string, raw: unknown) { const input = ExamEventMutationSchema.parse(raw); return mutate(pool, actor, 'event.delete', input.requestId, { id, ...input }, async (c, parent) => { if (!parent)
    throw conflict('场次不存在。'); currentVersion(parent.version, input.expectedVersion); const ids = await lockExams(c, id, undefined, true); await archive(c, actor, ids); await c.query('UPDATE exam_app.exam_events SET archived_at=now(),version=version+1 WHERE id=$1', [id]); await audit(c, actor.id, 'event.archive', id, 'event'); return { id }; }, id); }
export async function concreteExamPage(pool: pg.Pool, actor: ExamUser, eventId: string, raw: unknown) {
    const input = ExamPageQuerySchema.parse(raw);
    return tx(pool, async (c) => { const parent = await access(c, actor, eventId); active(parent); const eventValue = await one(c, ExamEventSchema, `SELECT ${eventProjection} AS value FROM exam_app.exam_events e JOIN exam_app.exam_templates t ON t.id=e.template_id WHERE e.id=$1`, [eventId]); const values = [eventId, '%' + input.q.replace(/[\\%_]/g, '\\$&') + '%']; const where = `s.event_id=$1 AND s.archived_at IS NULL AND s.title ILIKE $2 ESCAPE E'\\\\'`; const total = await one(c, count, `SELECT count(*) AS value FROM exam_app.exam_sittings s WHERE ${where}`, values), page = Math.min(input.page, Math.max(1, Math.ceil(total / input.pageSize))); const items = await rows(c, ExamConcreteSchema, `SELECT ${concreteProjection} AS value FROM exam_app.exam_sittings s WHERE ${where} ORDER BY s.opens_at DESC,s.id LIMIT $3 OFFSET $4`, [...values, input.pageSize, (page - 1) * input.pageSize]); return ExamConcretePageSchema.parse({ event: eventValue, items, total, page, pageSize: input.pageSize, selected: null }); }, true);
}
export async function createConcreteExam(pool: pg.Pool, actor: ExamUser, eventId: string, raw: unknown) { const input = ExamConcreteCreateSchema.parse(raw); return mutate(pool, actor, 'exam.create', input.requestId, { eventId, ...input }, async (c, parent) => { if (!parent)
    throw conflict('场次不存在。'); const total = await one(c, count, 'SELECT count(*) AS value FROM exam_app.exam_sittings WHERE event_id=$1 AND archived_at IS NULL', [eventId]); if (total >= 100)
    throw conflict('一个场次最多建立100个具体考试。'); const sitting = await insertSitting(c, actor, { templateId: parent.templateId, title: input.title, opensAt: input.opensAt, closesAt: input.closesAt }, eventId); for (const studentId of [...input.studentIds].sort())
    await insertAssignment(c, actor, { sittingId: sitting.id, studentId, supportIds: input.supportIds, mode: input.mode, wrongCounts: input.wrongCounts }); return sitting; }, eventId); }
export async function updateConcreteExam(pool: pg.Pool, actor: ExamUser, eventId: string, id: string, raw: unknown) {
    const input = ExamConcreteUpdateSchema.parse(raw);
    return mutate(pool, actor, 'exam.update', input.requestId, { eventId, id, ...input }, async (c) => {
        const item = await one(c, ExamConcreteSchema, `SELECT ${concreteProjection} AS value FROM exam_app.exam_sittings s WHERE s.id=$1 AND s.event_id=$2 AND s.archived_at IS NULL FOR UPDATE OF s`, [id, eventId]);
        currentVersion(item.version, input.expectedVersion);
        const changed = Date.parse(item.opensAt) !== Date.parse(input.opensAt) || (item.closesAt === null) !== (input.closesAt === null) || item.closesAt !== null && input.closesAt !== null && Date.parse(item.closesAt) !== Date.parse(input.closesAt);
        if (changed) {
            await lockExams(c, eventId, id);
            if (await started(c, [id]))
                throw conflict('已有学生参加，不能更改考试时间；名称仍可修改。');
            await c.query('UPDATE exam_app.exam_assignments SET opens_at=$2,closes_at=$3,version=version+1 WHERE sitting_id=$1', [id, input.opensAt, input.closesAt]);
        }
        await c.query('UPDATE exam_app.exam_sittings SET title=$2,opens_at=$3,closes_at=$4,version=version+1 WHERE id=$1', [id, input.title, input.opensAt, input.closesAt]);
        const attempts = await rows(c, z.uuid(), 'SELECT x.id AS value FROM exam_app.exam_attempts x JOIN exam_app.exam_assignments a ON a.id=x.assignment_id WHERE a.sitting_id=$1', [id]);
        for (const attempt of attempts)
            await event(c, attempt, 'exam.renamed');
        await audit(c, actor.id, 'exam.update', id, 'sitting');
        return { id };
    }, eventId);
}
export async function deleteConcreteExam(pool: pg.Pool, actor: ExamUser, eventId: string, id: string, raw: unknown) { const input = ExamEventMutationSchema.parse(raw); return mutate(pool, actor, 'exam.delete', input.requestId, { eventId, id, ...input }, async (c) => { const item = await one(c, z.number(), 'SELECT version AS value FROM exam_app.exam_sittings WHERE id=$1 AND event_id=$2 AND archived_at IS NULL', [id, eventId]); currentVersion(item, input.expectedVersion); await lockExams(c, eventId, id, true); await archive(c, actor, [id]); return { id }; }, eventId); }
