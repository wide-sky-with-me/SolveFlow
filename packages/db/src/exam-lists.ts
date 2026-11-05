// Decision: .agents/notes/implemented/architecture/2026-11-04-managed-list-pagination.md
import type pg from 'pg';
import { z } from 'zod';
import {
    ExamAssignmentPageQuerySchema, ExamAssignmentPageSchema, ExamAssignmentSchema,
    ExamChoicePageSchema, ExamPageQuerySchema, ExamProgressPageQuerySchema, ExamProgressPageSchema,
    ExamSittingPageQuerySchema, ExamSittingPageSchema, ExamTemplatePageQuerySchema, ExamTemplatePageSchema,
    ExamUserPageQuerySchema, ExamUserPageSchema, type ExamPageQuery, type ExamUser,
} from '@solveflow/contracts/managed-exam';
import { forbidden, isAdmin, one, requireManager, rows, tx, userJson } from './exam-store.js';
import { templateJson } from './exam-catalog.js';
import { missedAssignment, availableAssignment, assignmentFrom, assignmentJson, progressJson, userScope } from './exam-list-sql.js';

type PageQuery = { from: string; select: string; where: string; values: unknown[]; order: string; id: string; search: string[] };
const numeric = z.coerce.number().int().nonnegative();
const pattern = (value: string) => '%' + value.replace(/[\\%_]/g, '\\$&') + '%';
const staff = (actor: ExamUser) => { if (actor.state !== 'active' || !actor.roles.some(r=>r==='admin'||r==='manager'||r==='support')) throw forbidden(); };
const staffScope = `$1::boolean OR ($3::boolean AND s.manager_id=$2) OR ($4::boolean AND EXISTS(SELECT 1 FROM exam_app.staff_assignments f WHERE f.assignment_id=a.id AND f.staff_id=$2 AND f.revoked_at IS NULL))`;
const scopeValues = (actor: ExamUser): unknown[] => [isAdmin(actor),actor.id,actor.roles.includes('manager'),actor.roles.includes('support')];
const pending = `EXISTS(SELECT 1 FROM exam_app.verification_incidents i JOIN exam_app.exam_attempts ix ON ix.id=i.attempt_id WHERE ix.assignment_id=a.id AND i.resolved_at IS NULL)`;
const available = availableAssignment;
const latestAttempt = `LEFT JOIN LATERAL(SELECT * FROM exam_app.exam_attempts ax WHERE ax.assignment_id=a.id ORDER BY ax.attempt_no DESC LIMIT 1) x ON true`;
const online = `EXISTS(SELECT 1 FROM exam_app.auth_sessions z WHERE z.user_id=u.id AND u.state='active' AND z.auth_version=u.auth_version AND z.revoked_at IS NULL AND z.last_seen_at>now()-interval '45 seconds' AND z.expires_at>now())`;

function add(query: PageQuery, clause: (parameter: string) => string, value: unknown) {
    query.values.push(value); query.where += ' AND ('+clause('$'+query.values.length)+')';
}

async function readPage<T extends z.ZodType>(pool: pg.Pool, schema: T, input: ExamPageQuery, query: PageQuery, extra?: (c: pg.PoolClient) => Promise<Record<string,unknown>>): Promise<z.output<T>> {
    return tx(pool, async c => {
        const values=[...query.values];
        const search=input.q && query.search.length ? ' AND ('+query.search.map(column=>column+` ILIKE $${values.length+1} ESCAPE E'\\\\'`).join(' OR ')+')' : '';
        if(search)values.push(pattern(input.q));
        const where='('+query.where+')'+search;
        const total=await one(c,numeric,`SELECT count(*)::integer AS value FROM ${query.from} WHERE ${where}`,values);
        const page=Math.min(input.page,Math.max(1,Math.ceil(total/input.pageSize)));
        const items=await rows(c,z.unknown(),`SELECT ${query.select} AS value FROM ${query.from} WHERE ${where} ORDER BY ${query.order} LIMIT $${values.length+1} OFFSET $${values.length+2}`,[...values,input.pageSize,(page-1)*input.pageSize]);
        // A selected option may fall outside the search/page; its original permission and purpose filters still apply.
        const selected=input.selectedId ? (await rows(c,z.unknown(),`SELECT ${query.select} AS value FROM ${query.from} WHERE (${query.where}) AND ${query.id}=$${query.values.length+1} LIMIT 1`,[...query.values,input.selectedId]))[0]??null : null;
        return schema.parse({items,total,page,pageSize:input.pageSize,selected,...(extra?await extra(c):{})});
    },true);
}

export async function userPage(pool: pg.Pool, actor: ExamUser, raw: unknown) {
    requireManager(actor); const input=ExamUserPageQuerySchema.parse(raw);
    const query: PageQuery={from:'exam_app.users u',select:userJson,where:'('+userScope+')',values:[isAdmin(actor),actor.id],order:'u.created_at DESC,u.id DESC',id:'u.id',search:['u.display_name','u.username']};
    if(input.role)add(query,p=>`EXISTS(SELECT 1 FROM exam_app.user_roles ur JOIN exam_app.roles r ON r.id=ur.role_id WHERE ur.user_id=u.id AND r.code=${p})`,input.role);
    if(input.state)add(query,p=>`u.state=${p}`,input.state);
    if(input.purpose==='student-assignment')query.where+=` AND ($1::boolean OR u.created_by=$2 OR EXISTS(SELECT 1 FROM exam_app.exam_assignments a JOIN exam_app.exam_sittings s ON s.id=a.sitting_id WHERE a.student_id=u.id AND s.manager_id=$2)) AND u.state='active' AND EXISTS(SELECT 1 FROM exam_app.user_roles ur JOIN exam_app.roles r ON r.id=ur.role_id WHERE ur.user_id=u.id AND r.code='student')`;
    if(input.purpose==='support-assignment')query.where+=` AND u.state='active' AND EXISTS(SELECT 1 FROM exam_app.user_roles ur JOIN exam_app.roles r ON r.id=ur.role_id WHERE ur.user_id=u.id AND r.code='support')`;
    return readPage(pool,ExamUserPageSchema,input,query);
}

export async function templatePage(pool: pg.Pool, actor: ExamUser, raw: unknown) {
    requireManager(actor);const input=ExamTemplatePageQuerySchema.parse(raw);
    const query: PageQuery={from:'exam_app.exam_templates t',select:templateJson,where:`t.state='published'`,values:[],order:'t.title,t.version DESC,t.id',id:'t.id',search:['t.title','t.code']};
    if(input.exam)add(query,p=>`t.exam_type=${p}`,input.exam);
    return readPage(pool,ExamTemplatePageSchema,input,query);
}

export async function sittingPage(pool: pg.Pool, actor: ExamUser, raw: unknown) {
    requireManager(actor);const input=ExamSittingPageQuerySchema.parse(raw);
    const select=`jsonb_build_object('id',s.id,'templateId',s.template_id,'title',s.title,'opensAt',s.opens_at,'closesAt',s.closes_at,'state',s.state,'templateTitle',t.title,'assignmentCount',(SELECT count(*) FROM exam_app.exam_assignments a WHERE a.sitting_id=s.id AND a.state<>'revoked'))`;
    const query: PageQuery={from:'exam_app.exam_sittings s JOIN exam_app.exam_templates t ON t.id=s.template_id',select,where:'($1::boolean OR s.manager_id=$2)',values:[isAdmin(actor),actor.id],order:'s.opens_at DESC,s.id DESC',id:'s.id',search:['s.title','t.title']};
    if(input.state)add(query,p=>`s.state=${p}`,input.state);
    if(input.exam)add(query,p=>`t.exam_type=${p}`,input.exam);
    return readPage(pool,ExamSittingPageSchema,input,query);
}

export async function assignmentPage(pool: pg.Pool, actor: ExamUser, raw: unknown, own = false) {
    if(!own)staff(actor);
    const input=ExamAssignmentPageQuerySchema.parse(raw);
    const query: PageQuery={from:assignmentFrom,select:assignmentJson,where:own?'a.student_id=$2 AND $1::boolean IS NOT NULL AND $3::boolean IS NOT NULL AND $4::boolean IS NOT NULL':'('+staffScope+')',values:scopeValues(actor),order:'a.opens_at DESC,a.id DESC',id:'a.id',search:['u.display_name','u.username','s.title']};
    const base={where:query.where,values:[...query.values]};
    if(input.sittingId)add(query,p=>`a.sitting_id=${p}`,input.sittingId);
    if(input.studentId)add(query,p=>`a.student_id=${p}`,input.studentId);
    if(input.state==='available')query.where+=' AND ('+available+')';
    if(input.state==='upcoming')query.where+=` AND a.state='assigned' AND a.opens_at>now()`;
    if(input.state==='expired')query.where+=' AND ('+missedAssignment+')';
    if(input.state==='ended')query.where+=` AND a.state<>'revoked' AND EXISTS(SELECT 1 FROM exam_app.exam_attempts ended_attempt WHERE ended_attempt.assignment_id=a.id AND ended_attempt.started_at IS NOT NULL AND (ended_attempt.ended_at IS NOT NULL OR a.closes_at<=now()))`;
    if(input.state==='revoked')query.where+=` AND a.state='revoked'`;
    if(input.state==='attention')query.where+=' AND '+pending;
    return readPage(pool,ExamAssignmentPageSchema,input,query,async c=>{
        // Eligibility and global reminders do not depend on the currently displayed history page or search.
        const candidates=await rows(c,ExamAssignmentSchema,`SELECT ${assignmentJson} AS value FROM ${assignmentFrom} WHERE (${base.where}) AND (${available}) ORDER BY a.opens_at DESC,a.id DESC LIMIT 2`,base.values);
        const values=[...base.values,input.excludeAttemptId??null];
        const attentionTotal=await one(c,numeric,`SELECT count(*)::integer AS value FROM ${assignmentFrom} WHERE (${base.where}) AND ${pending} AND ($5::uuid IS NULL OR NOT EXISTS(SELECT 1 FROM exam_app.exam_attempts xa WHERE xa.assignment_id=a.id AND xa.id=$5))`,values);
        const missedTotal=await one(c,numeric,`SELECT count(*)::integer AS value FROM ${assignmentFrom} WHERE (${base.where}) AND (${missedAssignment})`,base.values);
        return {available:candidates,attentionTotal,missedTotal};
    });
}

export async function progressPage(pool: pg.Pool, actor: ExamUser, raw: unknown) {
    staff(actor);const input=ExamProgressPageQuerySchema.parse(raw);
    const query: PageQuery={from:assignmentFrom+' '+latestAttempt,select:progressJson,where:'('+staffScope+`) AND a.state<>'revoked'`,values:scopeValues(actor),order:'a.opens_at DESC,a.id DESC',id:'a.id',search:['u.display_name','u.username','s.title']};
    if(input.sittingId)add(query,p=>`a.sitting_id=${p}`,input.sittingId);
    if(input.status==='online')query.where+=' AND '+online;
    if(input.status==='attention')query.where+=' AND '+pending;
    if(input.status==='active')query.where+=` AND EXISTS(SELECT 1 FROM exam_app.question_slots q JOIN exam_app.answer_runs r ON r.id=q.current_run_id WHERE q.attempt_id=x.id AND r.finished_at IS NULL)`;
    return readPage(pool,ExamProgressPageSchema,input,query,async c=>{
        const values=[...query.values];let where=query.where;
        if(input.q){values.push(pattern(input.q));where+=' AND ('+query.search.map(column=>column+` ILIKE $${values.length} ESCAPE E'\\\\'`).join(' OR ')+')';}
        return {onlineTotal:await one(c,numeric,`SELECT count(DISTINCT u.id)::integer AS value FROM ${query.from} WHERE (${where}) AND ${online}`,values)};
    });
}

export async function studentChoicePage(pool: pg.Pool, actor: ExamUser, raw: unknown) {
    staff(actor);const input=ExamPageQuerySchema.parse(raw);
    const from=`exam_app.users u`;
    const where=`EXISTS(SELECT 1 FROM exam_app.exam_assignments a JOIN exam_app.exam_sittings s ON s.id=a.sitting_id WHERE a.student_id=u.id AND a.state<>'revoked' AND (${staffScope}))`;
    const query: PageQuery={from,where,select:`jsonb_build_object('id',u.id,'label',u.display_name || ' · ' || u.username)`,values:scopeValues(actor),order:'u.display_name,u.id',id:'u.id',search:['u.display_name','u.username']};
    return readPage(pool,ExamChoicePageSchema,input,query);
}

export async function dashboardSittingPage(pool: pg.Pool, actor: ExamUser, raw: unknown) {
    staff(actor);const input=ExamPageQuerySchema.parse(raw);
    // Students who also have a staff role cannot broaden that staff role's scope through self ownership.
    const where=`EXISTS(SELECT 1 FROM exam_app.exam_assignments a WHERE a.sitting_id=s.id AND a.state<>'revoked' AND ($1::boolean OR ($3::boolean AND s.manager_id=$2) OR ($4::boolean AND EXISTS(SELECT 1 FROM exam_app.staff_assignments f WHERE f.assignment_id=a.id AND f.staff_id=$2 AND f.revoked_at IS NULL))))`;
    const query: PageQuery={from:'exam_app.exam_sittings s',where,select:`jsonb_build_object('id',s.id,'label',s.title)`,values:scopeValues(actor),order:'s.opens_at DESC,s.id DESC',id:'s.id',search:['s.title']};
    return readPage(pool,ExamChoicePageSchema,input,query);
}
