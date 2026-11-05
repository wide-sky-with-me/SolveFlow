// Decision: .agents/notes/implemented/architecture/2026-11-05-exam-client-recovery.md
// Decision: .agents/notes/implemented/architecture/2026-11-03-teacher-question-actions.md
// Decision: .agents/notes/implemented/architecture/2026-11-03-exam-answer-presentation.md
// Decision: .agents/notes/implemented/architecture/2026-11-03-exam-review-hardening.md
// Decision: .agents/notes/implemented/architecture/2026-11-02-managed-exam-foundation.md
import { randomBytes, randomUUID } from 'node:crypto';
import type pg from 'pg';
import { z } from 'zod';
import { EXAM_MATERIAL_COUNT, EXAM_QUESTION_IMAGE_BYTES, ExamAttemptSchema, ExamDetailSchema, ExamEventsSchema, ExamSubmissionSchema, ExamTemplateSchema, type ExamUser } from '@solveflow/contracts/managed-exam';
import { audit, conflict, event, forbidden, hash, one, rows, scope, tx, type Queryable } from './exam-store.js';
import { incidentFrom, incidentJson } from './exam-review-state.js';
import { unreadResolutions } from './exam-attention.js';
import { activityFrom, activityJson, navigateAttempt } from './exam-navigation.js';
import { expireExamAttempt, attemptTimingJson } from './exam-timing.js';
import { templateJson } from './exam-catalog.js';
const settingsSchema = z.object({ mode: z.enum(['original', 'practice_simulation']), wrongCounts: z.array(z.number().int().nonnegative()) });
const slotJson = `jsonb_build_object('id',q.id,'moduleId',q.module_id,'position',q.position,'ordinal',q.ordinal,'revision',coalesce(v.revision,0),'status',CASE WHEN h.id IS NOT NULL AND h.revision_id=q.current_revision_id AND h.source_run_id IS NOT DISTINCT FROM q.current_run_id THEN 'completed' ELSE coalesce(r.status,'empty') END,'completedOnce',q.completed_once_at IS NOT NULL,'deferred',q.deferred_at IS NOT NULL,'skipped',q.skipped_at IS NOT NULL,'runId',r.id,'reviewId',CASE WHEN h.revision_id=q.current_revision_id THEN h.id ELSE NULL END,'errorCode',r.error_code,'presentation',CASE WHEN h.id IS NOT NULL AND h.revision_id=q.current_revision_id THEN jsonb_build_object('answer',h.answer_text,'selectedOptions',h.selected_options,'simulated',false,'verified',false,'humanConfirmed',true,'notAppliedReason',NULL) WHEN p.id IS NULL THEN NULL ELSE jsonb_build_object('answer',p.answer_text,'selectedOptions',p.selected_options,'simulated',p.is_simulated,'verified',p.display_verified,'notAppliedReason',p.not_applied_reason) END,'images',coalesce((SELECT jsonb_agg(jsonb_build_object('id',i.asset_id,'role',i.role) ORDER BY i.role DESC,i.position) FROM exam_app.revision_images i JOIN exam_app.media_assets a ON a.id=i.asset_id AND a.state='ready' WHERE i.revision_id=q.current_revision_id),'[]'::jsonb))`;
export const slotFrom = `exam_app.question_slots q LEFT JOIN exam_app.question_revisions v ON v.id=q.current_revision_id LEFT JOIN exam_app.answer_runs r ON r.id=q.current_run_id LEFT JOIN exam_app.answer_presentations p ON p.id=q.published_presentation_id AND EXISTS(SELECT 1 FROM exam_app.answer_runs pr WHERE pr.id=p.source_run_id AND pr.revision_id=q.current_revision_id) LEFT JOIN exam_app.teacher_reviews h ON h.id=q.published_review_id`;
// Writers hold the attempt lock and timestamp the actual publication, not transaction start.
const latestAnswerSlot = `(SELECT q.id FROM ${slotFrom} WHERE q.attempt_id=x.id AND ((h.id IS NOT NULL AND h.revision_id=q.current_revision_id) OR p.id IS NOT NULL) ORDER BY CASE WHEN h.id IS NOT NULL AND h.revision_id=q.current_revision_id THEN h.created_at ELSE p.created_at END DESC,q.ordinal DESC LIMIT 1)`;
export async function startAttempt(pool: pg.Pool, actor: ExamUser, assignmentId: string) {
    return tx(pool, async (c) => {
        await scope(c, actor, assignmentId, true);
        await c.query('SELECT id FROM exam_app.users WHERE id=$1 FOR UPDATE', [actor.id]);
        // Release the single-active-attempt constraint without discarding old jobs or reviews.
        const expired = await rows(c, z.uuid(), `SELECT x.id AS value FROM exam_app.exam_attempts x JOIN exam_app.exam_assignments a ON a.id=x.assignment_id JOIN exam_app.exam_sittings s ON s.id=a.sitting_id WHERE x.student_id=$1 AND x.state IN ('in_progress','completed') AND x.ended_at IS NULL AND (a.closes_at<=now() OR a.state='revoked' OR s.state IN ('closed','cancelled')) ORDER BY x.id FOR UPDATE OF x`, [actor.id]);
        for (const expiredId of expired) {
            await c.query(`UPDATE exam_app.exam_attempts x SET state='closed',finished_at=coalesce(x.finished_at,now()),ended_at=greatest(x.started_at,least(now(),a.closes_at)),end_reason=CASE WHEN a.closes_at<=now() THEN 'deadline' ELSE 'system' END,version=x.version+1 FROM exam_app.exam_assignments a WHERE x.id=$1 AND a.id=x.assignment_id`, [expiredId]);
            await event(c, expiredId, 'attempt.closed');
        }
        const assignment = await one(c, z.object({ studentId: z.uuid(), templateId: z.uuid(), settings: settingsSchema, policyId: z.uuid(), approvedBy: z.uuid().nullable(), allowed: z.boolean() }), `SELECT jsonb_build_object('studentId',a.student_id,'templateId',s.template_id,'settings',a.settings_snapshot,'policyId',p.id,'approvedBy',p.approved_by,'allowed',a.state='assigned' AND s.state='published' AND now()>=a.opens_at AND (a.closes_at IS NULL OR now()<a.closes_at)) AS value FROM exam_app.exam_assignments a JOIN exam_app.exam_sittings s ON s.id=a.sitting_id JOIN exam_app.delivery_policies p ON p.assignment_id=a.id WHERE a.id=$1 AND p.state IN ('approved','frozen') ORDER BY p.version DESC LIMIT 1 FOR UPDATE OF a`, [assignmentId]);
        const existing = await rows(c, z.uuid(), 'SELECT id AS value FROM exam_app.exam_attempts WHERE assignment_id=$1 ORDER BY attempt_no DESC LIMIT 1', [assignmentId]);
        if (existing[0])
            return { id: existing[0] };
        if (!assignment.allowed)
            throw conflict('当前不在可进入的考试时间内。');
        const active = await one(c, z.boolean(), `SELECT EXISTS(SELECT 1 FROM exam_app.exam_attempts WHERE student_id=$1 AND state IN ('in_progress','completed') AND ended_at IS NULL) AS value`, [actor.id]);
        if (active)
            throw conflict('请先结束当前进行中的考试。');
        const template = await one(c, ExamTemplateSchema, `SELECT ${templateJson} AS value FROM exam_app.exam_templates t WHERE id=$1`, [assignment.templateId]);
        const id = randomUUID(), seed = randomBytes(32), planId = randomUUID();
        await c.query(`INSERT INTO exam_app.exam_attempts(id,assignment_id,student_id,attempt_no,template_id,delivery_policy_id,template_snapshot,state,started_at) VALUES($1,$2,$3,1,$4,$5,$6,'in_progress',now())`, [id, assignmentId, actor.id, template.id, assignment.policyId, JSON.stringify(template)]);
        await c.query(`INSERT INTO exam_app.answer_plans(id,attempt_id,student_id,policy_id,version,seed,allocation,confidence,proposed_by,state,approved_by,frozen_at) VALUES($1,$2,$3,$4,1,$5,$6,'estimate','deterministic','frozen',$7,now())`, [planId, id, actor.id, assignment.policyId, seed, JSON.stringify(assignment.settings), assignment.approvedBy]);
        let ordinal = 0, firstSlot: string | null = null;
        for (const [i, module] of template.modules.entries()) {
            const moduleId = randomUUID();
            const templateModule = await one(c, z.uuid(), 'SELECT id AS value FROM exam_app.template_modules WHERE template_id=$1 AND position=$2', [template.id, i + 1]);
            await c.query(`INSERT INTO exam_app.attempt_modules(id,attempt_id,student_id,template_module_id,position,section_code,title,question_count,rules_snapshot,state,opened_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,CASE WHEN $5=1 THEN now() ELSE NULL END)`, [moduleId, id, actor.id, templateModule, i + 1, module.sectionCode, module.title, module.questionCount, JSON.stringify(module), i === 0 ? 'in_progress' : 'available']);
            const wrong = assignment.settings.mode === 'practice_simulation' ? (assignment.settings.wrongCounts[i] ?? 0) : 0;
            const selected = new Set<number>();
            for (let j = 0; j < wrong; j++) {
                const start = Math.floor(j * module.questionCount / wrong), end = Math.floor((j + 1) * module.questionCount / wrong);
                selected.add(start + 1 + parseInt(hash(seed.toString('hex') + ':' + i + ':' + j).slice(0, 8), 16) % (end - start));
            }
            for (let n = 1; n <= module.questionCount; n++) {
                const slotId = randomUUID();
                if (!firstSlot)
                    firstSlot = slotId;
                await c.query('INSERT INTO exam_app.question_slots(id,module_id,attempt_id,student_id,position,ordinal) VALUES($1,$2,$3,$4,$5,$6)', [slotId, moduleId, id, actor.id, n, ++ordinal]);
                await c.query('INSERT INTO exam_app.answer_plan_items(id,plan_id,attempt_id,student_id,slot_id,action) VALUES($1,$2,$3,$4,$5,$6)', [randomUUID(), planId, id, actor.id, slotId, selected.has(n) ? 'simulate_alternative' : 'original']);
            }
        }
        await c.query('UPDATE exam_app.exam_attempts SET next_slot_id=$2 WHERE id=$1', [id, firstSlot]);
        await c.query(`UPDATE exam_app.delivery_policies SET state='frozen' WHERE id=$1`, [assignment.policyId]);
        await event(c, id, 'attempt.started');
        await audit(c, actor.id, 'attempt.start', id, 'attempt');
        return { id };
    });
}
export async function attemptAssignment(db: Queryable, attemptId: string) { return one(db, z.uuid(), 'SELECT assignment_id AS value FROM exam_app.exam_attempts WHERE id=$1', [attemptId]); }
export async function snapshot(pool: pg.Pool, actor: ExamUser, attemptId: string) {
    await tx(pool, async c => {
        await scope(c, actor, await attemptAssignment(c, attemptId));
        await expireExamAttempt(c, attemptId);
    });
    return tx(pool, async (c) => {
        await scope(c, actor, await attemptAssignment(c, attemptId));
        return one(c, ExamAttemptSchema, `SELECT jsonb_build_object('id',x.id,'assignmentId',a.id,'studentId',x.student_id,'studentName',u.display_name,'title',s.title,'exam',x.template_snapshot->>'exam','state',x.state,'timing',${attemptTimingJson},'opensAt',a.opens_at,'closesAt',a.closes_at,'nextSlotId',x.next_slot_id,'latestAnswerSlotId',${latestAnswerSlot},'viewedSlotId',x.viewed_slot_id,'navigationVersion',x.navigation_version,'activity',coalesce((SELECT jsonb_agg(h.value ORDER BY h.navigation_version DESC) FROM (SELECT ${activityJson} AS value,n.navigation_version FROM ${activityFrom} WHERE n.attempt_id=x.id ORDER BY n.navigation_version DESC LIMIT 30) h),'[]'::jsonb),'lastSeq',coalesce((SELECT last_seq FROM exam_app.attempt_streams WHERE attempt_id=x.id),0),'simulation',p.mode='practice_simulation','resolutions',${unreadResolutions},'alerts',coalesce((SELECT jsonb_agg(${incidentJson} ORDER BY i.opened_at,q.ordinal) FROM ${incidentFrom} WHERE i.attempt_id=x.id AND i.resolved_at IS NULL),'[]'::jsonb),'modules',(SELECT jsonb_agg((m.rules_snapshot || jsonb_build_object('id',m.id,'position',m.position,'state',m.state)) ORDER BY m.position) FROM exam_app.attempt_modules m WHERE m.attempt_id=x.id),'slots',(SELECT jsonb_agg(${slotJson} ORDER BY q.ordinal) FROM ${slotFrom} WHERE q.attempt_id=x.id)) AS value FROM exam_app.exam_attempts x JOIN exam_app.exam_assignments a ON a.id=x.assignment_id JOIN exam_app.exam_sittings s ON s.id=a.sitting_id JOIN exam_app.users u ON u.id=x.student_id JOIN exam_app.delivery_policies p ON p.id=x.delivery_policy_id WHERE x.id=$1`, [attemptId]);
    }, true);
}
export async function slotDetail(pool: pg.Pool, actor: ExamUser, slotId: string) {
    return tx(pool, async (c) => {
        const attemptId = await one(c, z.uuid(), 'SELECT attempt_id AS value FROM exam_app.question_slots WHERE id=$1', [slotId]);
        await scope(c, actor, await attemptAssignment(c, attemptId));
        const value = await one(c, ExamDetailSchema, `SELECT jsonb_build_object('slot',${slotJson},'problem',o.outcome#>'{candidate,problem}','outcome',CASE WHEN p.is_simulated AND q.student_id=$2 THEN NULL ELSE o.outcome END,'humanReviews',(SELECT coalesce(jsonb_agg(value ORDER BY created_at DESC),'[]'::jsonb) FROM (SELECT t.created_at,jsonb_build_object('id',t.id,'revision',rv.revision,'teacherName',tu.display_name,'answer',t.answer_text,'selectedOptions',t.selected_options,'note',t.note,'createdAt',t.created_at) AS value FROM exam_app.teacher_reviews t JOIN exam_app.users tu ON tu.id=t.actor_id JOIN exam_app.question_revisions rv ON rv.id=t.revision_id WHERE t.slot_id=q.id ORDER BY t.created_at DESC LIMIT 100) reviews),'revisions',(SELECT coalesce(jsonb_agg(value ORDER BY revision DESC),'[]'::jsonb) FROM (SELECT revision,jsonb_build_object('revision',revision,'reason',reason,'createdAt',created_at) AS value FROM exam_app.question_revisions WHERE slot_id=q.id ORDER BY revision DESC LIMIT 100) h)) AS value FROM ${slotFrom} LEFT JOIN LATERAL(SELECT res.outcome FROM exam_app.run_results res JOIN exam_app.answer_runs rr ON rr.id=res.run_id WHERE res.slot_id=q.id AND rr.revision_id=q.current_revision_id ORDER BY res.created_at DESC LIMIT 1) o ON true WHERE q.id=$1`, [slotId, actor.id]);
        return value;
    }, true);
}
export async function enterModule(pool: pg.Pool, actor: ExamUser, moduleId: string) {
    const target = await one(pool, z.object({ attemptId: z.uuid(), version: z.coerce.number() }), `SELECT jsonb_build_object('attemptId',m.attempt_id,'version',x.navigation_version) AS value FROM exam_app.attempt_modules m JOIN exam_app.exam_attempts x ON x.id=m.attempt_id WHERE m.id=$1`, [moduleId]);
    await scope(pool, actor, await attemptAssignment(pool, target.attemptId), true);
    const alreadyHere = await one(pool, z.boolean(), 'SELECT EXISTS(SELECT 1 FROM exam_app.exam_attempts x JOIN exam_app.question_slots q ON q.id=x.next_slot_id WHERE x.id=$1 AND q.module_id=$2) AS value', [target.attemptId, moduleId]);
    if (alreadyHere) return { id: target.attemptId };
    const result = await navigateAttempt(pool, actor, target.attemptId, { requestId: randomUUID(), expectedVersion: target.version, action: 'select_module', moduleId });
    return { id: result.id };
}
/** Read only: resolve an uncertain response without dispatching another paid job. */
export async function submissionReceipt(pool: pg.Pool, actor: ExamUser, slotId: string, requestId: string) {
    return tx(pool, async c => {
        const attemptId = await one(c, z.uuid(), 'SELECT attempt_id AS value FROM exam_app.question_slots WHERE id=$1', [slotId]);
        await scope(c, actor, await attemptAssignment(c, attemptId), true);
        // Wait for a submission already writing this attempt; never interpret an uncommitted row as a receipt.
        await c.query('SELECT id FROM exam_app.exam_attempts WHERE id=$1 FOR SHARE', [attemptId]);
        await scope(c, actor, await attemptAssignment(c, attemptId), true);
        const found = await rows(c, z.uuid(), 'SELECT id AS value FROM exam_app.answer_runs WHERE slot_id=$1 AND student_id=$2 AND client_request_id=$3', [slotId, actor.id, requestId]);
        return { runId: found[0] ?? null };
    });
}
export async function submit(pool: pg.Pool, actor: ExamUser, slotId: string, raw: unknown) {
    const input = ExamSubmissionSchema.parse(raw);
    return tx(pool, async (c) => {
        const attemptId = await one(c, z.uuid(), 'SELECT attempt_id AS value FROM exam_app.question_slots WHERE id=$1', [slotId]);
        await scope(c, actor, await attemptAssignment(c, attemptId), true);
        await c.query('SELECT id FROM exam_app.exam_attempts WHERE id=$1 FOR UPDATE', [attemptId]);
        const digest = hash(JSON.stringify({ slotId, ...input }));
        const previous = await rows(c, z.object({ hash: z.string(), response: z.object({ runId: z.uuid() }) }), `SELECT jsonb_build_object('hash',input_sha256,'response',response) AS value FROM exam_app.idempotency_requests WHERE actor_id=$1 AND operation='submission' AND request_id=$2`, [actor.id, input.requestId]);
        if (previous[0]) {
            if (previous[0].hash !== digest)
                throw conflict('同一请求标识不能用于不同内容。');
            return previous[0].response;
        }
        const current = await one(c, z.object({ revision: z.number(), revisionId: z.uuid().nullable(), runId: z.uuid().nullable(), nextSlotId: z.uuid().nullable(), allowed: z.boolean() }), `SELECT jsonb_build_object('revision',coalesce(v.revision,0),'revisionId',v.id,'runId',q.current_run_id,'nextSlotId',x.next_slot_id,'allowed',x.ended_at IS NULL AND x.state IN ('in_progress','completed') AND a.state IN ('assigned','completed') AND s.state='published' AND now()>=a.opens_at AND (a.closes_at IS NULL OR now()<a.closes_at)) AS value FROM exam_app.question_slots q JOIN exam_app.exam_attempts x ON x.id=q.attempt_id JOIN exam_app.exam_assignments a ON a.id=x.assignment_id JOIN exam_app.exam_sittings s ON s.id=a.sitting_id LEFT JOIN exam_app.question_revisions v ON v.id=q.current_revision_id WHERE q.id=$1 FOR UPDATE OF q`, [slotId]);
        if (!current.allowed)
            throw conflict('当前不在可提交的考试时间内。');
        if (current.revision !== input.expectedRevision)
            throw conflict('题图已更新，请同步后重试。');
        if (input.kind === 'initial' && current.revision !== 0)
            throw conflict('本题已拍摄，请选择重拍。');
        if (input.kind !== 'initial' && current.revision === 0)
            throw conflict('请先拍摄当前题。');
        const added = await rows(c, z.object({ id: z.uuid(), size: z.coerce.number() }), `SELECT jsonb_build_object('id',id,'size',byte_size) AS value FROM exam_app.media_assets WHERE id=ANY($1::uuid[]) AND owner_user_id=$2 AND variant='model' AND state='ready' FOR SHARE`, [input.assetIds, actor.id]);
        if (added.length !== input.assetIds.length)
            throw forbidden();
        const old = input.kind === 'supplement' ? await rows(c, z.object({ id: z.uuid(), role: z.enum(['primary', 'material']), size: z.coerce.number() }), `SELECT jsonb_build_object('id',m.id,'role',i.role,'size',m.byte_size) AS value FROM exam_app.revision_images i JOIN exam_app.media_assets m ON m.id=i.asset_id WHERE i.revision_id=$1 AND m.state='ready' ORDER BY i.role DESC,i.position`, [current.revisionId]) : [];
        const images = [...old.map(v => ({ id: v.id, role: v.role, size: v.size })), ...input.assetIds.map((id, i) => ({ id, role: input.kind === 'supplement' || i > 0 ? 'material' : 'primary', size: added.find(v => v.id === id)?.size ?? 0 }))];
        if (new Set(images.map(v => v.id)).size !== images.length || images.length > EXAM_MATERIAL_COUNT + 1 || images.filter(v => v.role === 'primary').length !== 1 || images.reduce((sum, v) => sum + v.size, 0) > EXAM_QUESTION_IMAGE_BYTES)
            throw conflict('主图和补图合计最多8张、8MiB，请减少图片或重拍。');
        if (current.runId)
            await c.query(`UPDATE exam_app.answer_runs SET status='cancelled',cancel_requested_at=now(),finished_at=now(),error_code='SUPERSEDED' WHERE id=$1 AND finished_at IS NULL`, [current.runId]);
        const revisionId = randomUUID(), runId = randomUUID();
        await c.query('INSERT INTO exam_app.question_revisions(id,slot_id,student_id,revision,reason,input_sha256,created_by,sealed_at) VALUES($1,$2,$3,$4,$5,$6,$3,now())', [revisionId, slotId, actor.id, current.revision + 1, input.kind, hash(images.map(v => v.id).join(':'))]);
        let material = 0;
        for (const image of images)
            await c.query('INSERT INTO exam_app.revision_images(revision_id,student_id,asset_id,role,position) VALUES($1,$2,$3,$4,$5)', [revisionId, actor.id, image.id, image.role, image.role === 'primary' ? 0 : ++material]);
        await c.query(`INSERT INTO exam_app.answer_runs(id,slot_id,revision_id,student_id,client_request_id,purpose,status,input_manifest,model_policy_version) VALUES($1,$2,$3,$4,$5,'solve','queued',$6,'managed-v1')`, [runId, slotId, revisionId, actor.id, input.requestId, JSON.stringify({ assetIds: images.map(v => v.id) })]);
        await c.query('UPDATE exam_app.question_slots SET current_revision_id=$2,current_run_id=$3,skipped_at=NULL,deferred_at=NULL,version=version+1 WHERE id=$1', [slotId, revisionId, runId]);
        await c.query('UPDATE exam_app.verification_incidents SET revision_id=$2,source_run_id=$3,updated_at=now() WHERE slot_id=$1 AND resolved_at IS NULL', [slotId, revisionId, runId]);
        await c.query(`INSERT INTO exam_app.idempotency_requests(actor_id,operation,request_id,input_sha256,status,response_status,response,expires_at) VALUES($1,'submission',$2,$3,'completed',202,$4,now()+interval '180 days')`, [actor.id, input.requestId, digest, JSON.stringify({ runId })]);
        await c.query('UPDATE exam_app.exam_attempts SET viewed_slot_id=coalesce(viewed_slot_id,$2) WHERE id=$1', [attemptId, slotId]);
        await event(c, attemptId, 'slot.submitted');
        return { runId };
    });
}
export async function events(pool: pg.Pool, actor: ExamUser, attemptId: string, after: number) {
    return tx(pool, async (c) => {
        await scope(c, actor, await attemptAssignment(c, attemptId));
        const stream = await one(c, z.object({ last: z.coerce.number(), min: z.coerce.number() }), `SELECT jsonb_build_object('last',last_seq,'min',min_retained_seq) AS value FROM exam_app.attempt_streams WHERE attempt_id=$1`, [attemptId]);
        const values = await rows(c, z.object({ schemaVersion: z.literal(1), attemptId: z.uuid(), seq: z.coerce.number(), type: z.string() }), `SELECT jsonb_build_object('schemaVersion',schema_version,'attemptId',attempt_id,'seq',seq,'type',event_type) AS value FROM exam_app.attempt_events WHERE attempt_id=$1 AND seq>$2 ORDER BY seq LIMIT 100`, [attemptId, after]);
        return ExamEventsSchema.parse({ events: values, lastSeq: stream.last, reset: after < stream.min || after > stream.last });
    }, true);
}
