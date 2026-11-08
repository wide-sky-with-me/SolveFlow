// Decision: .agents/notes/implemented/architecture/2026-11-07-archived-exam-visibility.md
import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { z } from 'zod';
import { ExamTeacherMessageCreateSchema, ExamTeacherMessageSchema, type ExamUser } from '@solveflow/contracts/managed-exam';
import { audit, conflict, event, ExamError, forbidden, lockActor, one, rows, tx, type Queryable } from './exam-store.js';
// Decision: .agents/notes/implemented/architecture/2026-11-07-teacher-messages.md
export async function sendTeacherMessage(pool: pg.Pool, actor: ExamUser, slotId: string, raw: unknown) {
    const input = ExamTeacherMessageCreateSchema.parse(raw);
    return tx(pool, async (c) => {
        await lockActor(c, actor);
        if (!actor.roles.some(role => ['admin', 'manager', 'support'].includes(role)))
            throw forbidden();
        const target = await one(c, z.object({ attemptId: z.uuid(), studentId: z.uuid() }), `SELECT jsonb_build_object('attemptId',attempt_id,'studentId',student_id) AS value FROM exam_app.question_slots WHERE id=$1`, [slotId]);
        await c.query('SELECT id FROM exam_app.exam_attempts WHERE id=$1 FOR UPDATE', [target.attemptId]);
        const allowed = await one(c, z.boolean(), `SELECT s.archived_at IS NULL AND u.state='active' AND a.state<>'revoked' AND ($2::boolean OR ($3::boolean AND s.manager_id=$4) OR ($5::boolean AND EXISTS(SELECT 1 FROM exam_app.staff_assignments f WHERE f.assignment_id=a.id AND f.staff_id=$4 AND f.revoked_at IS NULL))) AS value FROM exam_app.exam_attempts x JOIN exam_app.exam_assignments a ON a.id=x.assignment_id JOIN exam_app.exam_sittings s ON s.id=a.sitting_id JOIN exam_app.users u ON u.id=x.student_id WHERE x.id=$1`, [target.attemptId, actor.roles.includes('admin'), actor.roles.includes('manager'), actor.id, actor.roles.includes('support')]);
        if (!allowed)
            throw forbidden();
        // Different exams for one student share the unread limit.
        for (const key of ['message-recipient:' + target.studentId, 'message-sender:' + actor.id].sort())
            await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,12))', [key]);
        const priorSchema = z.object({ id: z.uuid(), slotId: z.uuid(), revision: z.number(), message: z.string() });
        const prior = () => rows(c, priorSchema, `SELECT jsonb_build_object('id',id,'slotId',slot_id,'revision',material_revision,'message',message) AS value FROM exam_app.teacher_messages WHERE sender_id=$1 AND request_id=$2`, [actor.id, input.requestId]);
        const existing = (await prior())[0];
        function receipt(value: z.infer<typeof priorSchema>) {
            if (value.slotId !== slotId || value.revision !== input.expectedRevision || value.message !== input.message)
                throw conflict('同一请求标识不能用于不同消息。');
            return { id: value.id };
        }
        if (existing)
            return receipt(existing);
        const revision = await one(c, z.coerce.number(), `SELECT coalesce(v.revision,0) AS value FROM exam_app.question_slots q LEFT JOIN exam_app.question_revisions v ON v.id=q.current_revision_id WHERE q.id=$1`, [slotId]);
        if (revision !== input.expectedRevision)
            throw conflict('题图已更新，请重新查看后再发送消息。');
        const counts = await one(c, z.object({ total: z.number(), unread: z.number(), recent: z.number() }), `SELECT jsonb_build_object('total',count(*) FILTER(WHERE attempt_id=$1),'unread',count(*) FILTER(WHERE student_id=$2 AND read_at IS NULL),'recent',count(*) FILTER(WHERE sender_id=$3 AND created_at>now()-interval '1 minute')) AS value FROM exam_app.teacher_messages WHERE attempt_id=$1 OR student_id=$2 AND read_at IS NULL OR sender_id=$3 AND created_at>now()-interval '1 minute'`, [target.attemptId, target.studentId, actor.id]);
        if (counts.total >= 1000 || counts.unread >= 100 || counts.recent >= 20)
            throw new ExamError(429, 'MESSAGE_LIMIT', '消息较多，请稍后再发送。');
        const id = randomUUID();
        const inserted = await c.query(`INSERT INTO exam_app.teacher_messages(id,slot_id,attempt_id,student_id,sender_id,request_id,material_revision,message) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(sender_id,request_id) DO NOTHING`, [id, slotId, target.attemptId, target.studentId, actor.id, input.requestId, input.expectedRevision, input.message]);
        if (!inserted.rowCount) {
            const value = (await prior())[0];
            if (!value)
                throw conflict('请重新同步消息。');
            return receipt(value);
        }
        await audit(c, actor.id, 'teacher.message', id, 'message');
        await event(c, target.attemptId, 'teacher.message');
        return { id };
    });
}
export async function teacherMessages(pool: Queryable, actor: ExamUser) {
    if (actor.state !== 'active' || !actor.roles.includes('student'))
        throw forbidden();
    return { items: await rows(pool, ExamTeacherMessageSchema, `SELECT jsonb_build_object('id',n.id,'attemptId',n.attempt_id,'slotId',n.slot_id,'moduleTitle',m.title,'position',q.position,'examTitle',s.title,'teacherName',t.display_name,'message',n.message,'createdAt',n.created_at) AS value FROM exam_app.teacher_messages n JOIN exam_app.users t ON t.id=n.sender_id JOIN exam_app.question_slots q ON q.id=n.slot_id JOIN exam_app.attempt_modules m ON m.id=q.module_id JOIN exam_app.exam_attempts x ON x.id=n.attempt_id JOIN exam_app.exam_assignments a ON a.id=x.assignment_id JOIN exam_app.exam_sittings s ON s.id=a.sitting_id WHERE n.student_id=$1 AND n.read_at IS NULL ORDER BY n.created_at,n.id LIMIT 100`, [actor.id]) };
}
export async function readTeacherMessage(pool: pg.Pool, actor: ExamUser, id: string) {
    if (actor.state !== 'active' || !actor.roles.includes('student'))
        throw forbidden();
    return tx(pool, async (c) => {
        await lockActor(c, actor);
        const result = await c.query('UPDATE exam_app.teacher_messages SET read_at=coalesce(read_at,now()) WHERE id=$1 AND student_id=$2', [id, actor.id]);
        if (!result.rowCount)
            throw forbidden();
        return { ok: true };
    });
}
