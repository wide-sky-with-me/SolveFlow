import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { serve } from '@hono/node-server';
import { Server } from 'node:http';
import { chromium, webkit, expect as browserExpect } from '@playwright/test';
import sharp from 'sharp';
import { connectDatabase, migrate, bootstrap, createUser, createTemplate, createSitting, createAssignment, startAttempt, snapshot, submit, claimJob, publishDraft, finishJob, endExamAttempt, allocationPage, updateAllocation, createExamEvent, examEventDetail, examEventPage, examEventMembers, concreteExamPage, createConcreteExam, updateExamEvent, updateConcreteExam, deleteConcreteExam, deleteExamEvent, sendTeacherMessage, teacherMessages, readTeacherMessage, assignmentPage, updateUser, progressPage, progress, dashboard, dashboardSittingPage, studentChoicePage, sittingPage, sittings, assignments, issueQueue } from '@solveflow/db';
import { AnswerCandidateSchema, SolveOutcomeSchema } from '@solveflow/contracts/agent';
import { ExamTeacherMessagesSchema, type ExamUser } from '@solveflow/contracts/managed-exam';
import { createExamService, hashPassword } from './service.js';
import { LocalExamStorage } from './storage.js';
import { upload } from './images.js';
const url = process.env.SOLVEFLOW_EXAM_TEST_DATABASE_URL;
if (url && (new URL(url).hostname !== '127.0.0.1' || !/^\/solveflow_exam_test_[a-f0-9]{12}$/.test(new URL(url).pathname)))
    throw new Error('ISOLATED_DATABASE_REQUIRED');
const db = url ? connectDatabase(url) : null;
function pool() { if (!db)
    throw new Error('NO_DATABASE'); return db.pool; }
let admin: ExamUser, manager: ExamUser, foreign: ExamUser, teacher: ExamUser, teacher2: ExamUser, student: ExamUser, student2: ExamUser, templateId = '', replacementTemplate = '', password = '', root = '', origin = '';
let storage: LocalExamStorage, service: ReturnType<typeof createExamService>, server: Server;
function requestId() { return { requestId: randomUUID() }; }
describe.skipIf(!url)('exam event hierarchy and standalone teacher messages', () => {
    beforeAll(async () => {
        await migrate(pool());
        root = await mkdtemp(join(tmpdir(), 'solveflow-management-'));
        storage = new LocalExamStorage(join(root, 'media'));
        password = await hashPassword('synthetic-password-123');
        admin = await bootstrap(pool(), 'admin', '管理验收', password);
        const user = (username: string, roles: ExamUser['roles']) => createUser(pool(), admin, { username, displayName: username, password: 'synthetic-password-123', roles }, password);
        manager = await user('manager', ['manager']);
        foreign = await user('foreign', ['manager']);
        teacher = await user('teacher', ['support']);
        teacher2 = await user('teacher_two', ['support']);
        student = await user('student', ['student']);
        student2 = await user('student_two', ['student']);
        // Managers can assign students they created or already manage.
        await pool().query('UPDATE exam_app.users SET created_by=$1 WHERE id=ANY($2::uuid[])', [manager.id, [student.id, student2.id]]);
        const template = (code: string, counts: number[]) => createTemplate(pool(), admin, { code, title: code, exam: 'sat', modules: counts.map((questionCount, i) => ({ code: 'm' + i, title: '模块' + (i + 1), sectionCode: 'math', questionCount, durationSeconds: null })) });
        templateId = (await template('management-sat', [3, 2])).id;
        replacementTemplate = (await template('management-sat-new', [4, 3])).id;
        const started = serve({ hostname: '127.0.0.1', port: 0, fetch: req => service.app.fetch(req) });
        if (!(started instanceof Server))
            throw new Error('NO_HTTP_SERVER');
        server = started;
        await new Promise<void>(resolve => server.listening ? resolve() : server.once('listening', () => resolve()));
        const address = server.address();
        if (!address || typeof address === 'string')
            throw new Error('NO_PORT');
        origin = 'http://127.0.0.1:' + address.port;
        service = createExamService({ pool: pool(), storage, origin, publicDir: join(process.cwd(), 'apps/exam-web/dist/public'), clientAddress: () => randomUUID() });
    });
    afterAll(async () => { server?.closeAllConnections(); if (server)
        await new Promise<void>(resolve => server.close(() => resolve())); await db?.close(); if (root)
        await rm(root, { recursive: true, force: true }); });
    async function parent(title: string) { return createExamEvent(pool(), manager, { ...requestId(), title, templateId }); }
    function concrete(title: string, students = [student.id], teachers = [teacher.id]) { return { ...requestId(), title, opensAt: new Date(Date.now() - 60000).toISOString(), closesAt: null, studentIds: students, supportIds: teachers, mode: 'original', wrongCounts: [] }; }
    async function detail(id: string) { return (await examEventDetail(pool(), manager, id)).event; }
    async function failedQuestion(name: string) {
        const child = await createUser(pool(), manager, { username: 'message_' + name, displayName: '消息学生' + name, password: 'synthetic-password-123', roles: ['student'] }, password);
        const sitting = await createSitting(pool(), manager, { templateId, title: '消息考试' + name, opensAt: new Date(Date.now() - 60000).toISOString(), closesAt: null });
        const assignment = await createAssignment(pool(), manager, { sittingId: sitting.id, studentId: child.id, supportIds: [teacher.id] });
        const attempt = await startAttempt(pool(), child, assignment.id);
        const slots = (await snapshot(pool(), child, attempt.id)).slots, target = slots[1];
        if (!target)
            throw new Error('NO_MESSAGE_SLOT');
        const bytes = await sharp({ create: { width: 600, height: 400, channels: 3, background: '#fff' } }).jpeg().toBuffer(), asset = await upload(pool(), storage, child, target.id, randomUUID(), bytes);
        await submit(pool(), child, target.id, { ...requestId(), expectedRevision: 0, kind: 'initial', assetIds: [asset.id] });
        const job = await claimJob(pool());
        if (!job || job.slotId !== target.id)
            throw new Error('MISSING_MESSAGE_JOB');
        await finishJob(pool(), job, null, 'SYNTHETIC_MESSAGE_FAILURE');
        return { child, sitting, assignment, attempt, slot: target, before: await snapshot(pool(), child, attempt.id) };
    }
    it('backfills legacy concrete exams and preserves a default parent for legacy insert APIs', async () => {
        const sitting = await createSitting(pool(), manager, { templateId, title: '旧版兼容考试', opensAt: new Date().toISOString(), closesAt: null });
        const rows = await pool().query('SELECT event_id FROM exam_app.exam_sittings WHERE id=$1', [sitting.id]);
        expect(rows.rows[0]?.event_id).toBe(sitting.id);
        expect((await detail(sitting.id)).title).toBe('旧版兼容考试');
    });
    it('groups multiple concrete exams and deduplicates members from current allocations', async () => {
        const event = await parent('汇总场次'), input = concrete('第一场', [student.id, student2.id], [teacher.id, teacher2.id]);
        const first = await createConcreteExam(pool(), manager, event.id, input);
        expect(await createConcreteExam(pool(), manager, event.id, input)).toEqual(first);
        await createConcreteExam(pool(), manager, event.id, concrete('第二场'));
        expect(await detail(event.id)).toMatchObject({ examCount: 2, studentCount: 2, teacherCount: 2 });
        expect((await examEventMembers(pool(), manager, event.id, { role: 'student', pageSize: 1 })).total).toBe(2);
        expect((await examEventMembers(pool(), manager, event.id, { role: 'support' })).items.map(item => item.id).sort()).toEqual([teacher.id, teacher2.id].sort());
        expect((await concreteExamPage(pool(), manager, event.id, { q: '第二', pageSize: 1 })).total).toBe(1);
        await expect(examEventDetail(pool(), foreign, event.id)).rejects.toMatchObject({ status: 404 });
        await expect(examEventPage(pool(), teacher, {})).rejects.toMatchObject({ status: 404 });
        await expect(createConcreteExam(pool(), manager, event.id, { ...concrete('非法模板'), templateId: replacementTemplate })).rejects.toThrow();
        const before = (await detail(event.id)).examCount;
        await expect(createConcreteExam(pool(), manager, event.id, concrete('应回滚', [student.id, teacher2.id]))).rejects.toThrow();
        expect((await detail(event.id)).examCount).toBe(before);
    });
    it('edits names at either level, propagates unstarted templates and freezes started settings', async () => {
        const event = await parent('改名前场次'), created = await createConcreteExam(pool(), manager, event.id, concrete('改名前考试'));
        let p = await detail(event.id);
        await updateExamEvent(pool(), manager, event.id, { ...requestId(), expectedVersion: p.version, title: '改后场次', templateId: replacementTemplate });
        let exam = (await concreteExamPage(pool(), manager, event.id, {})).items[0];
        if (!exam)
            throw new Error('NO_EDIT_EXAM');
        expect(exam.templateId).toBe(replacementTemplate);
        await updateConcreteExam(pool(), manager, event.id, created.id, { ...requestId(), expectedVersion: exam.version, title: '改后考试', opensAt: exam.opensAt, closesAt: null });
        let allocation = (await allocationPage(pool(), manager, created.id, { config: '1' })).items[0];
        if (!allocation)
            throw new Error('NO_ALLOCATION');
        await updateAllocation(pool(), manager, created.id, allocation.id, { ...requestId(), expectedVersion: allocation.version, supportIds: [teacher.id, teacher2.id], settings: { mode: 'practice_simulation', wrongCounts: [1, 0] } });
        allocation = (await allocationPage(pool(), manager, created.id, { config: '1' })).items[0];
        if (!allocation)
            throw new Error('NO_UPDATED_ALLOCATION');
        expect(allocation).toMatchObject({ mode: 'practice_simulation', wrongCounts: [1, 0] });
        expect(allocation.support).toHaveLength(2);
        const attempt = await startAttempt(pool(), student, allocation.id);
        expect((await snapshot(pool(), student, attempt.id)).simulation).toBe(true);
        p = await detail(event.id);
        await updateExamEvent(pool(), manager, event.id, { ...requestId(), expectedVersion: p.version, title: '已开考仍可改场次名', templateId: p.templateId });
        exam = (await concreteExamPage(pool(), manager, event.id, {})).items[0];
        if (!exam)
            throw new Error('NO_STARTED_EXAM');
        await updateConcreteExam(pool(), manager, event.id, created.id, { ...requestId(), expectedVersion: exam.version, title: '已开考仍可改考试名', opensAt: exam.opensAt, closesAt: exam.closesAt });
        expect((await snapshot(pool(), student, attempt.id)).title).toBe('已开考仍可改考试名');
        await expect(updateAllocation(pool(), manager, created.id, allocation.id, { ...requestId(), expectedVersion: allocation.version, supportIds: [], settings: { mode: 'original', wrongCounts: [] } })).rejects.toThrow('学生已开始');
        p = await detail(event.id);
        await expect(updateExamEvent(pool(), manager, event.id, { ...requestId(), expectedVersion: p.version, title: p.title, templateId })).rejects.toThrow('已有学生参加');
        await expect(deleteExamEvent(pool(), manager, event.id, { ...requestId(), expectedVersion: p.version })).rejects.toThrow('进行中');
        await endExamAttempt(pool(), student, attempt.id);
        exam = (await concreteExamPage(pool(), manager, event.id, {})).items[0];
        if (!exam)
            throw new Error('NO_FINISHED_EXAM');
        await deleteConcreteExam(pool(), manager, event.id, created.id, { ...requestId(), expectedVersion: exam.version });
        expect((await concreteExamPage(pool(), manager, event.id, {})).total).toBe(0);
        expect((await snapshot(pool(), student, attempt.id)).title).toBe('已开考仍可改考试名');
        expect((await assignmentPage(pool(), student, { q: '已开考仍可改考试名' }, true)).items[0]?.entryState).toBe('ended');
        p = await detail(event.id);
        await deleteExamEvent(pool(), manager, event.id, { ...requestId(), expectedVersion: p.version });
        expect((await examEventPage(pool(), manager, { q: '已开考仍可改场次名' })).total).toBe(0);
    });
    it('rejects stale edits and cross-event mutations while keeping names optimistic', async () => {
        const a = await parent('并发场次'), b = await parent('其他场次'), exam = await createConcreteExam(pool(), manager, a.id, concrete('并发考试', [student2.id]));
        const p = await detail(a.id);
        const results = await Promise.allSettled(['甲', '乙'].map(title => updateExamEvent(pool(), manager, a.id, { ...requestId(), expectedVersion: p.version, title, templateId })));
        expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
        await expect(deleteConcreteExam(pool(), manager, b.id, exam.id, { ...requestId(), expectedVersion: 1 })).rejects.toMatchObject({ status: 404 });
    });
    it('reads the committed parent template when entry waits behind a structural edit', async () => {
        const child = await createUser(pool(), manager, { username: 'entry_template_race', displayName: '入场竞争', password: 'synthetic-password-123', roles: ['student'] }, password);
        const event = await parent('入场模板竞争');
        const exam = await createConcreteExam(pool(), manager, event.id, concrete('入场竞争考试', [child.id]));
        const allocation = (await allocationPage(pool(), manager, exam.id, {})).items[0];
        if (!allocation) throw new Error('NO_RACE_ALLOCATION');
        const blocker = await pool().connect();
        let entry: ReturnType<typeof startAttempt> | undefined;
        try {
            await blocker.query('BEGIN');
            const pid = (await blocker.query('SELECT pg_backend_pid() AS pid')).rows[0]?.pid;
            await blocker.query('SELECT id FROM exam_app.exam_events WHERE id=$1 FOR UPDATE', [event.id]);
            await blocker.query('SELECT id FROM exam_app.exam_sittings WHERE id=$1 FOR UPDATE', [exam.id]);
            await blocker.query('SELECT id FROM exam_app.exam_assignments WHERE id=$1 FOR UPDATE', [allocation.id]);
            entry = startAttempt(pool(), child, allocation.id);
            let waiting = false;
            for (let i = 0; i < 100; i++) {
                waiting = (await pool().query('SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE $1=ANY(pg_blocking_pids(pid))) AS blocked', [pid])).rows[0]?.blocked === true;
                if (waiting) break;
                await new Promise(resolve => setTimeout(resolve, 10));
            }
            expect(waiting).toBe(true);
            await blocker.query('UPDATE exam_app.exam_events SET template_id=$2,version=version+1 WHERE id=$1', [event.id, replacementTemplate]);
            await blocker.query('UPDATE exam_app.exam_sittings SET template_id=$2,version=version+1 WHERE id=$1', [exam.id, replacementTemplate]);
            await blocker.query('COMMIT');
            const attempt = await entry;
            const after = await snapshot(pool(), child, attempt.id);
            expect(after.modules.map(module => module.questionCount)).toEqual([4, 3]);
            await endExamAttempt(pool(), child, attempt.id);
        } finally {
            await blocker.query('ROLLBACK');
            blocker.release();
            await entry?.catch(() => undefined);
        }
    });
    it('holds planned simulated answers until final publication without a misleading correction notice', async () => {
        const child = await createUser(pool(), manager, { username: 'simulation_draft', displayName: '模拟草稿验收', password: 'synthetic-password-123', roles: ['student'] }, password);
        const event = await parent('模拟草稿场次');
        const exam = await createConcreteExam(pool(), manager, event.id, { ...concrete('模拟草稿考试', [child.id]), mode: 'practice_simulation', wrongCounts: [1, 0] });
        const assignment = (await allocationPage(pool(), manager, exam.id, {})).items[0];
        if (!assignment) throw new Error('NO_SIMULATION_ALLOCATION');
        const attempt = await startAttempt(pool(), child, assignment.id);
        const planned = await pool().query("SELECT i.slot_id FROM exam_app.answer_plan_items i JOIN exam_app.question_slots q ON q.id=i.slot_id WHERE q.attempt_id=$1 AND i.action='simulate_alternative'", [attempt.id]);
        const target = (await snapshot(pool(), child, attempt.id)).slots.find(slot => slot.id === planned.rows[0]?.slot_id);
        if (!target) throw new Error('NO_SIMULATED_SLOT');
        const bytes = await sharp({ create: { width: 600, height: 400, channels: 3, background: '#fff' } }).jpeg().toBuffer();
        const asset = await upload(pool(), storage, child, target.id, randomUUID(), bytes);
        await submit(pool(), child, target.id, { ...requestId(), expectedRevision: 0, kind: 'initial', assetIds: [asset.id] });
        const job = await claimJob(pool());
        if (!job || job.slotId !== target.id) throw new Error('NO_SIMULATED_JOB');
        const candidate = AnswerCandidateSchema.parse({ schemaVersion: 1, kind: 'answer', problem: { text: 'What is 2 + 2?', subject: 'math', uncertainties: [], response: { type: 'single-choice' }, options: [{ label: 'A', text: '3' }, { label: 'B', text: '4' }, { label: 'C', text: '5' }] }, selectedOptions: ['B'], answer: 'B. 4', steps: [], knowledgePoints: [], citationIds: [], clarificationQuestions: [] });
        expect(await publishDraft(pool(), job, candidate)).toBe(false);
        expect((await snapshot(pool(), child, attempt.id)).slots.find(slot => slot.id === target.id)?.draft).toBeNull();
        const outcome = SolveOutcomeSchema.parse({ schemaVersion: 1, status: 'completed', verified: false, verification: null, warning: null, verificationStatus: 'not_requested', candidate });
        expect(await finishJob(pool(), job, outcome, null)).toBe(true);
        const after = await snapshot(pool(), child, attempt.id);
        expect(after.slots.find(slot => slot.id === target.id)?.presentation?.selectedOptions).toEqual(['A']);
        expect(after.answerRevisions).toEqual([]);
        await endExamAttempt(pool(), child, attempt.id);
    });
    it('sends messages without answers, preserves failures and isolates recipients', async () => {
        const f = await failedQuestion('direct'), input = { ...requestId(), expectedRevision: 1, message: '请重新拍完整题干和选项。' };
        const results = await Promise.all([sendTeacherMessage(pool(), teacher, f.slot.id, input), sendTeacherMessage(pool(), teacher, f.slot.id, input)]);
        expect(results[0]).toEqual(results[1]);
        const messages = await teacherMessages(pool(), f.child);
        expect(messages.items).toHaveLength(1);
        expect(messages.items[0]).toMatchObject({ message: input.message, slotId: f.slot.id });
        const after = await snapshot(pool(), f.child, f.attempt.id);
        expect(after.slots.find(slot => slot.id === f.slot.id)?.presentation).toBeNull();
        expect(after.alerts).toEqual(f.before.alerts);
        const id = messages.items[0]?.id;
        if (!id)
            throw new Error('NO_MESSAGE');
        await expect(readTeacherMessage(pool(), student2, id)).rejects.toMatchObject({ status: 404 });
        await expect(sendTeacherMessage(pool(), teacher2, f.slot.id, { ...input, ...requestId() })).rejects.toMatchObject({ status: 404 });
        await expect(sendTeacherMessage(pool(), f.child, f.slot.id, { ...input, ...requestId() })).rejects.toMatchObject({ status: 404 });
        await expect(sendTeacherMessage(pool(), teacher, f.slot.id, { ...input, message: '改变同一个请求' })).rejects.toMatchObject({ status: 409 });
        await expect(sendTeacherMessage(pool(), teacher, f.slot.id, { ...input, ...requestId(), expectedRevision: 0 })).rejects.toMatchObject({ status: 409 });
        await readTeacherMessage(pool(), f.child, id);
        await readTeacherMessage(pool(), f.child, id);
        expect((await teacherMessages(pool(), f.child)).items).toEqual([]);
    });
    it('keeps message fields opt-in for older assignment-list clients and rechecks account state', async () => {
        const f = await failedQuestion('compat');
        await sendTeacherMessage(pool(), teacher, f.slot.id, { ...requestId(), expectedRevision: 1, message: '只读消息兼容。' });
        const auth = await service.app.request(origin + '/api/v2/auth/login', { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify({ username: f.child.username, password: 'synthetic-password-123' }) });
        const cookie = auth.headers.get('set-cookie')?.split(';')[0] ?? '';
        const read = (query: string) => service.app.request(origin + '/api/v2/me/assignments/page' + query, { headers: { cookie } });
        expect(await (await read('?entryState=1')).json()).not.toHaveProperty('messages');
        expect(await (await read('?entryState=1&messages=1')).json()).toHaveProperty('messages');
        const temp = await createUser(pool(), admin, { username: 'message_disabled', displayName: '停用老师', password: 'synthetic-password-123', roles: ['support'] }, password);
        await updateUser(pool(), admin, temp.id, { displayName: temp.displayName, state: 'disabled', roles: ['support'] }, undefined);
        await expect(sendTeacherMessage(pool(), temp, f.slot.id, { ...requestId(), expectedRevision: 1, message: '不应发送' })).rejects.toMatchObject({ status: 404 });
    });
    it('audit: archived exams disappear from active lists, filters, issues and dashboard without erasing history', async () => {
        const f = await failedQuestion('archive_audit');
        await sendTeacherMessage(pool(), teacher, f.slot.id, {...requestId(),expectedRevision:1,message:'归档前的消息仍可阅读。'});
        await endExamAttempt(pool(), f.child, f.attempt.id);
        const before = await dashboard(pool(), manager, {});
        const exam = (await concreteExamPage(pool(),manager,f.sitting.id,{})).items[0];
        if (!exam) throw new Error('NO_ARCHIVE_EXAM');
        await deleteConcreteExam(pool(),manager,f.sitting.id,exam.id,{...requestId(),expectedVersion:exam.version});
        expect((await progressPage(pool(),teacher,{q:f.child.username})).items).toEqual([]);
        expect((await progress(pool(),teacher)).some(item=>item.assignmentId===f.assignment.id)).toBe(false);
        expect((await dashboardSittingPage(pool(),teacher,{q:exam.title})).items).toEqual([]);
        expect((await studentChoicePage(pool(),teacher,{q:f.child.username})).items).toEqual([]);
        expect((await sittingPage(pool(),manager,{q:exam.title})).items).toEqual([]);
        expect((await sittings(pool(),manager)).some(item=>item.id===f.sitting.id)).toBe(false);
        expect((await assignments(pool(),manager)).some(item=>item.id===f.assignment.id)).toBe(false);
        expect((await issueQueue(pool(),teacher,{studentId:f.child.id})).total).toBe(0);
        expect((await dashboard(pool(),manager,{})).summary.students).toBe(before.summary.students-1);
        await expect(dashboard(pool(),teacher,{sittingId:f.sitting.id})).rejects.toMatchObject({status:404});
        await expect(sendTeacherMessage(pool(),teacher,f.slot.id,{...requestId(),expectedRevision:1,message:'归档后不得再写入。'})).rejects.toMatchObject({status:404});
        const history=await assignmentPage(pool(),f.child,{},true);expect(history.items[0]?.attemptId).toBe(f.attempt.id);expect(history.attentionTotal).toBe(0);
        expect((await snapshot(pool(),f.child,f.attempt.id)).slots.find(item=>item.id===f.slot.id)?.revision).toBe(1);
        expect((await teacherMessages(pool(),f.child)).items).toHaveLength(1);
    });
    it('audit: archiving waits for the attempt lock used by teacher interventions', async () => {
        const f=await failedQuestion('archive_lock');await endExamAttempt(pool(),f.child,f.attempt.id);
        const exam=(await concreteExamPage(pool(),manager,f.sitting.id,{})).items[0];if(!exam)throw new Error('NO_ARCHIVE_LOCK_EXAM');
        const blocker=await pool().connect();let pending:ReturnType<typeof deleteConcreteExam>|undefined,done=false;
        try {
            await blocker.query('BEGIN');const pid=(await blocker.query('SELECT pg_backend_pid() AS pid')).rows[0]?.pid;
            await blocker.query('SELECT id FROM exam_app.exam_attempts WHERE id=$1 FOR UPDATE',[f.attempt.id]);
            pending=deleteConcreteExam(pool(),manager,f.sitting.id,exam.id,{...requestId(),expectedVersion:exam.version}).finally(()=>{done=true;});
            let waiting=false;
            for(let i=0;i<100&&!done;i++){
                waiting=(await pool().query('SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE $1=ANY(pg_blocking_pids(pid))) AS blocked',[pid])).rows[0]?.blocked===true;
                if(waiting)break;await new Promise(resolve=>setTimeout(resolve,10));
            }
            expect(waiting).toBe(true);await blocker.query('COMMIT');await pending;
        } finally {await blocker.query('ROLLBACK');blocker.release();await pending?.catch(()=>undefined);}
    });
    for(const engine of ['chrome','webkit'] as const) {
        it(`audit UI: renaming a timed exam preserves its exact window in ${engine}`,async()=>{
            const event=await parent('精确时间'+engine),opens=new Date(Date.now()+3600000),closes=new Date(Date.now()+7200000);opens.setUTCSeconds(17,123);closes.setUTCSeconds(29,456);
            const created=await createConcreteExam(pool(),manager,event.id,{...concrete('只改名'+engine,[student2.id]),opensAt:opens.toISOString(),closesAt:closes.toISOString()});
            const browser=await(engine==='chrome'?chromium.launch({executablePath:'/usr/bin/google-chrome'}):webkit.launch()),context=await browser.newContext(),page=await context.newPage();
            page.setDefaultTimeout(6000);
            try{
                await context.request.post(origin+'/api/v2/auth/login',{headers:{origin},data:{username:manager.username,password:'synthetic-password-123'}});await page.goto(origin);
                await page.getByRole('navigation',{name:'管理导航'}).getByRole('button',{name:'考试安排',exact:true}).click();
                const search=page.getByRole('searchbox',{name:'搜索场次或模板'});await search.fill('精确时间'+engine);await search.press('Enter');
                await page.getByRole('article',{name:'精确时间'+engine,exact:true}).getByRole('button',{name:'查看考试',exact:true}).click();
                await page.getByRole('article',{name:'只改名'+engine,exact:true}).getByRole('button',{name:'编辑',exact:true}).click();
                const edit=page.getByRole('dialog',{name:'编辑具体考试'});await edit.getByLabel('考试名称',{exact:true}).fill('新名称'+engine);await edit.getByRole('button',{name:'保存考试',exact:true}).click();await edit.waitFor({state:'hidden'});
                const after=(await concreteExamPage(pool(),manager,event.id,{})).items.find(item=>item.id===created.id);expect(after?.title).toBe('新名称'+engine);
                expect(Date.parse(after?.opensAt??'')).toBe(opens.getTime());expect(Date.parse(after?.closesAt??'')).toBe(closes.getTime());
                expect((await allocationPage(pool(),manager,created.id,{})).items[0]?.version).toBe(1);
            }finally{await context.close();await browser.close();}
        },30000);
        it(`audit UI: unchanged score settings do not block a teacher update after entry in ${engine}`,async()=>{
            const child=await createUser(pool(),manager,{username:'editing_entry_'+engine,displayName:'编辑时入场'+engine,password:'synthetic-password-123',roles:['student']},password);
            const event=await parent('编辑并发'+engine),exam=await createConcreteExam(pool(),manager,event.id,concrete('编辑时入场'+engine,[child.id]));
            const browser=await(engine==='chrome'?chromium.launch({executablePath:'/usr/bin/google-chrome'}):webkit.launch()),context=await browser.newContext(),page=await context.newPage();
            page.setDefaultTimeout(6000);
            try{
                await context.request.post(origin+'/api/v2/auth/login',{headers:{origin},data:{username:manager.username,password:'synthetic-password-123'}});await page.goto(origin);
                await page.getByRole('navigation',{name:'管理导航'}).getByRole('button',{name:'考试安排',exact:true}).click();
                const search=page.getByRole('searchbox',{name:'搜索场次或模板'});await search.fill('编辑并发'+engine);await search.press('Enter');
                await page.getByRole('article',{name:'编辑并发'+engine,exact:true}).getByRole('button',{name:'查看考试',exact:true}).click();
                await page.getByRole('article',{name:'编辑时入场'+engine,exact:true}).getByRole('button',{name:'人员与错题配置',exact:true}).click();
                const dialog=page.locator('dialog.allocation-dialog');await dialog.getByRole('row').filter({hasText:child.username}).getByRole('button',{name:'调整',exact:true}).click();
                await dialog.getByRole('combobox',{name:'负责老师',exact:true}).click();await dialog.getByRole('option',{name:/teacher_two/}).click();await page.keyboard.press('Escape');
                const allocation=(await allocationPage(pool(),manager,exam.id,{})).items[0];if(!allocation)throw new Error('NO_EDITING_ALLOCATION');const attempt=await startAttempt(pool(),child,allocation.id);
                await dialog.getByRole('button',{name:'保存',exact:true}).click();await dialog.getByRole('heading',{name:'编辑时入场'+engine,exact:true}).waitFor();
                expect((await allocationPage(pool(),manager,exam.id,{})).items[0]?.support).toHaveLength(2);await endExamAttempt(pool(),child,attempt.id);
            }finally{await context.close();await browser.close();}
        },30000);
        it(`audit UI: an unavailable dashboard exam clears the stale filter but network errors retain it in ${engine}`,async()=>{
            const event=await parent('筛选回退'+engine),exam=await createConcreteExam(pool(),manager,event.id,concrete('筛选回退考试'+engine));
            const browser=await(engine==='chrome'?chromium.launch({executablePath:'/usr/bin/google-chrome'}):webkit.launch()),context=await browser.newContext(),page=await context.newPage();page.setDefaultTimeout(6000);
            try{
                await context.request.post(origin+'/api/v2/auth/login',{headers:{origin},data:{username:manager.username,password:'synthetic-password-123'}});await page.goto(origin);
                const filter=page.getByRole('combobox',{name:'具体考试',exact:true});await filter.click();await page.getByRole('option',{name:'筛选回退考试'+engine,exact:true}).click();
                const url='**/api/v2/admin/dashboard?sittingId='+exam.id;let status=503;
                await page.route(url,route=>route.fulfill({status,json:{message:status===503?'合成暂时断网':'记录不存在或无权访问。'}}));
                await page.getByRole('button',{name:'刷新',exact:true}).click();await page.getByText('合成暂时断网',{exact:true}).waitFor();await browserExpect(filter).toContainText('筛选回退考试'+engine);
                status=404;await page.getByRole('button',{name:'刷新',exact:true}).click();await browserExpect(filter).toContainText('全部考试');await page.getByText('合成暂时断网',{exact:true}).waitFor({state:'hidden'});
                await page.unroute(url);
            }finally{await context.close();await browser.close();}
        },30000);
        it(`audit UI: message retries keep receipts until the content changes in ${engine}`,async()=>{
            const f=await failedQuestion('message_retry_'+engine),browser=await(engine==='chrome'?chromium.launch({executablePath:'/usr/bin/google-chrome'}):webkit.launch()),context=await browser.newContext(),page=await context.newPage();
            page.setDefaultTimeout(6000);
            const sent:{requestId:string;message:string}[]=[];
            try{
                await context.request.post(origin+'/api/v2/auth/login',{headers:{origin},data:{username:teacher.username,password:'synthetic-password-123'}});await page.goto(origin);
                await page.getByRole('navigation',{name:'管理导航'}).getByRole('button',{name:'实时跟踪',exact:true}).click();
                await page.getByRole('row').filter({hasText:f.child.displayName}).getByRole('button',{name:'查看',exact:true}).click();
                const monitor=page.getByRole('dialog',{name:f.child.displayName,exact:true});await monitor.getByRole('button',{name:'模块1 · 第2题',exact:true}).click();await monitor.getByRole('button',{name:'发消息',exact:true}).click();
                await page.route('**/api/v2/admin/slots/*/messages',async route=>{
                    const body:unknown=route.request().postDataJSON();const value=body&&typeof body==='object'&&'requestId'in body&&typeof body.requestId==='string'&&'message'in body&&typeof body.message==='string'?{requestId:body.requestId,message:body.message}:null;if(!value)throw new Error('NO_MESSAGE_BODY');sent.push(value);
                    const response=await route.fetch();if(sent.length<3){expect(response.status()).toBe(200);await route.fulfill({status:503,json:{message:'合成响应丢失'}});}else await route.fulfill({response});
                });
                const composer=page.getByRole('dialog',{name:'通知学生',exact:true});await composer.getByLabel('消息内容').fill('第一条内容');
                for(let i=0;i<2;i++){await composer.getByRole('button',{name:'发送消息',exact:true}).click();await composer.getByText('合成响应丢失',{exact:true}).waitFor();}
                expect((await teacherMessages(pool(),f.child)).items).toHaveLength(1);expect(sent[0]?.requestId).toBe(sent[1]?.requestId);
                await composer.getByLabel('消息内容').fill('修改后的第二条内容');await composer.getByRole('button',{name:'发送消息',exact:true}).click();await composer.waitFor({state:'hidden'});
                expect(sent[2]?.requestId).not.toBe(sent[0]?.requestId);expect((await teacherMessages(pool(),f.child)).items.map(item=>item.message)).toEqual(['第一条内容','修改后的第二条内容']);
            }finally{await context.close();await browser.close();}
        },30000);
    }
    for (const engine of ['chrome', 'webkit'] as const)
        it(`event UI: creates the hierarchy, edits both names and deletes concrete exams in ${engine}`, async () => {
            const browser = await (engine === 'chrome' ? chromium.launch({ executablePath: '/usr/bin/google-chrome' }) : webkit.launch()), context = await browser.newContext({ viewport: { width: 1440, height: 1000 } }), page = await context.newPage();
            page.setDefaultTimeout(6000);
            const prefix = '界面场次' + engine, errors: string[] = [];
            page.on('pageerror', error => errors.push(error.message));
            try {
                expect((await context.request.post(origin + '/api/v2/auth/login', { headers: { origin }, data: { username: manager.username, password: 'synthetic-password-123' } })).status()).toBe(200);
                await page.goto(origin);
                await page.getByRole('navigation', { name: '管理导航' }).getByRole('button', { name: '考试安排', exact: true }).click();
                await page.getByRole('button', { name: '新建场次', exact: true }).click();
                const create = page.getByRole('dialog', { name: '新建场次', exact: true });
                await create.getByLabel('场次名称', { exact: true }).fill(prefix);
                expect(await create.getByRole('combobox', { name: '学生', exact: true }).count()).toBe(0);
                await create.getByRole('button', { name: '保存场次', exact: true }).click();
                await create.waitFor({ state: 'hidden' });
                const search = page.getByRole('searchbox', { name: '搜索场次或模板', exact: true });
                await search.fill(prefix);
                await search.press('Enter');
                await page.getByRole('article', { name: prefix, exact: true }).getByRole('button', { name: '查看考试', exact: true }).click();
                await page.getByRole('button', { name: '新建具体考试', exact: true }).click();
                const concrete = page.getByRole('dialog', { name: '新建具体考试', exact: true });
                await concrete.getByLabel('考试名称', { exact: true }).fill(prefix + '正式考试');
                await concrete.getByRole('combobox', { name: '学生', exact: true }).click();
                const students = concrete.getByRole('searchbox', { name: '搜索学生', exact: true });
                await students.fill('student_two');
                await students.press('Enter');
                await concrete.getByRole('option', { name: /student_two/ }).click();
                await page.keyboard.press('Escape');
                await concrete.getByRole('combobox', { name: '负责老师', exact: true }).click();
                await concrete.getByRole('option', { name: /^teacher · teacher$/ }).click();
                await concrete.getByRole('option', { name: /teacher_two/ }).click();
                await page.keyboard.press('Escape');
                await concrete.getByRole('combobox', { name: '答案模式', exact: true }).click();
                await concrete.getByRole('option', { name: '错题模拟', exact: true }).click();
                await concrete.getByLabel('模块1模拟错题数', { exact: true }).fill('1');
                await concrete.getByRole('button', { name: '保存考试', exact: true }).click();
                await concrete.waitFor({ state: 'hidden' });
                await page.getByRole('article', { name: prefix + '正式考试', exact: true }).waitFor();
                await page.getByRole('button', { name: '编辑场次', exact: true }).click();
                const parentEdit = page.getByRole('dialog', { name: '编辑场次', exact: true });
                await parentEdit.getByLabel('场次名称', { exact: true }).fill(prefix + '已改名');
                await parentEdit.getByRole('button', { name: '保存场次', exact: true }).click();
                await parentEdit.waitFor({ state: 'hidden' });
                await page.getByRole('heading', { name: prefix + '已改名', exact: true }).waitFor();
                await page.getByRole('article', { name: prefix + '正式考试', exact: true }).getByRole('button', { name: '编辑', exact: true }).click();
                const examEdit = page.getByRole('dialog', { name: '编辑具体考试', exact: true });
                await examEdit.getByLabel('考试名称', { exact: true }).fill(prefix + '考试已改名');
                await examEdit.getByRole('button', { name: '保存考试', exact: true }).click();
                await examEdit.waitFor({ state: 'hidden' });
                const row = page.getByRole('article', { name: prefix + '考试已改名', exact: true });
                await row.waitFor();
                await row.getByRole('button', { name: '人员与错题配置', exact: true }).click();
                const allocations = page.getByRole('dialog', { name: '人员与错题配置', exact: true });
                await allocations.getByRole('row').filter({ hasText: 'student_two' }).getByRole('button', { name: '调整', exact: true }).click();
                const settings = page.getByRole('dialog', { name: '调整学生分配', exact: true });
                await browserExpect(settings.getByLabel('模块1模拟错题数', { exact: true })).toHaveValue('1');
                await settings.getByLabel('模块1模拟错题数', { exact: true }).fill('2');
                await settings.getByRole('button', { name: '保存', exact: true }).click();
                await allocations.waitFor();
                const savedParent = (await examEventPage(pool(), manager, { q: prefix })).items[0];
                if (!savedParent) throw new Error('NO_UI_EVENT');
                const savedExam = (await concreteExamPage(pool(), manager, savedParent.id, {})).items[0];
                if (!savedExam) throw new Error('NO_UI_EXAM');
                expect((await allocationPage(pool(), manager, savedExam.id, { config: '1' })).items[0]).toMatchObject({ mode: 'practice_simulation', wrongCounts: [2, 0] });
                await allocations.getByRole('button', { name: '关闭', exact: true }).click();
                const screens = join(process.cwd(), '.runtime/exam-upgrade-20261107/screens');
                await mkdir(screens, { recursive: true });
                for (const width of [320, 390, 1440])
                    for (const theme of ['light', 'dark']) {
                        await page.setViewportSize({ width, height: 1000 });
                        await page.evaluate(theme => document.documentElement.dataset.theme = theme, theme);
                        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
                        await page.screenshot({ path: join(screens, `events-${engine}-${width}-${theme}.png`), fullPage: true, animations: 'disabled' });
                    }
                await page.getByRole('button', { name: '查看场次参与人员', exact: true }).click();
                const members = page.getByRole('dialog', { name: '场次参与人员', exact: true });
                await members.getByRole('cell', { name: 'student_two', exact: true }).first().waitFor();
                await members.getByRole('combobox', { name: '人员类型', exact: true }).click();
                await members.getByRole('option', { name: '老师', exact: true }).click();
                await browserExpect(members.locator('tbody tr')).toHaveCount(2);
                await members.getByRole('button', { name: '关闭', exact: true }).click();
                await row.getByRole('button', { name: '删除', exact: true }).click();
                const deletion = page.getByRole('dialog', { name: '删除具体考试？', exact: true });
                await deletion.getByRole('button', { name: '确认删除', exact: true }).click();
                await deletion.waitFor({ state: 'hidden' });
                await page.getByText('还没有具体考试', { exact: true }).waitFor();
                await page.getByRole('button', { name: '‹ 全部场次', exact: true }).click();
                await page.getByRole('article', { name: prefix + '已改名', exact: true }).getByRole('button', { name: '删除', exact: true }).click();
                const deleteParent = page.getByRole('dialog', { name: '删除场次？', exact: true });
                await deleteParent.getByRole('button', { name: '确认删除', exact: true }).click();
                await deleteParent.waitFor({ state: 'hidden' });
                expect((await examEventPage(pool(), manager, { q: prefix })).total).toBe(0);
                expect(errors).toEqual([]);
            }
            finally {
                await context.close();
                await browser.close();
            }
        }, 35000);
    for (const engine of ['chrome', 'webkit'] as const)
        it(`teacher message UI: sends without a choice and student can open the exact question in ${engine}`, async () => {
            const f = await failedQuestion(engine), browser = await (engine === 'chrome' ? chromium.launch({ executablePath: '/usr/bin/google-chrome' }) : webkit.launch());
            const staff = await browser.newContext({ viewport: { width: 1440, height: 1000 } }), pupil = await browser.newContext({ viewport: { width: 390, height: 844 } }), t = await staff.newPage(), s = await pupil.newPage(), errors: string[] = [];
            t.on('pageerror', error => errors.push(error.message));
            s.on('pageerror', error => errors.push(error.message));
            t.setDefaultTimeout(10000);
            s.setDefaultTimeout(10000);
            try {
                for (const [context, username] of [[staff, teacher.username], [pupil, f.child.username]] as const) {
                    expect((await context.request.post(origin + '/api/v2/auth/login', { headers: { origin }, data: { username, password: 'synthetic-password-123' } })).status()).toBe(200);
                }
                await t.goto(origin);
                await t.getByRole('navigation', { name: '管理导航' }).getByRole('button', { name: '实时跟踪', exact: true }).click();
                await t.getByRole('row').filter({ hasText: f.child.displayName }).getByRole('button', { name: '查看', exact: true }).click();
                const monitor = t.getByRole('dialog', { name: f.child.displayName, exact: true });
                await monitor.getByRole('button', { name: '模块1 · 第2题', exact: true }).click();
                await monitor.getByRole('button', { name: '发消息', exact: true }).click();
                const composer = t.getByRole('dialog', { name: '通知学生', exact: true });
                expect(await composer.locator('input[type=radio]').count()).toBe(0);
                await composer.getByLabel('消息内容', { exact: true }).fill('请重新拍摄完整表格，暂时不要重新解答。');
                await composer.getByRole('button', { name: '发送消息', exact: true }).click();
                await composer.waitFor({ state: 'hidden' });
                await s.goto(origin);
                const notice = s.getByRole('region', { name: '老师消息', exact: true });
                await notice.waitFor();
                await s.getByRole('button',{name:'账户菜单',exact:true}).click();await s.getByRole('menuitem',{name:'考试记录',exact:true}).click();await s.getByRole('heading',{name:'考试记录',exact:true}).waitFor();
                await s.route('**/api/v2/me/assignments/page?**',async route=>{if(new URL(route.request().url()).searchParams.get('q')==='合成列表故障')await route.fulfill({status:503,json:{message:'合成列表读取失败'}});else await route.continue();});
                const historySearch=s.getByRole('searchbox',{name:'搜索考试名称'});await historySearch.fill('合成列表故障');await historySearch.press('Enter');await s.getByText('合成列表读取失败',{exact:true}).waitFor();await browserExpect(notice).toBeVisible();
                await s.unroute('**/api/v2/me/assignments/page?**');
                let moves=0;
                await s.route('**/api/v2/attempts/*/navigation',async route=>{if(route.request().method()==='POST'){moves++;if(moves===1){await route.fulfill({status:503,json:{message:'合成定位失败'}});return;}}await route.continue();});
                await notice.getByText('老师消息 · 1 条', { exact: true }).click();
                await notice.getByRole('button').first().click();
                const message = s.getByRole('dialog', { name: '老师消息', exact: true });
                await message.getByText('请重新拍摄完整表格，暂时不要重新解答。', { exact: true }).waitFor();
                const screens = join(process.cwd(), '.runtime/exam-upgrade-20261107/screens');
                await mkdir(screens, { recursive: true });
                for (const theme of ['light', 'dark']) {
                    await s.evaluate(theme => document.documentElement.dataset.theme = theme, theme);
                    await s.mouse.move(0, 0);
                    const surfaces = await notice.evaluate(element => {
                        const summary = element.querySelector('summary');
                        if (!summary) throw new Error('MISSING_MESSAGE_SUMMARY');
                        return [getComputedStyle(element).backgroundColor, getComputedStyle(summary).backgroundColor];
                    });
                    expect(surfaces[1]).toBe(surfaces[0]);
                    await s.screenshot({ path: join(screens, `message-${engine}-${theme}.png`), animations: 'disabled' });
                    expect(await s.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
                }
                await message.getByRole('button', { name: '查看本题', exact: true }).click();
                const retry=s.getByRole('button',{name:'重新定位消息题目',exact:true});await retry.waitFor();expect(moves).toBe(1);await retry.click();
                await s.getByRole('heading', { name: '第2题答案', exact: true }).waitFor();
                await browserExpect(notice).toHaveCount(0);
                expect((await snapshot(pool(), f.child, f.attempt.id)).alerts).toEqual(f.before.alerts);
                expect(ExamTeacherMessagesSchema.parse(await (await pupil.request.get(origin + '/api/v2/me/messages')).json()).items).toEqual([]);
                expect(errors).toEqual([]);
            }
            finally {
                await staff.close();
                await pupil.close();
                await browser.close();
            }
        }, 30000);
});
