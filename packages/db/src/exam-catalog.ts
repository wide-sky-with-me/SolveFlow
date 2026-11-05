// Decision: .agents/notes/implemented/architecture/2026-11-03-exam-console-dashboard.md
import { availableAssignment, assignmentJson, progressJson, userScope } from './exam-list-sql.js';
import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { z } from 'zod';
import { ExamProgressSchema, ExamAssignmentCreateSchema, ExamAssignmentSchema, ExamSittingCreateSchema, ExamSittingSchema, ExamTemplateCreateSchema, ExamTemplateSchema, ExamUserCreateSchema, ExamUserSchema, ExamUserUpdateSchema, type ExamUser } from '@solveflow/contracts/managed-exam';
import { audit, conflict, forbidden, hash, isAdmin, lockActor, one, requireManager, rows, tx, userById, userJson, type Queryable } from './exam-store.js';
export const templateJson = `jsonb_build_object('id',t.id,'code',t.code,'title',t.title,'exam',t.exam_type,'version',t.version,'reference',t.rules->'reference','modules',(SELECT jsonb_agg((m.rules || jsonb_build_object('code',m.code,'title',m.title,'sectionCode',m.section_code,'questionCount',m.question_count,'durationSeconds',m.duration_seconds)) ORDER BY m.position) FROM exam_app.template_modules m WHERE m.template_id=t.id))`;
export async function templates(pool: pg.Pool) { return rows(pool, ExamTemplateSchema, `SELECT ${templateJson} AS value FROM exam_app.exam_templates t WHERE state='published' ORDER BY t.title,t.version DESC LIMIT 100`); }
export async function createTemplate(pool: pg.Pool, actor: ExamUser, raw: unknown) {
    requireManager(actor);
    const input = ExamTemplateCreateSchema.parse(raw);
    return tx(pool, async (c) => {
        await lockActor(c, actor);
        await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', ['template:' + input.code]);
        const version = await one(c, z.number(), 'SELECT coalesce(max(version),0)+1 AS value FROM exam_app.exam_templates WHERE code=$1', [input.code]);
        const id = randomUUID();
        await c.query(`INSERT INTO exam_app.exam_templates(id,code,version,exam_type,title,rules,config_sha256,state,created_by) VALUES($1,$2,$3,$4,$5,$8,$6,'published',$7)`, [id, input.code, version, input.exam, input.title, hash(JSON.stringify(input)), actor.id, JSON.stringify({ reference: input.reference })]);
        for (const [i, m] of input.modules.entries())
            await c.query(`INSERT INTO exam_app.template_modules(id,template_id,position,code,section_code,title,question_count,duration_seconds,response_kinds,rules) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, [randomUUID(), id, i + 1, m.code, m.sectionCode, m.title, m.questionCount, m.durationSeconds, JSON.stringify(m.responseKinds), JSON.stringify(m)]);
        await audit(c, actor.id, 'template.publish', id, 'template');
        return { id };
    });
}
export async function listUsers(pool: Queryable, actor: ExamUser) {
    requireManager(actor);
    return rows(pool, ExamUserSchema, `SELECT ${userJson} AS value FROM exam_app.users u WHERE ${userScope} ORDER BY u.created_at DESC LIMIT 500`, [isAdmin(actor), actor.id]);
}
export async function createUser(pool: pg.Pool, actor: ExamUser, raw: unknown, passwordHash: string) {
    requireManager(actor);
    const input = ExamUserCreateSchema.parse(raw);
    if (!isAdmin(actor) && input.roles.some(r => r !== 'student'))
        throw forbidden();
    return tx(pool, async (c) => {
        await lockActor(c, actor);
        const id = randomUUID();
        await c.query(`INSERT INTO exam_app.users(id,username,display_name,password_hash,created_by) VALUES($1,$2,$3,$4,$5)`, [id, input.username, input.displayName, passwordHash, actor.id]);
        for (const role of input.roles)
            await c.query('INSERT INTO exam_app.user_roles(user_id,role_id) SELECT $1,id FROM exam_app.roles WHERE code=$2', [id, role]);
        await audit(c, actor.id, 'user.create', id, 'user');
        return userById(c, id);
    });
}
export async function updateUser(pool: pg.Pool, actor: ExamUser, id: string, raw: unknown, passwordHash: string | undefined) {
    if (!isAdmin(actor))
        throw forbidden();
    const input = ExamUserUpdateSchema.parse(raw);
    if (id === actor.id && (input.state !== 'active' || !input.roles.includes('admin')))
        throw conflict('不能停用自己或移除自己的管理员身份。');
    return tx(pool, async (c) => { await c.query('SELECT pg_advisory_xact_lock(5839201003)'); if (!isAdmin(await lockActor(c, actor)))
        throw forbidden(); await userById(c, id); await c.query('UPDATE exam_app.users SET display_name=$2,state=$3,password_hash=coalesce($4,password_hash),auth_version=auth_version+1,updated_at=now() WHERE id=$1', [id, input.displayName, input.state, passwordHash ?? null]); await c.query('DELETE FROM exam_app.user_roles WHERE user_id=$1', [id]); for (const role of input.roles)
        await c.query('INSERT INTO exam_app.user_roles(user_id,role_id) SELECT $1,id FROM exam_app.roles WHERE code=$2', [id, role]); await audit(c, actor.id, 'user.update', id, 'user'); return userById(c, id); });
}
/** Internal transaction helper; callers must requireManager and lockActor first. */
export async function insertSitting(c: pg.PoolClient, actor: ExamUser, raw: unknown) {
    const input = ExamSittingCreateSchema.parse(raw), id = randomUUID();
    const inserted = await c.query(`INSERT INTO exam_app.exam_sittings(id,template_id,title,opens_at,closes_at,state,manager_id) SELECT $1,id,$3,$4,$5,'published',$6 FROM exam_app.exam_templates WHERE id=$2 AND state='published'`, [id,input.templateId,input.title,input.opensAt,input.closesAt,actor.id]);
    if (inserted.rowCount !== 1) throw forbidden();
    await audit(c,actor.id,'sitting.publish',id,'sitting'); return {id};
}
export async function createSitting(pool: pg.Pool, actor: ExamUser, raw: unknown) {
    requireManager(actor);
    return tx(pool, async c => { await lockActor(c,actor); return insertSitting(c,actor,raw); });
}
export async function sittings(pool: pg.Pool, actor: ExamUser) { requireManager(actor); return rows(pool, ExamSittingSchema, `SELECT jsonb_build_object('id',id,'templateId',template_id,'title',title,'opensAt',opens_at,'closesAt',closes_at,'state',state) AS value FROM exam_app.exam_sittings WHERE $1::boolean OR manager_id=$2 ORDER BY opens_at DESC LIMIT 200`, [isAdmin(actor), actor.id]); }
/** Internal transaction helper; callers must requireManager and lockActor first. */
export async function insertAssignment(c: pg.PoolClient, actor: ExamUser, raw: unknown) {
    const input = ExamAssignmentCreateSchema.parse(raw);
    const sitting = await one(c, z.object({ templateId: z.uuid(), opensAt: z.string(), closesAt: z.string().nullable() }), `SELECT jsonb_build_object('templateId',template_id,'opensAt',opens_at,'closesAt',closes_at) AS value FROM exam_app.exam_sittings WHERE id=$1 AND state='published' AND ($2::boolean OR manager_id=$3) FOR UPDATE`, [input.sittingId, isAdmin(actor), actor.id]);
    await c.query('SELECT id FROM exam_app.users WHERE id=$1 FOR SHARE',[input.studentId]);
    const student = await userById(c, input.studentId);
    if (student.state !== 'active' || !student.roles.includes('student'))
        throw conflict('请选择有效学生。');
    if (!isAdmin(actor) && !await one(c, z.boolean(), `SELECT EXISTS(SELECT 1 FROM exam_app.users u WHERE u.id=$1 AND (u.created_by=$2 OR EXISTS(SELECT 1 FROM exam_app.exam_assignments a JOIN exam_app.exam_sittings s ON s.id=a.sitting_id WHERE a.student_id=u.id AND s.manager_id=$2))) AS value`, [student.id, actor.id]))
        throw forbidden();
    const template = await one(c, ExamTemplateSchema, `SELECT ${templateJson} AS value FROM exam_app.exam_templates t WHERE id=$1`, [sitting.templateId]);
    if (input.mode === 'original' && input.wrongCounts.some(Boolean))
        throw conflict('正常答题模式不能设置模拟错题。');
    if (input.mode === 'practice_simulation' && (input.wrongCounts.length !== template.modules.length || input.wrongCounts.some((n, i) => n > (template.modules[i]?.questionCount ?? 0))))
        throw conflict('模拟错题数量须与模块对应，并且不超过题数。');
    for (const staffId of [...input.supportIds].sort()) {
        await c.query('SELECT id FROM exam_app.users WHERE id=$1 FOR SHARE',[staffId]);
        const staff = await userById(c, staffId);
        if (staff.state !== 'active' || !staff.roles.includes('support'))
            throw conflict('技术支持身份无效。');
    }
    const id = randomUUID();
    await c.query(`INSERT INTO exam_app.exam_assignments(id,sitting_id,student_id,opens_at,closes_at,state,settings_snapshot,created_by) VALUES($1,$2,$3,$4,$5,'assigned',$6,$7)`, [id, input.sittingId, input.studentId, sitting.opensAt, sitting.closesAt, JSON.stringify({ mode: input.mode, wrongCounts: input.wrongCounts }), actor.id]);
    await c.query(`INSERT INTO exam_app.delivery_policies(id,assignment_id,version,mode,targets,constraints,state,created_by,approved_by) VALUES($1,$2,1,$3,$4,'{}','approved',$5,$5)`, [randomUUID(), id, input.mode, JSON.stringify({ wrongCounts: input.wrongCounts }), actor.id]);
    for (const staffId of new Set(input.supportIds))
        await c.query('INSERT INTO exam_app.staff_assignments(assignment_id,staff_id,granted_by) VALUES($1,$2,$3)', [id, staffId, actor.id]);
    await audit(c, actor.id, 'assignment.create', id);
    return { id };
}
export async function createAssignment(pool: pg.Pool, actor: ExamUser, raw: unknown) {
    requireManager(actor);
    return tx(pool, async c => { await lockActor(c,actor); return insertAssignment(c,actor,raw); });
}
export async function assignments(pool: pg.Pool, actor: ExamUser) {
    return rows(pool, ExamAssignmentSchema, `SELECT ${assignmentJson} AS value FROM exam_app.exam_assignments a JOIN exam_app.users u ON u.id=a.student_id JOIN exam_app.exam_sittings s ON s.id=a.sitting_id JOIN exam_app.exam_templates t ON t.id=s.template_id WHERE $1::boolean OR a.student_id=$2 OR ($3::boolean AND s.manager_id=$2) OR ($4::boolean AND EXISTS(SELECT 1 FROM exam_app.staff_assignments f WHERE f.assignment_id=a.id AND f.staff_id=$2 AND f.revoked_at IS NULL)) ORDER BY a.opens_at DESC LIMIT 500`, [isAdmin(actor), actor.id, actor.roles.includes('manager'), actor.roles.includes('support')]);
}
export async function bootstrap(pool: pg.Pool, username: string, displayName: string, passwordHash: string) {
    return tx(pool, async (c) => {
        await c.query('SELECT pg_advisory_xact_lock(5839201002)');
        for (const [code, name] of [['student', '学生'], ['support', '技术支持'], ['manager', '场次管理员'], ['admin', '系统管理员']])
            await c.query('INSERT INTO exam_app.roles(id,code,name,built_in) VALUES($1,$2,$3,true) ON CONFLICT(code) DO NOTHING', [randomUUID(), code, name]);
        const exists = await one(c, z.boolean(), `SELECT EXISTS(SELECT 1 FROM exam_app.user_roles ur JOIN exam_app.roles r ON r.id=ur.role_id WHERE r.code='admin') AS value`);
        if (exists)
            throw conflict('管理员已初始化，请通过管理界面修改。');
        const id = randomUUID();
        await c.query('INSERT INTO exam_app.users(id,username,display_name,password_hash) VALUES($1,$2,$3,$4)', [id, username, displayName, passwordHash]);
        await c.query(`INSERT INTO exam_app.user_roles(user_id,role_id) SELECT $1,id FROM exam_app.roles WHERE code='admin'`, [id]);
        return userById(c, id);
    });
}
export async function progress(pool: pg.Pool, actor: ExamUser) {
    if (!actor.roles.some(r => ['admin', 'manager', 'support'].includes(r)))
        throw forbidden();
    const visible = await assignments(pool, actor);
    const ids = visible.map(a => a.id);
    return rows(pool, ExamProgressSchema, `SELECT ${progressJson} AS value FROM exam_app.exam_assignments a JOIN exam_app.users u ON u.id=a.student_id JOIN exam_app.exam_sittings s ON s.id=a.sitting_id LEFT JOIN exam_app.exam_attempts x ON x.assignment_id=a.id WHERE a.id=ANY($1::uuid[]) ORDER BY a.opens_at DESC`, [ids]);
}

export async function hasAvailableExam(pool: pg.Pool, studentId: string) { return one(pool, z.boolean(), `SELECT EXISTS(SELECT 1 FROM exam_app.exam_assignments a JOIN exam_app.exam_sittings s ON s.id=a.sitting_id WHERE a.student_id=$1 AND (${availableAssignment})) AS value`, [studentId]); }
