import { pinRunModelService } from './exam-model-services.js';
// Decision: .agents/notes/implemented/architecture/2026-11-03-teacher-question-actions.md
// Decision: .agents/notes/implemented/architecture/2026-11-03-exam-answer-presentation.md
// Decision: .agents/notes/implemented/architecture/2026-11-03-exam-review-hardening.md
// Decision: .agents/notes/implemented/architecture/2026-11-03-durable-exam-reviews.md
// Decision: .agents/notes/implemented/architecture/2026-11-06-student-rerun.md
// Teacher operations never overwrite an AI result, nor borrow the student's submission authority.
import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { z } from 'zod';
import { AnswerCandidateSchema } from '@solveflow/contracts/agent';
import { ExamDeferSchema, ExamStudentRunSchema, ExamTeacherConfirmSchema, ExamTeacherRunSchema, formatExamChoiceAnswer, type ExamUser } from '@solveflow/contracts/managed-exam';
import { audit, conflict, event, forbidden, hash, lockActor, one, rows, scope, tx } from './exam-store.js';
import { attemptAssignment } from './exam-attempts.js';
import { advanceCursor } from './exam-review-state.js';
async function lockReview(c: pg.PoolClient, actor: ExamUser, slotId: string, studentOnly = false) {
    await lockActor(c, actor);
    if (!studentOnly && (actor.state !== 'active' || !actor.roles.some(r => ['admin', 'manager', 'support'].includes(r)))) throw forbidden();
    const attemptId = await one(c, z.uuid(), 'SELECT attempt_id AS value FROM exam_app.question_slots WHERE id=$1', [slotId]);
    await c.query('SELECT id FROM exam_app.exam_attempts WHERE id=$1 FOR UPDATE', [attemptId]);
    await scope(c, actor, await attemptAssignment(c, attemptId), studentOnly);
    // Staff with a student role still cannot turn ownership into teacher authority.
    if (!studentOnly) {
        const staff = await one(c, z.boolean(), `SELECT $2::boolean OR ($3::boolean AND s.manager_id=$4) OR ($5::boolean AND EXISTS(SELECT 1 FROM exam_app.staff_assignments f WHERE f.assignment_id=a.id AND f.staff_id=$4 AND f.revoked_at IS NULL)) AS value FROM exam_app.exam_attempts x JOIN exam_app.exam_assignments a ON a.id=x.assignment_id JOIN exam_app.exam_sittings s ON s.id=a.sitting_id WHERE x.id=$1`, [attemptId, actor.roles.includes('admin'), actor.roles.includes('manager'), actor.id, actor.roles.includes('support')]);
        if (!staff) throw forbidden();
    }
    const slot = await one(c, z.object({ revision: z.number(), revisionId: z.uuid().nullable(), runId: z.uuid().nullable(), studentId: z.uuid(), allowed: z.boolean(), active: z.boolean(), open: z.boolean(), reviewId: z.uuid().nullable() }), `SELECT jsonb_build_object('revision',coalesce(v.revision,0),'revisionId',v.id,'runId',q.current_run_id,'studentId',q.student_id,'reviewId',(SELECT h.id FROM exam_app.teacher_reviews h WHERE h.id=q.published_review_id AND h.revision_id=q.current_revision_id),'active',coalesce(r.finished_at IS NULL AND r.id IS NOT NULL,false),'open',EXISTS(SELECT 1 FROM exam_app.verification_incidents i WHERE i.slot_id=q.id AND i.resolved_at IS NULL),'allowed',u.state='active' AND a.state IN ('assigned','completed') AND s.state='published' AND ((x.ended_at IS NULL AND x.state IN ('in_progress','completed')) OR (NOT $2::boolean AND (x.ended_at IS NOT NULL OR x.state='closed' AND now()>=a.closes_at)))) AS value FROM exam_app.question_slots q JOIN exam_app.exam_attempts x ON x.id=q.attempt_id JOIN exam_app.exam_assignments a ON a.id=x.assignment_id JOIN exam_app.exam_sittings s ON s.id=a.sitting_id JOIN exam_app.users u ON u.id=q.student_id LEFT JOIN exam_app.question_revisions v ON v.id=q.current_revision_id LEFT JOIN exam_app.answer_runs r ON r.id=q.current_run_id WHERE q.id=$1 FOR UPDATE OF q`, [slotId, studentOnly]);
    return { ...slot, attemptId };
}
function reviewDigest(slotId: string, input: z.infer<typeof ExamStudentRunSchema> | z.infer<typeof ExamTeacherRunSchema> | z.infer<typeof ExamTeacherConfirmSchema>) {
    // A null review token preserves pre-token idempotency receipts.
    const { expectedReviewId, ...legacy } = input;
    return hash(JSON.stringify({ slotId, ...legacy, ...(expectedReviewId ? { expectedReviewId } : {}) }));
}
type ReviewOperation = 'teacher-review' | 'student-rerun';
async function receipt(c: pg.PoolClient, actorId: string, requestId: string, digest: string, operation: ReviewOperation = 'teacher-review') {
    const previous = (await rows(c, z.object({ hash: z.string(), id: z.uuid() }), `SELECT jsonb_build_object('hash',input_sha256,'id',response->>'id') AS value FROM exam_app.idempotency_requests WHERE actor_id=$1 AND operation=$3 AND request_id=$2`, [actorId, requestId, operation]))[0];
    if (previous && previous.hash !== digest) throw conflict('同一请求标识不能用于不同处理。');
    return previous;
}
async function saveReceipt(c: pg.PoolClient, actor: ExamUser, requestId: string, digest: string, id: string, operation: ReviewOperation = 'teacher-review') {
    await c.query(`INSERT INTO exam_app.idempotency_requests(actor_id,operation,request_id,input_sha256,status,response_status,response,expires_at) VALUES($1,$5,$2,$3,'completed',200,$4,now()+interval '180 days')`, [actor.id, requestId, digest, JSON.stringify({ id }), operation]);
}
function checkCurrent(slot: { revision: number; runId: string | null; reviewId: string | null; allowed: boolean; open: boolean }, input: { expectedRevision: number; expectedRunId: string | null; expectedReviewId?: string | null }, incidentOnly = false) {
    if (slot.revision !== input.expectedRevision || slot.runId !== input.expectedRunId || input.expectedReviewId !== undefined && slot.reviewId !== input.expectedReviewId) throw conflict('本题已更新，请同步后重新处理。');
    if (!slot.allowed) throw conflict('本场考试当前不可处理，或已被撤销。');
    if (incidentOnly && !slot.open) throw conflict('本题当前没有待处理问题。');
}
export async function studentRun(pool: pg.Pool, actor: ExamUser, slotId: string, raw: unknown) {
    const input = ExamStudentRunSchema.parse(raw);
    return tx(pool, async c => {
        const slot = await lockReview(c, actor, slotId, true);
        const digest = reviewDigest(slotId, input);
        const previous = await receipt(c, actor.id, input.requestId, digest, 'student-rerun');
        if (previous) return { id: previous.id };
        checkCurrent(slot, input);
        if (slot.active) throw conflict('本题正在处理中，请先等待完成或停止本题。');
        const allowed = await one(c, z.boolean(), 'SELECT now()>=a.opens_at AND (a.closes_at IS NULL OR now()<a.closes_at) AS value FROM exam_app.exam_attempts x JOIN exam_app.exam_assignments a ON a.id=x.assignment_id WHERE x.id=$1', [slot.attemptId]);
        if (!allowed) throw conflict('当前不在可答题的考试时间内。');
        if (!slot.revisionId || !await one(c, z.boolean(), `SELECT EXISTS(SELECT 1 FROM exam_app.revision_images i JOIN exam_app.media_assets m ON m.id=i.asset_id WHERE i.revision_id=$1 AND i.role='primary' AND m.state='ready') AS value`, [slot.revisionId])) throw conflict('请先上传本题图片。');
        if ((await rows(c, z.uuid(), 'SELECT id AS value FROM exam_app.answer_runs WHERE student_id=$1 AND client_request_id=$2', [actor.id, input.requestId])).length) throw conflict('该请求已用于其他答题操作，请重新发起。');
        const id = randomUUID();
        // A student run keeps the ordinary exam deadline; it never receives staff review authority.
        await c.query(`INSERT INTO exam_app.answer_runs(id,slot_id,revision_id,student_id,client_request_id,purpose,status,input_manifest,model_policy_version) VALUES($1,$2,$3,$4,$5,'solve','queued','{}','managed-v1')`, [id, slotId, slot.revisionId, actor.id, input.requestId]);
        await pinRunModelService(c, id, actor.id);
        await c.query('UPDATE exam_app.question_slots SET current_run_id=$2,skipped_at=NULL,deferred_at=NULL,version=version+1 WHERE id=$1', [slotId, id]);
        await saveReceipt(c, actor, input.requestId, digest, id, 'student-rerun');
        await audit(c, actor.id, 'student.solve', slotId, 'slot');
        await event(c, slot.attemptId, 'student.run-requested');
        return { id };
    });
}
export async function teacherRun(pool: pg.Pool, actor: ExamUser, slotId: string, raw: unknown) {
    const input = ExamTeacherRunSchema.parse(raw);
    return tx(pool, async c => {
        const slot = await lockReview(c, actor, slotId);
        const digest = reviewDigest(slotId, input);
        const previous = await receipt(c, actor.id, input.requestId, digest);
        if (previous) return { id: previous.id };
        checkCurrent(slot, input);
        if (input.action === 'verify' && slot.reviewId) throw conflict('当前是人工答案，请使用AI答题生成并核验新的答案。');
        if (slot.active) throw conflict('本题正在处理中，请等待完成或由学生停止本题。');
        const source = input.action === 'verify' ? (await rows(c, z.object({ id: z.uuid(), candidate: AnswerCandidateSchema }), `SELECT jsonb_build_object('id',o.run_id,'candidate',o.outcome->'candidate') AS value FROM exam_app.run_results o JOIN exam_app.answer_runs r ON r.id=o.run_id WHERE o.slot_id=$1 AND r.revision_id=$2 AND o.outcome->>'status'='completed' ORDER BY o.created_at DESC LIMIT 1`, [slotId, slot.revisionId]))[0] : null;
        if (input.action === 'verify' && !source) throw conflict('当前题图没有可重新核验的答案，请先重新解答或人工处理。');
        const id = randomUUID();
        await c.query(`INSERT INTO exam_app.answer_runs(id,slot_id,revision_id,student_id,client_request_id,purpose,source_result_run_id,status,input_manifest,model_policy_version,initiated_by,review_deadline) VALUES($1,$2,$3,$4,$5,$6,$7,'queued','{}','managed-v1',$8,now()+interval '7 minutes')`, [id, slotId, slot.revisionId, slot.studentId, input.requestId, input.action, source?.id ?? null, actor.id]);
        await pinRunModelService(c, id, slot.studentId);
        await c.query('UPDATE exam_app.question_slots SET current_run_id=$2,version=version+1 WHERE id=$1', [slotId, id]);
        await saveReceipt(c, actor, input.requestId, digest, id);
        await audit(c, actor.id, 'teacher.' + input.action, slotId, 'slot');
        await event(c, slot.attemptId, 'teacher.run-requested');
        return { id };
    });
}
export async function teacherConfirm(pool: pg.Pool, actor: ExamUser, slotId: string, raw: unknown) {
    const input = ExamTeacherConfirmSchema.parse(raw);
    return tx(pool, async c => {
        const slot = await lockReview(c, actor, slotId);
        const digest = reviewDigest(slotId, input);
        const previous = await receipt(c, actor.id, input.requestId, digest);
        if (previous) return { id: previous.id };
        checkCurrent(slot, input);
        const problem = (await rows(c, z.unknown(), `SELECT o.outcome#>'{candidate,problem}' AS value FROM exam_app.run_results o JOIN exam_app.answer_runs r ON r.id=o.run_id WHERE o.slot_id=$1 AND r.revision_id=$2 AND o.outcome ? 'candidate' ORDER BY o.created_at DESC LIMIT 1`, [slotId, slot.revisionId]))[0];
        const recognized = z.object({ optionsComplete: z.boolean().optional(), options: z.array(z.object({ label: z.string(), text: z.string() })).optional(), response: z.object({ type: z.string() }).optional() }).safeParse(problem);
        const responseKind = recognized.success ? recognized.data.response?.type ?? (recognized.data.options?.length ? 'single-choice' : null) : null;
        if (recognized.success && recognized.data.optionsComplete !== false && recognized.data.options?.length && ['single-choice', 'multiple-choice'].includes(responseKind ?? '') && !input.selectedOptions) throw conflict('请选择确认答案对应的原始选项。');
        const wordLimit = await one(c, z.number().nullable(), `SELECT (m.rules_snapshot->>'wordLimit')::integer AS value FROM exam_app.question_slots q JOIN exam_app.attempt_modules m ON m.id=q.module_id WHERE q.id=$1`, [slotId]);
        if (wordLimit && input.answer.trim().split(/\s+/u).length > wordLimit) throw conflict('确认答案超过本模块的词数上限。');
        if (input.selectedOptions) {
            if (!recognized.success || !recognized.data.options?.length || !['single-choice', 'multiple-choice'].includes(responseKind ?? '') || input.selectedOptions.some(label => !recognized.data.options?.some(o => o.label === label)) || responseKind === 'single-choice' && input.selectedOptions.length !== 1) throw conflict('所选答案必须对应当前识别出的原始选项。');
            const formatted = formatExamChoiceAnswer(recognized.data.options, input.selectedOptions);
            if (!formatted || input.answer !== formatted && input.answer !== input.selectedOptions.join('、'))
                throw conflict('答案文字与所选选项不一致，请重新选择后确认。');
        }
        const id = randomUUID();
        await c.query(`INSERT INTO exam_app.teacher_reviews(id,slot_id,student_id,revision_id,actor_id,source_run_id,answer_text,selected_options,note,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,clock_timestamp())`, [id, slotId, slot.studentId, slot.revisionId, actor.id, slot.runId, input.answer, input.selectedOptions ? JSON.stringify(input.selectedOptions) : null, input.note]);
        await c.query(`UPDATE exam_app.answer_runs SET status='cancelled',cancel_requested_at=now(),finished_at=now(),error_code='HUMAN_CONFIRMED' WHERE id=$1 AND finished_at IS NULL`, [slot.runId]);
        await c.query(`UPDATE exam_app.question_slots SET published_review_id=$2,completed_once_at=coalesce(completed_once_at,now()),version=version+1 WHERE id=$1`, [slotId, id]);
        await c.query(`UPDATE exam_app.verification_incidents SET resolved_at=now(),resolution='human_confirmed',resolved_by=$2 WHERE slot_id=$1 AND resolved_at IS NULL`, [slotId, actor.id]);
        await advanceCursor(c, slot.attemptId, slotId);
        await saveReceipt(c, actor, input.requestId, digest, id);
        await audit(c, actor.id, 'teacher.confirm', slotId, 'slot');
        await event(c, slot.attemptId, 'teacher.confirmed');
        return { id };
    });
}
export async function deferSlot(pool: pg.Pool, actor: ExamUser, slotId: string, raw: unknown) {
    const input = ExamDeferSchema.parse(raw);
    return tx(pool, async c => {
        const slot = await lockReview(c, actor, slotId, true);
        checkCurrent(slot, input, true);
        if (slot.active) throw conflict('本题仍在解答，请等待结束。');
        const allowed = await one(c, z.boolean(), 'SELECT now()>=a.opens_at AND (a.closes_at IS NULL OR now()<a.closes_at) AS value FROM exam_app.exam_attempts x JOIN exam_app.exam_assignments a ON a.id=x.assignment_id WHERE x.id=$1', [slot.attemptId]);
        if (!allowed) throw conflict('考试时间已结束。');
        await c.query('UPDATE exam_app.question_slots SET deferred_at=coalesce(deferred_at,now()) WHERE id=$1', [slotId]);
        await advanceCursor(c, slot.attemptId, slotId);
        await event(c, slot.attemptId, 'slot.deferred');
        return { id: slot.attemptId };
    });
}
