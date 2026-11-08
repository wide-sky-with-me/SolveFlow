// Decision: .agents/notes/implemented/architecture/2026-11-04-sitting-allocations.md
import type pg from 'pg';
import { z } from 'zod';
import { ExamAllocationAddSchema, ExamAllocationEditSchema, ExamAllocationPageSchema, ExamAllocationPageQuerySchema, ExamAllocationStaffSchema, ExamAllocationStateSchema, ExamSittingPublishSchema, ExamSittingSchema, ExamTemplateSchema, type ExamUser } from '@solveflow/contracts/managed-exam';
import { audit, conflict, event, hash, isAdmin, lockActor, one, requireManager, rows, tx, userById, userJson, type Queryable } from './exam-store.js';
import { insertAssignment, insertSitting, templateJson } from './exam-catalog.js';
const idResult = z.strictObject({id:z.uuid()});

async function sittingScope(c: Queryable, actor: ExamUser, id: string, write=false) {
    requireManager(actor);
    return one(c, ExamSittingSchema, `SELECT jsonb_build_object('id',id,'templateId',template_id,'title',title,'opensAt',opens_at,'closesAt',closes_at,'state',state) AS value FROM exam_app.exam_sittings WHERE id=$1 AND ($2::boolean OR manager_id=$3)${write?' FOR UPDATE':''}`, [id,isAdmin(actor),actor.id]);
}
/** Admission and receipt share a transaction; a lost response must not create a second sitting. */
async function mutation(pool: pg.Pool, actor: ExamUser, operation: string, requestId: string, raw: unknown, action: (c: pg.PoolClient)=>Promise<{id:string}>, access?: (c: pg.PoolClient)=>Promise<unknown>) {
    requireManager(actor);
    return tx(pool,async c=>{
        await lockActor(c,actor);
        await access?.(c);
        await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[actor.id+':'+operation+':'+requestId]);
        const digest=hash(JSON.stringify(raw));
        const saved=(await rows(c,z.object({hash:z.string(),response:idResult}),`SELECT jsonb_build_object('hash',input_sha256,'response',response) AS value FROM exam_app.idempotency_requests WHERE actor_id=$1 AND operation=$2 AND request_id=$3`,[actor.id,operation,requestId]))[0];
        if(saved){if(saved.hash!==digest)throw conflict('操作内容已变化，请重新提交。');return saved.response;}
        const result=await action(c);
        await c.query(`INSERT INTO exam_app.idempotency_requests(actor_id,operation,request_id,input_sha256,status,response_status,response,expires_at) VALUES($1,$2,$3,$4,'completed',200,$5,now()+interval '1 day')`,[actor.id,operation,requestId,digest,JSON.stringify(result)]);
        return result;
    });
}
export async function publishSitting(pool: pg.Pool, actor: ExamUser, raw: unknown) {
    const input=ExamSittingPublishSchema.parse(raw);
    return mutation(pool,actor,'sitting.publish-and-assign',input.requestId,input,async c=>{
        const sitting=await insertSitting(c,actor,input.sitting);
        for(const studentId of [...input.studentIds].sort())await insertAssignment(c,actor,{sittingId:sitting.id,studentId,supportIds:input.supportIds,mode:input.mode,wrongCounts:input.wrongCounts});
        return sitting;
    });
}
export async function addSittingStudents(pool: pg.Pool, actor: ExamUser, sittingId: string, raw: unknown) {
    const input=ExamAllocationAddSchema.parse(raw);
    return mutation(pool,actor,'sitting.add-students',input.requestId,{sittingId,...input},async c=>{
        const sitting=await sittingScope(c,actor,sittingId,true);
        if(sitting.state!=='published')throw conflict('场次已结束，不能新增学生。');
        for(const studentId of [...input.studentIds].sort())await insertAssignment(c,actor,{sittingId,studentId,supportIds:input.supportIds,mode:input.mode,wrongCounts:input.wrongCounts});
        await audit(c,actor.id,'sitting.add-students',sittingId,'sitting');return{id:sittingId};
    },c=>sittingScope(c,actor,sittingId));
}
export async function allocationPage(pool: pg.Pool, actor: ExamUser, sittingId: string, raw: unknown) {
    const input=ExamAllocationPageQuerySchema.parse(raw);
    return tx(pool,async c=>{
        const sitting=await sittingScope(c,actor,sittingId);
        const search='%'+input.q.replace(/[\\%_]/g,'\\$&')+'%';
        const where=`a.sitting_id=$1 AND (u.display_name ILIKE $2 ESCAPE E'\\\\' OR u.username ILIKE $2 ESCAPE E'\\\\')`;
        const total=await one(c,z.number().int(),`SELECT count(*)::integer AS value FROM exam_app.exam_assignments a JOIN exam_app.users u ON u.id=a.student_id WHERE ${where}`,[sittingId,search]);
        const page=Math.min(input.page,Math.max(1,Math.ceil(total/input.pageSize)));
        const items=await rows(c,z.unknown(),`SELECT jsonb_build_object('id',a.id,'student',${userJson},'support',coalesce((SELECT jsonb_agg(value ORDER BY value->>'displayName',value->>'id') FROM (SELECT ${userJson} AS value FROM exam_app.staff_assignments f JOIN exam_app.users u ON u.id=f.staff_id WHERE f.assignment_id=a.id AND f.revoked_at IS NULL) staff),'[]'::jsonb),'state',a.state,'started',EXISTS(SELECT 1 FROM exam_app.exam_attempts x WHERE x.assignment_id=a.id),'version',a.version) || CASE WHEN $5::boolean THEN jsonb_build_object('mode',a.settings_snapshot->>'mode','wrongCounts',a.settings_snapshot->'wrongCounts') ELSE '{}'::jsonb END AS value FROM exam_app.exam_assignments a JOIN exam_app.users u ON u.id=a.student_id WHERE ${where} ORDER BY a.created_at,a.id LIMIT $3 OFFSET $4`,[sittingId,search,input.pageSize,(page-1)*input.pageSize,input.config==='1']);
        return ExamAllocationPageSchema.parse({sitting,items,total,page,pageSize:input.pageSize,selected:null});
    },true);
}
async function lockAllocation(c: pg.PoolClient, actor: ExamUser, sittingId: string, assignmentId: string, version: number) {
    const sitting=await sittingScope(c,actor,sittingId,true);
    if(sitting.state!=='published')throw conflict('场次已结束，不能调整分配。');
    const studentId=await one(c,z.uuid(),'SELECT student_id AS value FROM exam_app.exam_assignments WHERE id=$1 AND sitting_id=$2',[assignmentId,sittingId]);
    // Entry locks the student before creating an attempt; finish/review lock the attempt before the assignment.
    await c.query('SELECT id FROM exam_app.users WHERE id=$1 FOR UPDATE',[studentId]);
    await c.query('SELECT id FROM exam_app.exam_attempts WHERE assignment_id=$1 ORDER BY id FOR UPDATE',[assignmentId]);
    const item=await one(c,z.object({version:z.number(),state:z.string(),attemptId:z.uuid().nullable(),studentId:z.uuid()}),`SELECT jsonb_build_object('version',a.version,'state',a.state,'studentId',a.student_id,'attemptId',(SELECT id FROM exam_app.exam_attempts x WHERE x.assignment_id=a.id LIMIT 1)) AS value FROM exam_app.exam_assignments a WHERE a.id=$1 AND a.sitting_id=$2 FOR UPDATE`,[assignmentId,sittingId]);
    if(item.version!==version)throw conflict('分配已被其他人更新，请同步后重试。');return item;
}
async function replaceSupport(c: pg.PoolClient, actor: ExamUser, assignmentId: string, supportIds: string[]) {
    // Hold the target account rows until grants commit; role removal cannot win unnoticed.
    for(const id of [...supportIds].sort()){
        await c.query('SELECT id FROM exam_app.users WHERE id=$1 FOR SHARE',[id]);
        const staff=await userById(c,id);if(staff.state!=='active'||!staff.roles.includes('support'))throw conflict('请选择有效的负责老师。');
    }
    await c.query('UPDATE exam_app.staff_assignments SET revoked_at=now() WHERE assignment_id=$1 AND revoked_at IS NULL AND NOT (staff_id=ANY($2::uuid[]))',[assignmentId,supportIds]);
    for(const id of supportIds)await c.query(`INSERT INTO exam_app.staff_assignments(assignment_id,staff_id,granted_by) VALUES($1,$2,$3) ON CONFLICT(assignment_id,staff_id) DO UPDATE SET revoked_at=NULL,granted_by=EXCLUDED.granted_by`,[assignmentId,id,actor.id]);
}
export async function updateAllocation(pool:pg.Pool,actor:ExamUser,sittingId:string,assignmentId:string,raw:unknown){
    const input=ExamAllocationEditSchema.parse(raw);
    return mutation(pool,actor,'assignment.edit',input.requestId,{sittingId,assignmentId,...input},async c=>{
        const item=await lockAllocation(c,actor,sittingId,assignmentId,input.expectedVersion);if(item.state==='revoked')throw conflict('请先恢复这位学生的分配。');
        if(input.settings){
            if(item.attemptId)throw conflict('学生已开始，不能修改本次考试的错题配置。');
            const template=await one(c,ExamTemplateSchema,`SELECT ${templateJson} AS value FROM exam_app.exam_templates t JOIN exam_app.exam_sittings s ON s.template_id=t.id WHERE s.id=$1`,[sittingId]);
            const settings=input.settings;
            if(settings.mode==='original'&&settings.wrongCounts.some(Boolean)||settings.mode==='practice_simulation'&&(settings.wrongCounts.length!==template.modules.length||settings.wrongCounts.some((n,i)=>n>(template.modules[i]?.questionCount??0))))throw conflict('错题数量须与模块对应，并且不超过题数。');
            await c.query('UPDATE exam_app.exam_assignments SET settings_snapshot=$2 WHERE id=$1',[assignmentId,JSON.stringify(settings)]);
            await c.query(`UPDATE exam_app.delivery_policies SET state='retired' WHERE assignment_id=$1 AND state='approved'`,[assignmentId]);
            await c.query(`INSERT INTO exam_app.delivery_policies(id,assignment_id,version,mode,targets,constraints,state,created_by,approved_by) SELECT gen_random_uuid(),$1,coalesce(max(version),0)+1,$2,$3,'{}','approved',$4,$4 FROM exam_app.delivery_policies WHERE assignment_id=$1`,[assignmentId,settings.mode,JSON.stringify({wrongCounts:settings.wrongCounts}),actor.id]);
        }
        await replaceSupport(c,actor,assignmentId,input.supportIds);await c.query('UPDATE exam_app.exam_assignments SET version=version+1 WHERE id=$1',[assignmentId]);if(item.attemptId)await event(c,item.attemptId,'assignment.staff-changed');await audit(c,actor.id,'assignment.edit',assignmentId);return{id:assignmentId};
    },c=>sittingScope(c,actor,sittingId));
}
export async function updateAllocationStaff(pool: pg.Pool, actor: ExamUser, sittingId: string, assignmentId: string, raw: unknown) {
    const input=ExamAllocationStaffSchema.parse(raw);
    return mutation(pool,actor,'assignment.staff',input.requestId,{sittingId,assignmentId,...input},async c=>{
        const item=await lockAllocation(c,actor,sittingId,assignmentId,input.expectedVersion);
        if(item.state==='revoked')throw conflict('请先恢复这位学生的分配。');
        await replaceSupport(c,actor,assignmentId,input.supportIds);
        await c.query('UPDATE exam_app.exam_assignments SET version=version+1 WHERE id=$1',[assignmentId]);
        if(item.attemptId)await event(c,item.attemptId,'assignment.staff-changed');
        await audit(c,actor.id,'assignment.staff',assignmentId);return{id:assignmentId};
    },c=>sittingScope(c,actor,sittingId));
}
export async function updateAllocationState(pool: pg.Pool, actor: ExamUser, sittingId: string, assignmentId: string, raw: unknown) {
    const input=ExamAllocationStateSchema.parse(raw);
    return mutation(pool,actor,'assignment.state',input.requestId,{sittingId,assignmentId,...input},async c=>{
        const item=await lockAllocation(c,actor,sittingId,assignmentId,input.expectedVersion);
        if(item.attemptId)throw conflict('学生已开始考试，不能移除分配；可调整负责老师或结束考试。');
        if(input.action==='restore'){
            const student=await userById(c,item.studentId);
            if(student.state!=='active'||!student.roles.includes('student'))throw conflict('学生账号不可用。');
            if(item.state!=='revoked')throw conflict('该分配已恢复，请同步后查看。');
        }else if(item.state==='revoked')throw conflict('该分配已移除，请同步后查看。');
        await c.query('UPDATE exam_app.exam_assignments SET state=$2,version=version+1 WHERE id=$1',[assignmentId,input.action==='revoke'?'revoked':'assigned']);
        await audit(c,actor.id,'assignment.'+input.action,assignmentId);return{id:assignmentId};
    },c=>sittingScope(c,actor,sittingId));
}
