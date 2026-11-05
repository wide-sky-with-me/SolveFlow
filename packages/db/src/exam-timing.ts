// Decision: .agents/notes/implemented/architecture/2026-11-04-exam-timing.md
import type pg from 'pg';
import { z } from 'zod';
import type { ExamUser } from '@solveflow/contracts/managed-exam';
import { audit, event, lockActor, one, rows, scope, tx } from './exam-store.js';

export async function expireExamAttempt(c: pg.PoolClient, attemptId: string) {
  const changed = await c.query(`UPDATE exam_app.exam_attempts x SET state='closed',ended_at=greatest(x.started_at,a.closes_at),end_reason='deadline',finished_at=coalesce(x.finished_at,a.closes_at),version=x.version+1 FROM exam_app.exam_assignments a WHERE x.id=$1 AND a.id=x.assignment_id AND x.ended_at IS NULL AND x.started_at IS NOT NULL AND a.closes_at<=now()`, [attemptId]);
  if (changed.rowCount) {
    await c.query("UPDATE exam_app.exam_assignments SET state='completed' WHERE id=(SELECT assignment_id FROM exam_app.exam_attempts WHERE id=$1) AND state='assigned'", [attemptId]);
    await event(c, attemptId, 'attempt.ended');
  }
}
export async function expireExams(pool: pg.Pool) {
  return tx(pool, async c => {
    const expired = await rows(c, z.uuid(), `SELECT x.id AS value FROM exam_app.exam_attempts x JOIN exam_app.exam_assignments a ON a.id=x.assignment_id WHERE x.ended_at IS NULL AND x.started_at IS NOT NULL AND a.closes_at<=now() ORDER BY a.closes_at,x.id LIMIT 50 FOR UPDATE OF x SKIP LOCKED`);
    for (const id of expired) await expireExamAttempt(c, id);
  });
}

// x/a are the attempt and effective assignment in both snapshot and tracking queries.
const effectiveEnd = `coalesce(x.ended_at,CASE WHEN a.closes_at<=now() THEN a.closes_at END)`;
export const attemptTimingJson = `jsonb_build_object('startedAt',x.started_at,'endedAt',${effectiveEnd},'endedBy',coalesce(x.end_reason,CASE WHEN a.closes_at<=now() THEN 'deadline' END),'elapsedSeconds',coalesce(greatest(0,floor(extract(epoch FROM (coalesce(${effectiveEnd},now())-x.started_at))))::bigint,0),'remainingSeconds',CASE WHEN a.closes_at IS NULL THEN NULL ELSE greatest(0,ceil(extract(epoch FROM a.closes_at-now())))::bigint END,'serverNow',now())`;

/** One attempt lock serializes submission, teacher review, result publication and ending. */
export async function endExamAttempt(pool: pg.Pool, actor: ExamUser, attemptId: string) {
  return tx(pool, async c => {
    await lockActor(c, actor);
    const assignmentId = await one(c, z.uuid(), 'SELECT assignment_id AS value FROM exam_app.exam_attempts WHERE id=$1', [attemptId]);
    await scope(c, actor, assignmentId);
    const attempt = await one(c, z.object({ studentId: z.uuid(), ended: z.boolean(), expired: z.boolean() }), `SELECT jsonb_build_object('studentId',x.student_id,'ended',x.ended_at IS NOT NULL,'expired',coalesce(a.closes_at<=now(),false)) AS value FROM exam_app.exam_attempts x JOIN exam_app.exam_assignments a ON a.id=x.assignment_id WHERE x.id=$1 FOR UPDATE OF x`, [attemptId]);
    await scope(c, actor, assignmentId);
    if (attempt.ended) return { id: attemptId };
    const reason = attempt.expired ? 'deadline' : actor.id === attempt.studentId ? 'student' : 'teacher';
    await c.query(`UPDATE exam_app.exam_attempts x SET state='closed',ended_at=greatest(x.started_at,least(now(),a.closes_at)),end_reason=$2,ended_by=$3,finished_at=coalesce(x.finished_at,now()),version=x.version+1 FROM exam_app.exam_assignments a WHERE x.id=$1 AND a.id=x.assignment_id`, [attemptId, reason, actor.id]);
    await c.query(`UPDATE exam_app.exam_assignments SET state='completed' WHERE id=$1 AND state='assigned'`, [assignmentId]);
    await c.query(`UPDATE exam_app.answer_runs r SET status='cancelled',cancel_requested_at=now(),finished_at=now(),error_code='CANCELLED' FROM exam_app.question_slots q WHERE q.attempt_id=$1 AND r.slot_id=q.id AND r.finished_at IS NULL`, [attemptId]);
    await event(c, attemptId, 'attempt.ended');
    await audit(c, actor.id, 'attempt.end', attemptId, 'attempt');
    return { id: attemptId };
  });
}
