// Decision: .agents/notes/implemented/architecture/2026-11-03-exam-console-dashboard.md
import type pg from 'pg';
import { z } from 'zod';
import { ExamDashboardQuerySchema, ExamDashboardSchema, type ExamUser } from '@solveflow/contracts/managed-exam';
import { forbidden, isAdmin, one, rows, tx } from './exam-store.js';
import { slotFrom } from './exam-attempts.js';
import { attemptTimingJson } from './exam-timing.js';

// Aggregate in SQL before pagination; a 500-row management list is not a system total.
const visible = `permitted AS (
    SELECT a.id AS assignment_id,a.student_id,u.display_name AS student_name,s.id AS sitting_id,s.title,a.opens_at,a.closes_at,s.template_id,x.id AS attempt_id,t.exam_type,u.state AS student_state,u.auth_version
    FROM exam_app.exam_assignments a JOIN exam_app.exam_sittings s ON s.id=a.sitting_id JOIN exam_app.users u ON u.id=a.student_id JOIN exam_app.exam_templates t ON t.id=s.template_id
    LEFT JOIN LATERAL(SELECT id FROM exam_app.exam_attempts WHERE assignment_id=a.id ORDER BY attempt_no DESC LIMIT 1) x ON true
    WHERE a.state<>'revoked' AND ($1::boolean OR ($2::boolean AND s.manager_id=$4) OR ($3::boolean AND EXISTS(SELECT 1 FROM exam_app.staff_assignments f WHERE f.assignment_id=a.id AND f.staff_id=$4 AND f.revoked_at IS NULL)))
), visible AS (SELECT * FROM permitted WHERE $5::uuid IS NULL OR sitting_id=$5), slots AS (
    SELECT q.id,q.attempt_id,q.module_id,q.current_revision_id,
      (p.id IS NOT NULL OR (h.id IS NOT NULL AND h.revision_id=q.current_revision_id)) AS answered,
      coalesce(h.id IS NOT NULL AND h.revision_id=q.current_revision_id,false) AS human,
      coalesce(p.display_verified AND NOT(h.id IS NOT NULL AND h.revision_id=q.current_revision_id),false) AS verified,
      (r.id IS NOT NULL AND r.finished_at IS NULL) AS active,
      EXISTS(SELECT 1 FROM exam_app.verification_incidents i WHERE i.slot_id=q.id AND i.resolved_at IS NULL) AS attention
    FROM ${slotFrom} JOIN visible a ON a.attempt_id=q.attempt_id
)`;

export async function dashboard(pool: pg.Pool, actor: ExamUser, raw: unknown) {
    if (actor.state !== 'active' || !actor.roles.some(role => ['admin', 'manager', 'support'].includes(role))) throw forbidden();
    const input = ExamDashboardQuerySchema.parse(raw);
    const params = [isAdmin(actor), actor.roles.includes('manager'), actor.roles.includes('support'), actor.id, input.sittingId ?? null];
    return tx(pool, async c => {
        if (input.sittingId && !await one(c, z.boolean(), `WITH ${visible} SELECT EXISTS(SELECT 1 FROM permitted WHERE sitting_id=$5) AS value`, params)) throw forbidden();
        const sittings = await rows(c, ExamDashboardSchema.shape.sittings.element, `WITH ${visible} SELECT jsonb_build_object('id',sitting_id,'title',title) AS value FROM permitted GROUP BY sitting_id,title ORDER BY (sitting_id=$5) DESC NULLS LAST,max(opens_at) DESC,sitting_id LIMIT 200`, params);
        const totals = await one(c, ExamDashboardSchema.shape.summary.extend({ unphotographed: z.number().int().nonnegative(), processingClear: z.number().int().nonnegative(), answeredClear: z.number().int().nonnegative() }), `WITH ${visible}, planned AS (
          SELECT coalesce(sum(CASE WHEN a.attempt_id IS NULL THEN (SELECT sum(m.question_count) FROM exam_app.template_modules m WHERE m.template_id=a.template_id) ELSE (SELECT count(*) FROM slots q WHERE q.attempt_id=a.attempt_id) END),0)::integer AS total FROM visible a
        ) SELECT jsonb_build_object(
          'students',(SELECT count(DISTINCT student_id) FROM visible),
          'online',(SELECT count(DISTINCT a.student_id) FROM visible a WHERE a.student_state='active' AND EXISTS(SELECT 1 FROM exam_app.auth_sessions s WHERE s.user_id=a.student_id AND s.auth_version=a.auth_version AND s.revoked_at IS NULL AND s.expires_at>now() AND s.last_seen_at>now()-interval '45 seconds')),
          'total',(SELECT total FROM planned),'answered',count(*) FILTER(WHERE answered),'verified',count(*) FILTER(WHERE verified),'humanConfirmed',count(*) FILTER(WHERE human),'active',count(*) FILTER(WHERE active),'attention',count(*) FILTER(WHERE attention),
          'unphotographed',(SELECT total FROM planned)-count(*) FILTER(WHERE current_revision_id IS NOT NULL),
          'processingClear',count(*) FILTER(WHERE active AND NOT attention),'answeredClear',count(*) FILTER(WHERE answered AND NOT active AND NOT attention)
        ) AS value FROM slots`, params);
        const { unphotographed, processingClear, answeredClear, ...summary } = totals;
        const distribution = [
            { state: 'unphotographed', count: unphotographed }, { state: 'processing', count: processingClear },
            { state: 'attention', count: summary.attention }, { state: 'answered', count: answeredClear },
            { state: 'waiting', count: summary.total - unphotographed - processingClear - summary.attention - answeredClear },
        ];
        const throughput = await rows(c, ExamDashboardSchema.shape.throughput.element, `WITH ${visible}, anchor AS (SELECT date_bin(interval '5 minutes',now(),timestamptz '2000-01-01') AS at), buckets AS (SELECT generate_series(at-interval '55 minutes',at,interval '5 minutes') AS at FROM anchor), publications AS (
          SELECT p.created_at,false AS human FROM exam_app.answer_presentations p JOIN slots q ON q.id=p.slot_id WHERE p.created_at>=(SELECT min(at) FROM buckets)
          UNION ALL SELECT h.created_at,true FROM exam_app.teacher_reviews h JOIN slots q ON q.id=h.slot_id WHERE h.created_at>=(SELECT min(at) FROM buckets)
        ) SELECT jsonb_build_object('at',b.at,'ai',count(p.created_at) FILTER(WHERE NOT p.human),'human',count(p.created_at) FILTER(WHERE p.human)) AS value FROM buckets b LEFT JOIN publications p ON p.created_at>=b.at AND p.created_at<b.at+interval '5 minutes' GROUP BY b.at ORDER BY b.at`, params);
        const issues = await rows(c, ExamDashboardSchema.shape.issues.element, `WITH ${visible} SELECT jsonb_build_object('reason',i.reason,'count',count(*)) AS value FROM exam_app.verification_incidents i JOIN visible a ON a.attempt_id=i.attempt_id WHERE i.resolved_at IS NULL GROUP BY i.reason ORDER BY count(*) DESC,i.reason`, params);
        const modules = await rows(c, ExamDashboardSchema.shape.modules.element, `WITH ${visible}, module_counts AS (
          SELECT a.exam_type,m.title,m.section_code,m.question_count AS total,(SELECT count(*) FROM slots q WHERE q.module_id=m.id AND q.answered) AS answered,(SELECT count(*) FROM slots q WHERE q.module_id=m.id AND q.attention) AS attention FROM visible a JOIN exam_app.attempt_modules m ON m.attempt_id=a.attempt_id
          UNION ALL SELECT a.exam_type,m.title,m.section_code,m.question_count,0,0 FROM visible a JOIN exam_app.template_modules m ON m.template_id=a.template_id WHERE a.attempt_id IS NULL
        ) SELECT jsonb_build_object('exam',exam_type,'title',title,'sectionCode',section_code,'total',sum(total),'answered',sum(answered),'attention',sum(attention)) AS value FROM module_counts GROUP BY exam_type,title,section_code ORDER BY sum(attention) DESC,sum(total) DESC,exam_type,title,section_code LIMIT 8`, params);
        const students = await rows(c, ExamDashboardSchema.shape.students.element, `WITH ${visible}, counts AS (
          SELECT attempt_id,count(*) AS total,count(*) FILTER(WHERE answered) AS answered,count(*) FILTER(WHERE verified) AS verified,count(*) FILTER(WHERE human) AS human,count(*) FILTER(WHERE active) AS active,count(*) FILTER(WHERE attention) AS attention FROM slots GROUP BY attempt_id
        ), details AS (
          SELECT a.*,coalesce(n.total,(SELECT sum(m.question_count) FROM exam_app.template_modules m WHERE m.template_id=a.template_id)) AS total,coalesce(n.answered,0) AS answered,coalesce(n.verified,0) AS verified,coalesce(n.human,0) AS human,coalesce(n.active,0) AS active,coalesce(n.attention,0) AS attention,
            a.student_state='active' AND EXISTS(SELECT 1 FROM exam_app.auth_sessions s WHERE s.user_id=a.student_id AND s.auth_version=a.auth_version AND s.revoked_at IS NULL AND s.expires_at>now() AND s.last_seen_at>now()-interval '45 seconds') AS online
          FROM visible a LEFT JOIN counts n ON n.attempt_id=a.attempt_id
        ) SELECT jsonb_build_object('assignmentId',a.assignment_id,'attemptId',a.attempt_id,'timing',${attemptTimingJson},'studentName',a.student_name,'title',a.title,'moduleTitle',coalesce(current_slot.title,''),'currentPosition',current_slot.position,'answered',a.answered,'verified',a.verified,'humanConfirmed',a.human,'total',a.total,'active',a.active,'attention',a.attention,'online',a.online) AS value FROM details a
        LEFT JOIN exam_app.exam_attempts x ON x.id=a.attempt_id
        LEFT JOIN LATERAL(SELECT m.title,q.position FROM exam_app.exam_attempts x JOIN exam_app.question_slots q ON q.id=coalesce(x.viewed_slot_id,x.next_slot_id) JOIN exam_app.attempt_modules m ON m.id=q.module_id WHERE x.id=a.attempt_id) current_slot ON true
        ORDER BY a.attention DESC,a.active DESC,a.online DESC,a.student_name,a.assignment_id LIMIT 8`, params);
        return ExamDashboardSchema.parse({ generatedAt: new Date().toISOString(), sittings, summary, distribution, throughput, issues, modules, students });
    }, true);
}
