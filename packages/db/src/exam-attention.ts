// Decision: .agents/notes/implemented/architecture/2026-11-03-exam-resolution-notifications.md
import type pg from 'pg';
import { z } from 'zod';
import { ExamIssueQueueItemSchema, ExamIssueQueueQuerySchema, ExamIssueQueueSchema, type ExamUser } from '@solveflow/contracts/managed-exam';
import { conflict, event, ExamError, forbidden, isAdmin, one, rows, scope, tx } from './exam-store.js';
import { incidentFrom, incidentJson } from './exam-review-state.js';

// Current revision and absence of a new incident fence obsolete resolution notices.
export const unreadResolutions = `(SELECT coalesce(jsonb_agg(n.value ORDER BY n.resolved_at DESC,n.id),'[]'::jsonb) FROM (SELECT DISTINCT ON(q.id) i.id,i.resolved_at,jsonb_build_object('id',i.id,'slotId',q.id,'moduleId',q.module_id,'moduleTitle',m.title,'position',q.position,'revision',v.revision,'resolution',i.resolution,'resolvedAt',i.resolved_at) AS value FROM ${incidentFrom} WHERE i.attempt_id=x.id AND i.resolved_at IS NOT NULL AND i.resolution_read_at IS NULL AND i.revision_id=q.current_revision_id AND NOT EXISTS(SELECT 1 FROM exam_app.verification_incidents pending WHERE pending.slot_id=q.id AND pending.resolved_at IS NULL) ORDER BY q.id,i.resolved_at DESC,i.id) n)`;

const cursorSchema = z.strictObject({ openedAt: z.iso.datetime({ offset: true }), id: z.uuid() });
export async function issueQueue(pool: pg.Pool, actor: ExamUser, raw: unknown) {
    if (actor.state !== 'active' || !actor.roles.some(r => ['support', 'manager', 'admin'].includes(r))) throw forbidden();
    const input = ExamIssueQueueQuerySchema.parse(raw);
    let cursor: z.infer<typeof cursorSchema> | null = null;
    if (input.cursor) {
        try { cursor = cursorSchema.parse(JSON.parse(Buffer.from(input.cursor, 'base64url').toString('utf8'))); }
        catch { throw new ExamError(400, 'INVALID_CURSOR', '列表位置无效，请返回第一页。'); }
    }
    return tx(pool, async c => {
        // Staff ownership is insufficient: scope must come from the assigned staff/manager role.
        const from = `${incidentFrom} JOIN exam_app.exam_attempts x ON x.id=i.attempt_id JOIN exam_app.exam_assignments a ON a.id=x.assignment_id JOIN exam_app.exam_sittings s ON s.id=a.sitting_id JOIN exam_app.users u ON u.id=i.student_id`;
        const where = `i.resolved_at IS NULL AND ($1::boolean OR ($2::boolean AND s.manager_id=$4) OR ($3::boolean AND EXISTS(SELECT 1 FROM exam_app.staff_assignments f WHERE f.assignment_id=a.id AND f.staff_id=$4 AND f.revoked_at IS NULL))) AND ($5::uuid IS NULL OR i.student_id=$5) AND ($6::text IS NULL OR i.reason=$6) AND ($7::text='' OR u.display_name ILIKE $7 ESCAPE E'\\\\' OR u.username ILIKE $7 ESCAPE E'\\\\' OR s.title ILIKE $7 ESCAPE E'\\\\' OR m.title ILIKE $7 ESCAPE E'\\\\') AND ($8::uuid IS NULL OR a.sitting_id=$8)`;
        const params = [isAdmin(actor), actor.roles.includes('manager'), actor.roles.includes('support'), actor.id, input.studentId ?? null, input.reason ?? null, input.q?'%'+input.q.replace(/[\\%_]/g,'\\$&')+'%':'', input.sittingId ?? null];
        const total = await one(c, z.number().int().nonnegative(), `SELECT count(*)::integer AS value FROM ${from} WHERE ${where}`, params);
        const page = await rows(c, ExamIssueQueueItemSchema, `SELECT (${incidentJson} || jsonb_build_object('attemptId',i.attempt_id,'studentId',i.student_id,'studentName',u.display_name,'title',s.title)) AS value FROM ${from} WHERE ${where} AND ($9::timestamptz IS NULL OR (i.opened_at,i.id)>($9::timestamptz,$10::uuid)) ORDER BY i.opened_at,i.id LIMIT $11`, [...params, cursor?.openedAt ?? null, cursor?.id ?? null, input.limit + 1]);
        const items = page.slice(0, input.limit), last = items.at(-1);
        const nextCursor = page.length > input.limit && last ? Buffer.from(JSON.stringify({ openedAt: last.openedAt, id: last.id })).toString('base64url') : null;
        return ExamIssueQueueSchema.parse({ items, total, nextCursor });
    }, true);
}

export async function readResolution(pool: pg.Pool, actor: ExamUser, incidentId: string) {
    return tx(pool, async c => {
        const notice = await one(c, z.object({ attemptId: z.uuid(), studentId: z.uuid(), assignmentId: z.uuid(), resolved: z.boolean() }), `SELECT jsonb_build_object('attemptId',i.attempt_id,'studentId',i.student_id,'assignmentId',x.assignment_id,'resolved',i.resolved_at IS NOT NULL) AS value FROM exam_app.verification_incidents i JOIN exam_app.exam_attempts x ON x.id=i.attempt_id WHERE i.id=$1`, [incidentId]);
        if (actor.state !== 'active' || actor.id !== notice.studentId) throw forbidden();
        await scope(c, actor, notice.assignmentId, true);
        if (!notice.resolved) throw conflict('本题仍待处理，无法标记为已读。');
        await c.query('SELECT id FROM exam_app.exam_attempts WHERE id=$1 FOR UPDATE', [notice.attemptId]);
        const read = await c.query(`UPDATE exam_app.verification_incidents i SET resolution_read_at=clock_timestamp() FROM exam_app.question_slots q WHERE i.id=$1 AND q.id=i.slot_id AND i.revision_id=q.current_revision_id AND i.resolved_at IS NOT NULL AND i.resolution_read_at IS NULL AND NOT EXISTS(SELECT 1 FROM exam_app.verification_incidents pending WHERE pending.slot_id=q.id AND pending.resolved_at IS NULL) RETURNING i.id`, [incidentId]);
        if (read.rowCount) await event(c, notice.attemptId, 'resolution.read');
        return { ok: true };
    });
}
