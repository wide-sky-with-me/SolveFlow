// Decision: .agents/notes/implemented/architecture/2026-11-03-exam-answer-presentation.md
// Decision: .agents/notes/implemented/architecture/2026-11-02-managed-exam-foundation.md
// Decision: .agents/notes/implemented/architecture/2026-11-03-durable-exam-reviews.md
import { ExamModelServiceRefSchema } from '@solveflow/contracts/exam-model-services';
import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { z } from 'zod';
import { AnswerCandidateSchema, SolveOutcomeSchema, type SolveOutcome } from '@solveflow/contracts/agent';
import { ExamModuleSchema, type ExamUser } from '@solveflow/contracts/managed-exam';
import { ExamTypeSchema } from '@solveflow/contracts/exam';
import { audit, conflict, event, one, rows, scope, tx, type Queryable } from './exam-store.js';
import { advanceCursor, openIncident } from './exam-review-state.js';
import { attemptAssignment } from './exam-attempts.js';
const jobWindow = `(CASE WHEN r.initiated_by IS NULL THEN (x.ended_at IS NULL OR x.end_reason='deadline') AND (a.closes_at IS NULL OR now()<a.closes_at+make_interval(secs=>s.accepted_job_grace_seconds)) ELSE now()<r.review_deadline AND EXISTS(SELECT 1 FROM exam_app.users staff WHERE staff.id=r.initiated_by AND staff.state='active' AND (EXISTS(SELECT 1 FROM exam_app.user_roles ur JOIN exam_app.roles role ON role.id=ur.role_id WHERE ur.user_id=staff.id AND (role.code='admin' OR (role.code='manager' AND s.manager_id=staff.id) OR (role.code='support' AND EXISTS(SELECT 1 FROM exam_app.staff_assignments f WHERE f.assignment_id=a.id AND f.staff_id=staff.id AND f.revoked_at IS NULL)))))) END)`;
const jobSchema = z.object({ id: z.uuid(), slotId: z.uuid(), revisionId: z.uuid(), attemptId: z.uuid(), studentId: z.uuid(), exam: ExamTypeSchema, module: ExamModuleSchema, purpose: z.enum(['solve', 'verify']), sourceRunId: z.uuid().nullable(), modelService: ExamModelServiceRefSchema.nullable().optional(), leaseToken: z.uuid() });
export type ExamJob = z.infer<typeof jobSchema>;
export async function claimJob(pool: pg.Pool) {
    return tx(pool, async (c) => {
        const job = (await rows(c, jobSchema, `SELECT jsonb_build_object('id',r.id,'slotId',r.slot_id,'revisionId',r.revision_id,'attemptId',q.attempt_id,'studentId',r.student_id,'exam',x.template_snapshot->>'exam','module',(SELECT m.rules_snapshot FROM exam_app.attempt_modules m WHERE m.id=q.module_id),'purpose',r.purpose,'sourceRunId',r.source_result_run_id,'modelService',CASE WHEN r.model_service_code IS NULL THEN NULL ELSE jsonb_build_object('code',r.model_service_code,'version',r.model_service_version) END,'leaseToken',$1::text) AS value FROM exam_app.answer_runs r JOIN exam_app.question_slots q ON q.id=r.slot_id JOIN exam_app.exam_attempts x ON x.id=q.attempt_id JOIN exam_app.exam_assignments a ON a.id=x.assignment_id JOIN exam_app.exam_sittings s ON s.id=a.sitting_id JOIN exam_app.users u ON u.id=r.student_id WHERE r.status='queued' AND r.id=q.current_run_id AND r.cancel_requested_at IS NULL AND a.state IN ('assigned','completed') AND s.state='published' AND u.state='active' AND ${jobWindow} ORDER BY r.created_at LIMIT 1 FOR UPDATE OF r SKIP LOCKED`, [randomUUID()]))[0];
        if (!job)
            return null;
        await c.query(`UPDATE exam_app.answer_runs SET status='understanding',lease_owner=$2,lease_token=$2,lease_expires_at=now()+interval '45 seconds' WHERE id=$1`, [job.id, job.leaseToken]);
        await event(c, job.attemptId, 'run.started');
        return job;
    });
}
export async function jobImages(pool: pg.Pool, job: ExamJob) { return rows(pool, z.object({ id: z.uuid(), key: z.string(), role: z.enum(['primary', 'material']) }), `SELECT jsonb_build_object('id',m.id,'key',m.object_key,'role',i.role) AS value FROM exam_app.revision_images i JOIN exam_app.media_assets m ON m.id=i.asset_id WHERE i.revision_id=$1 AND i.student_id=$2 AND m.state='ready' ORDER BY CASE WHEN i.role='primary' THEN 0 ELSE 1 END,i.position`, [job.revisionId, job.studentId]); }
export async function heartbeatJob(pool: Queryable, job: ExamJob) { return one(pool, z.boolean(), `WITH renewed AS (UPDATE exam_app.answer_runs r SET lease_expires_at=now()+interval '45 seconds' FROM exam_app.question_slots q,exam_app.exam_attempts x,exam_app.exam_assignments a,exam_app.exam_sittings s,exam_app.users u WHERE r.id=$1 AND r.lease_token=$2 AND r.lease_expires_at>now() AND r.finished_at IS NULL AND r.cancel_requested_at IS NULL AND q.id=r.slot_id AND q.current_run_id=r.id AND x.id=q.attempt_id AND a.id=x.assignment_id AND s.id=a.sitting_id AND u.id=r.student_id AND u.state='active' AND s.state='published' AND a.state IN ('assigned','completed') AND ${jobWindow} RETURNING r.id) SELECT EXISTS(SELECT 1 FROM renewed) AS value`, [job.id, job.leaseToken]); }
export async function setJobPhase(pool: pg.Pool, job: ExamJob, phase: 'understanding' | 'solving' | 'verifying' | 'revising') {
    await tx(pool, async (c) => {
        const result = await c.query('UPDATE exam_app.answer_runs SET status=$3 WHERE id=$1 AND lease_token=$2 AND lease_expires_at>now() AND finished_at IS NULL AND status<>$3 RETURNING id', [job.id, job.leaseToken, phase]);
        if (result.rowCount)
            await event(c, job.attemptId, 'run.phase');
    });
}
export async function admitCall(pool: pg.Pool, job: ExamJob, role: 'solver' | 'verifier', model: string, limits: {
    solver: number;
    verifier: number;
    daily: number;
}) {
    return tx(pool, async (c) => {
        if (!await heartbeatJob(c, job))
            throw conflict('任务已停止或材料已更新。');
        await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', ['quota:' + job.studentId]);
        const count = await one(c, z.coerce.number(), `SELECT coalesce(sum(units),0) AS value FROM exam_app.usage_reservations WHERE user_id=$1 AND quota_day=(now() AT TIME ZONE 'Asia/Shanghai')::date AND status<>'released'`, [job.studentId]);
        if (count >= limits.daily)
            throw conflict('今日模型调用额度已用完。');
        const runCount = await one(c, z.coerce.number(), 'SELECT count(*) AS value FROM exam_app.model_call_attempts WHERE run_id=$1', [job.id]);
        if (runCount >= 24)
            throw conflict('本题模型调用次数已达上限，请手动重答。');
        const permit = (await rows(c, z.number(), `SELECT slot_no AS value FROM exam_app.execution_permits WHERE role=$1 AND slot_no<=$2 AND holder_call_id IS NULL ORDER BY slot_no LIMIT 1 FOR UPDATE SKIP LOCKED`, [role, limits[role]]))[0];
        if (permit === undefined)
            return null;
        const phase = role === 'verifier' ? 'verifier' : 'solver';
        const number = await one(c, z.number(), 'SELECT coalesce(max(attempt_no),0)+1 AS value FROM exam_app.model_call_attempts WHERE run_id=$1 AND phase=$2', [job.id, phase]);
        const callId = randomUUID();
        await c.query(`INSERT INTO exam_app.model_call_attempts(id,run_id,student_id,phase,attempt_no,provider_code,model_name,status,started_at) VALUES($1,$2,$3,$4,$5,'configured',$6,'started',now())`, [callId, job.id, job.studentId, phase, number, model]);
        await c.query(`INSERT INTO exam_app.usage_reservations(id,user_id,model_call_id,quota_day,units,status) VALUES($1,$2,$3,(now() AT TIME ZONE 'Asia/Shanghai')::date,1,'dispatched')`, [randomUUID(), job.studentId, callId]);
        await c.query(`UPDATE exam_app.execution_permits SET holder_call_id=$3,lease_token=$4,lease_expires_at=now()+interval '7 minutes' WHERE role=$1 AND slot_no=$2`, [role, permit, callId, job.leaseToken]);
        await c.query('UPDATE exam_app.answer_runs SET dispatch_started_at=coalesce(dispatch_started_at,now()) WHERE id=$1', [job.id]);
        return callId;
    });
}
export async function settleCall(pool: pg.Pool, callId: string, success: boolean, errorCode: string | null = null) { await tx(pool, async (c) => { await c.query(`UPDATE exam_app.model_call_attempts SET status=$2,finished_at=now(),error_code=$3 WHERE id=$1 AND status='started'`, [callId, success ? 'completed' : 'failed', success ? null : errorCode]); await c.query(`UPDATE exam_app.usage_reservations SET status='settled',settled_at=now() WHERE model_call_id=$1`, [callId]); await c.query('UPDATE exam_app.execution_permits SET holder_call_id=NULL,lease_token=NULL,lease_expires_at=NULL WHERE holder_call_id=$1', [callId]); }); }

/** Provisional answer for display while verification runs. Additive only: the
 * queued run row, immutable run_results and answer_presentations are untouched.
 * Decision: .agents/notes/implemented/architecture/2026-11-07-early-answer-publish.md */
export async function publishDraft(pool: pg.Pool, job: ExamJob, candidate: z.infer<typeof AnswerCandidateSchema>) {
    if (candidate.kind !== 'answer')
        return false;
    const responseMatches = !candidate.questions && job.module.responseKinds.includes(candidate.problem.response?.type ?? (candidate.problem.options ? 'single-choice' : 'short-answer')) && (!job.module.wordLimit || candidate.answer.trim().split(/\s+/u).length <= job.module.wordLimit);
    if (!responseMatches)
        return false;
    return tx(pool, async (c) => {
        const valid = await one(c, z.boolean(), `SELECT EXISTS(SELECT 1 FROM exam_app.answer_runs r JOIN exam_app.question_slots q ON q.id=r.slot_id JOIN exam_app.exam_attempts x ON x.id=q.attempt_id JOIN exam_app.exam_assignments a ON a.id=x.assignment_id JOIN exam_app.exam_sittings s ON s.id=a.sitting_id JOIN exam_app.users u ON u.id=r.student_id WHERE r.id=$1 AND r.lease_token=$2 AND r.lease_expires_at>now() AND r.finished_at IS NULL AND r.cancel_requested_at IS NULL AND q.current_run_id=r.id AND q.current_revision_id=r.revision_id AND NOT EXISTS(SELECT 1 FROM exam_app.answer_plan_items pi JOIN exam_app.answer_plans plan ON plan.id=pi.plan_id WHERE pi.slot_id=q.id AND plan.state='frozen' AND pi.action='simulate_alternative') AND a.state IN ('assigned','completed') AND s.state='published' AND u.state='active' AND ${jobWindow} FOR UPDATE OF r) AS value`, [job.id, job.leaseToken]);
        if (!valid)
            return false;
        await c.query('INSERT INTO exam_app.answer_drafts(slot_id,student_id,run_id,answer_text,selected_options) VALUES($1,$2,$3,$4,$5) ON CONFLICT(slot_id,student_id) DO UPDATE SET run_id=excluded.run_id,answer_text=excluded.answer_text,selected_options=excluded.selected_options,created_at=now()', [job.slotId, job.studentId, job.id, candidate.answer, candidate.selectedOptions ? JSON.stringify(candidate.selectedOptions) : null]);
        return true;
    });
}

export async function finishJob(pool: pg.Pool, job: ExamJob, raw: SolveOutcome | null, errorCode: string | null) {
    const outcome = raw ? SolveOutcomeSchema.parse(raw) : null;
    return tx(pool, async (c) => {
        await c.query('SELECT id FROM exam_app.exam_attempts WHERE id=$1 FOR UPDATE', [job.attemptId]);
        const valid = await one(c, z.boolean(), `SELECT EXISTS(SELECT 1 FROM exam_app.answer_runs r JOIN exam_app.question_slots q ON q.id=r.slot_id JOIN exam_app.exam_attempts x ON x.id=q.attempt_id JOIN exam_app.exam_assignments a ON a.id=x.assignment_id JOIN exam_app.exam_sittings s ON s.id=a.sitting_id JOIN exam_app.users u ON u.id=r.student_id WHERE r.id=$1 AND r.lease_token=$2 AND r.lease_expires_at>now() AND r.finished_at IS NULL AND r.cancel_requested_at IS NULL AND q.current_run_id=r.id AND q.current_revision_id=r.revision_id AND a.state IN ('assigned','completed') AND s.state='published' AND u.state='active' AND ${jobWindow} FOR UPDATE OF r) AS value`, [job.id, job.leaseToken]);
        if (!valid)
            return false;
        const candidate = outcome && 'candidate' in outcome ? outcome.candidate : null;
        const responseMatches = candidate?.kind === 'answer' && !candidate.questions && job.module.responseKinds.includes(candidate.problem.response?.type ?? (candidate.problem.options ? 'single-choice' : 'short-answer')) && (!job.module.wordLimit || candidate.answer.trim().split(/\s+/u).length <= job.module.wordLimit);
        const completed = outcome?.status === 'completed' && responseMatches;
        const status = completed ? 'completed' : outcome?.status === 'needs_clarification' ? 'needs_clarification' : 'failed';
        if (outcome)
            await c.query('INSERT INTO exam_app.run_results(run_id,slot_id,student_id,outcome) VALUES($1,$2,$3,$4)', [job.id, job.slotId, job.studentId, JSON.stringify(outcome)]);
        await c.query('UPDATE exam_app.answer_runs SET status=$3,finished_at=now(),error_code=$4 WHERE id=$1 AND lease_token=$2', [job.id, job.leaseToken, status, errorCode ?? (outcome && 'error' in outcome ? outcome.error.code : null)]);
        // The draft is the answer the student already saw before verification. Keep it
        // as the baseline for the "answer revised" notice, then clear it.
        const draft = (await rows(c, z.object({ answerText: z.string(), selectedOptions: z.unknown().nullable() }), `SELECT jsonb_build_object('answerText',answer_text,'selectedOptions',selected_options) AS value FROM exam_app.answer_drafts WHERE run_id=$1 AND slot_id=$2 AND student_id=$3`, [job.id, job.slotId, job.studentId]))[0] ?? null;
        await c.query('DELETE FROM exam_app.answer_drafts WHERE slot_id=$1 AND student_id=$2', [job.slotId, job.studentId]);
        if (completed && candidate?.kind === 'answer') {
            const plan = await one(c, z.object({ id: z.uuid(), alternative: z.boolean() }), `SELECT jsonb_build_object('id',i.id,'alternative',i.action='simulate_alternative') AS value FROM exam_app.answer_plan_items i JOIN exam_app.answer_plans p ON p.id=i.plan_id WHERE i.slot_id=$1 AND p.state='frozen' ORDER BY p.version DESC LIMIT 1`, [job.slotId]);
            let answer = candidate.answer;
            let selected = candidate.selectedOptions ?? null;
            let simulated = false;
            let notAppliedReason: string | null = null;
            if (plan.alternative) {
                const options = candidate.problem.options;
                const alternative = options?.find(o => !selected?.includes(o.label));
                if (candidate.problem.response?.type === 'single-choice' && selected?.length === 1 && alternative) {
                    selected = [alternative.label];
                    answer = alternative.label;
                    simulated = true;
                }
                else
                    notAppliedReason = '当前作答结构不支持安全构造模拟选项。';
            }
            const presentationId = randomUUID();
            await c.query('INSERT INTO exam_app.answer_presentations(id,slot_id,student_id,source_run_id,plan_item_id,mode,response_kind,answer_text,selected_options,is_simulated,policy_applied,not_applied_reason,display_verified,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$10,$11,$12,clock_timestamp())', [presentationId, job.slotId, job.studentId, job.id, plan.id, plan.alternative ? 'practice_simulation' : 'original', candidate.problem.response?.type ?? 'text', answer, selected ? JSON.stringify(selected) : null, simulated, notAppliedReason, !simulated && outcome.verified]);
            await c.query('UPDATE exam_app.question_slots SET published_presentation_id=$2,completed_once_at=coalesce(completed_once_at,now()),version=version+1 WHERE id=$1', [job.slotId, presentationId]);
            await c.query('UPDATE exam_app.question_slots SET published_review_id=NULL WHERE id=$1', [job.slotId]);
            await advanceCursor(c, job.attemptId, job.slotId);
            // Notify only when the published answer differs from the provisional one the
            // student was shown. A matching verification result stays silent.
            if (draft && (draft.answerText !== answer || JSON.stringify(draft.selectedOptions ?? null) !== JSON.stringify(selected ?? null)))
                await c.query('INSERT INTO exam_app.answer_revisions(id,slot_id,attempt_id,student_id,revision_id,run_id) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(run_id) DO NOTHING', [randomUUID(), job.slotId, job.attemptId, job.studentId, job.revisionId, job.id]);
        }
        if (completed && outcome?.verified) {
            await c.query("UPDATE exam_app.verification_incidents SET resolved_at=now(),resolution='ai_pass' WHERE slot_id=$1 AND resolved_at IS NULL", [job.slotId]);
        } else {
            const reason = outcome?.status === 'completed' ? !responseMatches ? 'response_mismatch' : outcome.verification?.verdict === 'fail' ? 'verification_failed' : outcome.verification?.verdict === 'unknown' ? 'verification_unknown' : 'verification_unavailable' : outcome?.status === 'needs_clarification' ? 'image_incomplete' : 'answer_failed';
            await openIncident(c, job.slotId, job.revisionId, job.id, reason);
        }
        await event(c, job.attemptId, 'run.finished');
        return true;
    });
}
export async function cancelJob(pool: pg.Pool, actor: ExamUser, runId: string) {
    return tx(pool, async (c) => {
        const attemptId = await one(c, z.uuid(), 'SELECT q.attempt_id AS value FROM exam_app.answer_runs r JOIN exam_app.question_slots q ON q.id=r.slot_id WHERE r.id=$1', [runId]);
        await scope(c, actor, await attemptAssignment(c, attemptId), true);
        await c.query('SELECT id FROM exam_app.exam_attempts WHERE id=$1 FOR UPDATE', [attemptId]);
        await c.query('DELETE FROM exam_app.answer_drafts WHERE run_id=$1', [runId]);
        const changed = await c.query(`UPDATE exam_app.answer_runs SET status='cancelled',cancel_requested_at=now(),finished_at=now(),error_code='CANCELLED' WHERE id=$1 AND finished_at IS NULL`, [runId]);
        if (changed.rowCount) {
            await event(c, attemptId, 'run.cancelled');
            await audit(c, actor.id, 'run.cancel', runId, 'run');
        }
        return { ok: true };
    });
}
export async function recoverJobs(pool: pg.Pool) {
    return tx(pool, async (c) => {
        const lost = await rows(c, z.object({ id: z.uuid(), attemptId: z.uuid() }), `SELECT jsonb_build_object('id',r.id,'attemptId',q.attempt_id) AS value FROM exam_app.answer_runs r JOIN exam_app.question_slots q ON q.id=r.slot_id JOIN exam_app.exam_attempts x ON x.id=q.attempt_id JOIN exam_app.exam_assignments a ON a.id=x.assignment_id JOIN exam_app.exam_sittings s ON s.id=a.sitting_id JOIN exam_app.users u ON u.id=r.student_id WHERE r.finished_at IS NULL AND ((r.status<>'queued' AND r.lease_expires_at<now()) OR NOT ${jobWindow} OR u.state<>'active' OR a.state='revoked' OR s.state<>'published') ORDER BY q.attempt_id,r.id LIMIT 100`);
        let recovered = 0;
        for (const job of lost) {
            // Match submission/finish lock order; a renewed lease must be checked again.
            await c.query('SELECT id FROM exam_app.exam_attempts WHERE id=$1 FOR UPDATE', [job.attemptId]);
            const changed = await c.query(`UPDATE exam_app.answer_runs r SET status='interrupted',finished_at=now(),error_code='WORKER_LOST' FROM exam_app.question_slots q,exam_app.exam_attempts x,exam_app.exam_assignments a,exam_app.exam_sittings s,exam_app.users u WHERE r.id=$1 AND r.finished_at IS NULL AND q.id=r.slot_id AND x.id=q.attempt_id AND a.id=x.assignment_id AND s.id=a.sitting_id AND u.id=r.student_id AND ((r.status<>'queued' AND r.lease_expires_at<now()) OR NOT ${jobWindow} OR u.state<>'active' OR a.state='revoked' OR s.state<>'published')`, [job.id]);
            if (!changed.rowCount) continue;
            recovered++;
            await c.query('DELETE FROM exam_app.answer_drafts WHERE run_id=$1', [job.id]);
            const slot = (await rows(c, z.object({ slotId: z.uuid(), revisionId: z.uuid() }), `SELECT jsonb_build_object('slotId',slot_id,'revisionId',revision_id) AS value FROM exam_app.answer_runs WHERE id=$1 AND id=(SELECT current_run_id FROM exam_app.question_slots WHERE id=slot_id)`, [job.id]))[0];
            if (slot) await openIncident(c, slot.slotId, slot.revisionId, job.id, 'interrupted');
            await event(c, job.attemptId, 'run.interrupted');
        }
        await c.query(`UPDATE exam_app.model_call_attempts SET status='unknown',finished_at=now() WHERE id IN (SELECT holder_call_id FROM exam_app.execution_permits WHERE lease_expires_at<now()) AND status='started'`);
        await c.query(`UPDATE exam_app.execution_permits SET holder_call_id=NULL,lease_token=NULL,lease_expires_at=NULL WHERE lease_expires_at<now()`);
        await c.query(`DELETE FROM exam_app.login_throttle WHERE window_start<now()-interval '1 day'`);
        return recovered;
    });
}

export async function jobVerificationTarget(pool: pg.Pool, job: ExamJob) {
    if (job.purpose !== 'verify' || !job.sourceRunId) return undefined;
    return one(pool, AnswerCandidateSchema, `SELECT o.outcome->'candidate' AS value FROM exam_app.run_results o JOIN exam_app.answer_runs r ON r.id=o.run_id WHERE o.run_id=$1 AND r.revision_id=$2 AND o.slot_id=$3 AND o.student_id=$4 AND o.outcome->>'status'='completed'`, [job.sourceRunId, job.revisionId, job.slotId, job.studentId]);
}
