// Decision: .agents/notes/implemented/architecture/2026-11-03-exam-navigation-and-tracking.md
import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { z } from 'zod';
import { ExamNavigationSchema, ExamNavigationResultSchema, type ExamUser } from '@solveflow/contracts/managed-exam';
import { conflict, event, hash, one, rows, scope, tx } from './exam-store.js';
import { refreshExamProgress } from './exam-review-state.js';
export const activityJson = `jsonb_build_object('id',n.id,'action',n.action,'moduleTitle',m.title,'position',q.position,'targetSlotId',n.target_slot_id,'affectedCount',n.affected_count,'createdAt',n.created_at)`;
export const activityFrom = `exam_app.student_navigation n JOIN exam_app.attempt_modules m ON m.id=n.module_id LEFT JOIN exam_app.question_slots q ON q.id=n.slot_id`;
export async function navigateAttempt(pool: pg.Pool, actor: ExamUser, attemptId: string, raw: unknown) {
    const input = ExamNavigationSchema.parse(raw);
    return tx(pool, async c => {
        await scope(c, actor, await one(c, z.uuid(), 'SELECT assignment_id AS value FROM exam_app.exam_attempts WHERE id=$1', [attemptId]), true);
        const current = await one(c, z.object({ version: z.coerce.number(), allowed: z.boolean() }), `SELECT jsonb_build_object('version',x.navigation_version,'allowed',x.ended_at IS NULL AND a.state IN ('assigned','completed') AND x.state IN ('in_progress','completed') AND s.state='published' AND now()>=a.opens_at AND (a.closes_at IS NULL OR now()<a.closes_at)) AS value FROM exam_app.exam_attempts x JOIN exam_app.exam_assignments a ON a.id=x.assignment_id JOIN exam_app.exam_sittings s ON s.id=a.sitting_id WHERE x.id=$1 FOR UPDATE OF x`, [attemptId]);
        const digest = hash(JSON.stringify({ attemptId, ...input }));
        const previous = (await rows(c, z.object({ hash: z.string(), response: ExamNavigationResultSchema }), `SELECT jsonb_build_object('hash',input_sha256,'response',response) AS value FROM exam_app.idempotency_requests WHERE actor_id=$1 AND operation='navigation' AND request_id=$2`, [actor.id, input.requestId]))[0];
        if (previous) {
            if (previous.hash !== digest) throw conflict('同一请求标识不能用于不同跳转。');
            return previous.response;
        }
        if (!current.allowed) throw conflict('当前不在可操作的考试时间内。');
        if (current.version !== input.expectedVersion) throw conflict('当前位置已在其他页面更新，请同步后重试。');
        const origin = 'slotId' in input
            ? await one(c, z.object({ moduleId: z.uuid(), position: z.number(), slotId: z.uuid().nullable() }), `SELECT jsonb_build_object('moduleId',module_id,'position',ordinal,'slotId',id) AS value FROM exam_app.question_slots WHERE id=$1 AND attempt_id=$2`, [input.slotId, attemptId])
            : await one(c, z.object({ moduleId: z.uuid(), position: z.number(), slotId: z.uuid().nullable() }), `SELECT jsonb_build_object('moduleId',m.id,'position',(SELECT max(q.ordinal) FROM exam_app.question_slots q WHERE q.module_id=m.id),'slotId',NULL) AS value FROM exam_app.attempt_modules m WHERE m.id=$1 AND m.attempt_id=$2`, [input.moduleId, attemptId]);
        let targetId: string | null = origin.slotId;
        let affected = 0;
        if (input.action === 'skip_slot' || input.action === 'skip_module') {
            const skipped = await c.query(`UPDATE exam_app.question_slots SET skipped_at=coalesce(skipped_at,now()) WHERE attempt_id=$1 AND completed_once_at IS NULL AND skipped_at IS NULL AND CASE WHEN $2::uuid IS NULL THEN module_id=$3 ELSE id=$2 END`, [attemptId, origin.slotId, origin.moduleId]);
            affected = skipped.rowCount ?? 0;
            targetId = (await rows(c, z.uuid(), `SELECT q.id AS value FROM exam_app.question_slots q WHERE q.attempt_id=$1 AND q.completed_once_at IS NULL AND q.skipped_at IS NULL AND q.deferred_at IS NULL AND NOT EXISTS(SELECT 1 FROM exam_app.answer_runs r WHERE r.id=q.current_run_id AND r.finished_at IS NULL) ORDER BY (q.ordinal>$2) DESC,q.ordinal LIMIT 1`, [attemptId, origin.position]))[0] ?? null;
        } else if (input.action === 'select_module') {
            targetId = await one(c, z.uuid(), `SELECT id AS value FROM exam_app.question_slots WHERE module_id=$1 ORDER BY (completed_once_at IS NULL AND skipped_at IS NULL AND deferred_at IS NULL) DESC,position LIMIT 1`, [origin.moduleId]);
        }
        const result = ExamNavigationResultSchema.parse({ id: attemptId, slotId: targetId, navigationVersion: current.version + 1 });
        await c.query('UPDATE exam_app.exam_attempts SET next_slot_id=$2,viewed_slot_id=coalesce($2,viewed_slot_id),navigation_version=navigation_version+1,version=version+1 WHERE id=$1', [attemptId, targetId]);
        if (targetId) await c.query('UPDATE exam_app.attempt_modules SET opened_at=coalesce(opened_at,now()) WHERE id=(SELECT module_id FROM exam_app.question_slots WHERE id=$1)', [targetId]);
        await refreshExamProgress(c, attemptId);
        await c.query(`INSERT INTO exam_app.student_navigation(id,attempt_id,student_id,request_id,module_id,slot_id,target_slot_id,action,affected_count,navigation_version) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, [randomUUID(), attemptId, actor.id, input.requestId, origin.moduleId, origin.slotId, targetId, input.action, affected, result.navigationVersion]);
        await c.query(`INSERT INTO exam_app.idempotency_requests(actor_id,operation,request_id,input_sha256,status,response_status,response,expires_at) VALUES($1,'navigation',$2,$3,'completed',200,$4,now()+interval '180 days')`, [actor.id, input.requestId, digest, JSON.stringify(result)]);
        await event(c, attemptId, 'student.' + input.action);
        return result;
    });
}
