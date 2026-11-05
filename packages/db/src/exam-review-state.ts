// Decision: .agents/notes/implemented/architecture/2026-11-03-exam-navigation-and-tracking.md
// Decision: .agents/notes/implemented/architecture/2026-11-03-durable-exam-reviews.md
import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { z } from 'zod';
import { one, rows } from './exam-store.js';
export const incidentJson = `jsonb_build_object('id',i.id,'slotId',q.id,'moduleId',q.module_id,'moduleTitle',m.title,'position',q.position,'revision',v.revision,'reason',i.reason,'openedAt',i.opened_at)`;
export const incidentFrom = `exam_app.verification_incidents i JOIN exam_app.question_slots q ON q.id=i.slot_id JOIN exam_app.question_revisions v ON v.id=i.revision_id JOIN exam_app.attempt_modules m ON m.id=q.module_id`;
export async function openIncident(c: pg.PoolClient, slotId: string, revisionId: string, runId: string, reason: string) {
    await c.query(`INSERT INTO exam_app.verification_incidents(id,slot_id,attempt_id,student_id,revision_id,source_run_id,reason) SELECT $1,q.id,q.attempt_id,q.student_id,$3,$4,$5 FROM exam_app.question_slots q WHERE q.id=$2 ON CONFLICT(slot_id) WHERE resolved_at IS NULL DO UPDATE SET revision_id=excluded.revision_id,source_run_id=excluded.source_run_id,reason=excluded.reason,updated_at=now()`, [randomUUID(), slotId, revisionId, runId, reason]);
}
/** Every mutation uses the attempt lock; background results never move another slot's cursor. */
export async function refreshExamProgress(c: pg.PoolClient, attemptId: string) {
    await c.query(`UPDATE exam_app.attempt_modules m SET state=CASE WHEN NOT EXISTS(SELECT 1 FROM exam_app.question_slots q WHERE q.module_id=m.id AND q.completed_once_at IS NULL) THEN 'completed' WHEN EXISTS(SELECT 1 FROM exam_app.exam_attempts x JOIN exam_app.question_slots q ON q.id=x.next_slot_id WHERE x.id=m.attempt_id AND q.module_id=m.id) THEN 'in_progress' ELSE 'available' END,completed_at=CASE WHEN NOT EXISTS(SELECT 1 FROM exam_app.question_slots q WHERE q.module_id=m.id AND q.completed_once_at IS NULL) THEN coalesce(m.completed_at,now()) ELSE NULL END WHERE m.attempt_id=$1`, [attemptId]);
    const remaining = await one(c, z.boolean(), `SELECT EXISTS(SELECT 1 FROM exam_app.question_slots WHERE attempt_id=$1 AND completed_once_at IS NULL) AS value`, [attemptId]);
    if (!remaining) {
        await c.query(`UPDATE exam_app.exam_attempts SET state='completed',finished_at=coalesce(finished_at,now()) WHERE id=$1 AND state IN ('in_progress','completed')`, [attemptId]);
        await c.query(`UPDATE exam_app.exam_assignments SET state='completed' WHERE id=(SELECT assignment_id FROM exam_app.exam_attempts WHERE id=$1) AND state='assigned'`, [attemptId]);
    }
}
export async function advanceCursor(c: pg.PoolClient, attemptId: string, slotId: string) {
    await c.query('UPDATE exam_app.question_slots SET skipped_at=NULL,deferred_at=NULL WHERE id=$1 AND completed_once_at IS NOT NULL', [slotId]);
    const atCursor = await one(c, z.boolean(), 'SELECT coalesce(next_slot_id=$2,false) AS value FROM exam_app.exam_attempts WHERE id=$1', [attemptId, slotId]);
    if (atCursor) {
        const next = await rows(c, z.uuid(), `SELECT n.id AS value FROM exam_app.question_slots n JOIN exam_app.question_slots q ON n.module_id=q.module_id WHERE q.id=$1 AND n.id<>q.id AND n.completed_once_at IS NULL AND n.deferred_at IS NULL AND n.skipped_at IS NULL AND NOT EXISTS(SELECT 1 FROM exam_app.answer_runs r WHERE r.id=n.current_run_id AND r.finished_at IS NULL) ORDER BY (n.position>q.position) DESC,n.position LIMIT 1`, [slotId]);
        await c.query('UPDATE exam_app.exam_attempts SET next_slot_id=$2,version=version+1 WHERE id=$1', [attemptId, next[0] ?? null]);
    }
    await refreshExamProgress(c, attemptId);
}
