import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { randomUUID, createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, rm, mkdir, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
import { serve } from '@hono/node-server';
import { Server, createServer, request as proxyRequest } from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium, webkit, type Page, type Locator } from '@playwright/test';
import { WebSocket as NodeWebSocket } from 'ws';
import { realtime } from './realtime.js';
import { processJob, modelSolver } from './worker.js';
import { WebStoredModelsSchema } from '@solveflow/contracts/local';
import { collectGarbage } from './maintenance.js';
import { seedV3Attempt } from './legacy-attempt.test-support.js';
import { one, connectDatabase, migrate, bootstrap, createTemplate, createUser, createSitting, createAssignment, startAttempt, enterModule, snapshot, submit, claimJob, heartbeatJob, finishJob, slotDetail, cancelJob, recoverJobs, admitCall, settleCall, publishDraft, readAnswerRevision, events, updateUser, templates, teacherRun, teacherConfirm, deferSlot, jobVerificationTarget, progress, navigateAttempt } from '@solveflow/db';
import { SolveOutcomeSchema, AnswerCandidateSchema } from '@solveflow/contracts/agent';
import { ExamStudentRunSchema, ExamAssignmentSchema, ExamAssignmentPageSchema, ExamSessionSchema, ExamUserSchema, ExamProgressSchema, ExamDashboardSchema, ExamAttemptSchema, ExamNavigationSchema, type ExamUser } from '@solveflow/contracts/managed-exam';
import sharp from 'sharp';
import { build } from 'esbuild';
import { createExamService, hashPassword } from './service.js';
import { LocalExamStorage } from './storage.js';
import { upload } from './images.js';
async function enlargePicture(viewer: Locator) {
    const viewport = viewer.getByLabel('题目原图查看区域');
    await viewport.focus(); await viewport.press('+');
}
const url = process.env.SOLVEFLOW_EXAM_TEST_DATABASE_URL;
if (url) {
    const parsed = new URL(url);
    if (parsed.hostname !== '127.0.0.1' || !/^\/solveflow_exam_test_[a-f0-9]{12}$/.test(parsed.pathname))
        throw new Error('ISOLATED_EXAM_TEST_DATABASE_REQUIRED');
}
const db = url ? connectDatabase(url) : null;
function pool() {
    if (!db)
        throw new Error('ISOLATED_DATABASE_REQUIRED');
    return db.pool;
}
let root = '', storage: LocalExamStorage, service: ReturnType<typeof createExamService>, admin: ExamUser, student: ExamUser, other: ExamUser, support: ExamUser, templateId = '', sittingId = '', assignmentId = '', attemptId = '', otherAttemptId = '', image: Buffer, password = '';
const origin = 'http://127.0.0.1:3190';
const legacyOwnerId = randomUUID();
const outcome = () => SolveOutcomeSchema.parse({ schemaVersion: 1, status: 'completed', verified: false, verification: null, warning: null, verificationStatus: 'not_requested', candidate: { schemaVersion: 1, kind: 'answer', problem: { text: 'What is 2 + 2?', subject: 'math', uncertainties: [], response: { type: 'single-choice' }, options: [{ label: 'A', text: '3' }, { label: 'B', text: '4' }, { label: 'C', text: '5' }, { label: 'D', text: '6' }] }, selectedOptions: ['B'], answer: 'B. 4', steps: [], knowledgePoints: [], citationIds: [], clarificationQuestions: [] } });
async function json(path: string, cookie = '', method = 'GET', body?: unknown) { return service.app.request('/api/v2' + path, { method, headers: { origin, cookie, 'x-test-ip': randomUUID(), ...body ? { 'content-type': 'application/json' } : {} }, ...body ? { body: JSON.stringify(body) } : {} }); }
async function login(username: string) { const response = await json('/auth/login', '', 'POST', { username, password: 'synthetic-password-123' }); expect(response.status).toBe(200); ExamSessionSchema.parse(await response.json()); return response.headers.get('set-cookie')?.split(';')[0] ?? ''; }
async function asset(slotId: string, user = student) { return (await upload(pool(), storage, user, slotId, randomUUID(), image)).id; }
async function adminNavigate(page: Page, title: string) {
    await page.locator('nav[aria-label="管理导航"]').first().waitFor({state:'attached'});
    const button=page.getByRole('navigation',{name:'管理导航'}).getByRole('button',{name:title,exact:true});
    if (!await button.isVisible()) await page.getByRole('button',{name:'展开导航',exact:true}).click();
    await button.click();
}
async function browserHarness(contents: string) {
    const result = await build({ stdin: { contents: `import './src/browser/styles.css';import './src/browser/review.css';import './src/browser/notifications.css';import './src/browser/console.css';import './src/browser/home.css';import './src/browser/paging.css';import './src/browser/practice.css';import './src/browser/exam-clock.css';import './src/browser/design.css';${contents}`, resolveDir: join(process.cwd(), 'apps/exam-web'), loader: 'tsx' }, outfile: 'harness.js', bundle: true, write: false, platform: 'browser', jsx: 'automatic', format: 'esm', loader: { '.woff2': 'dataurl', '.woff': 'dataurl', '.ttf': 'dataurl', '.svg': 'dataurl' }, define: { 'process.env.NODE_ENV': '"production"' } });
    const js = result.outputFiles.find(file => file.path.endsWith('.js'))?.text;
    const css = result.outputFiles.find(file => file.path.endsWith('.css'))?.text;
    if (!js || !css) throw new Error('MISSING_BROWSER_HARNESS');
    return { js, css, html: '<meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/harness.css"><div id="root"></div><script type="module" src="/harness.js"></script>' };
}
function interceptClientQueries(intercept: (sql: string, perform: () => Promise<unknown>) => Promise<unknown>) {
    return new Proxy(pool(), { get(target, property) {
        if (property === 'connect') return async () => {
            const client = await target.connect();
            return new Proxy(client, { get(c, p) {
                if (p === 'query') return (...args: unknown[]) => intercept(typeof args[0] === 'string' ? args[0] : '', () => Reflect.apply(c.query, c, args));
                const value: unknown = Reflect.get(c, p); return typeof value === 'function' ? value.bind(c) : value;
            } });
        };
        const value: unknown = Reflect.get(target, property); return typeof value === 'function' ? value.bind(target) : value;
    } });
}
async function queuedReviewSlot(username: string) {
    const child = await createUser(pool(), admin, { username, displayName: '保存故障回归', password: 'synthetic-password-123', roles: ['student'] }, password);
    const assignment = await createAssignment(pool(), admin, { sittingId, studentId: child.id });
    const attempt = await startAttempt(pool(), child, assignment.id);
    const slot = (await snapshot(pool(), child, attempt.id)).slots[0];
    if (!slot) throw new Error('NO_SLOT');
    const run = await submit(pool(), child, slot.id, { requestId: randomUUID(), expectedRevision: 0, kind: 'initial', assetIds: [await asset(slot.id, child)] });
    return { child, slot, run, attemptId: attempt.id };
}
describe.skipIf(!url)('managed exams isolated transactions and HTTP', () => {
    beforeAll(async () => {
        await pool().query('CREATE TABLE solveflow_migrations(version integer PRIMARY KEY,hash text NOT NULL,applied_at timestamptz NOT NULL DEFAULT now())');
        for (const [version, file] of [[1, '0001_initial.sql'], [2, '0002_run_context.sql'], [3, '0003_managed_exams.sql']] as const) {
            const sql = await readFile(join(process.cwd(), 'packages/db/migrations', file), 'utf8');
            await pool().query(sql);
            await pool().query('INSERT INTO solveflow_migrations(version,hash) VALUES($1,$2)', [version, createHash('sha256').update(sql).digest('hex')]);
        }
        await pool().query('INSERT INTO owners(id) VALUES($1)', [legacyOwnerId]);
        root = await mkdtemp(join(tmpdir(), 'solveflow-exam-test-'));
        storage = new LocalExamStorage(root);
        password = await hashPassword('synthetic-password-123');
        admin = await bootstrap(pool(), 'test_admin', '测试管理员', password);
        student = await createUser(pool(), admin, { username: 'student_a', displayName: '甲同学', password: 'synthetic-password-123', roles: ['student'] }, password);
        other = await createUser(pool(), admin, { username: 'student_b', displayName: '乙同学', password: 'synthetic-password-123', roles: ['student'] }, password);
        support = await createUser(pool(), admin, { username: 'support_a', displayName: '技术支持', password: 'synthetic-password-123', roles: ['support'] }, password);
        templateId = (await createTemplate(pool(), admin, { code: 'synthetic-sat', title: '合成模块', exam: 'sat', modules: [{ code: 'm1', title: '模块一', sectionCode: 'math', questionCount: 3, durationSeconds: null }, { code: 'm2', title: '模块二', sectionCode: 'math', questionCount: 2, durationSeconds: null }] })).id;
        sittingId = (await createSitting(pool(), admin, { templateId, title: '合成考试', opensAt: new Date(Date.now() - 60000).toISOString(), closesAt: new Date(Date.now() + 3600000).toISOString() })).id;
        assignmentId = (await createAssignment(pool(), admin, { sittingId, studentId: student.id, supportIds: [support.id] })).id;
        attemptId = (await seedV3Attempt(pool(), student, assignmentId, templateId)).id;
        // Populate a v3-style unverified result before applying the additive v4 migration.
        const legacyStudent = await createUser(pool(), admin, { username: 'legacy_unverified', displayName: '迁移同学', password: 'synthetic-password-123', roles: ['student'] }, password);
        const legacyAssignment = await createAssignment(pool(), admin, { sittingId, studentId: legacyStudent.id });
        const legacyAttempt = (await seedV3Attempt(pool(), legacyStudent, legacyAssignment.id, templateId)).id;
        const legacySlot = z.uuid().parse((await pool().query('SELECT id FROM exam_app.question_slots WHERE attempt_id=$1 ORDER BY ordinal LIMIT 1', [legacyAttempt])).rows[0]?.id);
        const legacyRevision = randomUUID(), legacyRun = randomUUID();
        await pool().query('INSERT INTO exam_app.question_revisions(id,slot_id,student_id,revision,reason,input_sha256,created_by,sealed_at) VALUES($1,$2,$3,1,$4,$5,$3,now())', [legacyRevision, legacySlot, legacyStudent.id, 'initial', '0'.repeat(64)]);
        await pool().query("INSERT INTO exam_app.answer_runs(id,slot_id,revision_id,student_id,client_request_id,purpose,status,input_manifest,model_policy_version,finished_at) VALUES($1,$2,$3,$4,$5,'solve','completed','{}','managed-v1',now())", [legacyRun, legacySlot, legacyRevision, legacyStudent.id, randomUUID()]);
        await pool().query('INSERT INTO exam_app.run_results(run_id,slot_id,student_id,outcome) VALUES($1,$2,$3,$4)', [legacyRun, legacySlot, legacyStudent.id, JSON.stringify(outcome())]);
        await pool().query('UPDATE exam_app.question_slots SET current_revision_id=$2,current_run_id=$3 WHERE id=$1', [legacySlot, legacyRevision, legacyRun]);
        // Old completed exams must stay ended after the timer migration, with their original duration.
        const legacyEnd = await one(pool(), z.string(), `UPDATE exam_app.exam_attempts SET state='completed',started_at=now()-interval '10 minutes',finished_at=now()-interval '5 minutes' WHERE id=$1 RETURNING to_jsonb(finished_at)#>>'{}' AS value`, [legacyAttempt]);
        await migrate(pool());
        const migratedLegacy = await snapshot(pool(), legacyStudent, legacyAttempt);
        expect(migratedLegacy.alerts[0]?.reason).toBe('verification_unavailable');
        expect(migratedLegacy.timing).toMatchObject({ endedBy: 'system', elapsedSeconds: 300 });
        expect(Date.parse(migratedLegacy.timing.endedAt ?? '')).toBe(Date.parse(legacyEnd));
        expect((await slotDetail(pool(), admin, legacySlot)).outcome).toEqual(outcome());
        image = await sharp({ create: { width: 300, height: 200, channels: 3, background: '#fff' } }).png().toBuffer();
        service = createExamService({ pool: pool(), storage, origin, publicDir: root, clientAddress: req => req.headers.get('x-test-ip') ?? 'browser' });
        for (const role of ['solver', 'verifier'])
            await pool().query('INSERT INTO exam_app.execution_permits(role,slot_no) SELECT $1,n FROM generate_series(1,2) n', [role]);
    });
    afterAll(async () => {
        await db?.close();
        if (root)
            await rm(root, { recursive: true, force: true });
    });
    it('keeps legacy migrations intact and resume does not duplicate slots', async () => {
        expect((await startAttempt(pool(), student, assignmentId)).id).toBe(attemptId);
        expect((await snapshot(pool(), student, attemptId)).slots).toHaveLength(5);
        expect((await pool().query('SELECT count(*) FROM solveflow_migrations')).rows[0]?.count).toBe('12');
        expect((await pool().query('SELECT e.id,e.title,s.event_id FROM exam_app.exam_sittings s JOIN exam_app.exam_events e ON e.id=s.event_id WHERE s.id=$1', [sittingId])).rows[0]).toMatchObject({ id: sittingId, event_id: sittingId, title: '合成考试' });
        expect((await pool().query('SELECT count(*) FROM solveflow_migrations WHERE version<=7')).rows[0]?.count).toBe('7');
        expect((await pool().query('SELECT id FROM owners WHERE id=$1', [legacyOwnerId])).rowCount).toBe(1);
        expect((await pool().query('SELECT approved_by FROM exam_app.answer_plans WHERE attempt_id=$1', [attemptId])).rows[0]?.approved_by).toBe(admin.id);
    });
    it('enforces login, origin and assigned support scope', async () => {
        expect((await json('/session')).status).toBe(401);
        expect((await service.app.request('/api/v2/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).status).toBe(403);
        const a = await login('student_a'), b = await login('student_b'), s = await login('support_a');
        expect((await json('/attempts/' + attemptId + '/snapshot', a)).status).toBe(200);
        expect((await json('/attempts/' + attemptId + '/snapshot', b)).status).toBe(404);
        expect((await json('/attempts/' + attemptId + '/snapshot', s)).status).toBe(200);
        expect((await json('/admin/users', s)).status).toBe(404);
    });
    it('rejects time-window violations and foreign access while permitting owned future slots', async () => {
        const before = (await createSitting(pool(), admin, { templateId, title: '未来场次', opensAt: new Date(Date.now() + 3600000).toISOString(), closesAt: new Date(Date.now() + 7200000).toISOString() })).id;
        const assigned = (await createAssignment(pool(), admin, { sittingId: before, studentId: other.id })).id;
        await expect(startAttempt(pool(), other, assigned)).rejects.toThrow('时间');
        const snap = await snapshot(pool(), student, attemptId);
        const future = snap.slots[1];
        if (!future)
            throw new Error('SLOT_MISSING');
        expect(await asset(future.id)).toMatch(/^[a-f0-9-]{36}$/);
        await expect(asset(future.id, other)).rejects.toThrow('无权');
        expect((await snapshot(pool(), student, attemptId)).nextSlotId).toBe(snap.nextSlotId);
    });
    it('accepts once, reuses idempotency, rejects key/input conflicts and does not advance early', async () => {
        const snap = await snapshot(pool(), student, attemptId), slot = snap.slots[0];
        if (!slot)
            throw new Error('SLOT_MISSING');
        const id = await asset(slot.id);
        const input = { requestId: randomUUID(), expectedRevision: 0, kind: 'initial', assetIds: [id] };
        const first = await submit(pool(), student, slot.id, input);
        expect(await submit(pool(), student, slot.id, input)).toEqual(first);
        await expect(submit(pool(), student, slot.id, { ...input, kind: 'retake' })).rejects.toThrow('标识');
        expect((await snapshot(pool(), student, attemptId)).nextSlotId).toBe(slot.id);
        const cookie = await login('student_b');
        expect((await json('/media/' + id, cookie)).status).toBe(404);
        const job = await claimJob(pool());
        if (!job)
            throw new Error('JOB_MISSING');
        await finishJob(pool(), job, outcome(), null);
        const next = await snapshot(pool(), student, attemptId);
        expect(next.nextSlotId).toBe(next.slots[1]?.id);
        expect(next.viewedSlotId).toBe(slot.id);
        expect((await progress(pool(), admin)).find(p => p.assignmentId === assignmentId)?.currentPosition).toBe(1);
        expect(next.slots[0]?.presentation?.answer).toBe('B. 4');
    });
    it('supplements create versions and late results cannot overwrite newer inputs', async () => {
        const snap = await snapshot(pool(), student, attemptId), slot = snap.slots[0];
        if (!slot)
            throw new Error('SLOT_MISSING');
        const material = await asset(slot.id);
        await submit(pool(), student, slot.id, { requestId: randomUUID(), expectedRevision: 1, kind: 'supplement', assetIds: [material] });
        const stale = await claimJob(pool());
        if (!stale)
            throw new Error('JOB_MISSING');
        const newer = await asset(slot.id);
        await submit(pool(), student, slot.id, { requestId: randomUUID(), expectedRevision: 2, kind: 'retake', assetIds: [newer] });
        expect(await finishJob(pool(), stale, outcome(), null)).toBe(false);
        const current = await claimJob(pool());
        if (!current)
            throw new Error('JOB_MISSING');
        await finishJob(pool(), current, outcome(), null);
        const next = await snapshot(pool(), student, attemptId);
        expect(next.nextSlotId).toBe(snap.nextSlotId);
        expect(next.slots[0]?.revision).toBe(3);
        expect((await slotDetail(pool(), support, slot.id)).revisions).toHaveLength(3);
    });
    it('persists cancellation and rejects late completion', async () => {
        const snap = await snapshot(pool(), student, attemptId), slot = snap.slots[1];
        if (!slot)
            throw new Error('SLOT_MISSING');
        const id = await asset(slot.id);
        const input = { requestId: randomUUID(), expectedRevision: 0, kind: 'initial', assetIds: [id] };
        await submit(pool(), student, slot.id, input);
        const job = await claimJob(pool());
        if (!job)
            throw new Error('JOB_MISSING');
        await cancelJob(pool(), student, job.id);
        const cancelledSeq = (await snapshot(pool(), student, attemptId)).lastSeq;
        await cancelJob(pool(), student, job.id);
        expect((await snapshot(pool(), student, attemptId)).lastSeq).toBe(cancelledSeq);
        expect(await finishJob(pool(), job, outcome(), null)).toBe(false);
        expect((await snapshot(pool(), student, attemptId)).nextSlotId).toBe(slot.id);
    });
    it('recovers lost workers as interrupted and never requeues paid requests', async () => {
        const snap = await snapshot(pool(), student, attemptId), slot = snap.slots[1];
        if (!slot)
            throw new Error('SLOT_MISSING');
        await submit(pool(), student, slot.id, { requestId: randomUUID(), expectedRevision: 1, kind: 'retake', assetIds: [await asset(slot.id)] });
        const job = await claimJob(pool());
        if (!job)
            throw new Error('JOB_MISSING');
        await pool().query("UPDATE exam_app.answer_runs SET lease_expires_at=now()-interval '1 second' WHERE id=$1", [job.id]);
        expect(await heartbeatJob(pool(), job)).toBe(false);
        expect(await recoverJobs(pool())).toBe(1);
        expect(await claimJob(pool())).toBeNull();
        expect((await snapshot(pool(), student, attemptId)).slots[1]?.status).toBe('interrupted');
    });
    it('holds bounded call permits, counts real dispatches and does not bypass daily quotas', async () => {
        const snap = await snapshot(pool(), student, attemptId), slot = snap.slots[1];
        if (!slot)
            throw new Error('SLOT_MISSING');
        await submit(pool(), student, slot.id, { requestId: randomUUID(), expectedRevision: 2, kind: 'retake', assetIds: [await asset(slot.id)] });
        const job = await claimJob(pool());
        if (!job)
            throw new Error('JOB_MISSING');
        const limits = { solver: 1, verifier: 1, daily: 2 };
        const first = await admitCall(pool(), job, 'solver', 'synthetic', limits);
        expect(first).toBeTruthy();
        expect(await admitCall(pool(), job, 'solver', 'synthetic', limits)).toBeNull();
        if (!first)
            throw new Error('CALL_MISSING');
        await settleCall(pool(), first, true);
        const second = await admitCall(pool(), job, 'solver', 'synthetic', limits);
        if (!second)
            throw new Error('CALL_MISSING');
        await settleCall(pool(), second, true);
        await expect(admitCall(pool(), job, 'verifier', 'synthetic', limits)).rejects.toThrow('额度');
        await finishJob(pool(), job, outcome(), null);
    });
    it('returns ordered replay and invalidates sessions immediately on role changes', async () => {
        const replay = await events(pool(), support, attemptId, 0);
        expect(replay.events.length).toBeGreaterThan(4);
        expect(replay.events.map(e => e.seq)).toEqual([...replay.events.map(e => e.seq)].sort((a, b) => a - b));
        const cookie = await login('support_a');
        await updateUser(pool(), admin, support.id, { displayName: support.displayName, state: 'disabled', roles: ['support'] }, undefined);
        expect((await json('/session', cookie)).status).toBe(401);
    });
    it('keeps module completion distinct from availability and can enter the next module repeatedly', async () => {
        const snap = await snapshot(pool(), student, attemptId), slot = snap.slots[2];
        if (!slot)
            throw new Error('SLOT_MISSING');
        await submit(pool(), student, slot.id, { requestId: randomUUID(), expectedRevision: 0, kind: 'initial', assetIds: [await asset(slot.id)] });
        const job = await claimJob(pool());
        if (!job)
            throw new Error('JOB_MISSING');
        await finishJob(pool(), job, outcome(), null);
        const next = await snapshot(pool(), student, attemptId);
        expect(next.nextSlotId).toBeNull();
        expect(next.modules[1]?.state).toBe('available');
        const module = next.modules[1];
        if (!module)
            throw new Error('MODULE_MISSING');
        expect(await enterModule(pool(), student, module.id)).toEqual({ id: attemptId });
        expect(await enterModule(pool(), student, module.id)).toEqual({ id: attemptId });
        expect((await snapshot(pool(), student, attemptId)).nextSlotId).toBe(next.slots[3]?.id);
    });
    it('stores simulations separately, keeps originals immutable and hides originals from students', async () => {
        const assignment = await createAssignment(pool(), admin, { sittingId, studentId: other.id, mode: 'practice_simulation', wrongCounts: [2, 1] });
        const attempt = (await startAttempt(pool(), other, assignment.id)).id;
        otherAttemptId = attempt;
        for (let i = 0; i < 3; i++) {
            const snap = await snapshot(pool(), other, attempt), slot = snap.slots[i];
            if (!slot)
                throw new Error('SLOT_MISSING');
            await submit(pool(), other, slot.id, { requestId: randomUUID(), expectedRevision: 0, kind: 'initial', assetIds: [await asset(slot.id, other)] });
            const job = await claimJob(pool());
            if (!job)
                throw new Error('JOB_MISSING');
            await finishJob(pool(), job, outcome(), null);
        }
        const snap = await snapshot(pool(), other, attempt);
        const simulated = snap.slots.slice(0, 3).filter(s => s.presentation?.simulated);
        expect(simulated).toHaveLength(2);
        for (const slot of simulated) {
            expect(slot.presentation?.verified).toBe(false);
            expect(slot.presentation?.selectedOptions).not.toEqual(['B']);
            const own = await slotDetail(pool(), other, slot.id);
            expect(own.outcome).toBeNull();
            expect(own.problem?.text).toBe('What is 2 + 2?');
            const original = await slotDetail(pool(), admin, slot.id);
            expect(original.outcome).toEqual(outcome());
            await expect(pool().query("UPDATE exam_app.run_results SET outcome='{}'::jsonb WHERE run_id=$1", [slot.runId])).rejects.toThrow('IMMUTABLE_EXAM_RECORD');
        }
    });
    it('removes orphaned image families while protecting active jobs', async () => {
        const snap = await snapshot(pool(), student, attemptId), slot = snap.slots[3], old = snap.slots[0];
        if (!slot || !old)
            throw new Error('SLOT_MISSING');
        const protectedId = await asset(slot.id);
        await submit(pool(), student, slot.id, { requestId: randomUUID(), expectedRevision: 0, kind: 'initial', assetIds: [protectedId] });
        const orphan = await asset(old.id);
        await pool().query("UPDATE exam_app.media_assets SET created_at=now()-interval '2 days' WHERE id IN (SELECT parent_asset_id FROM exam_app.media_assets WHERE id=$1) OR parent_asset_id=(SELECT parent_asset_id FROM exam_app.media_assets WHERE id=$1)", [orphan]);
        await pool().query("UPDATE exam_app.media_assets SET retention_until=now()-interval '1 second' WHERE id IN (SELECT parent_asset_id FROM exam_app.media_assets WHERE id=$1) OR parent_asset_id=(SELECT parent_asset_id FROM exam_app.media_assets WHERE id=$1)", [protectedId]);
        expect(await collectGarbage(pool(), storage)).toBe(3);
        expect((await pool().query('SELECT state FROM exam_app.media_assets WHERE id=$1', [protectedId])).rows[0]?.state).toBe('ready');
        const job = await claimJob(pool());
        if (!job)
            throw new Error('JOB_MISSING');
        await cancelJob(pool(), student, job.id);
    });
    it('serializes competing revisions and refuses a different student image', async () => {
        const race = await createUser(pool(), admin, { username: 'race_student', displayName: '并发同学', password: 'synthetic-password-123', roles: ['student'] }, password);
        const assignment = await createAssignment(pool(), admin, { sittingId, studentId: race.id });
        const attempt = (await startAttempt(pool(), race, assignment.id)).id;
        const slot = (await snapshot(pool(), race, attempt)).slots[0];
        if (!slot)
            throw new Error('SLOT_MISSING');
        const foreignSlot = (await snapshot(pool(), other, otherAttemptId)).slots[0];
        if (!foreignSlot)
            throw new Error('SLOT_MISSING');
        const foreign = await asset(foreignSlot.id, other);
        await expect(submit(pool(), race, slot.id, { requestId: randomUUID(), expectedRevision: 0, kind: 'initial', assetIds: [foreign] })).rejects.toThrow('无权');
        const images = await Promise.all([asset(slot.id, race), asset(slot.id, race)]);
        const results = await Promise.allSettled(images.map(id => submit(pool(), race, slot.id, { requestId: randomUUID(), expectedRevision: 0, kind: 'initial', assetIds: [id] })));
        expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
        expect(results.filter(r => r.status === 'rejected')).toHaveLength(1);
        expect((await snapshot(pool(), race, attempt)).slots[0]?.revision).toBe(1);
        const run = results.find(r => r.status === 'fulfilled');
        if (run?.status === 'fulfilled')
            await cancelJob(pool(), race, run.value.runId);
    });
    it('runs the existing agent through audited solver and verifier transports without network', async () => {
        const snap = await snapshot(pool(), student, attemptId), slot = snap.slots[3];
        if (!slot)
            throw new Error('SLOT_MISSING');
        await submit(pool(), student, slot.id, { requestId: randomUUID(), expectedRevision: 1, kind: 'retake', assetIds: [await asset(slot.id)] });
        const job = await claimJob(pool());
        if (!job)
            throw new Error('JOB_MISSING');
        const profile = (model: string) => ({ provider: 'fixture', baseURL: 'https://fixture.invalid/v1', model, api: 'openai-responses', contextWindow: 32768, maxTokens: 8192, maxTokensField: 'max_tokens' });
        const models = WebStoredModelsSchema.parse({ schemaVersion: 1, models: { solver: profile('fixture-solver'), verifier: profile('fixture-verifier'), backup: null }, keys: { solver: 'synthetic-local-only', verifier: 'synthetic-local-only', backup: null } });
        let calls = 0;
        const transport: typeof fetch = async (_url, init) => {
            calls++;
            const model = z.object({ model: z.string() }).parse(JSON.parse(String(init?.body))).model;
            const base = outcome();
            if (!('candidate' in base))
                throw new Error('CANDIDATE_MISSING');
            const value = model === 'fixture-verifier' ? { schemaVersion: 1, verdict: 'pass', checked: ['transcription', 'logic'], issues: [], independentChoices: [{ selectedOptions: ['B'], decisiveEvidence: 'Two plus two equals four, the second option.' }] } : base.candidate;
            const item = { type: 'message', id: 'msg_fixture', role: 'assistant', content: [{ type: 'output_text', text: JSON.stringify(value), annotations: [] }] };
            const frames = [{ type: 'response.created', response: { id: 'resp_fixture' } }, { type: 'response.output_item.added', output_index: 0, item: { ...item, content: [] } }, { type: 'response.output_item.done', output_index: 0, item }, { type: 'response.completed', response: { id: 'resp_fixture', status: 'completed', output: [item], usage: { input_tokens: 100, output_tokens: 100, total_tokens: 200 } } }];
            return new Response(frames.map(frame => 'data: ' + JSON.stringify(frame) + '\n\n').join(''), { headers: { 'content-type': 'text/event-stream' } });
        };
        const solve = modelSolver(pool(), storage, models, { solver: 2, verifier: 2, daily: 1000 }, transport);
        const result = await solve(job, new AbortController().signal, () => { });
        expect(result.status).toBe('completed');
        expect(result.verified).toBe(true);
        expect(calls).toBe(2);
        await finishJob(pool(), job, result, null);
        const phases = (await pool().query('SELECT phase FROM exam_app.model_call_attempts WHERE run_id=$1 ORDER BY phase', [job.id])).rows.map(r => r.phase);
        expect(phases).toEqual(['solver', 'verifier']);
        expect((await pool().query('SELECT count(*) FROM exam_app.execution_permits WHERE holder_call_id IS NOT NULL')).rows[0]?.count).toBe('0');
    });
    it.each(['first_content_timeout', 'stream_idle', 'http_error'] as const)('progress: audits primary failure and releases permits after takeover: %s', async fault => {
        const queued = await queuedReviewSlot('progress_' + fault);
        const job = await claimJob(pool());
        if (!job || job.id !== queued.run.runId) throw new Error('JOB_MISSING');
        const profile = (model: string) => ({ provider: 'fixture', baseURL: 'https://fixture.invalid/v1', model, api: 'openai-completions', contextWindow: 32768, maxTokens: 8192, maxTokensField: 'max_tokens' });
        const models = WebStoredModelsSchema.parse({ schemaVersion: 1, models: { solver: profile('primary'), verifier: profile('verifier'), backup: profile('backup') }, keys: { solver: 'synthetic-local-only', verifier: 'synthetic-local-only', backup: 'synthetic-local-only' } });
        const calls: string[] = [];
        const frame = (content: string, finish: string | null = null) => 'data: ' + JSON.stringify({ id: 'fixture', choices: [{ index: 0, delta: { content }, finish_reason: finish }] }) + '\n\n';
        const network: typeof fetch = async (_url, init) => {
            const { model } = z.object({ model: z.string() }).parse(JSON.parse(String(init?.body)));
            calls.push(model);
            if (model === 'primary') {
                if (fault === 'http_error') return new Response('synthetic provider unavailable', {status: 503});
                return new Response(new ReadableStream<Uint8Array>({ start(stream) {
                    stream.enqueue(new TextEncoder().encode(fault === 'stream_idle' ? frame('{"schemaVersion":') : ': keepalive\n\n'));
                    init?.signal?.addEventListener('abort', () => stream.error(new Error('PRIVATE_STREAM_CANARY')), {once: true});
                } }), { headers: {'content-type': 'text/event-stream'} });
            }
            const base = outcome(); if (!('candidate' in base)) throw new Error('CANDIDATE_MISSING');
            const value = model === 'verifier' ? { schemaVersion: 1, verdict: 'pass', checked: ['transcription', 'logic'], issues: [], independentChoices: [{selectedOptions: ['B'], decisiveEvidence: 'Two plus two equals four, option B.'}] } : base.candidate;
            return new Response(frame(JSON.stringify(value)) + frame('', 'stop') + 'data: [DONE]\n\n', {headers: {'content-type': 'text/event-stream'}});
        };
        const solve = modelSolver(pool(), storage, models, {solver: 2, verifier: 2, daily: 1000}, network, (callback, ms) => {
            const timer = ms === (fault === 'stream_idle' ? 60_000 : 90_000) ? setTimeout(callback, 10) : null;
            return () => { if (timer !== null) clearTimeout(timer); };
        });
        const result = await solve(job, AbortSignal.timeout(5000), () => {});
        expect(result).toMatchObject({status: 'completed', verified: true});
        expect(calls).toEqual([...(fault === 'http_error' ? ['primary', 'primary'] : ['primary']), 'backup', 'verifier']);
        const rows = z.array(z.object({id:z.string(),model:z.string(),status:z.string(),error_code:z.string().nullable()})).parse((await pool().query('SELECT id,model_name AS model,status,error_code FROM exam_app.model_call_attempts WHERE run_id=$1 ORDER BY started_at', [job.id])).rows);
        const primaryError = {model: 'primary', status: 'failed', error: fault === 'http_error' ? 'HTTP_503' : fault === 'stream_idle' ? 'MODEL_STREAM_IDLE_TIMEOUT' : 'MODEL_FIRST_CONTENT_TIMEOUT'};
        expect(rows.map(row => ({model: row.model, status: row.status, error: row.error_code}))).toEqual([
            primaryError, ...(fault === 'http_error' ? [primaryError] : []),
            {model: 'backup', status: 'completed', error: null}, {model: 'verifier', status: 'completed', error: null}
        ]);
        const primary = rows[0]; if (!primary) throw new Error('PRIMARY_CALL_MISSING');
        await settleCall(pool(), primary.id, true);
        expect((await pool().query('SELECT error_code FROM exam_app.model_call_attempts WHERE id=$1', [primary.id])).rows[0]?.error_code).toBe(primary.error_code);
        expect((await pool().query('SELECT count(*) FROM exam_app.execution_permits WHERE holder_call_id IS NOT NULL')).rows[0]?.count).toBe('0');
        await finishJob(pool(), job, result, null);
    });
    it('progress: phase expiry aborts permit wait without dispatching or charging a model call', async () => {
        const queued = await queuedReviewSlot('progress_permit_wait');
        const job = await claimJob(pool()); if (!job || job.id !== queued.run.runId) throw new Error('JOB_MISSING');
        const profile = {provider:'fixture',baseURL:'https://fixture.invalid/v1',model:'fixture',api:'openai-completions',contextWindow:32768,maxTokens:8192,maxTokensField:'max_tokens'};
        const models = WebStoredModelsSchema.parse({schemaVersion:1,models:{solver:profile,verifier:profile,backup:null},keys:{solver:'synthetic-only',verifier:'synthetic-only',backup:null}});
        const windows: number[] = []; let calls = 0;
        const solve = modelSolver(pool(), storage, models, {solver:0,verifier:0,daily:1000}, async () => {calls++; throw new Error('UNEXPECTED_NETWORK');}, (callback,ms) => {
            windows.push(ms);const timer=setTimeout(callback,10);return()=>clearTimeout(timer);
        });
        const result = await solve(job, AbortSignal.timeout(5000), () => {});
        expect(result.status).toBe('failed'); expect(calls).toBe(0); expect(windows).not.toContain(90_000);
        expect((await pool().query('SELECT count(*) FROM exam_app.model_call_attempts WHERE run_id=$1', [job.id])).rows[0]?.count).toBe('0');
        await finishJob(pool(), job, result, null);
    });
    it('persists accumulating red incidents across next question, reload, retries, and scoped teacher confirmation', async () => {
        const teacher = await createUser(pool(), admin, { username: 'teacher_' + randomUUID().slice(0, 8), displayName: '负责老师', password: 'synthetic-password-123', roles: ['support'] }, password);
        const child = await createUser(pool(), admin, { username: 'review_student', displayName: '待处理同学', password: 'synthetic-password-123', roles: ['student'] }, password);
        const assigned = await createAssignment(pool(), admin, { sittingId, studentId: child.id, supportIds: [teacher.id] });
        const id = (await startAttempt(pool(), child, assigned.id)).id;
        const slots = (await snapshot(pool(), child, id)).slots;
        const first = slots[0], second = slots[1];
        if (!first || !second) throw new Error('SLOTS_MISSING');
        for (const slot of [first, second]) {
            await submit(pool(), child, slot.id, { requestId: randomUUID(), expectedRevision: 0, kind: 'initial', assetIds: [await asset(slot.id, child)] });
            const job = await claimJob(pool()); if (!job) throw new Error('JOB_MISSING');
            await finishJob(pool(), job, outcome(), null);
        }
        let snap = await snapshot(pool(), child, id);
        expect(snap.alerts.map(a => a.slotId)).toEqual([first.id, second.id]);
        expect(snap.nextSlotId).toBe(slots[2]?.id);
        const current = snap.slots[0]; if (!current) throw new Error('SLOT_MISSING');
        const review = { requestId: randomUUID(), expectedRevision: 1, expectedRunId: current.runId, answer: 'B. 4', selectedOptions: ['B'], note: '逐项核对题图，2+2=4，对应B。' };
        await expect(teacherConfirm(pool(), child, first.id, review)).rejects.toThrow('无权');
        await expect(teacherConfirm(pool(), teacher, (await snapshot(pool(), other, otherAttemptId)).slots[0]?.id ?? '', review)).rejects.toThrow('无权');
        const result = await teacherConfirm(pool(), teacher, first.id, review);
        expect(await teacherConfirm(pool(), teacher, first.id, review)).toEqual(result);
        snap = await snapshot(pool(), child, id);
        expect(snap.alerts.map(a => a.slotId)).toEqual([second.id]);
        expect(snap.slots[0]?.presentation).toMatchObject({ humanConfirmed: true, verified: false, answer: 'B. 4' });
        expect((await slotDetail(pool(), teacher, first.id)).humanReviews[0]?.note).toContain('逐项核对');
        expect((await progress(pool(), admin)).find(p => p.assignmentId === assigned.id)).toMatchObject({ humanConfirmed: 1, verified: 0, attention: 1 });
        const target = snap.slots[1]; if (!target) throw new Error('SLOT_MISSING');
        const request = { requestId: randomUUID(), expectedRevision: 1, expectedRunId: target.runId, action: 'verify' };
        const queued = await teacherRun(pool(), teacher, second.id, request);
        expect(await teacherRun(pool(), teacher, second.id, request)).toEqual(queued);
        expect((await snapshot(pool(), child, id)).alerts).toHaveLength(1);
        const verifying = await claimJob(pool()); if (!verifying) throw new Error('JOB_MISSING');
        expect(verifying.purpose).toBe('verify');
        expect((await jobVerificationTarget(pool(), verifying))?.answer).toBe('B. 4');
        // A supplement invalidates the in-flight review and does not remove the incident.
        await submit(pool(), child, second.id, { requestId: randomUUID(), expectedRevision: 1, kind: 'supplement', assetIds: [await asset(second.id, child)] });
        const pass = SolveOutcomeSchema.parse({ ...outcome(), verified: true, verificationStatus: undefined, verification: { schemaVersion: 1, verdict: 'pass', checked: ['transcription', 'logic'], issues: [] } });
        expect(await finishJob(pool(), verifying, pass, null)).toBe(false);
        await expect(teacherConfirm(pool(), teacher, second.id, { ...review, requestId: randomUUID(), expectedRunId: verifying.id })).rejects.toThrow('已更新');
        expect((await snapshot(pool(), child, id)).alerts[0]?.revision).toBe(2);
        const fresh = await claimJob(pool()); if (!fresh) throw new Error('JOB_MISSING');
        await finishJob(pool(), fresh, pass, null);
        expect((await snapshot(pool(), child, id)).alerts).toHaveLength(0);
        expect((await snapshot(pool(), child, id)).nextSlotId).toBe(slots[2]?.id);
        await expect(pool().query('UPDATE exam_app.teacher_reviews SET answer_text=$2 WHERE id=$1', [result.id, 'changed'])).rejects.toThrow('IMMUTABLE');
    });
    it('allows deferring an attempted failed question without losing red state or skipping an unphotographed one', async () => {
        const teacher = await createUser(pool(), admin, { username: 'teacher_' + randomUUID().slice(0, 8), displayName: '负责老师', password: 'synthetic-password-123', roles: ['support'] }, password);
        const child = await createUser(pool(), admin, { username: 'defer_student', displayName: '继续同学', password: 'synthetic-password-123', roles: ['student'] }, password);
        const assigned = await createAssignment(pool(), admin, { sittingId, studentId: child.id, supportIds: [teacher.id] });
        const id = (await startAttempt(pool(), child, assigned.id)).id;
        const slots = (await snapshot(pool(), child, id)).slots, first = slots[0], second = slots[1];
        if (!first || !second) throw new Error('SLOTS_MISSING');
        await submit(pool(), child, first.id, { requestId: randomUUID(), expectedRevision: 0, kind: 'initial', assetIds: [await asset(first.id, child)] });
        const job = await claimJob(pool()); if (!job) throw new Error('JOB_MISSING');
        await finishJob(pool(), job, null, 'SOLVE_FAILED');
        const input = { expectedRevision: 1, expectedRunId: job.id };
        await expect(deferSlot(pool(), child, second.id, input)).rejects.toThrow('已更新');
        await deferSlot(pool(), child, first.id, input);
        let snap = await snapshot(pool(), child, id);
        expect(snap.nextSlotId).toBe(second.id); expect(snap.alerts).toHaveLength(1); expect(snap.slots[0]?.completedOnce).toBe(false);
        await teacherConfirm(pool(), teacher, first.id, { ...input, requestId: randomUUID(), answer: '4', selectedOptions: null, note: '已根据原图人工完整解答。' });
        snap = await snapshot(pool(), child, id);
        expect(snap.alerts).toHaveLength(0); expect(snap.nextSlotId).toBe(second.id); expect(snap.slots[0]?.completedOnce).toBe(true);
        expect((await progress(pool(), admin)).find(p => p.assignmentId === assigned.id)).toMatchObject({ attention: 0, humanConfirmed: 1 });
    });
    it('permits explicitly requested teacher review after close, fences revoked teachers, and does not reopen student upload', async () => {
        const teacher = await createUser(pool(), admin, { username: 'teacher_' + randomUUID().slice(0, 8), displayName: '负责老师', password: 'synthetic-password-123', roles: ['support'] }, password);
        const child = await createUser(pool(), admin, { username: 'late_review', displayName: '收尾同学', password: 'synthetic-password-123', roles: ['student'] }, password);
        const assigned = await createAssignment(pool(), admin, { sittingId, studentId: child.id, supportIds: [teacher.id] });
        const id = (await startAttempt(pool(), child, assigned.id)).id, first = (await snapshot(pool(), child, id)).slots[0];
        if (!first) throw new Error('SLOT_MISSING');
        await submit(pool(), child, first.id, { requestId: randomUUID(), expectedRevision: 0, kind: 'initial', assetIds: [await asset(first.id, child)] });
        const job = await claimJob(pool()); if (!job) throw new Error('JOB_MISSING'); await finishJob(pool(), job, outcome(), null);
        await pool().query("UPDATE exam_app.exam_assignments SET closes_at=now()-interval '10 minutes',opens_at=now()-interval '1 hour' WHERE id=$1", [assigned.id]);
        await teacherRun(pool(), teacher, first.id, { requestId: randomUUID(), expectedRevision: 1, expectedRunId: job.id, action: 'verify' });
        const review = await claimJob(pool()); if (!review) throw new Error('JOB_MISSING'); expect(await heartbeatJob(pool(), review)).toBe(true);
        await expect(asset(first.id, child)).rejects.toThrow();
        await pool().query('UPDATE exam_app.staff_assignments SET revoked_at=now() WHERE assignment_id=$1 AND staff_id=$2', [assigned.id, teacher.id]);
        expect(await heartbeatJob(pool(), review)).toBe(false);
        expect(await finishJob(pool(), review, outcome(), null)).toBe(false);
        await recoverJobs(pool());
        expect((await snapshot(pool(), admin, id)).alerts).toHaveLength(1);
    });
    it('keeps numeric, essay and multipart responses structured, and flags a wrong module response', async () => {
        const examples = [
            { exam: 'sat', kind: 'numeric', answer: '4', extra: { responseValue: '4' }, response: { type: 'numeric', numericFormat: 'sat-spr' } },
            { exam: 'tara', kind: 'essay', answer: 'A short synthetic argument with evidence.', extra: {}, response: { type: 'essay', wordLimit: 750 } },
            { exam: 'ap', kind: 'multipart', answer: '(a) 4; (b) 8', extra: { parts: [{ label: 'a', answer: '4' }, { label: 'b', answer: '8' }] }, response: { type: 'multipart', parts: ['a', 'b'] } },
        ];
        for (const [n, example] of examples.entries()) {
            const child = await createUser(pool(), admin, { username: 'response_' + n, displayName: '题型同学', password: 'synthetic-password-123', roles: ['student'] }, password);
            const template = await createTemplate(pool(), admin, { code: 'response-' + n, title: '合成题型', exam: example.exam, modules: [{ code: 'm1', sectionCode: 'test', title: '合成模块', subject: n === 1 ? 'english' : 'math', questionCount: 1, durationSeconds: null, responseKinds: [example.kind], ...n === 1 ? { wordLimit: 750, promptChoices: 3 } : {} }] });
            const sitting = await createSitting(pool(), admin, { templateId: template.id, title: '合成题型', opensAt: new Date(Date.now() - 60000).toISOString(), closesAt: new Date(Date.now() + 3600000).toISOString() });
            const assignment = await createAssignment(pool(), admin, { sittingId: sitting.id, studentId: child.id });
            const id = (await startAttempt(pool(), child, assignment.id)).id, slot = (await snapshot(pool(), child, id)).slots[0];
            if (!slot) throw new Error('SLOT_MISSING');
            const candidate = AnswerCandidateSchema.parse({ schemaVersion: 1, kind: 'answer', problem: { text: 'Synthetic prompt', subject: n === 1 ? 'english' : 'math', uncertainties: [], response: example.response }, answer: example.answer, steps: [], knowledgePoints: [], citationIds: [], clarificationQuestions: [], ...example.extra });
            await submit(pool(), child, slot.id, { requestId: randomUUID(), expectedRevision: 0, kind: 'initial', assetIds: [await asset(slot.id, child)] });
            const job = await claimJob(pool()); if (!job) throw new Error('JOB_MISSING');
            expect(job.module.responseKinds).toEqual([example.kind]);
            const completed = SolveOutcomeSchema.parse({ schemaVersion: 1, status: 'completed', verified: false, verification: null, warning: null, verificationStatus: 'not_requested', candidate });
            await finishJob(pool(), job, completed, null);
            expect((await snapshot(pool(), child, id)).slots[0]?.presentation?.answer).toBe(example.answer);
            expect((await slotDetail(pool(), admin, slot.id)).outcome).toEqual(completed);
            // Misread a numeric/essay/FRQ as a choice: preserve the AI output for investigation,
            // but do not publish a verified single choice in an incompatible module.
            await submit(pool(), child, slot.id, { requestId: randomUUID(), expectedRevision: 1, kind: 'retake', assetIds: [await asset(slot.id, child)] });
            const wrong = await claimJob(pool()); if (!wrong) throw new Error('JOB_MISSING'); await finishJob(pool(), wrong, outcome(), null);
            const snap = await snapshot(pool(), child, id);
            expect(snap.alerts[0]?.reason).toBe('response_mismatch'); expect(snap.slots[0]?.presentation).toBeNull();
        }
    });
    it('teacher re-verification calls only the configured verifier and cannot impersonate an AI-confirmed manual answer', async () => {
        const child = await createUser(pool(), admin, { username: 'verify_only_student', displayName: '核验同学', password: 'synthetic-password-123', roles: ['student'] }, password);
        const assigned = await createAssignment(pool(), admin, { sittingId, studentId: child.id });
        const id = (await startAttempt(pool(), child, assigned.id)).id, slot = (await snapshot(pool(), child, id)).slots[0];
        if (!slot) throw new Error('SLOT_MISSING');
        await submit(pool(), child, slot.id, { requestId: randomUUID(), expectedRevision: 0, kind: 'initial', assetIds: [await asset(slot.id, child)] });
        const first = await claimJob(pool()); if (!first) throw new Error('JOB_MISSING'); await finishJob(pool(), first, outcome(), null);
        await teacherRun(pool(), admin, slot.id, { requestId: randomUUID(), expectedRevision: 1, expectedRunId: first.id, action: 'verify' });
        const job = await claimJob(pool()); if (!job) throw new Error('JOB_MISSING');
        const profile = (model: string) => ({ provider: 'fixture', baseURL: 'https://fixture.invalid/v1', model, api: 'openai-responses', contextWindow: 32768, maxTokens: 8192, maxTokensField: 'max_tokens' });
        const models = WebStoredModelsSchema.parse({ schemaVersion: 1, models: { solver: profile('fixture-solver'), verifier: profile('fixture-verifier'), backup: null }, keys: { solver: 'synthetic', verifier: 'synthetic', backup: null } });
        const calls: string[] = [];
        const transport: typeof fetch = async (_url, init) => {
            calls.push(z.object({ model: z.string() }).parse(JSON.parse(String(init?.body))).model);
            const value = { schemaVersion: 1, verdict: 'pass', checked: ['transcription', 'logic'], issues: [] };
            const item = { type: 'message', id: 'msg_fixture', role: 'assistant', content: [{ type: 'output_text', text: JSON.stringify(value), annotations: [] }] };
            const frames = [{ type: 'response.created', response: { id: 'resp_fixture' } }, { type: 'response.output_item.added', output_index: 0, item: { ...item, content: [] } }, { type: 'response.output_item.done', output_index: 0, item }, { type: 'response.completed', response: { id: 'resp_fixture', status: 'completed', output: [item], usage: { input_tokens: 100, output_tokens: 100, total_tokens: 200 } } }];
            return new Response(frames.map(f => 'data: ' + JSON.stringify(f) + '\n\n').join(''), { headers: { 'content-type': 'text/event-stream' } });
        };
        const solver = modelSolver(pool(), storage, models, { solver: 2, verifier: 2, daily: 1000 }, transport);
        const result = await solver(job, new AbortController().signal, () => {});
        expect(result.verified).toBe(true); expect(calls).toEqual(['fixture-verifier']);
        await finishJob(pool(), job, result, null);
        const snapshotAfter = await snapshot(pool(), child, id);
        expect(snapshotAfter.alerts).toHaveLength(0); expect(snapshotAfter.slots[0]?.presentation).toMatchObject({ verified: true, humanConfirmed: false });
        expect((await pool().query('SELECT phase FROM exam_app.model_call_attempts WHERE run_id=$1', [job.id])).rows.map(r => r.phase)).toEqual(['verifier']);
    });
    it('manual confirmation supersedes only its own active verification and serializes competing reviewers', async () => {
        const child = await createUser(pool(), admin, { username: 'human_race_student', displayName: '人工并发同学', password: 'synthetic-password-123', roles: ['student'] }, password);
        const assigned = await createAssignment(pool(), admin, { sittingId, studentId: child.id });
        const id = (await startAttempt(pool(), child, assigned.id)).id, slots = (await snapshot(pool(), child, id)).slots;
        const first = slots[0], second = slots[1]; if (!first || !second) throw new Error('SLOTS_MISSING');
        await submit(pool(), child, first.id, { requestId: randomUUID(), expectedRevision: 0, kind: 'initial', assetIds: [await asset(first.id, child)] });
        const completed = await claimJob(pool()); if (!completed) throw new Error('JOB_MISSING'); await finishJob(pool(), completed, outcome(), null);
        const base = { expectedRevision: 1, expectedRunId: completed.id };
        await expect(teacherConfirm(pool(), admin, first.id, { ...base, requestId: randomUUID(), answer: 'B', selectedOptions: null, note: 'missing choice' })).rejects.toThrow('原始选项');
        await teacherRun(pool(), admin, first.id, { ...base, requestId: randomUUID(), action: 'verify' });
        const active = await claimJob(pool()); if (!active) throw new Error('JOB_MISSING');
        const independent = await submit(pool(), child, second.id, { requestId: randomUUID(), expectedRevision: 0, kind: 'initial', assetIds: [await asset(second.id, child)] });
        const review = { expectedRevision: 1, expectedRunId: active.id, answer: 'B. 4', selectedOptions: ['B'], note: '确认当前图像及答案。' };
        const results = await Promise.allSettled([1, 2].map(() => teacherConfirm(pool(), admin, first.id, { ...review, requestId: randomUUID() })));
        expect(results.filter(v => v.status === 'fulfilled')).toHaveLength(1); expect(results.filter(v => v.status === 'rejected')).toHaveLength(1);
        expect(await finishJob(pool(), active, outcome(), null)).toBe(false);
        const snap = await snapshot(pool(), child, id);
        expect(snap.alerts).toHaveLength(0); expect(snap.slots[0]?.presentation?.humanConfirmed).toBe(true); expect(snap.slots[1]?.status).toBe('queued');
        expect((await slotDetail(pool(), admin, first.id)).humanReviews).toHaveLength(1);
        await cancelJob(pool(), child, independent.runId);
    });
    it('tracks jumps and skips without changing IDs, cancelling jobs, or falsely completing modules', async () => {
        const child = await createUser(pool(), admin, { username: 'navigation_student', displayName: '跳转同学', password: 'synthetic-password-123', roles: ['student'] }, password);
        const assignment = await createAssignment(pool(), admin, { sittingId, studentId: child.id });
        const id = (await startAttempt(pool(), child, assignment.id)).id, original = await snapshot(pool(), child, id);
        const first = original.slots[0], future = original.slots[4], otherModuleFirst = original.slots[3], module = original.modules[0];
        if (!first || !future || !otherModuleFirst || !module) throw new Error('SLOTS_MISSING');
        const jump = { requestId: randomUUID(), expectedVersion: 0, action: 'select_slot', slotId: future.id };
        const selected = await navigateAttempt(pool(), child, id, jump);
        expect(await navigateAttempt(pool(), child, id, jump)).toEqual(selected);
        await expect(navigateAttempt(pool(), child, id, { ...jump, slotId: first.id })).rejects.toThrow('标识');
        await expect(navigateAttempt(pool(), other, id, { ...jump, requestId: randomUUID() })).rejects.toThrow('无权');
        await submit(pool(), child, future.id, { requestId: randomUUID(), expectedRevision: 0, kind: 'initial', assetIds: [await asset(future.id, child)] });
        const job = await claimJob(pool()); if (!job) throw new Error('JOB_MISSING');
        await navigateAttempt(pool(), child, id, { requestId: randomUUID(), expectedVersion: 1, action: 'select_slot', slotId: first.id });
        await navigateAttempt(pool(), child, id, { requestId: randomUUID(), expectedVersion: 2, action: 'skip_module', moduleId: module.id });
        expect(await heartbeatJob(pool(), job)).toBe(true);
        await finishJob(pool(), job, outcome(), null);
        let snap = await snapshot(pool(), child, id);
        expect(snap.nextSlotId).toBe(otherModuleFirst.id);
        expect(snap.slots.map(q => [q.id, q.ordinal])).toEqual(original.slots.map(q => [q.id, q.ordinal]));
        expect(snap.slots.filter(q => q.skipped)).toHaveLength(3);
        expect(snap.modules.every(m => m.state !== 'completed')).toBe(true);
        expect(snap.alerts.map(a => a.slotId)).toEqual([future.id]);
        expect(snap.activity).toHaveLength(3);
        expect((await progress(pool(), admin)).find(p => p.assignmentId === assignment.id)).toMatchObject({ moduleTitle: '模块二', currentPosition: 1, skipped: 3, answered: 1, unphotographed: 4, attention: 1 });
        await navigateAttempt(pool(), child, id, { requestId: randomUUID(), expectedVersion: 3, action: 'skip_slot', slotId: otherModuleFirst.id });
        snap = await snapshot(pool(), child, id);
        expect(snap.nextSlotId).toBeNull(); expect(snap.state).toBe('in_progress'); expect(snap.slots.filter(q => q.skipped)).toHaveLength(4);
        await navigateAttempt(pool(), child, id, { requestId: randomUUID(), expectedVersion: 4, action: 'select_slot', slotId: first.id });
        const resumed = await submit(pool(), child, first.id, { requestId: randomUUID(), expectedRevision: 0, kind: 'initial', assetIds: [await asset(first.id, child)] });
        expect((await snapshot(pool(), child, id)).slots[0]?.skipped).toBe(false);
        const race = await Promise.allSettled([future.id, otherModuleFirst.id].map(slotId => navigateAttempt(pool(), child, id, { requestId: randomUUID(), expectedVersion: 5, action: 'select_slot', slotId })));
        expect(race.filter(r => r.status === 'fulfilled')).toHaveLength(1); expect(race.filter(r => r.status === 'rejected')).toHaveLength(1);
        await pool().query("UPDATE exam_app.exam_assignments SET closes_at=now()-interval '1 second' WHERE id=$1", [assignment.id]);
        await expect(navigateAttempt(pool(), child, id, { requestId: randomUUID(), expectedVersion: 6, action: 'select_slot', slotId: first.id })).rejects.toThrow('时间');
        await cancelJob(pool(), child, resumed.runId);
    });
    it('skips an active question without cancelling it and keeps the selected next slot on completion', async () => {
        const child = await createUser(pool(), admin, { username: 'skip_active_student', displayName: '跳过运行题', password: 'synthetic-password-123', roles: ['student'] }, password);
        const assignment = await createAssignment(pool(), admin, { sittingId, studentId: child.id });
        const id = (await startAttempt(pool(), child, assignment.id)).id, before = await snapshot(pool(), child, id), first = before.slots[0];
        if (!first) throw new Error('SLOT_MISSING');
        await submit(pool(), child, first.id, { requestId: randomUUID(), expectedRevision: 0, kind: 'initial', assetIds: [await asset(first.id, child)] });
        const job = await claimJob(pool()); if (!job) throw new Error('JOB_MISSING');
        await navigateAttempt(pool(), child, id, { requestId: randomUUID(), expectedVersion: 0, action: 'skip_slot', slotId: first.id });
        expect(await heartbeatJob(pool(), job)).toBe(true);
        expect((await snapshot(pool(), child, id)).slots[0]?.skipped).toBe(true);
        await finishJob(pool(), job, outcome(), null);
        const after = await snapshot(pool(), child, id);
        expect(after.nextSlotId).toBe(before.slots[1]?.id);
        expect(after.slots[0]).toMatchObject({ completedOnce: true, skipped: false });
        expect(after.alerts[0]?.slotId).toBe(first.id);
    });
    it('runs bundled migration and bootstrap without replacing existing credentials', async () => {
        const config = join(root, 'private-config.json');
        await writeFile(config, JSON.stringify({ schemaVersion: 1, origin, databaseUrl: url, storage: { type: 'local', root: join(root, 'entry-images') }, liveCalls: false }), { mode: 0o600 });
        const before = (await pool().query('SELECT password_hash FROM exam_app.users WHERE id=$1', [admin.id])).rows[0]?.password_hash;
        for (const role of ['migrate', 'bootstrap']) {
            const result = await promisify(execFile)(process.execPath, [join(process.cwd(), 'apps/exam-web/dist/server.mjs')], { env: { ...process.env, SOLVEFLOW_EXAM_CONFIG: config, SOLVEFLOW_EXAM_ROLE: role }, timeout: 15000 });
            expect(result.stderr).toBe('');
            expect(result.stdout).toContain('complete');
        }
        expect((await pool().query('SELECT password_hash FROM exam_app.users WHERE id=$1', [admin.id])).rows[0]?.password_hash).toBe(before);
    });
    it('runs the real mobile browser flow with a fake worker and restores after refresh', async () => {
        const child = await createUser(pool(), admin, { username: 'browser_student', displayName: '浏览器同学', password: 'synthetic-password-123', roles: ['student'] }, password);
        const browserSitting=await createSitting(pool(),admin,{templateId,title:'浏览器端到端场次',opensAt:new Date(Date.now()-60000).toISOString(),closesAt:new Date(Date.now()+3600000).toISOString()});
        const assigned = await createAssignment(pool(), admin, { sittingId:browserSitting.id, studentId: child.id });
        let live: ReturnType<typeof createExamService> | undefined;
        const server = serve({ fetch: request => live ? live.app.fetch(request) : new Response(null, { status: 503 }), hostname: '127.0.0.1', port: 0 });
        if (!(server instanceof Server))
            throw new Error('TEST_HTTP_SERVER_REQUIRED');
        await new Promise<void>(resolve => server.listening ? resolve() : server.once('listening', () => resolve()));
        const address = server.address();
        if (!address || typeof address === 'string')
            throw new Error('TEST_PORT_MISSING');
        const localOrigin = 'http://127.0.0.1:' + address.port;
        let failUpload = true;
        const browserStorage = { get: storage.get.bind(storage), remove: storage.remove.bind(storage), close: () => { }, async put(key: string, data: Uint8Array) { if (failUpload) {
                failUpload = false;
                throw new Error('SYNTHETIC_STORAGE_FAILURE');
            } await storage.put(key, data); } };
        live = createExamService({ pool: pool(), storage: browserStorage, origin: localOrigin, publicDir: join(process.cwd(), 'apps/exam-web/dist/public'), clientAddress: () => 'browser-' + child.id });
        const closeWs = realtime(server, pool(), localOrigin, live.session);
        const browser = await chromium.launch({ executablePath: process.env.SOLVEFLOW_TEST_CHROME ?? '/usr/bin/google-chrome', headless: true });
        const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
        const page = await context.newPage();
        page.setDefaultTimeout(5000);
        const errors: string[] = [];
        let step = 'login';
        page.on('pageerror', error => errors.push(error.message));
        const stop = new AbortController();
        const worker = (async () => {
            while (!stop.signal.aborted) {
                await processJob(pool(), async () => { await delay(200); return outcome(); }, stop.signal);
                await delay(50);
            }
        })();
        try {
            await page.goto(localOrigin);
            await page.getByLabel('用户名', { exact: true }).fill('browser_student');
            await page.getByLabel('密码', { exact: true }).fill('synthetic-password-123');
            await page.getByRole('button', { name: '登录', exact: true }).click();
            step = 'capture';
            await page.getByRole('button', { name: '拍摄第1题', exact: true }).waitFor();
            step = 'skip-and-jump';
            await page.getByRole('button', { name: '下一题', exact: true }).click();
            await page.getByRole('button', { name: '拍摄第2题', exact: true }).waitFor();
            await page.getByRole('button', { name: '下一题', exact: true }).click();
            await page.getByRole('button', { name: '拍摄第3题', exact: true }).waitFor();
            await page.getByRole('navigation', { name: '考试模块' }).getByRole('button', { name: '模块二', exact: true }).click();
            await page.getByRole('button', { name: '总览', exact: true }).click();
            await page.getByRole('dialog').getByRole('button', { name: '第2题', exact: true }).click();
            await page.getByRole('dialog').waitFor({ state: 'hidden' });
            const jumpedId = (await startAttempt(pool(), child, assigned.id)).id;
            const jumped = await snapshot(pool(), child, jumpedId);
            expect(jumped.nextSlotId).toBe(jumped.slots[4]?.id);
            expect((await progress(pool(), admin)).find(p => p.assignmentId === assigned.id)).toMatchObject({ currentPosition: 2, moduleTitle: '模块二', skipped: 0, answered: 0 });
            await page.reload();
            await page.getByRole('button', { name: '拍摄第2题', exact: true }).waitFor();
            expect(await page.getByRole('button',{name:'模块操作',exact:true}).count()).toBe(0);
            await page.getByRole('navigation', { name: '考试模块' }).getByRole('button', { name: '模块一', exact: true }).click();
            await page.getByRole('button', { name: '总览', exact: true }).click();
            const jumpDialog = page.getByRole('dialog');
            expect(await jumpDialog.getByRole('button', { name: '第1题', exact: true }).isEnabled()).toBe(true);
            const navigationScreens = join(process.cwd(), '.runtime/managed-exams-browser');
            await mkdir(navigationScreens, { recursive: true });
            await page.screenshot({ path: join(navigationScreens, 'navigation-workbench-light.png'), fullPage: true, animations: 'disabled' });
            await jumpDialog.getByRole('button', { name: '第1题', exact: true }).click();
            await jumpDialog.waitFor({ state: 'hidden' });
            expect(await page.getByRole('button', { name: '拍摄第1题', exact: true }).isVisible()).toBe(true);
            const chooser = page.waitForEvent('filechooser');
            await page.getByRole('button', { name: '拍摄第1题', exact: true }).click();
            await (await chooser).setFiles({ name: 'synthetic.png', mimeType: 'image/png', buffer: image });
            await page.getByRole('button', { name: '保存并解答', exact: true }).click();
            await page.getByRole('dialog').getByRole('alert').waitFor();
            await page.getByRole('button', { name: '保存并解答', exact: true }).click();
            step = 'answer-and-manual-next';
            await page.locator('.current-answer').getByText('B. 4', { exact: true }).waitFor({ timeout: 10000 });
            expect(await page.locator('.capture-box > .section-head h2').innerText()).toBe('第1题');
            await page.getByRole('button', { name: '下一题', exact: true }).click();
            await page.getByRole('button', { name: '拍摄第2题', exact: true }).waitFor();
            await page.getByRole('button', { name: '下一题', exact: true }).click();
            await page.getByRole('button', { name: '拍摄第3题', exact: true }).waitFor();
            expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
            await page.getByRole('region', { name: '待处理核验问题' }).getByText('待处理 · 1 题', { exact: true }).waitFor();
            step = 'reload';
            await page.routeWebSocket('**/ws', socket => socket.close());
            await page.reload();
            await page.getByRole('button', { name: '拍摄第3题', exact: true }).waitFor();
            await page.getByRole('region', { name: '待处理核验问题' }).getByText('待处理 · 1 题', { exact: true }).waitFor();
            step = 'supplement';
            await page.getByRole('button', { name: '总览', exact: true }).click();
            await page.getByRole('dialog').getByRole('button', { name: '第1题', exact: true }).click();
            const materialChooser = page.waitForEvent('filechooser');
            await page.getByRole('button', { name: '补图', exact: true }).click();
            await (await materialChooser).setFiles({ name: 'material.png', mimeType: 'image/png', buffer: image });
            await page.getByRole('button', { name: '保存并解答', exact: true }).click();
            await page.getByRole('button', { name: '总览', exact: true }).click();
            await page.getByRole('dialog').getByRole('button', { name: '第3题', exact: true }).click();
            await page.getByRole('button', { name: '拍摄第3题', exact: true }).waitFor();
            const current = (await startAttempt(pool(), child, assigned.id)).id;
            await expect.poll(async () => (await snapshot(pool(), child, current)).slots[0]?.status, { timeout: 10000 }).toBe('completed');
            expect(await page.locator('.current-answer').getByText('B. 4', { exact: true }).count()).toBe(0);
            const snap = await snapshot(pool(), child, current);
            expect(snap.slots[0]?.revision).toBe(2);
            expect(snap.nextSlotId).toBe(snap.slots[2]?.id);
            expect(errors).toEqual([]);
            const screens = join(process.cwd(), '.runtime/managed-exams-browser');
            await mkdir(screens, { recursive: true });
            await page.screenshot({ path: join(screens, 'navigation-student-light.png'), fullPage: true });
            await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
            await page.screenshot({ path: join(screens, 'navigation-student-dark.png'), fullPage: true });
            // This scenario owns its three online participants; earlier tests may be older than the presence TTL.
            for(const n of [1,2]){const observer=await createUser(pool(),admin,{username:'browser_observer_'+n,displayName:'在线观察'+n,password:'synthetic-password-123',roles:['student']},password);await createAssignment(pool(),admin,{sittingId:browserSitting.id,studentId:observer.id});await login(observer.username);}
            const staffContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
            const managerPage = await staffContext.newPage();
            await managerPage.goto(localOrigin);
            await managerPage.getByLabel('用户名', { exact: true }).fill('test_admin');
            await managerPage.getByLabel('密码', { exact: true }).fill('synthetic-password-123');
            await managerPage.getByRole('button', { name: '登录', exact: true }).click();
            await managerPage.getByRole('main',{name:'看板首页',exact:true}).waitFor();
            await managerPage.getByRole('combobox',{name:'具体考试',exact:true}).click();
            const filtered=managerPage.waitForResponse(response=>{const url=new URL(response.url());return url.pathname==='/api/v2/admin/dashboard'&&url.searchParams.get('sittingId')===browserSitting.id;});
            await managerPage.getByRole('option',{name:'浏览器端到端场次',exact:true}).click();expect((await filtered).status()).toBe(200);
            await managerPage.getByText('3 位在线', { exact: true }).waitFor();
            await managerPage.setViewportSize({ width: 1440, height: 1000 });
            await managerPage.screenshot({ path: join(screens, 'navigation-admin-light.png'), fullPage: true });
            step = 'teacher-intervention';
            await adminNavigate(managerPage,'待处理题');
            await managerPage.getByRole('region', { name: '待处理题队列' }).locator('.issue-row').filter({hasText:'浏览器同学'}).first().click();
            const monitor = managerPage.getByRole('dialog');
            await monitor.getByRole('region', { name: '待处理核验问题' }).locator('summary').click();
            await monitor.getByRole('region', { name: '待处理核验问题' }).locator('.alert-links button').first().click();
            await monitor.getByRole('tab', { name: '手动作答', exact: true }).click();
            await monitor.getByLabel('处理意见', { exact: true }).fill('核对原图，正确答案为B。');
            await managerPage.screenshot({ path: join(screens, 'navigation-teacher-review.png'), fullPage: true });
            await monitor.getByRole('button', { name: '保存并通知学生', exact: true }).click();
            await monitor.getByRole('region', { name: '待处理核验问题' }).waitFor({ state: 'hidden', timeout: 10000 });
            await page.getByRole('region', { name: '待处理核验问题' }).waitFor({ state: 'hidden', timeout: 10000 });
            const resolved = page.getByRole('dialog', { name: '答案已更新', exact: true });
            await resolved.locator('.alert-links button').first().click();
            await page.getByRole('dialog').getByText('老师已确认', { exact: true }).waitFor();
            await monitor.getByRole('button', { name: '关闭', exact: true }).click();
            await adminNavigate(managerPage,'考试安排');
            await managerPage.setViewportSize({ width: 390, height: 844 });
            await managerPage.getByRole('tab',{name:'考试模板',exact:true}).click();
            await managerPage.getByRole('button', { name: '选择考试模板', exact: true }).waitFor();
            await managerPage.screenshot({ path: join(screens, 'template-toolbar-mobile.png'), fullPage: true, animations: 'disabled' });
            await managerPage.getByRole('button', { name: '选择考试模板', exact: true }).click();
            const picker = managerPage.getByRole('dialog');
            await picker.getByRole('combobox', { name: '考试及版本', exact: true }).click();
            await picker.getByRole('listbox').press('End');
            await picker.getByRole('listbox').press('Escape');
            expect(await picker.isVisible()).toBe(true);
            expect(await picker.getByRole('listbox').count()).toBe(0);
            await picker.getByRole('combobox', { name: '考试及版本', exact: true }).click();
            const listBox = await picker.getByRole('listbox').boundingBox();
            expect(listBox && listBox.x >= 0 && listBox.x + listBox.width <= 391 && listBox.y >= 0 && listBox.y + listBox.height <= 845).toBe(true);
            await managerPage.screenshot({ path: join(screens, 'navigation-template-picker.png'), fullPage: true, animations: 'disabled' });
            await picker.getByRole('option', { name: 'ACT · 新版', exact: true }).click();
            await picker.getByLabel('Science · 40题 / 40分钟', { exact: true }).check();
            await picker.getByRole('button', { name: '添加模板', exact: true }).click();
            await picker.waitFor({ state: 'hidden' });
            await adminNavigate(managerPage,'用户管理');
            await managerPage.getByRole('region', { name: '用户列表', exact: true }).getByRole('table').waitFor();
            await managerPage.screenshot({ path: join(screens, 'user-toolbar-mobile.png'), fullPage: true, animations: 'disabled' });
            await managerPage.setViewportSize({ width: 1440, height: 1000 });
            await managerPage.screenshot({ path: join(screens, 'user-toolbar-desktop.png'), fullPage: true, animations: 'disabled' });
            await managerPage.setViewportSize({ width: 390, height: 844 });
            await managerPage.getByRole('button', { name: '新建用户' }).click();
            await managerPage.getByLabel('姓名', { exact: true }).fill('界面同学');
            await managerPage.getByLabel('用户名', { exact: true }).fill('ui_student');
            await managerPage.getByLabel('密码', { exact: true }).fill('synthetic-password-123');
            await managerPage.getByRole('button', { name: '保存', exact: true }).click();
            await adminNavigate(managerPage,'用户管理');
            await managerPage.getByText('界面同学', { exact: true }).waitFor();
            expect(await managerPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        }
        catch (error) {
            const folder = join(process.cwd(), '.runtime/managed-exams-browser');
            await mkdir(folder, { recursive: true });
            await page.screenshot({ path: join(folder, 'failure.png'), fullPage: true });
            await writeFile(join(folder, 'failure.json'), JSON.stringify({ step, errors, text: await page.locator('body').innerText() }, null, 2));
            throw error;
        }
        finally {
            stop.abort();
            await worker;
            await browser.close();
            closeWs();
            server.closeAllConnections();
            await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
        }
    }, 30000);
    it('regression: an expired incomplete attempt must not block the next assigned exam', async () => {
        const child = await createUser(pool(), admin, { username: 'review_expired', displayName: 'Review expired', password: 'synthetic-password-123', roles: ['student'] }, password);
        const first = await createAssignment(pool(), admin, { sittingId, studentId: child.id });
        const old = await startAttempt(pool(), child, first.id);
        const oldSlot = (await snapshot(pool(), child, old.id)).slots[0];
        if (!oldSlot) throw new Error('NO_SLOT');
        await submit(pool(), child, oldSlot.id, { requestId: randomUUID(), expectedRevision: 0, kind: 'initial', assetIds: [await asset(oldSlot.id, child)] });
        const accepted = await claimJob(pool());
        if (!accepted || accepted.slotId !== oldSlot.id) throw new Error('WRONG_JOB');
        await pool().query("UPDATE exam_app.exam_assignments SET closes_at=now()-interval '1 second' WHERE id=$1", [first.id]);
        const nextSitting = await createSitting(pool(), admin, { templateId, title: 'Review next', opensAt: new Date(Date.now()-10000).toISOString(), closesAt: new Date(Date.now()+3600000).toISOString() });
        const next = await createAssignment(pool(), admin, { sittingId: nextSitting.id, studentId: child.id });
        const started = await startAttempt(pool(), child, next.id);
        expect((await snapshot(pool(), child, old.id)).state).toBe('closed');
        expect((await snapshot(pool(), child, started.id)).state).toBe('in_progress');
        expect(await finishJob(pool(), accepted, outcome(), null)).toBe(true);
        const closed = await snapshot(pool(), child, old.id);
        expect(closed.state).toBe('closed');
        expect(closed.alerts).toHaveLength(1);
        const current = closed.slots[0]; if (!current) throw new Error('NO_SLOT');
        const review = await teacherRun(pool(), admin, current.id, { requestId: randomUUID(), expectedRevision: current.revision, expectedRunId: current.runId, action: 'verify' });
        const reviewing = await claimJob(pool()); if (!reviewing || reviewing.id !== review.id) throw new Error('WRONG_JOB');
        expect(await finishJob(pool(), reviewing, outcome(), null)).toBe(true);
        await expect(teacherConfirm(pool(), admin, current.id, { requestId: randomUUID(), expectedRevision: current.revision, expectedRunId: review.id, answer: 'B. 4', selectedOptions: ['B'], note: '已检查过期考试的答案。' })).resolves.toHaveProperty('id');
        expect((await snapshot(pool(), child, old.id)).alerts).toHaveLength(0);
        const freshSlot = (await snapshot(pool(), child, started.id)).slots[0]; if (!freshSlot) throw new Error('NO_SLOT');
        await expect(submit(pool(), child, oldSlot.id, { requestId: randomUUID(), expectedRevision: 1, kind: 'supplement', assetIds: [await asset(freshSlot.id, child)] })).rejects.toThrow('时间');
    });
    it('regression: live exams remain exclusive and competing starts after expiry serialize', async () => {
        const child = await createUser(pool(), admin, { username: 'review_exclusive', displayName: '考试互斥回归', password: 'synthetic-password-123', roles: ['student'] }, password);
        const first = await createAssignment(pool(), admin, { sittingId, studentId: child.id });
        const old = await startAttempt(pool(), child, first.id);
        const next = await createSitting(pool(), admin, { templateId, title: '并行入口回归', opensAt: new Date(Date.now()-10000).toISOString(), closesAt: new Date(Date.now()+3600000).toISOString() });
        const second = await createAssignment(pool(), admin, { sittingId: next.id, studentId: child.id });
        await expect(startAttempt(pool(), child, second.id)).rejects.toThrow('当前进行中');
        await pool().query("UPDATE exam_app.exam_assignments SET closes_at=now()-interval '1 second' WHERE id=$1", [first.id]);
        const another = await createSitting(pool(), admin, { templateId, title: '竞争入口回归', opensAt: new Date(Date.now()-10000).toISOString(), closesAt: new Date(Date.now()+3600000).toISOString() });
        const third = await createAssignment(pool(), admin, { sittingId: another.id, studentId: child.id });
        const results = await Promise.allSettled([startAttempt(pool(), child, second.id), startAttempt(pool(), child, third.id)]);
        expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
        expect(results.filter(result => result.status === 'rejected')).toHaveLength(1);
        expect((await snapshot(pool(), child, old.id)).state).toBe('closed');
    });
    it('regression: resetting a password must invalidate an in-flight login using the old hash', async () => {
        const child = await createUser(pool(), admin, { username: 'review_reset', displayName: 'Review reset', password: 'synthetic-password-123', roles: ['student'] }, password);
        let readDone: () => void = () => {}, release: () => void = () => {};
        const didRead = new Promise<void>(r => readDone = r), gate = new Promise<void>(r => release = r);
        let paused = false;
        const wrapped = new Proxy(pool(), { get(target, property) {
            if (property === 'query') return async (...args: unknown[]) => {
                const result = await Reflect.apply(target.query, target, args);
                if (!paused && typeof args[0] === 'string' && args[0].includes("'passwordHash',password_hash")) { paused = true; readDone(); await gate; }
                return result;
            };
            const value: unknown = Reflect.get(target, property); return typeof value === 'function' ? value.bind(target) : value;
        } });
        const local = createExamService({ pool: wrapped, storage, origin, publicDir: root, clientAddress: () => 'review-reset' });
        const task = local.app.request('/api/v2/auth/login', { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify({ username: 'review_reset', password: 'synthetic-password-123' }) });
        await didRead;
        try { await updateUser(pool(), admin, child.id, { displayName: child.displayName, state: 'active', roles: ['student'], password: 'synthetic-replacement-456' }, await hashPassword('synthetic-replacement-456')); }
        finally { release(); }
        const response = await task;
        const cookie = response.headers.get('set-cookie')?.split(';')[0] ?? '';
        const sessionResponse = await local.app.request('/api/v2/session', { headers: { cookie } });
        expect({ login: response.status, session: sessionResponse.status }).toEqual({ login: 401, session: 401 });
    });
    it('regression: clients behind the gateway must not share one 20-per-minute login quota', async () => {
        const local = createExamService({ pool: pool(), storage, origin, publicDir: root, trustedProxyCidrs: ['127.0.0.1/32'] });
        const http = serve({ fetch: local.app.fetch, hostname: '127.0.0.1', port: 0 });
        await new Promise<void>(r => http.listening ? r() : http.once('listening', () => r()));
        const address = http.address(); if (!address || typeof address === 'string') throw new Error('NO_ADDRESS');
        const statuses: number[] = [];
        try {
            for (let n = 0; n < 21; n++) {
                const response = await fetch(`http://127.0.0.1:${address.port}/api/v2/auth/login`, { method: 'POST', headers: { origin, 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.' + (n+1) }, body: JSON.stringify({ username: 'student_a', password: 'synthetic-password-123' }) });
                statuses.push(response.status); await response.arrayBuffer();
            }
                expect(statuses).toEqual(Array.from({ length: 21 }, () => 200));
            const key = createHash('sha256').update('203.0.113.1').digest('hex');
            await pool().query("UPDATE exam_app.login_throttle SET window_start=date_trunc('minute',now()),attempts=20 WHERE key=$1", [key]);
            const limited = await fetch(`http://127.0.0.1:${address.port}/api/v2/auth/login`, { method: 'POST', headers: { origin, 'content-type': 'application/json', 'x-forwarded-for': '198.51.100.9, 203.0.113.1' }, body: JSON.stringify({ username: 'student_a', password: 'synthetic-password-123' }) });
            expect(limited.status).toBe(429); await limited.arrayBuffer();
        } finally { if (http instanceof Server) http.closeAllConnections(); await new Promise<void>(r => http.close(() => r())); }
    });
    it('regression: a transient result insert failure must preserve the generated answer', async () => {
        const child = await createUser(pool(), admin, { username: 'review_persist', displayName: 'Review persist', password: 'synthetic-password-123', roles: ['student'] }, password);
        const assigned = await createAssignment(pool(), admin, { sittingId, studentId: child.id });
        const attempt = await startAttempt(pool(), child, assigned.id), slot = (await snapshot(pool(), child, attempt.id)).slots[0];
        if (!slot) throw new Error('NO_SLOT');
        const media = await asset(slot.id, child);
        await submit(pool(), child, slot.id, { requestId: randomUUID(), expectedRevision: 0, kind: 'initial', assetIds: [media] });
        let injected = false, solves = 0;
        const wrapped = interceptClientQueries(async (sql, perform) => {
            if (!injected && sql.includes('INSERT INTO exam_app.run_results')) { injected = true; throw new Error('synthetic transient persistence failure'); }
            return perform();
        });
        expect(await processJob(wrapped, async () => { solves++; return outcome(); }, new AbortController().signal)).toBe(true);
        expect(solves).toBe(1);
        expect(injected).toBe(true);
        const final = await slotDetail(pool(), child, slot.id);
        expect(final.slot.status).toBe('completed');
        expect(final.slot.presentation?.answer).toBe('B. 4');
    });


    it('regression: an uncertain commit retries storage without duplicating answers or model calls', async () => {
        const { child, slot } = await queuedReviewSlot('review_commit');
        let saving = false, lost = false, solves = 0;
        const wrapped = interceptClientQueries(async (sql, perform) => {
            if (sql.includes('INSERT INTO exam_app.run_results')) saving = true;
            const result = await perform();
            if (saving && !lost && sql === 'COMMIT') { lost = true; throw new Error('synthetic lost commit acknowledgement'); }
            return result;
        });
        expect(await processJob(wrapped, async () => { solves++; return outcome(); }, new AbortController().signal)).toBe(true);
        expect(lost).toBe(true); expect(solves).toBe(1);
        expect((await slotDetail(pool(), child, slot.id)).slot.presentation?.answer).toBe('B. 4');
        expect((await pool().query('SELECT count(*) FROM exam_app.run_results WHERE slot_id=$1', [slot.id])).rows[0]?.count).toBe('1');
    });
    it('regression: cancellation between save retries remains final', async () => {
        const { child, slot, run } = await queuedReviewSlot('review_save_cancel');
        let savingFailed = false, cancelled = false, solves = 0;
        const wrapped = interceptClientQueries(async (sql, perform) => {
            if (!savingFailed && sql.includes('INSERT INTO exam_app.run_results')) { savingFailed = true; throw new Error('synthetic failed save'); }
            const result = await perform();
            if (savingFailed && !cancelled && sql === 'ROLLBACK') { cancelled = true; await cancelJob(pool(), child, run.runId); }
            return result;
        });
        expect(await processJob(wrapped, async () => { solves++; return outcome(); }, new AbortController().signal)).toBe(true);
        const final = await slotDetail(pool(), child, slot.id);
        expect(cancelled).toBe(true); expect(solves).toBe(1);
        expect(final.slot.status).toBe('cancelled'); expect(final.outcome).toBeNull(); expect(final.slot.presentation).toBeNull();
    });
    it('regression: exhausted result saves never replace a successful answer with SOLVE_FAILED', async () => {
        const { child, slot } = await queuedReviewSlot('review_save_outage');
        let solves = 0;
        const wrapped = interceptClientQueries(async (sql, perform) => {
            if (sql.includes('INSERT INTO exam_app.run_results')) throw new Error('synthetic persistent database outage');
            return perform();
        });
        await expect(processJob(wrapped, async () => { solves++; return outcome(); }, new AbortController().signal)).rejects.toThrow('synthetic persistent database outage');
        const final = await slotDetail(pool(), child, slot.id);
        expect(solves).toBe(1); expect(final.slot.errorCode).toBeNull(); expect(final.slot.status).toBe('understanding');
        await pool().query("UPDATE exam_app.answer_runs SET lease_expires_at=now()-interval '1 second' WHERE id=$1", [final.slot.runId]);
        await recoverJobs(pool());
        expect((await slotDetail(pool(), child, slot.id)).slot.status).toBe('interrupted');
    });
    it('regression: genuine model failures still finish as failures without automatic replay', async () => {
        const { child, slot } = await queuedReviewSlot('review_model_failure');
        let solves = 0;
        expect(await processJob(pool(), async () => { solves++; throw new Error('synthetic model rejection'); }, new AbortController().signal)).toBe(true);
        const final = await slotDetail(pool(), child, slot.id);
        expect(solves).toBe(1); expect(final.slot.status).toBe('failed'); expect(final.slot.errorCode).toBe('SOLVE_FAILED');
    });
    it('regression: reloading an active job keeps its answer until explicit Next', async () => {
        const child = await createUser(pool(), admin, { username: 'review_reload', displayName: 'Review reload', password: 'synthetic-password-123', roles: ['student'] }, password);
        const assigned = await createAssignment(pool(), admin, { sittingId, studentId: child.id });
        const attempt = await startAttempt(pool(), child, assigned.id), slot = (await snapshot(pool(), child, attempt.id)).slots[0];
        if (!slot) throw new Error('NO_SLOT');
        await submit(pool(), child, slot.id, { requestId: randomUUID(), expectedRevision: 0, kind: 'initial', assetIds: [await asset(slot.id, child)] });
        let local: ReturnType<typeof createExamService> | undefined;
        const http = serve({ fetch: request => local ? local.app.fetch(request) : new Response(null, { status: 503 }), hostname: '127.0.0.1', port: 0 });
        await new Promise<void>(r => http.listening ? r() : http.once('listening', () => r()));
        const address = http.address(); if (!address || typeof address === 'string' || !(http instanceof Server)) throw new Error('NO_ADDRESS');
        const url = 'http://127.0.0.1:' + address.port;
        local = createExamService({ pool: pool(), storage, origin: url, publicDir: join(process.cwd(), 'apps/exam-web/dist/public'), clientAddress: () => 'review-reload' });
        const closeWs = realtime(http, pool(), url, local.session);
        const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true });
        try {
            const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
            await page.goto(url);
            await page.getByLabel('用户名', { exact: true }).fill('review_reload');
            await page.getByLabel('密码', { exact: true }).fill('synthetic-password-123');
            await page.getByRole('button', { name: '登录', exact: true }).click();
            await page.getByRole('button', { name: '重拍本题', exact: true }).waitFor();
            await page.reload();
            await page.getByRole('button', { name: '重拍本题', exact: true }).waitFor();
            const job = await claimJob(pool()); if (!job || job.slotId !== slot.id) throw new Error('WRONG_JOB');
            await finishJob(pool(), job, outcome(), null);
            await page.locator('.current-answer').getByText('B. 4', { exact: true }).waitFor();
            expect((await snapshot(pool(), child, attempt.id)).nextSlotId).not.toBe(slot.id);
            expect((await snapshot(pool(), child, attempt.id)).viewedSlotId).toBe(slot.id);
            await page.getByRole('button', { name: '下一题', exact: true }).click();
            await page.getByRole('button', { name: '拍摄第2题', exact: true }).waitFor({ timeout: 5500 });
            const second = (await snapshot(pool(), child, attempt.id)).slots[1]; if (!second) throw new Error('NO_SLOT');
            await submit(pool(), child, second.id, { requestId: randomUUID(), expectedRevision: 0, kind: 'initial', assetIds: [await asset(second.id, child)] });
            await page.reload();
            await page.getByText('排队中', { exact: true }).waitFor();
            await page.getByRole('button', { name: '总览', exact: true }).click();
            await page.getByRole('dialog').getByRole('button', { name: '第3题', exact: true }).click();
            await page.getByRole('button', { name: '拍摄第3题', exact: true }).waitFor();
            const background = await claimJob(pool()); if (!background || background.slotId !== second.id) throw new Error('WRONG_JOB');
            await finishJob(pool(), background, outcome(), null);
            await expect.poll(async () => (await page.getByRole('region', { name: '待处理核验问题' }).innerText()).includes('待处理 · 2 题'), { timeout: 5500 }).toBe(true);
            expect(await page.getByRole('button', { name: '拍摄第3题', exact: true }).isVisible()).toBe(true);
        } finally { await browser.close(); closeWs(); http.closeAllConnections(); await new Promise<void>(r => http.close(() => r())); }
    });
    it('shows a solver draft while running and notifies only when the final answer changes', async () => {
        const { child, slot: target, attemptId: owned } = await queuedReviewSlot('revision_notice_changed');
        const attempt = await snapshot(pool(), child, owned);
        const job = await claimJob(pool()); if (!job || job.slotId !== target.id) throw new Error('WRONG_JOB');
        const draftCandidate = AnswerCandidateSchema.parse({ schemaVersion: 1, kind: 'answer', problem: { text: 'What is 2 + 2?', subject: 'math', uncertainties: [], response: { type: 'single-choice' }, options: [{ label: 'A', text: '3' }, { label: 'B', text: '4' }, { label: 'C', text: '5' }, { label: 'D', text: '6' }] }, selectedOptions: ['B'], answer: 'DRAFT-ANSWER', steps: [], knowledgePoints: [], citationIds: [], clarificationQuestions: [] });
        await publishDraft(pool(), job, draftCandidate);
        const during = (await snapshot(pool(), child, attempt.id)).slots.find(s => s.id === target.id);
        expect(during?.presentation).toBeNull();
        expect(during?.draft).toMatchObject({ answer: 'DRAFT-ANSWER' });
        await finishJob(pool(), job, outcome(), null);
        const after = await snapshot(pool(), child, attempt.id);
        expect(after.slots.find(s => s.id === target.id)?.draft).toBeNull();
        expect(after.slots.find(s => s.id === target.id)?.presentation?.answer).toBe('B. 4');
        expect((await pool().query('SELECT count(*) FROM exam_app.answer_drafts')).rows[0]?.count).toBe('0');
        // The student saw DRAFT-ANSWER, the published answer is B. 4: notify the revision.
        expect(after.answerRevisions).toHaveLength(1);
        expect(after.answerRevisions[0]).toMatchObject({ slotId: target.id, position: target.position, revision: 1 });
        await readAnswerRevision(pool(), child, after.answerRevisions[0]!.id);
        expect((await snapshot(pool(), child, attempt.id)).answerRevisions).toHaveLength(0);
    });
    it('keeps a matching verification result silent', async () => {
        const { child, slot: target, attemptId: owned } = await queuedReviewSlot('revision_notice_silent');
        const attempt = await snapshot(pool(), child, owned);
        const job = await claimJob(pool()); if (!job || job.slotId !== target.id) throw new Error('WRONG_JOB');
        const baseline = outcome();
        if (!('candidate' in baseline)) throw new Error('NO_CANDIDATE');
        await publishDraft(pool(), job, AnswerCandidateSchema.parse(baseline.candidate));
        const verified = SolveOutcomeSchema.parse({ ...baseline, verified: true, verificationStatus: undefined, verification: { schemaVersion: 1, verdict: 'pass', checked: ['transcription', 'logic'], issues: [] } });
        await finishJob(pool(), job, verified, null);
        const after = await snapshot(pool(), child, attempt.id);
        expect(after.slots.find(s => s.id === target.id)?.presentation?.answer).toBe('B. 4');
        expect(after.slots.find(s => s.id === target.id)?.presentation?.verified).toBe(true);
        expect(after.answerRevisions).toHaveLength(0);
        expect((await pool().query('SELECT count(*) FROM exam_app.answer_revisions WHERE run_id=$1', [job.id])).rows[0]?.count).toBe('0');
    });
    it('regression: a WS update arriving during an HTTP refresh must trigger a follow-up refresh', async () => {
        const base = await snapshot(pool(), student, attemptId);
        let seq = base.lastSeq, capture = false, release: () => void = () => {}, requested: () => void = () => {};
        const gate = new Promise<void>(r => release = r), started = new Promise<void>(r => requested = r);
        const bundle = await build({ stdin: { contents: `import {createElement} from 'react';import {createRoot} from 'react-dom/client';import {useAttempt} from './src/browser/use-attempt.ts';function App(){const {attempt}=useAttempt('${attemptId}');return createElement('div',{id:'seq'},attempt?.lastSeq??'loading')}createRoot(document.getElementById('root')).render(createElement(App));`, resolveDir: join(process.cwd(), 'apps/exam-web') }, bundle: true, write: false, platform: 'browser', format: 'esm', define: { 'process.env.NODE_ENV': '"production"' } });
        const code = bundle.outputFiles[0]?.text; if (!code) throw new Error('NO_CODE');
        const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true });
        try {
            const page = await browser.newPage();
            await page.addInitScript(`window.__reviewSockets=[];window.WebSocket=class{static OPEN=1;readyState=0;constructor(){window.__reviewSockets.push(this);setTimeout(()=>{this.readyState=1;this.onopen?.()},0)}send(data){if(JSON.parse(data).type==='heartbeat')this.onmessage?.({data:JSON.stringify({type:'heartbeat'})})}close(){this.readyState=3;this.onclose?.()}};window.__reviewNotify=(seq)=>window.__reviewSockets.at(-1).onmessage?.({data:JSON.stringify({type:'changed',attemptId:'${attemptId}',lastSeq:seq})});`);
            await page.route('http://127.0.0.1:3199/**', async route => {
                const path = new URL(route.request().url()).pathname;
                if (path === '/') return route.fulfill({ contentType: 'text/html', body: '<div id="root"></div><script type="module" src="/harness.js"></script>' });
                if (path === '/harness.js') return route.fulfill({ contentType: 'text/javascript', body: code });
                if (path.endsWith('/snapshot')) { const body = JSON.stringify({ ...base, lastSeq: seq }); if (capture) { capture = false; requested(); await gate; } return route.fulfill({ contentType: 'application/json', body }); }
                return route.fulfill({ status: 404, body: '{}' });
            });
            await page.goto('http://127.0.0.1:3199/');
            await page.locator('#seq').filter({ hasText: String(base.lastSeq) }).waitFor();
            await delay(300);
            capture = true; seq = base.lastSeq + 1;
            await page.evaluate(n => { Reflect.get(window, '__reviewNotify')(n); }, seq);
            await started;
            seq = base.lastSeq + 2;
            await page.evaluate(n => { Reflect.get(window, '__reviewNotify')(n); }, seq);
            release();
            await expect.poll(async () => Number(await page.locator('#seq').innerText()), { timeout: 2500 }).toBe(seq);
        } finally { release(); await browser.close(); }
    });

    it('ui regression: rejects contradictory manual choice without clearing the incident', async () => {
        const {child,slot}=await queuedReviewSlot('ui_choice_guard');
        const job=await claimJob(pool()); if(!job || job.slotId!==slot.id)throw new Error('WRONG_JOB');
        await finishJob(pool(),job,outcome(),null);
        const detail=await slotDetail(pool(),child,slot.id);
        const input={requestId:randomUUID(),expectedRevision:1,expectedRunId:detail.slot.runId,answer:'B. 4',selectedOptions:['C'],note:'合成字段一致性回归。'};
        await expect(teacherConfirm(pool(),admin,slot.id,input)).rejects.toThrow('答案文字');
        expect((await slotDetail(pool(),child,slot.id)).humanReviews).toHaveLength(0);
        expect((await snapshot(pool(),child,job.attemptId)).alerts).toHaveLength(1);
        await teacherConfirm(pool(),admin,slot.id,{...input,requestId:randomUUID(),answer:'C. 5'});
        expect((await slotDetail(pool(),child,slot.id)).slot.presentation).toMatchObject({answer:'C. 5',selectedOptions:['C'],humanConfirmed:true,verified:false});
    });
    it('ui regression: recent answer follows publication and excludes replaced revisions', async () => {
        const {child,slot}=await queuedReviewSlot('ui_recent_order');
        const first=await claimJob(pool()); if(!first || first.slotId!==slot.id)throw new Error('WRONG_JOB'); await finishJob(pool(),first,outcome(),null);
        const third=(await snapshot(pool(),child,first.attemptId)).slots[2]; if(!third)throw new Error('NO_SLOT');
        await submit(pool(),child,third.id,{requestId:randomUUID(),expectedRevision:0,kind:'initial',assetIds:[await asset(third.id,child)]});
        const later=await claimJob(pool()); if(!later || later.slotId!==third.id)throw new Error('WRONG_JOB'); await finishJob(pool(),later,outcome(),null);
        expect(await snapshot(pool(),child,first.attemptId)).toMatchObject({latestAnswerSlotId:third.id});
        await teacherConfirm(pool(),admin,slot.id,{requestId:randomUUID(),expectedRevision:1,expectedRunId:first.id,answer:'B. 4',selectedOptions:['B'],note:'历史题最后人工确认。'});
        expect(await snapshot(pool(),child,first.attemptId)).toMatchObject({latestAnswerSlotId:slot.id});
        const retake=await submit(pool(),child,slot.id,{requestId:randomUUID(),expectedRevision:1,kind:'retake',assetIds:[await asset(slot.id,child)]});
        expect(await snapshot(pool(),child,first.attemptId)).toMatchObject({latestAnswerSlotId:third.id});
        await cancelJob(pool(),child,retake.runId);
    });

    it('ui regression: teacher choice, recent answer and background error stay scoped in Chrome', async () => {
        const child=await createUser(pool(),admin,{username:'ui_browser_student',displayName:'界面回归同学',password:'synthetic-password-123',roles:['student']},password);
        const assigned=await createAssignment(pool(),admin,{sittingId,studentId:child.id});
        const attempt=await startAttempt(pool(),child,assigned.id), initial=await snapshot(pool(),child,attempt.id);
        const first=initial.slots[0],second=initial.slots[1],third=initial.slots[2]; if(!first||!second||!third)throw new Error('NO_SLOT');
        for(const slot of [first,third]){
            await submit(pool(),child,slot.id,{requestId:randomUUID(),expectedRevision:0,kind:'initial',assetIds:[await asset(slot.id,child)]});
            const job=await claimJob(pool()); if(!job||job.slotId!==slot.id)throw new Error('WRONG_JOB'); await finishJob(pool(),job,outcome(),null);
        }
        let live:ReturnType<typeof createExamService>|undefined;
        const server=serve({fetch:req=>live?live.app.fetch(req):new Response(null,{status:503}),hostname:'127.0.0.1',port:0});
        await new Promise<void>(resolve=>server.listening?resolve():server.once('listening',()=>resolve()));
        const address=server.address(); if(!address||typeof address==='string'||!(server instanceof Server))throw new Error('NO_ADDRESS');
        const local='http://127.0.0.1:'+address.port;
        live=createExamService({pool:pool(),storage,origin:local,publicDir:join(process.cwd(),'apps/exam-web/dist/public'),clientAddress:()=> 'ui-browser-regression'});
        const closeWs=realtime(server,pool(),local,live.session);
        const browser=await chromium.launch({executablePath:process.env.SOLVEFLOW_TEST_CHROME??'/usr/bin/google-chrome',headless:true});
        const errors:string[]=[];
        const screens=join(process.cwd(),'.runtime/exam-ui-fixes/screens'); await mkdir(screens,{recursive:true});
        async function signedIn(username:string,width:number,height:number){
            const context=await browser.newContext({viewport:{width,height}}),page=await context.newPage(); page.on('pageerror',e=>errors.push(e.message));
            await page.goto(local); await page.getByLabel('用户名',{exact:true}).fill(username); await page.getByLabel('密码',{exact:true}).fill('synthetic-password-123'); await page.getByRole('button',{name:'登录',exact:true}).click(); return page;
        }
        try{
            const teacher=await signedIn('test_admin',1440,1000);
            await teacher.locator('.student-row').filter({hasText:child.displayName}).click();
            const dialog=teacher.getByRole('dialog'); await dialog.getByRole('region',{name:'待处理核验问题'}).locator('summary').click(); await dialog.locator('.alert-links button').filter({hasText:'第1题'}).click();
            await dialog.getByRole('tab',{name:'手动作答',exact:true}).click();
            await dialog.getByRole('radio',{name:'C',exact:true}).check();
            expect(await dialog.locator('.review-choice.selected').innerText()).toBe('C'); expect(await dialog.getByRole('textbox',{name:'确认答案',exact:true}).count()).toBe(0);
            await dialog.getByLabel('处理意见',{exact:true}).fill('合成界面回归：检查选项与答案一致。');
            await teacher.screenshot({path:join(screens,'manual-choice-desktop.png'),animations:'disabled'});
            await teacher.setViewportSize({width:390,height:844}); await teacher.emulateMedia({colorScheme:'dark'});
            const note=dialog.getByRole('textbox',{name:'处理意见',exact:true}); await note.focus();
            expect(await note.evaluate(el=>getComputedStyle(el).outlineColor)).toBe('rgb(139, 181, 255)');
            await teacher.screenshot({path:join(screens,'manual-choice-mobile-dark.png'),animations:'disabled'});
            await dialog.getByRole('button',{name:'保存并通知学生',exact:true}).click();
            await expect.poll(async()=> (await slotDetail(pool(),child,first.id)).slot.presentation?.answer).toBe('C. 5');
            const studentPage=await signedIn('ui_browser_student',390,844);
            const resolvedReminder = studentPage.getByRole('dialog', { name: '答案已更新', exact: true });
            await resolvedReminder.waitFor(); await resolvedReminder.getByRole('button', { name: '稍后查看', exact: true }).click();
            await studentPage.getByRole('heading',{name:'第1题答案',exact:true}).waitFor();
            await studentPage.reload(); await resolvedReminder.waitFor(); await resolvedReminder.getByRole('button', { name: '稍后查看', exact: true }).click();
            await studentPage.getByRole('heading',{name:'第1题答案',exact:true}).waitFor();
            expect((await snapshot(pool(),child,attempt.id)).viewedSlotId).toBe(first.id);
            await studentPage.getByRole('button',{name:'总览',exact:true}).click(); await studentPage.getByRole('dialog').getByRole('button',{name:'第1题',exact:true}).click();
            const detail=studentPage.locator('.current-answer'); await detail.getByText('老师已确认',{exact:true}).waitFor(); await detail.locator('summary').filter({hasText:'题目详情'}).click();
            expect(await detail.locator('.option.selected').innerText()).toContain('C');
            expect(await detail.getByText('C. 5',{exact:true}).isVisible()).toBe(true);
            await studentPage.screenshot({path:join(screens,'student-manual-answer.png'),animations:'disabled'});
            expect(await studentPage.getByRole('dialog').count()).toBe(0);
            await studentPage.getByRole('button',{name:'总览',exact:true}).click(); await studentPage.getByRole('dialog').getByRole('button',{name:'第2题',exact:true}).click();
            await studentPage.getByRole('button',{name:'拍摄第2题',exact:true}).waitFor();
            await submit(pool(),child,second.id,{requestId:randomUUID(),expectedRevision:0,kind:'initial',assetIds:[await asset(second.id,child)]});
            await studentPage.getByText('排队中',{exact:true}).waitFor(); await studentPage.getByRole('navigation',{name:'考试模块'}).getByRole('button',{name:'模块二',exact:true}).click();
            await studentPage.getByRole('navigation',{name:'考试模块'}).getByRole('button',{name:'模块二',exact:true}).waitFor();
            await studentPage.getByRole('button',{name:'拍摄第1题',exact:true}).waitFor();
            const failing=await claimJob(pool()); if(!failing||failing.slotId!==second.id)throw new Error('WRONG_JOB'); await finishJob(pool(),failing,null,'SYNTHETIC_FAILURE');
            await studentPage.getByRole('region',{name:'待处理核验问题'}).getByText('待处理 · 2 题',{exact:true}).waitFor({timeout:5500});
            expect(await studentPage.getByRole('alert').count()).toBe(0);
            expect(await studentPage.getByRole('button',{name:'拍摄第1题',exact:true}).isVisible()).toBe(true);
            await studentPage.screenshot({path:join(screens,'background-error-scoped-light.png'),animations:'disabled'});
            await studentPage.emulateMedia({colorScheme:'dark'});
            await studentPage.screenshot({path:join(screens,'background-error-scoped-dark.png'),animations:'disabled'});
            expect(await studentPage.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
            expect(errors).toEqual([]);
        }finally{await browser.close();closeWs();server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}
    },40000);
    it('ui regression: a future exam auto-enters after opening and explicit exit remains on the list', async () => {
        const child=await createUser(pool(),admin,{username:'ui_future_entry',displayName:'待开考回归同学',password:'synthetic-password-123',roles:['student']},password);
        const future=await createSitting(pool(),admin,{templateId,title:'开考自动进入（合成回归）',opensAt:new Date(Date.now()+3500).toISOString(),closesAt:new Date(Date.now()+3600000).toISOString()});
        const assigned=await createAssignment(pool(),admin,{sittingId:future.id,studentId:child.id});
        await mkdir(join(process.cwd(),'.runtime/exam-ui-fixes/screens'),{recursive:true});
        let live:ReturnType<typeof createExamService>|undefined;
        const server=serve({fetch:req=>live?live.app.fetch(req):new Response(null,{status:503}),hostname:'127.0.0.1',port:0});
        await new Promise<void>(resolve=>server.listening?resolve():server.once('listening',()=>resolve()));
        const address=server.address(); if(!address||typeof address==='string'||!(server instanceof Server))throw new Error('NO_ADDRESS');
        const local='http://127.0.0.1:'+address.port;
        live=createExamService({pool:pool(),storage,origin:local,publicDir:join(process.cwd(),'apps/exam-web/dist/public'),clientAddress:()=> 'ui-future-regression'});
        const closeWs=realtime(server,pool(),local,live.session);
        const browser=await chromium.launch({executablePath:process.env.SOLVEFLOW_TEST_CHROME??'/usr/bin/google-chrome',headless:true});
        try{
            const page=await browser.newPage({viewport:{width:390,height:844}});
            await page.goto(local); await page.getByLabel('用户名',{exact:true}).fill(child.username); await page.getByLabel('密码',{exact:true}).fill('synthetic-password-123'); await page.getByRole('button',{name:'登录',exact:true}).click();
            await page.locator('.assignment-card .assignment-status').getByText('待开始',{exact:true}).waitFor();
            await page.getByRole('button',{name:'拍摄第1题',exact:true}).waitFor({timeout:12000});
            const count=await pool().query('SELECT count(*) FROM exam_app.exam_attempts WHERE assignment_id=$1',[assigned.id]); expect(count.rows[0]?.count).toBe('1');
            await page.screenshot({path:join(process.cwd(),'.runtime/exam-ui-fixes/screens','auto-entered.png'),animations:'disabled'});
            await page.getByRole('button',{name:'账户菜单',exact:true}).click();await page.getByRole('menuitem',{name:'考试记录',exact:true}).click();await page.getByRole('heading',{name:'考试记录',exact:true}).waitFor();
            await delay(5200);
            expect(await page.getByRole('heading',{name:'考试记录',exact:true}).isVisible()).toBe(true);
        }finally{await browser.close();closeWs();server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}
    },30000);

    it('attention: persists resolved notifications until the owner reads them without dismissing other incidents', async () => {
        const { child, slot, run } = await queuedReviewSlot('attention_owner');
        const job = await claimJob(pool()); if (!job || job.id !== run.runId) throw new Error('WRONG_JOB');
        await finishJob(pool(), job, null, 'SYNTHETIC_FAILURE');
        const attempt = z.uuid().parse((await pool().query('SELECT attempt_id FROM exam_app.question_slots WHERE id=$1', [slot.id])).rows[0]?.attempt_id);
        const first = await snapshot(pool(), child, attempt);
        expect(first.alerts).toHaveLength(1);
        await teacherConfirm(pool(), admin, slot.id, { requestId: randomUUID(), expectedRevision: 1, expectedRunId: run.runId, answer: 'B. 4', selectedOptions: null, note: '核对题图后直接回复答案。' });
        const resolved = await snapshot(pool(), child, attempt);
        expect(resolved.alerts).toHaveLength(0);
        expect(resolved.resolutions).toHaveLength(1);
        const notice = resolved.resolutions[0]; if (!notice) throw new Error('NO_RESOLUTION');
        expect(notice).toMatchObject({ slotId: slot.id, revision: 1, resolution: 'human_confirmed' });
        const cookie = await login(child.username), outsider = await login(other.username), teacher = await login(admin.username);
        expect((await json('/resolutions/' + notice.id + '/read', outsider, 'POST')).status).toBe(404);
        expect((await json('/resolutions/' + notice.id + '/read', teacher, 'POST')).status).toBe(404);
        expect((await snapshot(pool(), child, attempt)).resolutions).toHaveLength(1);
        expect((await json('/resolutions/' + notice.id + '/read', cookie, 'POST')).status).toBe(200);
        const seq = (await snapshot(pool(), child, attempt)).lastSeq;
        expect((await json('/resolutions/' + notice.id + '/read', cookie, 'POST')).status).toBe(200);
        const read = await snapshot(pool(), child, attempt);
        expect(read.resolutions).toHaveLength(0); expect(read.lastSeq).toBe(seq);
        expect((await slotDetail(pool(), child, slot.id)).slot.presentation).toMatchObject({ answer: 'B. 4', humanConfirmed: true, verified: false });
    });
    it('attention: lists scoped problem questions with stable pagination and filtering', async () => {
        const teacher = await createUser(pool(), admin, { username: 'attention_teacher', displayName: '问题队列老师', password: 'synthetic-password-123', roles: ['support'] }, password);
        const child = await createUser(pool(), admin, { username: 'attention_queue', displayName: '问题队列同学', password: 'synthetic-password-123', roles: ['student'] }, password);
        const assignment = await createAssignment(pool(), admin, { sittingId, studentId: child.id, supportIds: [teacher.id] });
        const attempt = await startAttempt(pool(), child, assignment.id), snap = await snapshot(pool(), child, attempt.id);
        for (const slot of snap.slots.slice(0, 2)) {
            await submit(pool(), child, slot.id, { requestId: randomUUID(), expectedRevision: 0, kind: 'initial', assetIds: [await asset(slot.id, child)] });
            const job = await claimJob(pool()); if (!job || job.slotId !== slot.id) throw new Error('WRONG_JOB');
            await finishJob(pool(), job, null, 'SYNTHETIC_FAILURE');
        }
        // Equal timestamps exercise the cursor's UUID tiebreaker, including sub-millisecond precision.
        await pool().query("UPDATE exam_app.verification_incidents SET opened_at='2026-11-03T00:00:00.123456Z' WHERE attempt_id=$1", [attempt.id]);
        const cookie = await login(teacher.username), studentCookie = await login(child.username);
        expect((await json('/admin/issues', studentCookie)).status).toBe(404);
        const firstResponse = await json('/admin/issues?limit=1', cookie); expect(firstResponse.status).toBe(200);
        const schema = z.object({ items: z.array(z.object({ id: z.uuid(), studentId: z.uuid(), slotId: z.uuid(), reason: z.string() })), total: z.number(), nextCursor: z.string().nullable() });
        const first = schema.parse(await firstResponse.json()); expect(first.total).toBe(2); expect(first.items).toHaveLength(1); expect(first.items[0]?.studentId).toBe(child.id);
        const next = schema.parse(await (await json('/admin/issues?limit=1&cursor=' + encodeURIComponent(first.nextCursor ?? ''), cookie)).json());
        expect(next.items).toHaveLength(1); expect(next.items[0]?.id).not.toBe(first.items[0]?.id); expect(next.nextCursor).toBeNull();
        expect(schema.parse(await (await json('/admin/issues?reason=verification_failed', cookie)).json()).total).toBe(0);
        expect(schema.parse(await (await json('/admin/issues?studentId=' + other.id, cookie)).json()).total).toBe(0);
        expect((await json('/admin/issues?cursor=invalid', cookie)).status).toBe(400);
        expect((await json('/admin/issues?limit=1000', cookie)).status).toBe(400);
        await pool().query('UPDATE exam_app.staff_assignments SET revoked_at=now() WHERE assignment_id=$1 AND staff_id=$2', [assignment.id, teacher.id]);
        expect(schema.parse(await (await json('/admin/issues', cookie)).json()).total).toBe(0);
    });
    it('attention: AI resolution survives reconnect and an old receipt cannot clear a new failure', async () => {
        const { child, slot, run } = await queuedReviewSlot('attention_retake');
        const job = await claimJob(pool()); if (!job || job.id !== run.runId) throw new Error('WRONG_JOB');
        await finishJob(pool(), job, outcome(), null);
        const attempt = z.uuid().parse((await pool().query('SELECT attempt_id FROM exam_app.question_slots WHERE id=$1', [slot.id])).rows[0]?.attempt_id);
        const cookie = await login(child.username), incident = (await snapshot(pool(), child, attempt)).alerts[0];
        if (!incident) throw new Error('NO_INCIDENT');
        expect((await json('/resolutions/' + incident.id + '/read', cookie, 'POST')).status).toBe(409);
        await teacherRun(pool(), admin, slot.id, { requestId: randomUUID(), expectedRevision: 1, expectedRunId: run.runId, action: 'verify' });
        const retry = await claimJob(pool()); if (!retry || retry.slotId !== slot.id) throw new Error('WRONG_JOB');
        const pass = SolveOutcomeSchema.parse({ ...outcome(), verified: true, verificationStatus: undefined, verification: { schemaVersion: 1, verdict: 'pass', checked: ['transcription', 'logic'], issues: [] } });
        await finishJob(pool(), retry, pass, null);
        const resolved = await snapshot(pool(), child, attempt);
        expect(resolved.resolutions[0]).toMatchObject({ id: incident.id, resolution: 'ai_pass', revision: 1 });
        expect((await snapshot(pool(), child, attempt)).resolutions).toEqual(resolved.resolutions);
        await submit(pool(), child, slot.id, { requestId: randomUUID(), expectedRevision: 1, kind: 'retake', assetIds: [await asset(slot.id, child)] });
        expect((await snapshot(pool(), child, attempt)).resolutions).toHaveLength(0);
        const replacement = await claimJob(pool()); if (!replacement || replacement.slotId !== slot.id) throw new Error('WRONG_JOB');
        await finishJob(pool(), replacement, null, 'SYNTHETIC_FAILURE');
        expect((await json('/resolutions/' + incident.id + '/read', cookie, 'POST')).status).toBe(200);
        const failing = await snapshot(pool(), child, attempt);
        expect(failing.alerts).toHaveLength(1); expect(failing.alerts[0]?.id).not.toBe(incident.id);
        await teacherConfirm(pool(), admin, slot.id, { requestId: randomUUID(), expectedRevision: 2, expectedRunId: replacement.id, answer: '4', selectedOptions: null, note: '人工核对重拍后的题图。' });
        expect((await snapshot(pool(), child, attempt)).resolutions[0]).toMatchObject({ id: failing.alerts[0]?.id, revision: 2, resolution: 'human_confirmed' });
        await migrate(pool());
        expect((await snapshot(pool(), child, attempt)).resolutions).toHaveLength(1);
    });
    it('attention: teacher queue returns a manual answer and student opens the durable notice over HTTP fallback', async () => {
        const teacher = await createUser(pool(), admin, { username: 'attention_ui_teacher', displayName: '答疑老师', password: 'synthetic-password-123', roles: ['support'] }, password);
        const child = await createUser(pool(), admin, { username: 'attention_ui_student', displayName: '答疑同学', password: 'synthetic-password-123', roles: ['student'] }, password);
        const assignment = await createAssignment(pool(), admin, { sittingId, studentId: child.id, supportIds: [teacher.id] });
        const attempt = await startAttempt(pool(), child, assignment.id), snap = await snapshot(pool(), child, attempt.id);
        const first = snap.slots[0]; if (!first) throw new Error('NO_SLOT');
        for (const slot of snap.slots.slice(0, 2)) {
            await submit(pool(), child, slot.id, { requestId: randomUUID(), expectedRevision: 0, kind: 'initial', assetIds: [await asset(slot.id, child)] });
            const job = await claimJob(pool()); if (!job || job.slotId !== slot.id) throw new Error('WRONG_JOB');
            await finishJob(pool(), job, null, 'SYNTHETIC_FAILURE');
        }
        let live: ReturnType<typeof createExamService> | undefined;
        const server = serve({ fetch: req => live ? live.app.fetch(req) : new Response(null, { status: 503 }), hostname: '127.0.0.1', port: 0 });
        await new Promise<void>(resolve => server.listening ? resolve() : server.once('listening', () => resolve()));
        const address = server.address(); if (!address || typeof address === 'string' || !(server instanceof Server)) throw new Error('NO_ADDRESS');
        const local = 'http://127.0.0.1:' + address.port;
        live = createExamService({ pool: pool(), storage, origin: local, publicDir: join(process.cwd(), 'apps/exam-web/dist/public'), clientAddress: () => 'attention-ui' });
        const closeWs = realtime(server, pool(), local, live.session);
        const browser = await chromium.launch({ executablePath: process.env.SOLVEFLOW_TEST_CHROME ?? '/usr/bin/google-chrome', headless: true });
        const screens = join(process.cwd(), '.runtime/exam-attention/screens'); await mkdir(screens, { recursive: true });
        const pageErrors: string[] = [];
        try {
            const pupil = await browser.newPage({ viewport: { width: 390, height: 844 } });
            await pupil.addInitScript(`window.WebSocket=class{static OPEN=1;readyState=3;constructor(){setTimeout(()=>this.onclose?.(),0)}send(){}close(){}}`);
            const staff = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
            for (const [page, username] of [[pupil, child.username], [staff, teacher.username]] as const) {
                page.on('pageerror', e => pageErrors.push(e.message));
                await page.goto(local); await page.getByLabel('用户名', { exact: true }).fill(username); await page.getByLabel('密码', { exact: true }).fill('synthetic-password-123'); await page.getByRole('button', { name: '登录', exact: true }).click();
            }
            await pupil.getByRole('button', { name: '总览', exact: true }).waitFor();
            await pupil.getByRole('region', { name: '待处理核验问题' }).getByText('待处理 · 2 题', { exact: true }).waitFor();
            const pendingNotices = pupil.getByRole('region', { name: '待处理核验问题' });
            expect((await pendingNotices.boundingBox())?.height).toBeLessThanOrEqual(72);
            expect(await pendingNotices.locator('.alert-links').isVisible()).toBe(false);
            expect(await pendingNotices.getByRole('button', {name:'关闭提示'}).count()).toBe(0);
            await pendingNotices.locator('summary').focus(); await pupil.keyboard.press('Enter');
            expect(await pendingNotices.locator('.alert-links button').count()).toBe(2);
            expect(await pendingNotices.locator('.alert-links').isVisible()).toBe(true);
            await pupil.getByRole('navigation', { name: '考试模块' }).getByRole('button', { name: '模块二', exact: true }).click();
            await pupil.getByRole('button', { name: '拍摄第1题', exact: true }).waitFor();
            expect(await pendingNotices.locator('details').evaluate(element => element instanceof HTMLDetailsElement && element.open)).toBe(true);
            await pendingNotices.locator('summary').press('Space');
            expect(await pendingNotices.locator('.alert-links').isVisible()).toBe(false);
            await adminNavigate(staff,'待处理题');
            const queue = staff.getByRole('region', { name: '待处理题队列' }); await queue.getByText('2 题', { exact: true }).waitFor();
            expect(await queue.locator('.issue-row').count()).toBe(2);
            await queue.getByRole('combobox', { name: '问题类型', exact: true }).click();
            await staff.getByRole('option', { name: '核验未通过', exact: true }).click();
            await queue.getByRole('button', { name: '查询', exact: true }).click();
            await queue.getByText('暂无待处理题', { exact: true }).waitFor();
            await queue.getByRole('combobox', { name: '问题类型', exact: true }).click();
            await staff.getByRole('option', { name: '全部问题', exact: true }).click();
            await queue.getByRole('button', { name: '查询', exact: true }).click();
            await queue.getByText('2 题', { exact: true }).waitFor();
            await staff.screenshot({ path: join(screens, 'teacher-queue-desktop.png'), animations: 'disabled' });
            await queue.locator('.issue-row').filter({ hasText: '第1题' }).click();
            const monitor = staff.getByRole('dialog'); await monitor.getByRole('tab', { name: '手动作答', exact: true }).click();
            await monitor.getByRole('textbox', { name: '确认答案', exact: true }).fill('B. 4');
            await monitor.getByRole('textbox', { name: '处理意见', exact: true }).fill('检查原图后确认答案为B。');
            await staff.emulateMedia({ colorScheme: 'dark' }); await staff.setViewportSize({ width: 390, height: 844 });
            await staff.screenshot({ path: join(screens, 'teacher-answer-mobile-dark.png'), animations: 'disabled' });
            await monitor.getByRole('button', { name: '保存并通知学生', exact: true }).scrollIntoViewIfNeeded();
            await staff.screenshot({ path: join(screens, 'teacher-confirm-mobile-dark.png'), animations: 'disabled' });
            expect(await staff.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
            await monitor.getByRole('button', { name: '保存并通知学生', exact: true }).click();
            const updateReminder = pupil.getByRole('dialog', { name: '答案已更新', exact: true });
            await updateReminder.getByText('老师已处理', { exact: true }).waitFor({ timeout: 10000 });
            expect((await snapshot(pool(), child, attempt.id)).viewedSlotId).toBe(snap.slots[3]?.id);
            await pupil.screenshot({ path: join(screens, 'student-overview-notice.png'), animations: 'disabled' });
            await pupil.emulateMedia({ colorScheme: 'dark' });
            await pupil.screenshot({ path: join(screens, 'student-overview-notice-dark.png'), animations: 'disabled' });
            await updateReminder.getByRole('button', { name: '稍后查看', exact: true }).click();
            const notices = pupil.getByRole('region', { name: '已解决题目' }); await notices.getByText('已解决 · 1 题', { exact: true }).waitFor();
            await pupil.getByRole('region', { name: '待处理核验问题' }).getByText('待处理 · 1 题', { exact: true }).waitFor();
            // A failed detail fetch keeps the notification unread and retryable.
            await pupil.route('**/api/v2/slots/' + first.id, route => route.abort(), { times: 1 });
            await notices.locator('summary').click();
            await notices.locator('.alert-links button').click(); await pupil.getByRole('alert').waitFor();
            expect((await snapshot(pool(), child, attempt.id)).resolutions).toHaveLength(1);
            await notices.locator('.alert-links button').click();
            const answer = pupil.getByRole('dialog'); await answer.getByText('老师已确认', { exact: true }).waitFor();
            await answer.getByText('B. 4', { exact: true }).waitFor();
            await notices.waitFor({ state: 'hidden' });
            expect((await snapshot(pool(), child, attempt.id)).viewedSlotId).toBe(first.id);
            await pupil.screenshot({ path: join(screens, 'student-resolved-answer.png'), animations: 'disabled' });
            expect(await pupil.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
            await pupil.reload(); await pupil.getByRole('button', { name: '总览', exact: true }).waitFor();
            expect(await pupil.getByRole('region', { name: '已解决题目' }).count()).toBe(0);
            expect((await snapshot(pool(), child, attempt.id)).alerts).toHaveLength(1);
            // Resolving a failure while the student stays on that question also clears its transient error.
            await pupil.getByRole('region', { name: '待处理核验问题' }).locator('summary').click();
            await pupil.getByRole('region', { name: '待处理核验问题' }).locator('.alert-links button').click();
            await pupil.getByRole('button', { name: '重拍本题', exact: true }).waitFor();
            const second = snap.slots[1]; if (!second) throw new Error('NO_SLOT');
            const redo = await submit(pool(), child, second.id, { requestId: randomUUID(), expectedRevision: 1, kind: 'retake', assetIds: [await asset(second.id, child)] });
            await pupil.getByText('排队中', { exact: true }).waitFor({ timeout: 8000 });
            const failing = await claimJob(pool()); if (!failing || failing.id !== redo.runId) throw new Error('WRONG_JOB');
            await finishJob(pool(), failing, null, 'SYNTHETIC_FAILURE');
            await pupil.getByRole('alert').filter({ hasText: '解答失败' }).waitFor({ timeout: 8000 });
            await teacherConfirm(pool(), teacher, second.id, { requestId: randomUUID(), expectedRevision: 2, expectedRunId: failing.id, answer: '4', selectedOptions: null, note: '确认重拍题的答案。' });
            await updateReminder.waitFor({ timeout: 8000 });
            await updateReminder.getByRole('button', { name: '稍后查看', exact: true }).click();
            await pupil.getByRole('region', { name: '已解决题目' }).waitFor({ timeout: 8000 });
            expect(await pupil.getByRole('alert').count()).toBe(0);
            expect(await pupil.getByRole('region', { name: '待处理核验问题' }).count()).toBe(0);
            await monitor.getByRole('button', { name: '关闭', exact: true }).click();
            await queue.getByText('暂无待处理题', { exact: true }).waitFor({ timeout: 8000 });
            // Clarification already has a persistent incident and an actionable capture status.
            await navigateAttempt(pool(), child, attempt.id, { requestId: randomUUID(), expectedVersion: (await snapshot(pool(), child, attempt.id)).navigationVersion, action: 'select_slot', slotId: second.id });
            await submit(pool(), child, second.id, { requestId: randomUUID(), expectedRevision: 2, kind: 'retake', assetIds: [await asset(second.id, child)] });
            await pupil.getByText('排队中', { exact: true }).waitFor({ timeout: 8000 });
            const incomplete = await claimJob(pool()); if (!incomplete || incomplete.slotId !== second.id) throw new Error('WRONG_JOB');
            await finishJob(pool(), incomplete, SolveOutcomeSchema.parse({ schemaVersion: 1, status: 'needs_clarification', verified: false, candidate: { schemaVersion: 1, kind: 'clarification', problem: { text: 'Using Table 1, find the maximum value.', subject: 'math', uncertainties: ['missing table'] }, answer: null, steps: [], knowledgePoints: [], citationIds: [], clarificationQuestions: ['请补充表格。'] } }), null);
            await pupil.locator('.capture-box .badge').filter({ hasText: '需要补图' }).waitFor({ timeout: 8000 });
            expect(await pupil.getByRole('region', { name: '待处理核验问题' }).count()).toBe(1);
            expect(await pupil.getByRole('button', { name: '补图', exact: true }).isEnabled()).toBe(true);
            expect(await pupil.getByRole('alert').count()).toBe(0);
            await pupil.screenshot({ path: join(screens, 'student-clarification-clean.png'), animations: 'disabled' });
            expect(pageErrors).toEqual([]);
        } finally { await browser.close(); closeWs(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
    }, 50000);
    it('console: dashboard uses scoped current answers, disjoint chart counts and real publication times', async () => {
        const teacher = await createUser(pool(), admin, { username:'console_teacher',displayName:'看板老师',password:'synthetic-password-123',roles:['support'] }, password);
        const pupils = [];
        for (let n=0;n<2;n++) {
            const child=await createUser(pool(),admin,{username:'console_child_'+n,displayName:'看板同学'+n,password:'synthetic-password-123',roles:['student']},password);
            const assignment=await createAssignment(pool(),admin,{sittingId,studentId:child.id,supportIds:[teacher.id]});
            pupils.push({child,assignment});
        }
        const pupil=pupils[0]; if(!pupil)throw new Error('NO_STUDENT');
        const attempt=await startAttempt(pool(),pupil.child,pupil.assignment.id), snap=await snapshot(pool(),pupil.child,attempt.id);
        for(const [n,slot] of snap.slots.slice(0,3).entries()) {
            await submit(pool(),pupil.child,slot.id,{requestId:randomUUID(),expectedRevision:0,kind:'initial',assetIds:[await asset(slot.id,pupil.child)]});
            if(n===2)break;
            const job=await claimJob(pool());if(!job||job.slotId!==slot.id)throw new Error('WRONG_JOB');
            await finishJob(pool(),job,n===0?outcome():null,n===0?null:'SYNTHETIC_FAILURE');
        }
        const cookie=await login(teacher.username), studentCookie=await login(pupil.child.username);
        const response=await json('/admin/dashboard',cookie);expect(response.status).toBe(200);
        const board=ExamDashboardSchema.parse(await response.json());
        expect(board.summary).toMatchObject({students:2,online:1,total:10,answered:1,verified:0,humanConfirmed:0,active:1,attention:2});
        expect(board.students).toHaveLength(2);expect(board.students.reduce((n,p)=>n+p.answered,0)).toBe(board.summary.answered);
        expect(board.distribution.reduce((n,p)=>n+p.count,0)).toBe(10);
        expect(board.distribution.find(p=>p.state==='unphotographed')?.count).toBe(7);
        expect(board.modules.reduce((n,m)=>n+m.total,0)).toBe(10);
        expect(board.throughput).toHaveLength(12);expect(board.throughput.reduce((n,p)=>n+p.ai,0)).toBe(1);
        const second=(await snapshot(pool(),pupil.child,attempt.id)).slots[1];if(!second)throw new Error('NO_SLOT');
        await teacherConfirm(pool(),teacher,second.id,{requestId:randomUUID(),expectedRevision:1,expectedRunId:second.runId,answer:'4',selectedOptions:null,note:'人工核对。'});
        const updated=ExamDashboardSchema.parse(await(await json('/admin/dashboard?sittingId='+sittingId,cookie)).json());
        expect(updated.summary).toMatchObject({answered:2,humanConfirmed:1,attention:1});expect(updated.throughput.reduce((n,p)=>n+p.human,0)).toBe(1);
        expect(updated.distribution.reduce((n,p)=>n+p.count,0)).toBe(updated.summary.total);
        expect((await json('/admin/dashboard',studentCookie)).status).toBe(404);
        expect((await json('/admin/dashboard?sittingId='+randomUUID(),cookie)).status).toBe(404);
        expect((await json('/admin/dashboard?studentId='+pupil.child.id,cookie)).status).toBe(400);
        const third=(await snapshot(pool(),pupil.child,attempt.id)).slots[2];if(third?.runId)await cancelJob(pool(),pupil.child,third.runId);
        await pool().query('UPDATE exam_app.staff_assignments SET revoked_at=now() WHERE staff_id=$1',[teacher.id]);
        expect(ExamDashboardSchema.parse(await(await json('/admin/dashboard',cookie)).json()).summary.total).toBe(0);
    });
    it('console: progress excludes a replaced answer while retake is pending', async () => {
        const {child,slot,run}=await queuedReviewSlot('console_retake');
        const first=await claimJob(pool());if(!first||first.id!==run.runId)throw new Error('WRONG_JOB');
        await finishJob(pool(),first,outcome(),null);
        const assignment=z.uuid().parse((await pool().query('SELECT assignment_id FROM exam_app.exam_attempts x JOIN exam_app.question_slots q ON q.attempt_id=x.id WHERE q.id=$1',[slot.id])).rows[0]?.assignment_id);
        const before=(await progress(pool(),admin)).find(p=>p.assignmentId===assignment);
        expect(before?.answered).toBe(1);
        const redo=await submit(pool(),child,slot.id,{requestId:randomUUID(),expectedRevision:1,kind:'retake',assetIds:[await asset(slot.id,child)]});
        try { expect((await progress(pool(),admin)).find(p=>p.assignmentId===before?.assignmentId)?.answered).toBe(0); }
        finally { await cancelJob(pool(),child,redo.runId); }
    });
    it('console: charts, filters, sync recovery and consolidated homepage actions work in Chrome', async () => {
        let live:ReturnType<typeof createExamService>|undefined;
        const server=serve({fetch:req=>live?live.app.fetch(req):new Response(null,{status:503}),hostname:'127.0.0.1',port:0});
        await new Promise<void>(resolve=>server.listening?resolve():server.once('listening',()=>resolve()));
        const address=server.address();if(!address||typeof address==='string'||!(server instanceof Server))throw new Error('NO_ADDRESS');
        const local='http://127.0.0.1:'+address.port;
        live=createExamService({pool:pool(),storage,origin:local,publicDir:join(process.cwd(),'apps/exam-web/dist/public'),clientAddress:()=> 'console-ui'});
        const browser=await chromium.launch({executablePath:process.env.SOLVEFLOW_TEST_CHROME??'/usr/bin/google-chrome',headless:true});
        const screens=join(process.cwd(),'.runtime/exam-console/screens');await mkdir(screens,{recursive:true});
        const errors:string[]=[];
        let releaseRefresh=()=>{};
        try{
            const page=await browser.newPage({viewport:{width:1440,height:1000}});page.on('pageerror',e=>errors.push(e.message));
            await page.goto(local);await page.getByLabel('用户名',{exact:true}).fill(admin.username);await page.getByLabel('密码',{exact:true}).fill('synthetic-password-123');await page.getByRole('button',{name:'登录',exact:true}).click();
            const board=page.getByRole('region',{name:'考试数据看板'});await board.getByRole('img',{name:'题目状态分布图'}).waitFor();
            expect(await page.getByRole('navigation',{name:'管理导航'}).getByRole('button',{name:'答题统计',exact:true}).count()).toBe(0);
            expect(await page.getByRole('navigation',{name:'管理导航'}).getByRole('button',{name:'数据大屏',exact:true}).count()).toBe(0);
            expect((await page.locator('.header .brand').boundingBox())?.x).toBeLessThan(40);
            expect(await page.getByRole('heading',{name:'看板首页',exact:true}).count()).toBe(0);
            await page.getByRole('button',{name:'收起导航',exact:true}).click();
            await expect.poll(()=>page.locator('.sidebar').evaluate(node=>node.getBoundingClientRect().width)).toBeLessThan(90);
            await page.reload();await board.getByRole('img',{name:'题目状态分布图'}).waitFor();
            expect(await page.getByRole('button',{name:'展开导航',exact:true}).count()).toBe(1);
            const theme=page.locator('.header').getByRole('button',{name:'主题设置',exact:true});
            await theme.click();await page.getByRole('menuitemradio',{name:'深色',exact:true}).click();
            expect(await page.evaluate(()=>document.documentElement.dataset.theme)).toBe('dark');
            await page.emulateMedia({colorScheme:'dark'});await theme.click();await page.getByRole('menuitemradio',{name:'浅色',exact:true}).click();
            expect(await page.evaluate(()=>getComputedStyle(document.documentElement).colorScheme)).toBe('light');
            await page.reload();await board.getByRole('img',{name:'题目状态分布图'}).waitFor();
            expect(await page.evaluate(()=>document.documentElement.dataset.theme)).toBe('light');
            await theme.click();await page.keyboard.press('End');await page.keyboard.press('Enter');
            expect(await page.evaluate(()=>document.documentElement.hasAttribute('data-theme'))).toBe(false);
            await theme.click();await page.keyboard.press('Escape');expect(await theme.evaluate(node=>node===document.activeElement)).toBe(true);
            await theme.click();await page.keyboard.press('Tab');expect(await page.getByRole('menu',{name:'主题',exact:true}).count()).toBe(0);
            expect(await page.getByRole('button',{name:'退出登录',exact:true}).evaluate(node=>node===document.activeElement)).toBe(true);
            await page.getByRole('button',{name:'展开导航',exact:true}).click();await page.emulateMedia({colorScheme:'light'});
            await board.getByRole('button',{name:'柱图',exact:true}).click();expect(await board.locator('.chart-bar').count()).toBe(24);
            await board.getByRole('button',{name:'趋势',exact:true}).click();
            await board.getByRole('group',{name:'答案发布趋势，方向键查看时间段',exact:true}).focus();await page.keyboard.press('ArrowRight');
            expect(await board.locator('.chart-tooltip').isVisible()).toBe(true);await page.keyboard.press('Escape');expect(await board.locator('.chart-tooltip').count()).toBe(0);
            const gate=new Promise<void>(resolve=>releaseRefresh=resolve);let refreshes=0;
            const countRefresh=(request:import('@playwright/test').Request)=>{if(request.url().includes('/api/v2/admin/dashboard'))refreshes++;};
            await page.route('**/api/v2/admin/dashboard*',async route=>{await gate;await route.continue();},{times:1});
            page.on('request',countRefresh);
            await page.evaluate(()=>{const button=document.querySelector('.refresh-button');if(button instanceof HTMLButtonElement){button.click();button.click();}});
            await expect.poll(()=>refreshes).toBe(1);await delay(5200);expect(refreshes).toBe(1);
            expect(await board.getByRole('button',{name:'刷新',exact:true}).isDisabled()).toBe(true);expect(await board.getByRole('button',{name:'刷新',exact:true}).getAttribute('aria-busy')).toBe('true');
            releaseRefresh();await board.getByRole('button',{name:'刷新',exact:true}).waitFor();page.off('request',countRefresh);
            expect(await page.getByRole('button',{name:'新建用户',exact:true}).count()).toBe(0);
            await page.screenshot({path:join(screens,'console-desktop-light.png'),fullPage:true,animations:'disabled'});
            await board.getByRole('combobox',{name:'具体考试',exact:true}).click();await page.getByRole('option',{name:'合成考试',exact:true}).click();
            await board.getByRole('img',{name:'近一小时答案发布图'}).waitFor();
            await page.route('**/api/v2/admin/dashboard*',route=>route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({message:'合成看板同步中断'})}),{times:1});
            await board.getByRole('button',{name:'刷新',exact:true}).click();
            await page.getByRole('alert').filter({hasText:'合成看板同步中断'}).waitFor({timeout:8000});
            expect(await board.getByRole('img',{name:'题目状态分布图'}).isVisible()).toBe(true);
            await page.getByRole('alert').filter({hasText:'合成看板同步中断'}).waitFor({state:'hidden',timeout:8000});
            await page.emulateMedia({colorScheme:'dark'});await page.screenshot({path:join(screens,'console-desktop-dark.png'),fullPage:true,animations:'disabled'});
            const publicationDetails=board.getByRole('button',{name:'发布明细',exact:true});
            await publicationDetails.click();const detail=page.getByRole('dialog',{name:'发布明细',exact:true});await detail.waitFor();
            expect(await detail.getByRole('table',{name:'答案发布明细',exact:true}).getByRole('row').count()).toBe(14);
            await page.screenshot({path:join(screens,'homepage-publications-desktop.png'),animations:'disabled'});
            await detail.getByRole('button',{name:'关闭',exact:true}).click();
            await adminNavigate(page,'实时跟踪');await page.getByRole('table').waitFor();
            await page.screenshot({path:join(screens,'tracking-desktop.png'),fullPage:true,animations:'disabled'});
            await adminNavigate(page,'看板首页');await page.getByRole('img',{name:'题目状态分布图'}).waitFor();
            await page.setViewportSize({width:390,height:844});await page.screenshot({path:join(screens,'console-mobile-dark.png'),fullPage:true,animations:'disabled'});
            expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
            await page.emulateMedia({colorScheme:'light'});await page.screenshot({path:join(screens,'console-mobile-light.png'),fullPage:true,animations:'disabled'});
            await page.setViewportSize({width:1920,height:1080});
            await page.evaluate(()=>{const set=Storage.prototype.setItem;Storage.prototype.setItem=function(key,value){if(key==='solveflow-exam-appearance')throw new DOMException('Synthetic preference storage refusal','QuotaExceededError');return Reflect.apply(set,this,[key,value]);};});
            await theme.click();await page.getByRole('menuitemradio',{name:'深色',exact:true}).click();
            expect(await page.evaluate(()=>document.documentElement.dataset.theme)).toBe('dark');
            await page.screenshot({path:join(screens,'homepage-1920.png'),fullPage:true,animations:'disabled'});
            expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
            expect(await page.getByRole('button',{name:'全屏',exact:true}).count()).toBe(0);
            await board.locator('.students-panel').getByRole('button',{name:'查看',exact:true}).first().click();
            await page.getByRole('dialog').waitFor({timeout:5000});
            await page.getByRole('dialog').locator('.monitor-counts').waitFor({timeout:5000});
            await page.screenshot({path:join(screens,'homepage-student-dialog.png'),animations:'disabled'});
            await page.getByRole('dialog').getByRole('button',{name:'关闭',exact:true}).click();
            expect(await page.evaluate(()=>document.fullscreenElement===null)).toBe(true);
            await page.getByRole('main',{name:'看板首页',exact:true}).waitFor();
            expect(await page.evaluate(()=>document.body.style.overflow)).not.toBe('hidden');
            await page.getByRole('button',{name:'查看待处理题',exact:true}).click();await page.getByRole('region',{name:'待处理题队列'}).waitFor();
            expect(errors).toEqual([]);
        }finally{releaseRefresh();await browser.close();server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}
    },40000);
    for (const engine of ['chrome', 'webkit'] as const) it(`console home: consolidated publication details retain live data and narrow layouts in ${engine}`, async () => {
        const baseline = ExamDashboardSchema.parse(await (await json('/admin/dashboard', await login(admin.username))).json());
        const template = baseline.students.find(student => student.attemptId);
        if (!template) throw new Error('HOME_STUDENT_FIXTURE_REQUIRED');
        let payload = ExamDashboardSchema.parse({ ...baseline,
            summary: { students: 12, online: 9, total: 1176, answered: 624, verified: 480, humanConfirmed: 96, active: 12, attention: 36 },
            distribution: [{ state: 'unphotographed', count: 528 }, { state: 'processing', count: 12 }, { state: 'attention', count: 36 }, { state: 'answered', count: 588 }, { state: 'waiting', count: 12 }],
            modules: Array.from({ length: 8 }, (_, i) => ({ exam: 'sat', title: '阅读与写作' + (i + 1) + '长模块名称'.repeat(8), sectionCode: 'module-' + i, total: 147, answered: 78, attention: 4 })),
            students: Array.from({ length: 8 }, (_, i) => ({ ...template, assignmentId: randomUUID(), studentName: '合成考生' + i + '长姓名'.repeat(16), attention: 8 - i, online: i < 7 })),
            throughput: baseline.throughput.map((point, index) => ({ ...point, ai: index + 1, human: index % 3 })),
        });
        let fail = false;
        const writes: string[] = [];
        const bundle = await browserHarness(`import {useState} from 'react';import {createRoot} from 'react-dom/client';import {Dashboard} from './src/browser/dashboard.tsx';function Preview(){const[action,setAction]=useState('');return <><Dashboard onWatch={id=>setAction('student:'+id)} onIssues={reason=>setAction('issues:'+(reason??'all'))}/><output aria-label="看板操作">{action}</output></>};createRoot(document.getElementById('root')).render(<Preview/>);`);
        const browser = await (engine === 'webkit' ? webkit.launch() : chromium.launch({ executablePath: '/usr/bin/google-chrome' }));
        try {
            const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } }), errors: string[] = [];
            page.on('pageerror', error => errors.push(error.message));
            await page.clock.install();
            await page.route('http://127.0.0.1:3199/**', route => {
                const request = route.request(), path = new URL(request.url()).pathname;
                if (request.method() !== 'GET') { writes.push(path); return route.abort(); }
                if (path === '/api/v2/admin/dashboard') return route.fulfill(fail ? { status: 503, json: { message: '合成发布同步失败' } } : { json: payload });
                return route.fulfill({ contentType: path.endsWith('.js') ? 'text/javascript' : path.endsWith('.css') ? 'text/css' : 'text/html', body: path === '/harness.js' ? bundle.js : path === '/harness.css' ? bundle.css : bundle.html });
            });
            await page.goto('http://127.0.0.1:3199/');
            const board = page.getByRole('region', { name: '考试数据看板' });
            await board.getByRole('img', { name: '答案覆盖率 53%' }).waitFor();
            expect(await board.locator('.console-metric').count()).toBe(4);
            expect(await board.locator('.students-panel tbody tr').count()).toBe(8);
            const open = board.getByRole('button', { name: '发布明细', exact: true });
            await open.focus(); await open.click();
            const details = page.getByRole('dialog', { name: '发布明细', exact: true }), table = details.getByRole('table', { name: '答案发布明细', exact: true });
            await table.waitFor();
            expect(await table.getByRole('row').count()).toBe(14);
            expect(await table.locator('tfoot th,tfoot td').allTextContents()).toEqual(['合计', '78', '12', '90']);
            await table.evaluate(node => node.setAttribute('data-stable-publication', 'yes'));
            const close = details.getByRole('button', { name: '关闭', exact: true }); await close.focus();
            payload = ExamDashboardSchema.parse({ ...payload, throughput: payload.throughput.map(point => ({ ...point, ai: point.ai + 2 })) });
            await page.clock.fastForward(5000);
            await expect.poll(() => table.locator('tfoot th,tfoot td').allTextContents()).toEqual(['合计', '102', '12', '114']);
            expect(await table.getAttribute('data-stable-publication')).toBe('yes');
            expect(await close.evaluate(node => node === document.activeElement)).toBe(true);
            fail = true; await page.clock.fastForward(5000); await details.getByRole('alert').waitFor();
            expect(await details.getByRole('alert').textContent()).toContain('合成发布同步失败');
            expect(await table.locator('tfoot th,tfoot td').allTextContents()).toEqual(['合计', '102', '12', '114']);
            fail = false; await page.clock.fastForward(5000); await expect.poll(() => details.getByRole('alert').count()).toBe(0);
            const screens = join(process.cwd(), '.runtime/dashboard-consolidation-20261108/screens'); await mkdir(screens, { recursive: true });
            for (const width of [1440, 768, 390, 320]) for (const theme of ['light', 'dark']) {
                await page.setViewportSize({ width, height: 900 });
                await page.evaluate(theme => document.documentElement.dataset.theme = theme, theme);
                expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
                expect(await details.locator('.publication-details-table').evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
                await page.screenshot({ path: join(screens, `publications-${engine}-${width}-${theme}.png`), animations: 'disabled' });
            }
            await page.emulateMedia({ reducedMotion: 'reduce' });
            expect(await details.evaluate(node => getComputedStyle(node).animationName)).toBe('none');
            expect(await board.locator('.orbit-value').evaluate(node => getComputedStyle(node).animationName)).toBe('none');
            await page.keyboard.press('Escape'); await expect.poll(() => details.count()).toBe(0);
            expect(await open.evaluate(node => node === document.activeElement)).toBe(true);
            const studentAction = board.locator('.students-panel').getByRole('button', { name: '查看', exact: true }).first();
            await studentAction.click(); expect(await page.getByLabel('看板操作').innerText()).toBe('student:' + template.attemptId);
            const mobileAction = await studentAction.boundingBox();
            expect(mobileAction?.width).toBeGreaterThanOrEqual(44); expect(mobileAction?.height).toBeGreaterThanOrEqual(44);
            await board.getByRole('button', { name: '查看待处理题', exact: true }).click(); expect(await page.getByLabel('看板操作').innerText()).toBe('issues:all');
            await board.getByRole('button', { name: '柱图', exact: true }).click(); expect(await board.locator('.chart-bar').count()).toBe(24);
            await board.getByRole('button', { name: '趋势', exact: true }).click();
            const chart = board.getByRole('group', { name: '答案发布趋势，方向键查看时间段' }); await chart.focus(); await chart.press('ArrowRight');
            expect(await board.locator('.chart-tooltip').isVisible()).toBe(true); await chart.press('Escape'); expect(await board.locator('.chart-tooltip').count()).toBe(0);
            payload = ExamDashboardSchema.parse({ ...payload, summary: { students: 0, online: 0, total: 0, answered: 0, verified: 0, humanConfirmed: 0, active: 0, attention: 0 }, modules: [], students: [], issues: [], distribution: payload.distribution.map(item => ({ ...item, count: 0 })), throughput: payload.throughput.map(item => ({ ...item, ai: 0, human: 0 })) });
            await page.clock.fastForward(5000); await board.getByRole('img', { name: '答案覆盖率 0%' }).waitFor();
            expect(await board.innerText()).not.toMatch(/NaN|Infinity/); expect(await board.getByText('暂无考试分配', { exact: true }).isVisible()).toBe(true);
            expect(await board.locator('.orbit-value').getAttribute('opacity')).toBe('0');
            await open.click(); await table.waitFor(); expect(await table.locator('tfoot th,tfoot td').allTextContents()).toEqual(['合计', '0', '0', '0']);
            await close.click(); expect(writes).toEqual([]); expect(errors).toEqual([]);
        } finally { await browser.close(); }
    }, 40000);

    for (const engine of ['chrome', 'webkit'] as const) it(`console home: progress, issue actions and compact layouts work in ${engine}`, async () => {
        const baseline=ExamDashboardSchema.parse(await(await json('/admin/dashboard',await login(admin.username))).json());
        const template=baseline.students.find(student=>student.attemptId);if(!template)throw new Error('HOME_STUDENT_FIXTURE_REQUIRED');
        let payload=ExamDashboardSchema.parse({...baseline,
            summary:{students:12,online:9,total:1176,answered:624,verified:480,humanConfirmed:96,active:12,attention:36},
            distribution:[{state:'unphotographed',count:528},{state:'processing',count:12},{state:'attention',count:36},{state:'answered',count:588},{state:'waiting',count:12}],
            issues:[{reason:'image_incomplete',count:21},{reason:'verification_unknown',count:15}],
            modules:Array.from({length:8},(_,i)=>({exam:'sat',title:'阅读与写作'+i+'长模块名称'.repeat(8),sectionCode:'module-'+i,total:147,answered:78,attention:4})),
            students:Array.from({length:8},(_,i)=>({...template,assignmentId:randomUUID(),studentName:'合成考生'+i+'长姓名'.repeat(16),attention:8-i,online:i<7})),
        });
        const bundle=await browserHarness(`import {useState} from 'react';import {createRoot} from 'react-dom/client';import {Dashboard} from './src/browser/dashboard.tsx';function Preview(){const[action,setAction]=useState('');return <><Dashboard onWatch={id=>setAction('student:'+id)} onIssues={reason=>setAction('issues:'+(reason??'all'))}/><output aria-label="首页操作">{action}</output></>};createRoot(document.getElementById('root')).render(<Preview/>);`);
        const browser=await(engine==='webkit'?webkit.launch():chromium.launch({executablePath:'/usr/bin/google-chrome'}));
        try{
            const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
            await page.route('http://127.0.0.1:3199/**',route=>{const path=new URL(route.request().url()).pathname;return route.fulfill(path==='/api/v2/admin/dashboard'?{contentType:'application/json',body:JSON.stringify(payload)}:{contentType:path.endsWith('.js')?'text/javascript':path.endsWith('.css')?'text/css':'text/html',body:path==='/harness.js'?bundle.js:path==='/harness.css'?bundle.css:bundle.html});});
            await page.goto('http://127.0.0.1:3199/');const board=page.getByRole('region',{name:'考试数据看板'});await board.getByRole('img',{name:'答案覆盖率 53%'}).waitFor();
            expect(await board.locator('.console-metric').count()).toBe(4);expect(await board.getByRole('button',{name:'查看待处理题',exact:true}).count()).toBe(1);
            await board.getByRole('button',{name:'查看待处理题',exact:true}).click();expect(await page.getByLabel('首页操作').innerText()).toBe('issues:all');
            await board.locator('.reason-bars').getByRole('button',{name:'题图不完整 21',exact:true}).click();expect(await page.getByLabel('首页操作').innerText()).toBe('issues:image_incomplete');
            const distributionBounds=await board.locator('.home-chart-grid .distribution-chart').evaluate(n=>({bottom:n.getBoundingClientRect().bottom,parentBottom:n.parentElement?.getBoundingClientRect().bottom??0}));expect(distributionBounds.bottom).toBeLessThanOrEqual(distributionBounds.parentBottom+1);
            await board.locator('.students-panel').getByRole('button',{name:'查看',exact:true}).first().click();expect(await page.getByLabel('首页操作').innerText()).toBe('student:'+template.attemptId);
            await board.getByRole('button',{name:'柱图',exact:true}).click();expect(await board.locator('.chart-bar').count()).toBe(24);await board.getByRole('button',{name:'趋势',exact:true}).click();
            await page.emulateMedia({reducedMotion:'reduce'});expect(await board.locator('.orbit-value').evaluate(n=>getComputedStyle(n).animationName)).toBe('none');
            for(const width of [1280,768,390,320]){
                await page.setViewportSize({width,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
                if(width<=390){const container=await board.locator('.home-attention').boundingBox(),panel=await board.locator('.issues-panel').boundingBox();if(!container||!panel)throw new Error('MISSING_ATTENTION_LAYOUT');expect(Math.abs(container.width-panel.width)).toBeLessThan(2);expect((await board.getByRole('button',{name:'查看待处理题',exact:true}).boundingBox())?.height).toBeGreaterThanOrEqual(44);}
            }
            payload=ExamDashboardSchema.parse({...payload,summary:{students:0,online:0,total:0,answered:0,verified:0,humanConfirmed:0,active:0,attention:0},modules:[],students:[],issues:[{reason:'image_incomplete',count:0}],distribution:payload.distribution.map(item=>({...item,count:0})),throughput:payload.throughput.map(item=>({...item,ai:0,human:0}))});
            await board.getByRole('button',{name:'刷新',exact:true}).click();await board.getByRole('img',{name:'答案覆盖率 0%'}).waitFor();expect(await board.innerText()).not.toMatch(/NaN|Infinity/);expect(await board.locator('.home-attention-total').evaluate(n=>n.classList.contains('feedback-tone-success'))).toBe(true);expect(await board.locator('.reason-bars b').getAttribute('style')).toContain('width: 0%');
            expect(await board.getByText('暂无考试分配',{exact:true}).isVisible()).toBe(true);expect(await board.locator('.orbit-value').getAttribute('opacity')).toBe('0');expect(errors).toEqual([]);
        }finally{await browser.close();}
    },40000);

    it('teacher access: healthy questions expose AI answering and full manual choices in Chrome', async () => {
        const teacher = await createUser(pool(), admin, { username: 'healthy_ui_teacher', displayName: '作答老师', password: 'synthetic-password-123', roles: ['support'] }, password);
        const child = await createUser(pool(), admin, { username: 'healthy_ui_student', displayName: '作答同学', password: 'synthetic-password-123', roles: ['student'] }, password);
        const assignment = await createAssignment(pool(), admin, { sittingId, studentId: child.id, supportIds: [teacher.id] });
        const attempt = await startAttempt(pool(), child, assignment.id), snap = await snapshot(pool(), child, attempt.id);
        const first = snap.slots[0], second = snap.slots[1]; if (!first || !second) throw new Error('NO_SLOT');
        const pass = SolveOutcomeSchema.parse({ ...outcome(), verified: true, verificationStatus: undefined, verification: { schemaVersion: 1, verdict: 'pass', checked: ['transcription', 'logic'], issues: [] } });
        if (pass.status !== 'completed' || pass.candidate.kind !== 'answer') throw new Error('NO_ANSWER');
        for (const slot of [first, second]) {
            await submit(pool(), child, slot.id, { requestId: randomUUID(), expectedRevision: 0, kind: 'initial', assetIds: [await asset(slot.id, child)] });
            const job = await claimJob(pool()); if (!job || job.slotId !== slot.id) throw new Error('WRONG_JOB');
            const result = slot.id === first.id ? pass : SolveOutcomeSchema.parse({ ...pass, candidate: { ...pass.candidate, problem: { ...pass.candidate.problem, text: 'Select the two even values.', response: { type: 'multiple-choice' } }, selectedOptions: ['B', 'D'], answer: 'B. 4\nD. 6' } });
            await finishJob(pool(), job, result, null);
        }
        expect((await snapshot(pool(), child, attempt.id)).alerts).toHaveLength(0);
        let live: ReturnType<typeof createExamService> | undefined;
        const server = serve({ fetch: req => live ? live.app.fetch(req) : new Response(null, { status: 503 }), hostname: '127.0.0.1', port: 0 });
        await new Promise<void>(resolve => server.listening ? resolve() : server.once('listening', () => resolve()));
        const address = server.address(); if (!address || typeof address === 'string' || !(server instanceof Server)) throw new Error('NO_ADDRESS');
        const local = 'http://127.0.0.1:' + address.port;
        live = createExamService({ pool: pool(), storage, origin: local, publicDir: join(process.cwd(), 'apps/exam-web/dist/public'), clientAddress: () => 'healthy-question-ui' });
        const closeWs = realtime(server, pool(), local, live.session);
        const browser = await chromium.launch({ executablePath: process.env.SOLVEFLOW_TEST_CHROME ?? '/usr/bin/google-chrome', headless: true });
        const screens = join(process.cwd(), '.runtime/teacher-answer/screens'); await mkdir(screens, { recursive: true });
        const errors: string[] = [];
        try {
            const staff = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
            const pupil = await browser.newPage({ viewport: { width: 390, height: 844 } });
            let answerRequests = 0;
            staff.on('request', request => { if (request.method() === 'POST' && request.url().endsWith('/run')) answerRequests++; });
            for (const [page, username] of [[staff, teacher.username], [pupil, child.username]] as const) {
                page.on('pageerror', error => errors.push(error.message));
                await page.goto(local); await page.getByLabel('用户名', { exact: true }).fill(username); await page.getByLabel('密码', { exact: true }).fill('synthetic-password-123'); await page.getByRole('button', { name: '登录', exact: true }).click();
            }
            await pupil.locator('.answer-card').waitFor();
            await staff.locator('.student-row').filter({ hasText: child.displayName }).click();
            const dialog = staff.getByRole('dialog');
            const nav = dialog.getByRole('region', { name: '题目导航', exact: true }); await nav.waitFor();
            await nav.locator('section').first().getByRole('button', { name: /第1题$/, exact: false }).click();
            await dialog.getByRole('button', { name: '开始 AI 答题', exact: true }).waitFor();
            expect(await dialog.getByRole('button', { name: '开始 AI 答题', exact: true }).isEnabled()).toBe(true);
            const modes = dialog.getByRole('tablist', { name: '题目处理', exact: true });
            expect(await modes.getByRole('tab').count()).toBe(3);
            const leftQuestion = dialog.getByRole('region', { name: '题目与原图', exact: true });
            const questionText = await leftQuestion.innerText();
            const imageSource = await leftQuestion.locator('img').first().getAttribute('src');
            await modes.getByRole('tab', { name: 'AI 答题', exact: true }).focus();
            await staff.keyboard.press('ArrowRight');
            expect(await modes.getByRole('tab', { name: '手动作答', exact: true }).evaluate(el => el === document.activeElement)).toBe(true);
            expect(await modes.getByRole('tab', { name: 'AI 答题', exact: true }).getAttribute('aria-selected')).toBe('true');
            await staff.keyboard.press('Enter');
            expect(await dialog.locator('.review-choice').count()).toBe(4);
            expect(await dialog.getByRole('tab', { name: '手动作答', exact: true }).evaluate(el => el === document.activeElement)).toBe(true);
            expect(await dialog.locator('.review-question .option').count()).toBe(4);
            expect(await dialog.getByRole('button', { name: '保存并通知学生', exact: true }).isDisabled()).toBe(true);
            expect(await dialog.locator('.review-choice').filter({ has: staff.getByRole('radio', { name: 'C', exact: true }) }).innerText()).toBe('C');
            expect(await dialog.locator('.review-question .option').filter({ hasText: '5' }).count()).toBe(1);
            await dialog.getByRole('radio', { name: 'C', exact: true }).check();
            expect(await dialog.locator('.review-choice.selected').innerText()).toBe('C'); expect(await dialog.getByRole('textbox', { name: '确认答案', exact: true }).count()).toBe(0);
            await dialog.getByLabel('处理意见', { exact: true }).fill('合成界面测试：验证老师选项能同步，不评估数学正确率。');
            await modes.getByRole('tab', { name: '发消息', exact: true }).click();
            const composer = dialog.getByRole('tabpanel', { name: '发消息', exact: true });
            await composer.getByLabel('消息内容', { exact: true }).fill('仅用于验证模式切换保留草稿。');
            expect(await staff.getByRole('dialog').count()).toBe(1);
            expect(await leftQuestion.innerText()).toBe(questionText);
            expect(await leftQuestion.locator('img').first().getAttribute('src')).toBe(imageSource);
            await staff.screenshot({ path: join(screens, 'teacher-message-desktop.png'), animations: 'disabled' });
            await modes.getByRole('tab', { name: 'AI 答题', exact: true }).click();
            expect(await dialog.getByRole('button', { name: '开始 AI 答题', exact: true }).isDisabled()).toBe(true);
            expect(answerRequests).toBe(0);
            expect(await leftQuestion.locator('.option').count()).toBe(4);
            await modes.getByRole('tab', { name: '发消息', exact: true }).click();
            expect(await composer.getByLabel('消息内容', { exact: true }).inputValue()).toBe('仅用于验证模式切换保留草稿。');
            await composer.getByRole('button', { name: '取消', exact: true }).click();
            await modes.getByRole('tab', { name: '手动作答', exact: true }).click();
            expect(await dialog.getByRole('radio', { name: 'C', exact: true }).isChecked()).toBe(true);
            expect(await dialog.getByLabel('处理意见', { exact: true }).inputValue()).toBe('合成界面测试：验证老师选项能同步，不评估数学正确率。');
            await dialog.locator('.review-choices').scrollIntoViewIfNeeded();
            await staff.screenshot({ path: join(screens, 'teacher-choice-desktop.png'), animations: 'disabled' });
            await staff.setViewportSize({ width: 390, height: 844 }); await staff.emulateMedia({ colorScheme: 'dark' });
            await dialog.locator('.review-choices').scrollIntoViewIfNeeded();
            await staff.screenshot({ path: join(screens, 'teacher-choice-mobile-dark.png'), animations: 'disabled' });
            expect(await staff.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
            await dialog.getByRole('button', { name: '保存并通知学生', exact: true }).click();
            await pupil.locator('.answer-card').getByText('C. 5', { exact: true }).waitFor({ timeout: 8000 });
            await pupil.locator('.answer-card').getByText('老师已确认', { exact: true }).waitFor();
            expect((await snapshot(pool(), child, attempt.id)).resolutions).toHaveLength(0);
            await pupil.screenshot({ path: join(screens, 'student-teacher-answer.png'), animations: 'disabled' });
            await expect.poll(() => dialog.getByRole('button', { name: '重新核验', exact: true }).isDisabled()).toBe(true);
            await dialog.getByRole('tab', { name: '手动作答', exact: true }).click();
            expect(await dialog.getByRole('radio', { name: 'C', exact: true }).isChecked()).toBe(true);
            await dialog.getByRole('button', { name: '取消', exact: true }).click();
            await dialog.getByRole('button', { name: '开始 AI 答题', exact: true }).click();
            await dialog.locator('.review-detail .badge').filter({ hasText: '排队中' }).waitFor({ timeout: 8000 });
            expect(await dialog.getByRole('button', { name: '开始 AI 答题', exact: true }).isDisabled()).toBe(true);
            const job = await claimJob(pool()); if (!job || job.slotId !== first.id) throw new Error('WRONG_JOB');
            await finishJob(pool(), job, pass, null);
            await pupil.locator('.answer-card').getByText('B. 4', { exact: true }).waitFor({ timeout: 8000 });
            await pupil.locator('.answer-card').getByText('AI 已核验', { exact: true }).waitFor();
            await expect.poll(() => dialog.getByRole('button', { name: '开始 AI 答题', exact: true }).isEnabled()).toBe(true);
            await staff.setViewportSize({ width: 1440, height: 1000 }); await staff.emulateMedia({ colorScheme: 'light' });
            await nav.locator('section').first().getByRole('button', { name: /第2题$/ }).click();
            await dialog.getByRole('heading', { name: '第2题', exact: true }).waitFor();
            await dialog.getByRole('tab', { name: '手动作答', exact: true }).click();
            expect(await dialog.getByRole('checkbox', { name: 'B', exact: true }).isChecked()).toBe(true);
            expect(await dialog.getByRole('checkbox', { name: 'D', exact: true }).isChecked()).toBe(true);
            await dialog.getByRole('checkbox', { name: 'D', exact: true }).uncheck();
            expect(await dialog.locator('.review-choice.selected').allTextContents()).toEqual(['B']);
            await dialog.getByRole('checkbox', { name: 'D', exact: true }).check();
            expect(await dialog.locator('.review-choice.selected').allTextContents()).toEqual(['B','D']);
            await dialog.getByLabel('处理意见', { exact: true }).fill('确认两个偶数选项。');
            await dialog.locator('.review-choices').scrollIntoViewIfNeeded();
            await staff.screenshot({ path: join(screens, 'teacher-multiple-choice.png'), animations: 'disabled' });
            await dialog.getByRole('button', { name: '保存并通知学生', exact: true }).click();
            expect(await pupil.locator('.current-answer').innerText()).toContain('B. 4');
            await pupil.getByRole('button', { name: '下一题', exact: true }).click();
            await pupil.getByRole('heading', { name: '第2题答案', exact: true }).waitFor({ timeout: 8000 });
            await expect.poll(async () => (await slotDetail(pool(), child, second.id)).slot.presentation?.selectedOptions).toEqual(['B', 'D']);
            await nav.locator('section').first().getByRole('button', { name: /第3题$/ }).click();
            await dialog.getByRole('heading', { name: '第3题', exact: true }).waitFor();
            expect(await dialog.getByRole('button', { name: '开始 AI 答题', exact: true }).count()).toBe(0);
            expect(await dialog.getByRole('tab', { name: '手动作答', exact: true }).count()).toBe(0);
            const third = snap.slots[2]; if (!third) throw new Error('NO_SLOT');
            await submit(pool(), child, third.id, { requestId: randomUUID(), expectedRevision: 0, kind: 'initial', assetIds: [await asset(third.id, child)] });
            const incomplete = await claimJob(pool()); if (!incomplete || incomplete.slotId !== third.id) throw new Error('WRONG_JOB');
            await finishJob(pool(), incomplete, SolveOutcomeSchema.parse({ schemaVersion: 1, status: 'needs_clarification', verified: false, candidate: { schemaVersion: 1, kind: 'clarification', problem: { text: 'What is 2 + 2?', subject: 'math', uncertainties: ['未拍到完整选项'], response: { type: 'single-choice' }, options: [{ label: 'A', text: '3' }], optionsComplete: false }, answer: null, steps: [], knowledgePoints: [], citationIds: [], clarificationQuestions: ['请补充选项。'] } }), null);
            await dialog.locator('.review-detail .badge').filter({ hasText: '需要补图' }).waitFor({ timeout: 8000 });
            await dialog.getByRole('tab', { name: '手动作答', exact: true }).click();
            expect(await dialog.getByRole('radio').count()).toBe(0);
            const written = dialog.getByRole('textbox', { name: '确认答案', exact: true });
            expect(await written.getAttribute('readonly')).toBeNull();
            await written.fill('B. 4'); await dialog.getByLabel('处理意见', { exact: true }).fill('核对原图，人工补充尚未识别的答案。');
            await dialog.getByRole('button', { name: '保存并通知学生', exact: true }).click();
            const updated = pupil.getByRole('dialog', { name: '答案已更新', exact: true }); await updated.waitFor({ timeout: 8000 });
            await updated.getByRole('button', { name: '稍后查看', exact: true }).click();
            expect(await pupil.getByRole('heading', { name: '第2题答案', exact: true }).isVisible()).toBe(true);
            await pupil.getByRole('button', { name: '下一题', exact: true }).click();
            await pupil.getByRole('heading', { name: '第3题答案', exact: true }).waitFor({ timeout: 8000 });
            await pupil.locator('.answer-card').getByText('B. 4', { exact: true }).waitFor();
            await pupil.getByRole('region', { name: '已解决题目' }).waitFor();
            expect(errors).toEqual([]);
        } finally { closeWs(); await browser.close(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
    }, 40000);
    it('teacher access: legacy choices retain selection checks and missing options permit a written answer', async () => {
        const base = outcome(); if (base.status !== 'completed' || base.candidate.kind !== 'answer') throw new Error('NO_ANSWER');
        for (const kind of ['legacy', 'missing', 'partial'] as const) {
            const { child, slot, run } = await queuedReviewSlot('teacher_options_' + kind);
            const job = await claimJob(pool()); if (!job || job.id !== run.runId) throw new Error('WRONG_JOB');
            const problem = kind === 'legacy' ? { ...base.candidate.problem, response: undefined } : { ...base.candidate.problem, options: kind === 'partial' ? [{ label: 'A', text: '3' }] : undefined, optionsComplete: false, uncertainties: ['部分选项未拍清'] };
            const result = kind === 'legacy' ? { ...base, candidate: { ...base.candidate, problem } } : { schemaVersion: 1, status: 'needs_clarification', verified: false, candidate: { schemaVersion: 1, kind: 'clarification', problem, answer: null, steps: [], knowledgePoints: [], citationIds: [], clarificationQuestions: ['请补充完整选项。'] } };
            await finishJob(pool(), job, SolveOutcomeSchema.parse(result), null);
            const request = { requestId: randomUUID(), expectedRevision: 1, expectedRunId: run.runId, note: '检查原图后人工作答。' };
            if (kind === 'legacy') {
                await expect(teacherConfirm(pool(), admin, slot.id, { ...request, answer: 'C. 5', selectedOptions: null })).rejects.toThrow('请选择');
                await teacherConfirm(pool(), admin, slot.id, { ...request, answer: 'C. 5', selectedOptions: ['C'] });
            } else {
                await expect(teacherConfirm(pool(), admin, slot.id, { ...request, answer: 'B. 4', selectedOptions: ['B'] })).rejects.toThrow('原始选项');
                await teacherConfirm(pool(), admin, slot.id, { ...request, answer: '4', selectedOptions: null });
            }
            expect((await slotDetail(pool(), child, slot.id)).slot.presentation).toMatchObject({ humanConfirmed: true, verified: false });
        }
    });
    it('teacher access: can ask AI to solve a verified question without affecting other slots', async () => {
        const { child, slot, run } = await queuedReviewSlot('teacher_healthy_ai');
        const initial = await claimJob(pool()); if (!initial || initial.id !== run.runId) throw new Error('WRONG_JOB');
        const pass = SolveOutcomeSchema.parse({ ...outcome(), verified: true, verificationStatus: undefined, verification: { schemaVersion: 1, verdict: 'pass', checked: ['transcription', 'logic'], issues: [] } });
        await finishJob(pool(), initial, pass, null);
        const attempt = z.uuid().parse((await pool().query('SELECT attempt_id FROM exam_app.question_slots WHERE id=$1', [slot.id])).rows[0]?.attempt_id);
        const before = await snapshot(pool(), child, attempt), second = before.slots[1], third = before.slots[2]; if (!second || !third) throw new Error('NO_SLOT');
        expect(before.alerts).toHaveLength(0);
        const request = { requestId: randomUUID(), expectedRevision: 1, expectedRunId: initial.id, expectedReviewId: null, action: 'solve' };
        await expect(teacherRun(pool(), child, slot.id, request)).rejects.toThrow('无权');
        const next = await teacherRun(pool(), admin, slot.id, request);
        expect(await teacherRun(pool(), admin, slot.id, request)).toEqual(next);
        await expect(teacherRun(pool(), admin, slot.id, { ...request, requestId: randomUUID(), expectedRunId: next.id })).rejects.toThrow('正在');
        const job = await claimJob(pool()); if (!job || job.id !== next.id) throw new Error('WRONG_JOB');
        const independent = await submit(pool(), child, second.id, { requestId: randomUUID(), expectedRevision: 0, kind: 'initial', assetIds: [await asset(second.id, child)] });
        const nav = await snapshot(pool(), child, attempt);
        await navigateAttempt(pool(), child, attempt, { requestId: randomUUID(), expectedVersion: nav.navigationVersion, action: 'select_slot', slotId: third.id });
        await finishJob(pool(), job, pass, null);
        const done = await snapshot(pool(), child, attempt);
        expect(done.nextSlotId).toBe(third.id); expect(done.slots[1]?.status).toBe('queued');
        expect(done.slots[0]?.presentation).toMatchObject({ verified: true, humanConfirmed: false });
        expect((await pool().query('SELECT count(*) FROM exam_app.answer_runs WHERE slot_id=$1', [slot.id])).rows[0]?.count).toBe('2');
        await cancelJob(pool(), child, independent.runId);
    });
    it('teacher access: manual edits on healthy questions are versioned and AI can replace the current human answer', async () => {
        const { child, slot, run } = await queuedReviewSlot('teacher_healthy_manual');
        const initial = await claimJob(pool()); if (!initial || initial.id !== run.runId) throw new Error('WRONG_JOB');
        const pass = SolveOutcomeSchema.parse({ ...outcome(), verified: true, verificationStatus: undefined, verification: { schemaVersion: 1, verdict: 'pass', checked: ['transcription', 'logic'], issues: [] } });
        await finishJob(pool(), initial, pass, null);
        const first = { requestId: randomUUID(), expectedRevision: 1, expectedRunId: initial.id, answer: 'C. 5', selectedOptions: ['C'], note: '合成场景只验证手动选择与同步。' };
        const review = await teacherConfirm(pool(), admin, slot.id, first);
        expect(await teacherConfirm(pool(), admin, slot.id, first)).toEqual(review);
        const digest = createHash('sha256').update(JSON.stringify({ slotId: slot.id, ...first })).digest('hex');
        expect((await pool().query('SELECT input_sha256 FROM exam_app.idempotency_requests WHERE actor_id=$1 AND request_id=$2', [admin.id, first.requestId])).rows[0]?.input_sha256).toBe(digest);
        const current = await slotDetail(pool(), admin, slot.id);
        expect(current.slot.reviewId).toBe(review.id); expect(current.slot.presentation).toMatchObject({ selectedOptions: ['C'], humanConfirmed: true, verified: false });
        await expect(teacherConfirm(pool(), admin, slot.id, { ...first, requestId: randomUUID() })).rejects.toThrow('已更新');
        await expect(teacherRun(pool(), admin, slot.id, { requestId: randomUUID(), expectedRevision: 1, expectedRunId: initial.id, expectedReviewId: review.id, action: 'verify' })).rejects.toThrow('人工答案');
        const request = { expectedRevision: 1, expectedRunId: initial.id, expectedReviewId: review.id, answer: 'B. 4', selectedOptions: ['B'], note: '第二次独立人工确认。' };
        const racing = await Promise.allSettled([1,2].map(() => teacherConfirm(pool(), admin, slot.id, { ...request, requestId: randomUUID() })));
        expect(racing.filter(r => r.status === 'fulfilled')).toHaveLength(1);
        const latest = await slotDetail(pool(), admin, slot.id);
        const next = await teacherRun(pool(), admin, slot.id, { requestId: randomUUID(), expectedRevision: 1, expectedRunId: initial.id, expectedReviewId: latest.slot.reviewId, action: 'solve' });
        const queued = (await slotDetail(pool(), admin, slot.id)).slot;
        expect(queued.status).toBe('queued'); expect(queued.presentation?.humanConfirmed).toBe(true);
        const job = await claimJob(pool()); if (!job || job.id !== next.id) throw new Error('WRONG_JOB');
        await finishJob(pool(), job, pass, null);
        const done = await slotDetail(pool(), admin, slot.id);
        expect(done.slot.reviewId).toBeNull(); expect(done.slot.presentation).toMatchObject({ answer: 'B. 4', verified: true, humanConfirmed: false });
        expect(done.humanReviews).toHaveLength(2);
    });
    it('imports HEIC initial, supplement and retake images in the student UI without moving the target slot', async () => {
        const child = await createUser(pool(), admin, { username: 'heic_ui_student', displayName: 'HEIC回归同学', password: 'synthetic-password-123', roles: ['student'] }, password);
        const assignment = await createAssignment(pool(), admin, { sittingId, studentId: child.id });
        const attempt = await startAttempt(pool(), child, assignment.id);
        const slot = (await snapshot(pool(), child, attempt.id)).slots[0]; if (!slot) throw new Error('NO_SLOT');
        let live: ReturnType<typeof createExamService> | undefined;
        const server = serve({ fetch: req => live ? live.app.fetch(req) : new Response(null, { status: 503 }), hostname: '127.0.0.1', port: 0 });
        await new Promise<void>(resolve => server.listening ? resolve() : server.once('listening', () => resolve()));
        const address = server.address(); if (!address || typeof address === 'string' || !(server instanceof Server)) throw new Error('NO_ADDRESS');
        const local = 'http://127.0.0.1:' + address.port;
        live = createExamService({ pool: pool(), storage, origin: local, publicDir: join(process.cwd(), 'apps/exam-web/dist/public'), clientAddress: () => 'heic-upload-ui' });
        const closeWs = realtime(server, pool(), local, live.session);
        const browser = process.env.SOLVEFLOW_EXAM_UPLOAD_ENGINE === 'webkit' ? await webkit.launch({ headless: true }) : await chromium.launch({ executablePath: process.env.SOLVEFLOW_TEST_CHROME ?? '/usr/bin/google-chrome', headless: true });
        const errors: string[] = [];
        try {
            const page = await browser.newPage({ viewport: { width: 390, height: 844 } }); page.on('pageerror', e => errors.push(e.message));
            const codecWorker = await page.request.get(local + '/heic-worker-1-23-5.js'); expect(codecWorker.status()).toBe(200); expect(codecWorker.headers()['cache-control']).toBe('no-cache');
            expect(codecWorker.headers()['content-security-policy']).toContain("'wasm-unsafe-eval'"); expect(codecWorker.headers()['x-content-type-options']).toBe('nosniff');
            await page.goto(local); await page.getByLabel('用户名', { exact: true }).fill(child.username); await page.getByLabel('密码', { exact: true }).fill('synthetic-password-123'); await page.getByRole('button', { name: '登录', exact: true }).click();
            const input = page.locator('input[type=file]'), fixture = (name: string) => join(process.cwd(), 'tests/fixtures/images', name);
            for (const kind of ['initial', 'supplement', 'retake'] as const) {

                await page.getByRole('button', { name: kind === 'supplement' ? '补图' : '从相册选择', exact: true }).waitFor();
                const chooser = page.waitForEvent('filechooser', { timeout: 5000 }); await page.getByRole('button', { name: kind === 'supplement' ? '补图' : '从相册选择', exact: true }).click();
                await (await chooser).setFiles(kind === 'supplement' ? [fixture('rotated.heic'), fixture('primary-second.heic')] : fixture(kind === 'initial' ? '48mp.heic' : '24mp.heic'));
                const dialog = page.getByRole('dialog'); await dialog.getByRole('button', { name: '保存并解答', exact: true }).waitFor();
                await expect.poll(() => dialog.locator('img').evaluateAll(images => images.every(image => image instanceof HTMLImageElement && image.complete && image.naturalWidth > 0))).toBe(true);
                const screens = join(process.cwd(), '.runtime/heic-review/screens'); await mkdir(screens, { recursive: true });
                await page.screenshot({ path: join(screens, (process.env.SOLVEFLOW_EXAM_UPLOAD_ENGINE ?? 'chromium') + '-draft-' + kind + '.png') });
                expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
                const request = page.waitForRequest(req => req.url().endsWith('/submissions') && req.method() === 'POST');
                await dialog.getByRole('button', { name: '保存并解答', exact: true }).click();
                expect((await request).url()).toContain('/slots/' + slot.id + '/submissions'); await dialog.waitFor({ state: 'hidden' });
                const detail = await slotDetail(pool(), child, slot.id);
                expect(detail.slot.revision).toBe(kind === 'initial' ? 1 : kind === 'supplement' ? 2 : 3);
                expect(detail.slot.images).toHaveLength(kind === 'supplement' ? 3 : 1);
                const dimensions: { width?: number; height?: number }[] = [];
                for (const image of detail.slot.images) {
                    const response = await page.request.get(local + '/api/v2/media/' + image.id + '?view=source');
                    expect(response.status()).toBe(200); const metadata = await sharp(await response.body()).metadata();
                    expect(metadata.format).toBe('jpeg'); expect(metadata.exif).toBeUndefined(); dimensions.push({ width: metadata.width, height: metadata.height });
                }
                if (kind === 'initial') expect(dimensions).toEqual([{ width: 4096, height: 3072 }]);
                if (kind === 'supplement') expect(dimensions.some(image => image.width === 320 && image.height === 480)).toBe(true);
            }
            const before = (await slotDetail(pool(), child, slot.id)).slot.revision;
            await page.route('**/heic-worker-1-23-5.js', route => route.fulfill({ contentType: 'text/javascript', body: 'onmessage=()=>{};' }));
            await page.getByRole('button', { name: '从相册选择', exact: true }).click({ noWaitAfter: true });
            await input.setInputFiles(fixture('synthetic.heic'));
            await page.getByRole('dialog', { name: '正在处理图片…', exact: true }).getByRole('button', { name: '取消', exact: true }).click();
            await page.getByRole('dialog').waitFor({ state: 'hidden' }); expect((await slotDetail(pool(), child, slot.id)).slot.revision).toBe(before);
            expect(await page.getByRole('button', { name: '从相册选择', exact: true }).isEnabled()).toBe(true);
            expect(errors).toEqual([]);
            const running = (await slotDetail(pool(), child, slot.id)).slot.runId; if (running) await cancelJob(pool(), child, running);
        } finally { await browser.close(); closeWs(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
    }, 40000);

    it('deep review: a long select reveals its current option and Tab continues after the control', async () => {
        const bundle = await browserHarness(`import {createRoot} from 'react-dom/client';import {Select} from '@solveflow/web-ui/select';import {Dialog} from '@solveflow/web-ui/dialog';createRoot(document.getElementById('root')).render(<Dialog title="分配考试" onClose={()=>{}}><Select label="学生" defaultValue="39" options={Array.from({length:40},(_,i)=>({value:String(i),label:'合成同学'+(i+1)}))}/><button>后续操作</button><div style={{height:220}}/></Dialog>);`);
        const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true });
        try {
            const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
            await page.route('http://127.0.0.1:3199/**', route => { const path = new URL(route.request().url()).pathname; return route.fulfill({contentType:path.endsWith('.js')?'text/javascript':path.endsWith('.css')?'text/css':'text/html',body:path==='/harness.js'?bundle.js:path==='/harness.css'?bundle.css:bundle.html}); });
            await page.goto('http://127.0.0.1:3199/');
            await page.getByRole('combobox',{name:'学生',exact:true}).click();
            const option = page.getByRole('option',{name:'合成同学40',exact:true});await option.waitFor();
            const screens = join(process.cwd(), '.runtime/deep-review/screens');await mkdir(screens,{recursive:true});
            await page.screenshot({path:join(screens,'select-current.png'),animations:'disabled'});
            await expect.poll(()=>option.evaluate(el=>{const list=el.closest('[role="listbox"]');if(!list)return false;const a=el.getBoundingClientRect(),b=list.getBoundingClientRect();return a.top>=b.top&&a.bottom<=b.bottom;}),{timeout:2000}).toBe(true);
            await page.emulateMedia({colorScheme:'dark'});
            for (const control of [page.getByRole('combobox',{name:'学生',exact:true}), option]) {
                await expect.poll(()=>control.evaluate(el=>{
                    const luminance=(color:string)=>{
                        const channels=color.match(/[\d.]+/g)?.slice(0,3).map(Number);
                        if(!channels||channels.length!==3)throw new Error('EXPECTED_RGB_COLOR');
                        const linear=channels.map(value=>{const v=value/255;return v<=0.04045?v/12.92:((v+0.055)/1.055)**2.4;});
                        return 0.2126*linear[0]!+0.7152*linear[1]!+0.0722*linear[2]!;
                    };
                    const style=getComputedStyle(el),a=luminance(style.color),b=luminance(style.backgroundColor);
                    return (Math.max(a,b)+0.05)/(Math.min(a,b)+0.05);
                })).toBeGreaterThanOrEqual(4.5);
            }
            await page.screenshot({path:join(screens,'select-current-dark.png'),animations:'disabled'});
            await page.keyboard.press('Tab');
            await expect.poll(()=>page.getByRole('button',{name:'后续操作',exact:true}).evaluate(el=>document.activeElement===el)).toBe(true);
            await page.getByRole('combobox',{name:'学生',exact:true}).click();await page.keyboard.press('Escape');
            await expect.poll(()=>page.getByRole('combobox',{name:'学生',exact:true}).evaluate(el=>document.activeElement===el)).toBe(true);
        } finally {await browser.close();}
    });
    it('deep review: late inline details cannot replace another question or restore an exited view', async () => {
        const {child,slot,run}=await queuedReviewSlot('deep_detail_race');
        const firstJob=await claimJob(pool());if(!firstJob||firstJob.id!==run.runId)throw new Error('WRONG_JOB');await finishJob(pool(),firstJob,outcome(),null);
        const second=(await snapshot(pool(),child,firstJob.attemptId)).slots[1];if(!second)throw new Error('NO_SLOT');
        await submit(pool(),child,second.id,{requestId:randomUUID(),expectedRevision:0,kind:'initial',assetIds:[await asset(second.id,child)]});
        const secondJob=await claimJob(pool());if(!secondJob||secondJob.slotId!==second.id)throw new Error('WRONG_JOB');await finishJob(pool(),secondJob,outcome(),null);
        await navigateAttempt(pool(),child,firstJob.attemptId,{requestId:randomUUID(),action:'select_slot',slotId:slot.id,expectedVersion:(await snapshot(pool(),child,firstJob.attemptId)).navigationVersion});
        const base=await snapshot(pool(),child,firstJob.attemptId),details=new Map([[slot.id,await slotDetail(pool(),child,slot.id)],[second.id,await slotDetail(pool(),child,second.id)]]);
        const bundle=await browserHarness(`import {useState} from 'react';import {createRoot} from 'react-dom/client';import {StudentAttempt} from './src/browser/student.tsx';function App(){const[shown,setShown]=useState(true);return <main className="student-content">{shown?<><button onClick={()=>setShown(false)}>返回考试记录</button><StudentAttempt id="${base.id}" onExit={()=>setShown(false)}/></>:<p>已返回考试记录</p>}</main>}createRoot(document.getElementById('root')).render(<App/>);`);
        const browser=await chromium.launch({executablePath:'/usr/bin/google-chrome',headless:true});
        let release=()=>{};
        try {
            for(const closeBeforeLate of [false,true]){
                const page=await browser.newPage({viewport:{width:390,height:844}});
                await page.addInitScript(`window.WebSocket=class{static OPEN=1;readyState=0;send(){}close(){}};`);
                let started=()=>{},delivered=()=>{};
                const gate=new Promise<void>(resolve=>release=resolve),requested=new Promise<void>(resolve=>started=resolve),settled=new Promise<void>(resolve=>delivered=resolve);
                await page.route('http://127.0.0.1:3199/**',async route=>{
                    const path=new URL(route.request().url()).pathname;
                    if(path==='/')return route.fulfill({contentType:'text/html',body:bundle.html});
                    if(path==='/harness.js')return route.fulfill({contentType:'text/javascript',body:bundle.js});
                    if(path==='/harness.css')return route.fulfill({contentType:'text/css',body:bundle.css});
                    if(path.endsWith('/snapshot'))return route.fulfill({contentType:'application/json',body:JSON.stringify(base)});
                    if(path.endsWith('/navigation')){const action=ExamNavigationSchema.parse(route.request().postDataJSON());if(!('slotId' in action))throw new Error('EXPECTED_SLOT');base.viewedSlotId=action.slotId;base.nextSlotId=action.slotId;base.navigationVersion++;base.lastSeq++;return route.fulfill({json:{id:base.id,slotId:action.slotId,navigationVersion:base.navigationVersion}});}
                    const detail=details.get(path.split('/').at(-1)??'');
                    if(detail){if(detail.slot.id===slot.id){started();await gate;try{await route.fulfill({contentType:'application/json',body:JSON.stringify(detail)});}finally{delivered();}return;}return route.fulfill({contentType:'application/json',body:JSON.stringify(detail)});}
                    return route.fulfill({status:404,body:'{}'});
                });
                base.viewedSlotId=slot.id;base.nextSlotId=slot.id;
                await page.goto('http://127.0.0.1:3199/');await page.locator('.current-answer').waitFor();await page.locator('.current-answer summary').filter({hasText:'题目详情'}).click();await requested;
                await page.getByRole('button',{name:'下一题',exact:true}).click();await page.getByRole('heading',{name:'第2题答案',exact:true}).waitFor();
                if(closeBeforeLate)await page.getByRole('button',{name:'返回考试记录',exact:true}).click();
                release();await settled;await delay(150);
                const screens=join(process.cwd(),'.runtime/deep-review/screens');await mkdir(screens,{recursive:true});await page.screenshot({path:join(screens,closeBeforeLate?'detail-closed.png':'detail-latest.png'),animations:'disabled'});
                expect(await page.locator('.current-answer').count()).toBe(closeBeforeLate?0:1);expect(await page.getByRole('dialog').count()).toBe(0);
                if(!closeBeforeLate)expect(await page.locator('.current-answer h3').first().innerText()).toBe('第2题答案');
                await page.close();
            }
        } finally {release();await browser.close();}
    });
    it('notifications: large lists stay compact, keyboard accessible and readable across themes', async () => {
        const bundle = await browserHarness(`import {useState} from 'react';import {createRoot} from 'react-dom/client';import {QuestionNotices,ErrorText,Feedback} from './src/browser/components.tsx';function Preview(){const[count,setCount]=useState(60);const[selected,setSelected]=useState(0);return <main className="student-content"><QuestionNotices label="待处理核验问题" title={'待处理 · '+count+' 题'} tone="error">{Array.from({length:count},(_,i)=><button key={i} onClick={()=>setSelected(i+1)}><span className="notice-question">长模块名称阅读与写作 · 第{i+1}题<span>核验未通过</span></span></button>)}</QuestionNotices><button onClick={()=>setCount(n=>n+1)}>同步新增问题</button><output aria-label="选中题目">{selected}</output><ErrorText error={'上传失败，请重新选择图片。'+'x'.repeat(150)}/><Feedback>正在恢复连接</Feedback><Feedback tone="success">考试已分配</Feedback><Feedback tone="warning">考试即将结束</Feedback></main>};createRoot(document.getElementById('root')).render(<Preview/>);`);
        const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true });
        try {
            const page = await browser.newPage({ viewport: { width: 320, height: 568 } });
            await page.route('http://127.0.0.1:3199/**', route => { const path = new URL(route.request().url()).pathname; return route.fulfill({contentType:path.endsWith('.js')?'text/javascript':path.endsWith('.css')?'text/css':'text/html',body:path==='/harness.js'?bundle.js:path==='/harness.css'?bundle.css:bundle.html}); });
            await page.goto('http://127.0.0.1:3199/');
            const pending = page.getByRole('region', { name: '待处理核验问题' }), summary = pending.locator('summary');
            await summary.waitFor();
            expect((await pending.boundingBox())?.height).toBeLessThanOrEqual(72);
            expect(await pending.locator('.alert-links').isVisible()).toBe(false);
            await summary.focus(); await page.keyboard.press('Enter');
            expect(await pending.locator('.alert-links').evaluate(element => element.scrollHeight > element.clientHeight)).toBe(true);
            expect((await pending.boundingBox())?.height).toBeLessThanOrEqual(260);
            await page.getByRole('button', { name: '同步新增问题' }).click();
            expect(await pending.locator('details').evaluate(element => element instanceof HTMLDetailsElement && element.open)).toBe(true);
            await pending.locator('.alert-links button').last().click();
            expect(await page.getByLabel('选中题目').innerText()).toBe('61');
            await summary.press('Space');
            expect(await pending.locator('.alert-links').isVisible()).toBe(false);
            expect(await pending.isVisible()).toBe(true);
            const screens = join(process.cwd(), '.runtime/notification-style/screens'); await mkdir(screens, { recursive: true });
            for (const colorScheme of ['light', 'dark'] as const) {
                await page.emulateMedia({ colorScheme });
                await page.screenshot({ path: join(screens, 'feedback-320-' + colorScheme + '.png'), fullPage: true, animations: 'disabled' });
                expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
                expect(await page.getByRole('alert').count()).toBe(1);
                expect(await page.getByRole('status').count()).toBe(4);
                const boxes = page.locator('.feedback,.question-notices');
                for (const box of await boxes.all()) {
                    const ratio = await box.evaluate(element => {
                        const luminance = (color: string) => {
                            const rgb = color.match(/[\d.]+/g)?.slice(0,3).map(Number);
                            if (!rgb || rgb.length !== 3) throw new Error('EXPECTED_RGB_COLOR');
                            const linear = rgb.map(value => { const n=value/255; return n<=0.04045?n/12.92:((n+0.055)/1.055)**2.4; });
                            return .2126*linear[0]!+.7152*linear[1]!+.0722*linear[2]!;
                        };
                        const style=getComputedStyle(element),a=luminance(style.color),b=luminance(style.backgroundColor);
                        return (Math.max(a,b)+.05)/(Math.min(a,b)+.05);
                    });
                    expect(ratio).toBeGreaterThanOrEqual(4.5);
                }
            }
        } finally { await browser.close(); }
    });
    let pagingFixture: Promise<Awaited<ReturnType<typeof makePagingFixture>>>|undefined;
    async function makePagingFixture(){
        const manager=await createUser(pool(),admin,{username:'paging_manager',displayName:'分页管理员',password:'synthetic-password-123',roles:['manager']},password);
        const foreignManager=await createUser(pool(),admin,{username:'paging_foreign',displayName:'另一管理员',password:'synthetic-password-123',roles:['manager']},password);
        await pool().query(`INSERT INTO exam_app.users(id,username,display_name,password_hash,created_by) SELECT gen_random_uuid(),'paging_user_'||n,'分页学生 '||n||CASE WHEN n=620 THEN ' %_' ELSE '' END,$1,$2 FROM generate_series(1,620) n`,[password,manager.id]);
        await pool().query(`INSERT INTO exam_app.user_roles(user_id,role_id) SELECT u.id,r.id FROM exam_app.users u CROSS JOIN exam_app.roles r WHERE u.created_by=$1 AND u.username LIKE 'paging_user_%' AND r.code='student'`,[manager.id]);
        await pool().query(`INSERT INTO exam_app.users(id,username,display_name,password_hash,created_by) SELECT gen_random_uuid(),'paging_staff_'||n,'分页老师 '||n,$1,$2 FROM generate_series(1,25) n`,[password,admin.id]);
        await pool().query(`INSERT INTO exam_app.user_roles(user_id,role_id) SELECT u.id,r.id FROM exam_app.users u CROSS JOIN exam_app.roles r WHERE u.username LIKE 'paging_staff_%' AND r.code='support'`);
        const childId=await one(pool(),z.uuid(),`SELECT id AS value FROM exam_app.users WHERE username='paging_user_1'`),lastId=await one(pool(),z.uuid(),`SELECT id AS value FROM exam_app.users WHERE username='paging_user_620'`);
        const child=await service.app.request('/api/v2/auth/login',{method:'POST',headers:{origin,'content-type':'application/json','x-test-ip':randomUUID()},body:JSON.stringify({username:'paging_user_1',password:'synthetic-password-123'})});
        const childUser=ExamSessionSchema.parse(await child.json()).user;
        await pool().query(`INSERT INTO exam_app.exam_templates(id,code,version,exam_type,title,rules,config_sha256,state,created_by) SELECT gen_random_uuid(),'paging-clone-'||n,1,t.exam_type,'分页模板 '||n,t.rules,t.config_sha256,'published',$2 FROM exam_app.exam_templates t CROSS JOIN generate_series(1,125) n WHERE t.id=$1`,[templateId,manager.id]);
        await pool().query(`INSERT INTO exam_app.template_modules(id,template_id,position,code,section_code,title,question_count,duration_seconds,response_kinds,rules) SELECT gen_random_uuid(),t.id,m.position,m.code,m.section_code,m.title,m.question_count,m.duration_seconds,m.response_kinds,m.rules FROM exam_app.exam_templates t CROSS JOIN exam_app.template_modules m WHERE t.code LIKE 'paging-clone-%' AND m.template_id=$1`,[templateId]);
        await pool().query(`INSERT INTO exam_app.exam_sittings(id,template_id,title,opens_at,closes_at,state,manager_id) SELECT gen_random_uuid(),$1,'分页场次 '||n,now()+interval '1 day'+n*interval '1 minute',now()+interval '2 day'+n*interval '1 minute','published',$2 FROM generate_series(1,625) n`,[templateId,manager.id]);
        const historical=(await createSitting(pool(),manager,{templateId,title:'分页历史待处理',opensAt:new Date(Date.now()-7200000).toISOString(),closesAt:new Date(Date.now()+3600000).toISOString()})).id;
        const historicalAssignment=(await createAssignment(pool(),manager,{sittingId:historical,studentId:childId})).id,historicalAttempt=(await startAttempt(pool(),childUser,historicalAssignment)).id;
        const histSlot=(await snapshot(pool(),childUser,historicalAttempt)).slots[0];if(!histSlot)throw new Error('NO_HISTORY_SLOT');
        await submit(pool(),childUser,histSlot.id,{requestId:randomUUID(),expectedRevision:0,kind:'initial',assetIds:[await asset(histSlot.id,childUser)]});
        await pool().query(`INSERT INTO exam_app.verification_incidents(id,slot_id,attempt_id,student_id,revision_id,source_run_id,reason) SELECT gen_random_uuid(),q.id,q.attempt_id,q.student_id,q.current_revision_id,q.current_run_id,'answer_failed' FROM exam_app.question_slots q WHERE q.id=$1`,[histSlot.id]);
        await pool().query(`UPDATE exam_app.exam_assignments SET closes_at=now()-interval '10 minutes' WHERE id=$1`,[historicalAssignment]);await pool().query(`UPDATE exam_app.exam_sittings SET closes_at=now()-interval '10 minutes' WHERE id=$1`,[historical]);
        const current=(await createSitting(pool(),manager,{templateId,title:'分页当前考试',opensAt:new Date(Date.now()-60000).toISOString(),closesAt:new Date(Date.now()+86400000).toISOString()})).id;
        await pool().query(`INSERT INTO exam_app.exam_assignments(id,sitting_id,student_id,opens_at,closes_at,state,settings_snapshot,created_by) SELECT gen_random_uuid(),s.id,u.id,s.opens_at,s.closes_at,'assigned','{"mode":"original","wrongCounts":[]}'::jsonb,$2 FROM exam_app.users u CROSS JOIN exam_app.exam_sittings s WHERE s.id=$1 AND u.created_by=$2 AND u.username LIKE 'paging_user_%' AND u.id<>$3`,[current,manager.id,childId]);
        const currentAssignment=(await createAssignment(pool(),manager,{sittingId:current,studentId:childId})).id,currentAttempt=(await startAttempt(pool(),childUser,currentAssignment)).id;
        await pool().query(`INSERT INTO exam_app.exam_assignments(id,sitting_id,student_id,opens_at,closes_at,state,settings_snapshot,created_by) SELECT gen_random_uuid(),s.id,$1,s.opens_at,s.closes_at,'assigned','{"mode":"original","wrongCounts":[]}'::jsonb,$2 FROM exam_app.exam_sittings s WHERE s.manager_id=$2 AND s.title LIKE '分页场次 %'`,[childId,manager.id]);
        const foreignStudent=await createUser(pool(),foreignManager,{username:'paging_hidden',displayName:'不应显示',password:'synthetic-password-123',roles:['student']},password);
        const foreignSitting=(await createSitting(pool(),foreignManager,{templateId,title:'不可见场次',opensAt:new Date(Date.now()-60000).toISOString(),closesAt:new Date(Date.now()+86400000).toISOString()})).id;
        await createAssignment(pool(),foreignManager,{sittingId:foreignSitting,studentId:foreignStudent.id});
        return {manager,foreignStudent,foreignSitting,childUser,childId,lastId,current,currentAttempt,historical};
    }
    const getPagingFixture=()=>pagingFixture??=makePagingFixture();
    it('paging: server pages search beyond old caps and retain permission-scoped totals',async()=>{
        const fixture=await getPagingFixture(),cookie=await login(fixture.manager.username);
        const {ExamUserPageSchema,ExamSittingPageSchema,ExamTemplatePageSchema,ExamProgressPageSchema,ExamAssignmentPageSchema,ExamChoicePageSchema}=await import('@solveflow/contracts/managed-exam');
        const first=ExamUserPageSchema.parse(await(await json('/admin/users/page?q=分页学生&pageSize=100',cookie)).json()),second=ExamUserPageSchema.parse(await(await json('/admin/users/page?q=分页学生&pageSize=100&page=2',cookie)).json());
        expect(first.total).toBe(620);expect(first.items).toHaveLength(100);expect(second.items).toHaveLength(100);expect(second.items.some(item=>first.items.some(other=>other.id===item.id))).toBe(false);
        const last=ExamUserPageSchema.parse(await(await json('/admin/users/page?q=分页学生&pageSize=100&page=1000000',cookie)).json());expect(last.page).toBe(7);expect(last.items).toHaveLength(20);
        const literal=ExamUserPageSchema.parse(await(await json('/admin/users/page?q='+encodeURIComponent('%_'),cookie)).json());expect(literal.items.map(item=>item.id)).toEqual([fixture.lastId]);
        const hidden=ExamUserPageSchema.parse(await(await json('/admin/users/page?selectedId='+fixture.foreignStudent.id,cookie)).json());expect(hidden.selected).toBeNull();
        const scenes=ExamSittingPageSchema.parse(await(await json('/admin/sittings/page?q=分页场次&pageSize=100&page=7',cookie)).json());expect(scenes.total).toBe(625);expect(scenes.items).toHaveLength(25);
        const scene=ExamSittingPageSchema.parse(await(await json('/admin/sittings/page?q=分页当前考试',cookie)).json());expect(scene.items[0]?.assignmentCount).toBe(620);
        const templatesPage=ExamTemplatePageSchema.parse(await(await json('/admin/templates/page?q=分页模板&pageSize=100&page=2',cookie)).json());expect(templatesPage.total).toBe(125);expect(templatesPage.items).toHaveLength(25);
        const progressPage=ExamProgressPageSchema.parse(await(await json('/admin/progress/page?q=分页学生&pageSize=100&page=7',cookie)).json());expect(progressPage.total).toBe(1246);expect(progressPage.items).toHaveLength(100);
        const choices=ExamChoicePageSchema.parse(await(await json('/admin/dashboard/sittings/page?q=分页当前考试&selectedId='+fixture.foreignSitting,cookie)).json());expect(choices.selected).toBeNull();expect(choices.items.map(item=>item.id)).toEqual([fixture.current]);
        const pupil=await login('paging_user_1'),own=ExamAssignmentPageSchema.parse(await(await json('/me/assignments/page',pupil)).json());expect(own.total).toBe(627);expect(own.items).toHaveLength(20);expect(own.available.map(item=>item.attemptId)).toEqual([fixture.currentAttempt]);expect(own.attentionTotal).toBe(1);
        for(const query of ['page=0','pageSize=101','ownerId='+admin.id,'q='+encodeURIComponent('x'.repeat(121))])expect((await json('/admin/users/page?'+query,cookie)).status).toBe(400);
        expect((await json('/admin/users/page',pupil)).status).toBe(404);expect((await json('/admin/progress/page',pupil)).status).toBe(404);
        const escaped=ExamAssignmentPageSchema.parse(await(await json('/me/assignments/page?studentId='+fixture.foreignStudent.id,pupil)).json());expect(escaped.total).toBe(0);
        const dual=await createUser(pool(),admin,{username:'paging_dual',displayName:'隔离双角色',password:'synthetic-password-123',roles:['student','support']},password);
        await createAssignment(pool(),admin,{sittingId:fixture.foreignSitting,studentId:dual.id});
        const dualCookie=await login(dual.username),dualChoices=ExamChoicePageSchema.parse(await(await json('/admin/student-options/page?selectedId='+dual.id,dualCookie)).json());
        expect(dualChoices.total).toBe(0);expect(dualChoices.selected).toBeNull();
        const dualOwn=ExamAssignmentPageSchema.parse(await(await json('/me/assignments/page',dualCookie)).json());expect(dualOwn.total).toBe(1);
    },40000);

    for(const engine of ['chrome','webkit'] as const)it(`paging: management selectors and student history work in ${engine}`,async()=>{
        const fixture=await getPagingFixture();let live:ReturnType<typeof createExamService>|undefined;
        const server=serve({fetch:request=>live?live.app.fetch(request):new Response(null,{status:503}),hostname:'127.0.0.1',port:0});
        await new Promise<void>(resolve=>server.listening?resolve():server.once('listening',()=>resolve()));const address=server.address();if(!address||typeof address==='string'||!(server instanceof Server))throw new Error('NO_ADDRESS');const local='http://127.0.0.1:'+address.port;
        live=createExamService({pool:pool(),storage,origin:local,publicDir:join(process.cwd(),'apps/exam-web/dist/public'),clientAddress:()=> 'paging-ui-'+engine});
        const browser=await(engine==='webkit'?webkit.launch():chromium.launch({executablePath:'/usr/bin/google-chrome'})),errors:string[]=[];
        try{
            const page=await browser.newPage({viewport:{width:1440,height:1000}});page.on('pageerror',error=>errors.push(error.message));
            await page.goto(local);await page.getByLabel('用户名',{exact:true}).fill(fixture.manager.username);await page.getByLabel('密码',{exact:true}).fill('synthetic-password-123');await page.getByRole('button',{name:'登录',exact:true}).click();
            const board=page.getByRole('region',{name:'考试数据看板'});await board.getByRole('button',{name:'查看全部',exact:true}).click();await page.getByRole('region',{name:'学生进度',exact:true}).waitFor();
            await adminNavigate(page,'用户管理');const users=page.getByRole('region',{name:'用户列表',exact:true});await users.getByRole('navigation',{name:'用户列表分页'}).waitFor();
            const search=users.getByRole('searchbox',{name:'搜索姓名或用户名'});await search.fill('分页学生');await search.press('Enter');await expect.poll(()=>users.locator('tbody tr').count()).toBe(20);
            const pager=users.getByRole('navigation',{name:'用户列表分页'});await pager.getByRole('button',{name:'下一页',exact:true}).click();await expect.poll(()=>pager.getByRole('spinbutton',{name:'页码'}).inputValue()).toBe('2');
            await search.fill('分页学生 620');await search.press('Enter');await users.getByText('paging_user_620',{exact:true}).waitFor();expect(await pager.getByRole('spinbutton',{name:'页码'}).inputValue()).toBe('1');
            await page.setViewportSize({width:390,height:844});const screens=join(process.cwd(),'.runtime/pagination/screens');await mkdir(screens,{recursive:true});await page.screenshot({path:join(screens,'users-search-'+engine+'.png'),fullPage:true,animations:'disabled'});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
            await page.setViewportSize({width:1440,height:1000});await adminNavigate(page,'考试安排');await page.getByRole('button',{name:'新建场次',exact:true}).click();const dialog=page.getByRole('dialog');
            const eventTitle='选择器场次 '+engine;await dialog.getByLabel('场次名称',{exact:true}).fill(eventTitle);await dialog.getByRole('button',{name:'保存场次',exact:true}).click();await page.getByRole('article',{name:eventTitle,exact:true}).getByRole('button',{name:'查看考试',exact:true}).click();await page.getByRole('button',{name:'新建具体考试',exact:true}).click();
            await dialog.getByRole('combobox',{name:'学生',exact:true}).click();const studentSearch=dialog.getByRole('searchbox',{name:'搜索学生',exact:true});await studentSearch.fill('分页学生 620');await studentSearch.press('Enter');await dialog.getByRole('option',{name:/分页学生 620/}).click();expect(await dialog.locator('select[name=studentIds] option:checked').evaluateAll(nodes=>nodes.map(node=>node.getAttribute('value')))).toEqual([fixture.lastId]);await page.keyboard.press('Escape');
            await dialog.getByRole('combobox',{name:'负责老师',exact:true}).click();const teachers=dialog.locator('.select-options');await expect.poll(()=>teachers.getByRole('option').count()).toBe(20);await teachers.getByRole('option').first().click();await teachers.getByRole('button',{name:'下一页',exact:true}).click();await expect.poll(()=>teachers.locator('.page-position').innerText()).toContain('第 2');await teachers.getByRole('option').first().click();expect(await dialog.locator('select[name=supportIds] option:checked').count()).toBe(2);await expect.poll(()=>dialog.getByRole('combobox',{name:'负责老师',exact:true}).innerText()).toContain('已选 2 / 32');await page.keyboard.press('Escape');
            await page.screenshot({path:join(screens,'assignment-selector-'+engine+'.png'),animations:'disabled'});await dialog.getByRole('button',{name:'取消',exact:true}).click();
            await page.getByRole('tab',{name:'考试模板',exact:true}).click();const templatesPanel=page.getByRole('region',{name:'考试模板列表',exact:true}),templateSearch=templatesPanel.getByRole('searchbox',{name:'搜索模板名称或标识'});await templateSearch.fill('分页模板 125');await templateSearch.press('Enter');await templatesPanel.getByRole('button',{name:'新建场次',exact:true}).click();await page.getByRole('dialog').getByRole('combobox',{name:'考试模板',exact:true}).getByText('分页模板 125 · 第1版',{exact:true}).waitFor();await page.getByRole('dialog').getByRole('button',{name:'取消',exact:true}).click();
            await page.getByRole('button',{name:'退出登录',exact:true}).click();await page.getByLabel('用户名',{exact:true}).fill('paging_user_1');await page.getByLabel('密码',{exact:true}).fill('synthetic-password-123');await page.getByRole('button',{name:'登录',exact:true}).click();
            await page.getByRole('button',{name:'考试状态',exact:true}).waitFor();const notices=page.getByRole('region',{name:'其他考试待处理问题'});await notices.locator('summary').click();await notices.getByRole('button',{name:/查看待处理考试/}).click();await page.getByRole('heading',{name:'分页历史待处理',exact:true}).waitFor();expect(await page.getByRole('combobox',{name:'考试状态'}).innerText()).toBe('待处理');expect(await page.locator('.assignment-card').count()).toBe(1);
            await page.setViewportSize({width:390,height:844});await page.screenshot({path:join(screens,'student-attention-'+engine+'.png'),fullPage:true,animations:'disabled'});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);expect(errors).toEqual([]);
        }catch(error){const failed=browser.contexts()[0]?.pages()[0];if(failed){const folder=join(process.cwd(),'.runtime/pagination/screens');await mkdir(folder,{recursive:true});await failed.screenshot({path:join(folder,'selector-failure-'+engine+'.png'),fullPage:true});await writeFile(join(folder,'selector-failure-'+engine+'.json'),JSON.stringify(await failed.evaluate(()=>[...document.querySelectorAll('.select-control.is-open,.select-options,.select-option-list,.select-option-list>div:first-child,.multi-selection-tools,.dialog-body')].map(node=>({classes:node.className,rect:node.getBoundingClientRect().toJSON(),scrollTop:node.scrollTop,scrollHeight:node.scrollHeight}))),null,2));}throw error;}finally{await browser.close();server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}
    },45000);

    for(const engine of ['chrome','webkit'] as const)it(`paging: stale searches and shrinking final pages are safe in ${engine}`,async()=>{
        const bundle=await browserHarness(`import {createRoot} from 'react-dom/client';import {UserList} from './src/browser/management-lists.tsx';createRoot(document.getElementById('root')).render(<UserList admin version={0} onEdit={()=>{}}/>);`);
        const records=Array.from({length:45},(_,i)=>({id:randomUUID(),username:'synthetic_'+i,displayName:'合成用户 '+i,state:'active',roles:['student']}));let total=45,release=()=>{},oldStarted=()=>{};
        const started=new Promise<void>(resolve=>oldStarted=resolve),held=new Promise<void>(resolve=>release=resolve);
        const browser=await(engine==='webkit'?webkit.launch():chromium.launch({executablePath:'/usr/bin/google-chrome'}));
        try{
            const page=await browser.newPage({viewport:{width:390,height:844}});await page.route('http://127.0.0.1:3199/**',async route=>{
                const url=new URL(route.request().url()),path=url.pathname;if(path==='/api/v2/admin/users/page'){
                    const q=url.searchParams.get('q')??'',size=Number(url.searchParams.get('pageSize')??20),number=Math.min(Number(url.searchParams.get('page')??1),Math.max(1,Math.ceil((q?1:total)/size)));
                    if(q==='旧'){oldStarted();await held;}
                    try{await route.fulfill({contentType:'application/json',body:JSON.stringify({items:q?[{...records[0],displayName:q}]:records.slice((number-1)*size,Math.min(total,number*size)),total:q?1:total,page:number,pageSize:size,selected:null})});}catch{/* The superseded browser request is allowed to abort. */}return;
                }
                return route.fulfill({contentType:path.endsWith('.js')?'text/javascript':path.endsWith('.css')?'text/css':'text/html',body:path==='/harness.js'?bundle.js:path==='/harness.css'?bundle.css:bundle.html});
            });
            await page.goto('http://127.0.0.1:3199/');const panel=page.getByRole('region',{name:'用户列表'}),pager=panel.getByRole('navigation',{name:'用户列表分页'});await expect.poll(()=>panel.locator('tbody tr').count()).toBe(20);
            await pager.getByRole('spinbutton',{name:'页码'}).fill('3');await pager.getByRole('spinbutton',{name:'页码'}).press('Enter');await expect.poll(()=>panel.locator('tbody tr').count()).toBe(5);total=25;await panel.getByRole('button',{name:'刷新',exact:true}).click();await expect.poll(()=>pager.getByRole('spinbutton',{name:'页码'}).inputValue()).toBe('2');await expect.poll(()=>panel.locator('tbody tr').count()).toBe(5);
            const search=panel.getByRole('searchbox',{name:'搜索姓名或用户名'});await search.fill('旧');await search.press('Enter');await started;await search.fill('新');await search.press('Enter');await panel.getByText('新',{exact:true}).waitFor();release();await page.waitForTimeout(120);expect(await panel.getByText('旧',{exact:true}).count()).toBe(0);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
        }finally{release();await browser.close();}
    },40000);

    for(const engine of ['chrome','webkit'] as const)it(`console: HTTP IP trial supports login, photos, navigation and teacher confirmation in ${engine}`,async()=>{
        const child=await createUser(pool(),admin,{username:'http_student_'+engine,displayName:'HTTP学生 '+engine,password:'synthetic-password-123',roles:['student']},password),teacher=await createUser(pool(),admin,{username:'http_teacher_'+engine,displayName:'HTTP老师 '+engine,password:'synthetic-password-123',roles:['support']},password);
        const assignment=await createAssignment(pool(),admin,{sittingId,studentId:child.id,supportIds:[teacher.id]});
        const publicOrigin='http://192.0.2.17:18443',domainOrigin='http://exam.example.test',bundle=await browserHarness(`import './src/browser/main.tsx';`);
        const live=createExamService({pool:pool(),storage,origin:publicOrigin,insecureHttpTrial:true,httpTrialAliases:[domainOrigin],publicDir:root,clientAddress:()=> 'http-trial-test',canSolve:()=>true});
        const server=serve({fetch:live.app.fetch,hostname:'127.0.0.1',port:0});if(!(server instanceof Server))throw new Error('HTTP_SERVER_REQUIRED');if(!server.listening)await new Promise<void>(resolve=>server.once('listening',resolve));const address=server.address();if(!address||typeof address==='string')throw new Error('HTTP_TRIAL_SERVER_MISSING');
        const backend='http://127.0.0.1:'+address.port,closeWs=realtime(server,pool(),publicOrigin,live.session,[domainOrigin]);
        // A loopback HTTP proxy preserves real browser cookies and binary request bodies.
        const proxy=createServer((req,res)=>{
            const url=new URL(req.url??'/',publicOrigin),path=url.pathname;
            if(![publicOrigin,domainOrigin].includes(url.origin)){res.writeHead(403);res.end();return;}
            if(path.startsWith('/api/v2/')){
                const upstream=proxyRequest(backend+path+url.search,{method:req.method,headers:req.headers},response=>{res.writeHead(response.statusCode??502,response.headers);response.pipe(res);});
                upstream.setTimeout(10000,()=>upstream.destroy());upstream.on('error',()=>{if(!res.headersSent)res.writeHead(502);res.end();});req.on('aborted',()=>upstream.destroy());req.pipe(upstream);return;
            }
            res.setHeader('Content-Type',path.endsWith('.js')?'text/javascript':path.endsWith('.css')?'text/css':'text/html');res.end(path==='/harness.js'?bundle.js:path==='/harness.css'?bundle.css:'<!doctype html>'+bundle.html);
        });proxy.listen(0,'127.0.0.1');await new Promise<void>(resolve=>proxy.once('listening',resolve));const proxyAddress=proxy.address();if(!proxyAddress||typeof proxyAddress==='string')throw new Error('HTTP_PROXY_MISSING');const proxyPort=proxyAddress.port;
        const browser=await(engine==='chrome'?chromium.launch({executablePath:'/usr/bin/google-chrome'}):webkit.launch());let socket:NodeWebSocket|undefined;
        try{
            const errors:string[]=[];
            async function client(username:string,mobile=false,entry=publicOrigin){
                const page=await browser.newPage({proxy:{server:'http://127.0.0.1:'+proxyPort},viewport:mobile?{width:390,height:844}:{width:1440,height:1000}});page.setDefaultTimeout(5000);page.on('pageerror',error=>errors.push(error.message));
                await page.addInitScript(`window.WebSocket=class{static OPEN=1;readyState=0;send(){}close(){}};`);
                await page.goto(entry);expect(await page.evaluate(()=>isSecureContext)).toBe(false);expect(await page.evaluate(()=>typeof crypto.randomUUID)).toBe('undefined');
                await page.getByLabel('用户名',{exact:true}).fill(username);await page.getByLabel('密码',{exact:true}).fill('synthetic-password-123');await page.getByRole('button',{name:'登录',exact:true}).click();return page;
            }
            const studentPage=await client(child.username,true);await studentPage.getByRole('button',{name:'拍摄第1题',exact:true}).waitFor();
            const cookies=await studentPage.context().cookies(publicOrigin),cookie=cookies.find(c=>c.name==='solveflow_exam_http_trial');expect(cookie?.secure).toBe(false);expect(cookie?.httpOnly).toBe(true);expect(cookie?.sameSite).toBe('Strict');expect(cookies.some(c=>c.name==='solveflow_exam')).toBe(false);
            const chooser=studentPage.waitForEvent('filechooser');await studentPage.getByRole('button',{name:'从相册选择',exact:true}).click();await(await chooser).setFiles({name:'synthetic-question.png',mimeType:'image/png',buffer:image});
            const draft=studentPage.getByRole('dialog',{name:'第1题 · 题图',exact:true});await draft.getByRole('button',{name:'保存并解答',exact:true}).click();await draft.waitFor({state:'hidden'});
            const attempt=await one(pool(),z.uuid(),'SELECT id AS value FROM exam_app.exam_attempts WHERE assignment_id=$1',[assignment.id]),saved=ExamAttemptSchema.parse(await snapshot(pool(),child,attempt)),slot=saved.slots[0];if(!slot)throw new Error('HTTP_TRIAL_SLOT_MISSING');expect(slot.revision).toBe(1);expect(slot.images).toHaveLength(1);
            const job=await claimJob(pool());if(!job||job.slotId!==slot.id)throw new Error('HTTP_TRIAL_JOB_MISSING');await finishJob(pool(),job,null,'SYNTHETIC_FAILURE');
            await studentPage.getByRole('button',{name:'总览',exact:true}).click();await studentPage.getByRole('dialog',{name:'题目总览',exact:true}).getByRole('button',{name:'第2题',exact:true}).click();await studentPage.getByRole('button',{name:'拍摄第2题',exact:true}).waitFor();
            const teacherPage=await client(teacher.username);await teacherPage.getByRole('navigation',{name:'管理导航'}).getByRole('button',{name:'实时跟踪',exact:true}).click();await teacherPage.getByRole('button',{name:'查看',exact:true}).click();const monitor=teacherPage.getByRole('dialog').filter({has:teacherPage.locator('.monitor-tools')});
            await expect.poll(()=>monitor.innerText()).toContain('第2题');await monitor.getByRole('region',{name:'题目导航',exact:true}).getByRole('button',{name:'模块一 · 第1题',exact:true}).click();await monitor.getByRole('tab',{name:'手动作答',exact:true}).click();await monitor.getByLabel('确认答案',{exact:true}).fill('4');await monitor.getByLabel('处理意见',{exact:true}).fill('合成题图人工核对，答案为4。');await monitor.getByRole('button',{name:'保存并通知学生',exact:true}).click();
            await studentPage.getByRole('dialog',{name:'答案已更新',exact:true}).waitFor({timeout:10000});expect((await slotDetail(pool(),child,slot.id)).slot.presentation?.humanConfirmed).toBe(true);
            const aliasPage=await client(child.username,true,domainOrigin);await aliasPage.getByRole('dialog',{name:'答案已更新',exact:true}).waitFor();expect((await aliasPage.context().cookies(domainOrigin)).some(c=>c.name==='solveflow_exam_http_trial'&&!c.secure)).toBe(true);
            const teacherCookie=(await teacherPage.context().cookies(publicOrigin)).find(c=>c.name==='solveflow_exam_http_trial');if(!teacherCookie)throw new Error('HTTP_TRIAL_COOKIE_MISSING');
            socket=new NodeWebSocket(backend.replace('http:','ws:')+'/ws',{headers:{origin:domainOrigin,cookie:teacherCookie.name+'='+teacherCookie.value}});
            await new Promise<void>((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('HTTP_WS_OPEN_TIMEOUT')),4000);socket?.once('open',()=>{clearTimeout(timer);resolve();});socket?.once('error',error=>{clearTimeout(timer);reject(error);});});
            const changed=new Promise<unknown>((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('HTTP_WS_CHANGE_TIMEOUT')),4000);socket?.once('message',raw=>{clearTimeout(timer);try{resolve(JSON.parse(raw.toString()));}catch(error){reject(error);}});});socket.send(JSON.stringify({type:'subscribe',attemptId:attempt,afterSeq:0}));expect(await changed).toMatchObject({type:'changed',attemptId:attempt});
            const forbidden=await fetch(backend+'/api/v2/attempts/'+attempt+'/finish',{method:'POST',headers:{origin:'http://192.0.2.18:18443',cookie:cookie?.name+'='+cookie?.value}});expect(forbidden.status).toBe(403);
            const screens=join(process.cwd(),'.runtime/http-trial');await mkdir(screens,{recursive:true});await studentPage.screenshot({path:join(screens,engine+'-student.png'),fullPage:true,animations:'disabled'});expect(errors).toEqual([]);
            await studentPage.getByRole('dialog',{name:'答案已更新',exact:true}).getByRole('button',{name:'稍后查看',exact:true}).click();await studentPage.getByRole('button',{name:'账户菜单',exact:true}).click();await studentPage.getByRole('menuitem',{name:'退出登录',exact:true}).click();await studentPage.getByLabel('用户名',{exact:true}).waitFor();expect((await studentPage.context().cookies(publicOrigin)).some(c=>c.name==='solveflow_exam_http_trial')).toBe(false);
        }catch(error){const folder=join(process.cwd(),'.runtime/http-trial');await mkdir(folder,{recursive:true});for(const [index,page] of browser.contexts().flatMap(context=>context.pages()).entries()){await page.screenshot({path:join(folder,engine+'-failure-'+index+'.png'),fullPage:true});console.error(JSON.stringify({engine,index,visibility:await page.evaluate(()=>document.visibilityState),text:await page.locator('body').innerText()}));}throw error;}finally{socket?.terminate();await browser.close();closeWs();proxy.closeAllConnections();await new Promise<void>(resolve=>proxy.close(()=>resolve()));server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}
    },35000);

    it('console: cached image validation checks current access without reading storage', async () => {
        const teacher=await createUser(pool(),admin,{username:'media_head_teacher',displayName:'图片权限老师',password:'synthetic-password-123',roles:['support']},password),child=await createUser(pool(),admin,{username:'media_head_child',displayName:'图片权限学生',password:'synthetic-password-123',roles:['student']},password);
        const assignment=await createAssignment(pool(),admin,{sittingId,studentId:child.id,supportIds:[teacher.id]}),attempt=await startAttempt(pool(),child,assignment.id),slot=(await snapshot(pool(),child,attempt.id)).slots[0];if(!slot)throw new Error('MISSING_MEDIA_SLOT');
        const media=await asset(slot.id,child),run=await submit(pool(),child,slot.id,{requestId:randomUUID(),expectedRevision:0,kind:'initial',assetIds:[media]});await cancelJob(pool(),child,run.runId);
        let reads=0;const scopedStorage={put:storage.put.bind(storage),remove:storage.remove.bind(storage),close:()=>{},async get(key:string){reads++;return storage.get(key);}};
        const live=createExamService({pool:pool(),storage:scopedStorage,origin,publicDir:root,clientAddress:()=> 'media-head-test'}),cookie=await login(teacher.username),foreign=await login(other.username);
        const request=(method:string,identity:string,view='model')=>live.app.request('/api/v2/media/'+media+'?view='+view,{method,headers:{origin,cookie:identity}});
        for(const view of ['model','thumbnail','source']){const response=await request('HEAD',cookie,view);expect(response.status).toBe(200);expect(Number(response.headers.get('content-length'))).toBeGreaterThan(0);expect(await response.text()).toBe('');expect(response.headers.get('cache-control')).toBe('private, no-store');}
        expect(reads).toBe(0);expect((await request('HEAD',foreign)).status).toBe(404);expect((await request('HEAD',cookie,'invalid')).status).toBe(400);
        expect((await request('GET',cookie)).status).toBe(200);expect(reads).toBe(1);
        await pool().query('UPDATE exam_app.staff_assignments SET revoked_at=now() WHERE staff_id=$1',[teacher.id]);expect((await request('HEAD',cookie)).status).toBe(404);expect(reads).toBe(1);
    });

    for (const engine of ['chrome','webkit'] as const) it(`console: student simulation labels stay in the teacher view in ${engine}`, async () => {
        const base = ExamAttemptSchema.parse(await snapshot(pool(), student, attemptId)), initial = base.slots[0];
        if (!initial) throw new Error('MISSING_SIMULATION_SLOT');
        const result = outcome(); if (result.status !== 'completed') throw new Error('MISSING_SIMULATION_ANSWER');
        const slot = { ...initial, revision: 1, status: 'completed' as const, completedOnce: true, images: [], presentation: { answer: 'A', selectedOptions: ['A'], verified: false, simulated: true, humanConfirmed: false, notAppliedReason: null } };
        const current = ExamAttemptSchema.parse({ ...base, simulation: true, slots: base.slots.map(value => value.id === slot.id ? slot : value), alerts: [], resolutions: [], nextSlotId: slot.id, viewedSlotId: slot.id, latestAnswerSlotId: slot.id });
        const browser = await (engine === 'chrome' ? chromium.launch({ executablePath: '/usr/bin/google-chrome' }) : webkit.launch());
        let writes = 0;
        try {
            for (const role of ['student','teacher'] as const) {
                const bundle = await browserHarness(`import './src/browser/exam-clock.css';import{createRoot}from'react-dom/client';import{${role === 'student' ? 'StudentAttempt' : 'Monitor'}}from'./src/browser/${role === 'student' ? 'student' : 'monitor'}.tsx';createRoot(document.getElementById('root')).render(${role === 'student' ? `<main className="student-content"><StudentAttempt id="${base.id}"/></main>` : `<Monitor id="${base.id}" initialSlotId="${slot.id}" onClose={()=>{}}/>`});`);
                const page = await browser.newPage({ viewport: { width: role === 'student' ? 390 : 1280, height: 960 } }), errors: string[] = [];
                page.setDefaultTimeout(3000);page.on('pageerror', error => errors.push(error.message));
                await page.addInitScript(`window.WebSocket=class{static OPEN=1;readyState=0;send(){}close(){}};`);
                await page.route('http://127.0.0.1:3199/**', async route => {
                    const path = new URL(route.request().url()).pathname;
                    if (route.request().method() !== 'GET') { writes++;return route.fulfill({ status: 500 }); }
                    if (path.endsWith('/snapshot')) return route.fulfill({ json: current });
                    if (path.includes('/slots/')) return route.fulfill({ json: { slot, problem: result.candidate.problem, outcome: role === 'teacher' ? result : null, humanReviews: [], revisions: [] } });
                    return route.fulfill({ contentType: path.endsWith('.js') ? 'text/javascript' : path.endsWith('.css') ? 'text/css' : 'text/html', body: path === '/harness.js' ? bundle.js : path === '/harness.css' ? bundle.css : bundle.html });
                });
                await page.goto('http://127.0.0.1:3199/');
                if (role === 'student') {
                    const latest = page.locator('.answer-card');await latest.waitFor();
                    expect(await latest.locator('.answer-options').innerText()).toBe('A');
                    expect(await page.getByText(/错题模拟/).count()).toBe(0);
                    expect(await latest.locator('.badge').count()).toBe(0);
                    const detail = page.locator('.current-answer');await detail.locator('summary').filter({hasText:'题目详情'}).click();await detail.getByRole('region', { name: '识别题目' }).waitFor();
                    expect(await detail.getByText('A', { exact: true }).count()).toBeGreaterThan(0);
                    expect(await detail.getByText(/错题模拟|AI 已核验|待核验/).count()).toBe(0);
                } else {
                    const detail = page.getByRole('dialog');await detail.getByText('学生当前答案', { exact: true }).waitFor();
                    expect(await detail.getByText('错题模拟', { exact: true }).count()).toBe(1);
                    expect(await detail.getByText('B. 4', { exact: true }).count()).toBeGreaterThan(0);
                }
                expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
                const screens = join(process.cwd(), '.runtime/student-answer-labels');await mkdir(screens, { recursive: true });
                await page.screenshot({ path: join(screens, engine + '-' + role + '.png'), fullPage: true, animations: 'disabled' });
                expect(errors).toEqual([]);await page.close();
            }
            expect(writes).toBe(0);expect(current.slots.find(value => value.id === slot.id)?.presentation?.verified).toBe(false);
        } finally { await browser.close(); }
    });

    for (const engine of ['chrome','webkit'] as const) for (const role of ['student','teacher'] as const) it(`console: question dialogs and original image controls work for ${role} ${engine}`, async () => {
        const base = ExamAttemptSchema.parse(await snapshot(pool(), student, attemptId)), initial = base.slots[0]; if (!initial) throw new Error('MISSING_IMAGE_SLOT');
        const result = outcome(); if (result.status !== 'completed') throw new Error('MISSING_IMAGE_ANSWER');
        const media = randomUUID(), supplement = randomUUID(), slot = { ...initial, revision: 1, status: 'completed' as const, completedOnce: true, images: [{id:media,role:'primary' as const},{id:supplement,role:'material' as const}], presentation: { answer: 'B. 4', selectedOptions: ['B'], verified: false, simulated: false, humanConfirmed: false, notAppliedReason: null } };
        const current = ExamAttemptSchema.parse({ ...base, slots: base.slots.map(value=>value.id===slot.id?slot:value), alerts: [], resolutions: [], nextSlotId: slot.id, viewedSlotId: slot.id, latestAnswerSlotId: slot.id, activity: [{id:randomUUID(),action:'select_slot',moduleTitle:'阅读与写作一',position:1,targetSlotId:slot.id,affectedCount:1,createdAt:new Date().toISOString()}] });
        const picture = await sharp({create:{width:1600,height:1200,channels:3,background:'#f8fafc'}}).composite([{input:Buffer.from('<svg width="1600" height="1200"><path d="M50 50h1500v1100H50Z M800 50v1100 M50 600h1500" stroke="#375481" stroke-width="10" fill="none"/><text x="130" y="200" font-size="70">Original question 1</text></svg>')}]).png().toBuffer();
        const bundle = await browserHarness(`import './src/browser/exam-clock.css';import{createRoot}from'react-dom/client';import{${role==='student'?'StudentAttempt':'Monitor'}}from'./src/browser/${role==='student'?'student':'monitor'}.tsx';createRoot(document.getElementById('root')).render(${role==='student'?`<main className="student-content"><StudentAttempt id="${base.id}"/></main>`:`<Monitor id="${base.id}" initialSlotId="${slot.id}" onClose={()=>{}}/>`});`);
        bundle.html='<!doctype html>'+bundle.html;
        const browser = await(engine==='chrome'?chromium.launch({executablePath:'/usr/bin/google-chrome'}):webkit.launch());
        let writes=0, sources=0, failSource=false, releaseSource=()=>{}, sourceStarted=()=>{};
        const sourceGate=new Promise<void>(resolve=>releaseSource=resolve), firstSource=new Promise<void>(resolve=>sourceStarted=resolve);
        try { const page=await browser.newPage({viewport:{width:1280,height:960}}), errors:string[]=[];page.setDefaultTimeout(3000);page.on('pageerror',error=>errors.push(error.message));
            await page.addInitScript(`window.WebSocket=class{static OPEN=1;readyState=0;send(){}close(){}};`);
            await page.route('http://127.0.0.1:3199/**',async route=>{const url=new URL(route.request().url()),path=url.pathname;
                if(route.request().method()==='HEAD'&&path.includes('/media/'))return route.fulfill({status:200});
                if(route.request().method()!=='GET'){writes++;return route.fulfill({status:500});}
                if(path.endsWith('/snapshot'))return route.fulfill({json:current});
                if(path.includes('/slots/'))return route.fulfill({json:{slot,problem:result.candidate.problem,outcome:result,humanReviews:[],revisions:[]}});
                if(path.includes('/media/')){if(url.searchParams.get('view')==='source'){sources++;if(sources===1){sourceStarted();await sourceGate;}if(failSource)return route.fulfill({status:503});}return route.fulfill({contentType:'image/png',body:picture});}
                return route.fulfill({contentType:path.endsWith('.js')?'text/javascript':path.endsWith('.css')?'text/css':'text/html',body:path==='/harness.js'?bundle.js:path==='/harness.css'?bundle.css:bundle.html});
            });
            await page.goto('http://127.0.0.1:3199/');
            if(role==='teacher'){
                const nav=page.getByRole('region',{name:'题目导航',exact:true});await nav.waitFor();await nav.locator('section').first().getByRole('button',{name:/第1题$/}).click();expect(await nav.isVisible()).toBe(true);expect(await page.getByRole('dialog').count()).toBe(1);
                await page.getByRole('button',{name:'操作记录',exact:true}).click();const history=page.getByRole('dialog',{name:'操作记录',exact:true});await history.getByText('切换到 阅读与写作一 · 第1题',{exact:true}).waitFor();await history.getByRole('button',{name:'关闭',exact:true}).click();expect(await page.getByRole('button',{name:'操作记录',exact:true}).evaluate(el=>el===document.activeElement)).toBe(true);
            } else { await page.getByRole('heading',{name:'第1题答案',exact:true}).waitFor(); await page.locator('.current-answer summary').filter({hasText:'题目详情'}).click(); }
            const detail=role==='teacher'?page.getByRole('dialog').first():page.locator('.student-question');
            await detail.getByRole('region',{name:'识别题目'}).waitFor();expect(await detail.getByRole('region',{name:'识别题目'}).locator('.option').count()).toBe(4);await detail.getByRole('button',{name:'查看原图',exact:true}).click();
            const viewer=page.getByRole('dialog',{name:'题图',exact:true}), viewport=viewer.getByLabel('题目原图查看区域'), zoom=viewer.getByLabel('图片缩放比例');
            const displayed=viewer.locator('[data-display-image=true]');
            await expect.poll(()=>viewer.getByRole('button',{name:'重置图片',exact:true}).isEnabled()).toBe(true);expect(sources).toBe(0);expect(await displayed.evaluate(image=>image instanceof HTMLImageElement ? image.naturalWidth : 0)).toBe(1600);
            const imageBefore=await displayed.boundingBox(), viewportBefore=await viewport.boundingBox();if(!imageBefore||!viewportBefore)throw new Error('MISSING_IMAGE_GEOMETRY');
            await enlargePicture(viewer);await expect.poll(()=>zoom.textContent()).toBe('125%');
            await firstSource;await viewer.getByRole('status',{name:'正在加载高清原图',exact:true}).waitFor();expect(await displayed.getAttribute('alt')).toBe('题目清晰预览');expect(await viewer.getByRole('button',{name:'重置图片',exact:true}).isEnabled()).toBe(true);
            const imageAfter=await displayed.boundingBox(), viewportAfter=await viewport.boundingBox();if(!imageAfter||!viewportAfter)throw new Error('MISSING_ZOOMED_GEOMETRY');
            expect(imageAfter.width/imageBefore.width).toBeCloseTo(1.25,2);expect(imageAfter.height/imageBefore.height).toBeCloseTo(1.25,2);expect(viewportAfter.width).toBe(viewportBefore.width);expect(viewportAfter.height).toBe(viewportBefore.height);
            const scrollBefore=await viewport.evaluate(element=>({x:element.scrollLeft,y:element.scrollTop}));releaseSource();await expect.poll(()=>displayed.getAttribute('alt')).toBe('题目原图');expect(await displayed.boundingBox()).toEqual(imageAfter);expect(await viewport.evaluate(element=>({x:element.scrollLeft,y:element.scrollTop}))).toEqual(scrollBefore);
            await page.waitForTimeout(150);expect(await zoom.textContent()).toBe('125%');
            await viewer.getByRole('button',{name:'全屏查看',exact:true}).click();await expect.poll(()=>zoom.textContent()).toBe('100%');
            const full=await viewer.boundingBox(), fullViewport=await viewport.boundingBox();if(!full||!fullViewport)throw new Error('MISSING_FULLSCREEN_GEOMETRY');expect(full.x).toBeLessThanOrEqual(1);expect(full.y).toBeLessThanOrEqual(1);expect(full.width).toBeGreaterThanOrEqual(1260);expect(full.height).toBeGreaterThanOrEqual(959);expect(fullViewport.height).toBeGreaterThan(720);
            const fullImageBefore=await displayed.boundingBox();if(!fullImageBefore)throw new Error('MISSING_FULLSCREEN_IMAGE');await enlargePicture(viewer);await expect.poll(()=>zoom.textContent()).toBe('125%');const fullImageAfter=await displayed.boundingBox();if(!fullImageAfter)throw new Error('MISSING_FULLSCREEN_ZOOM');expect(fullImageAfter.width/fullImageBefore.width).toBeCloseTo(1.25,2);expect(fullImageAfter.height/fullImageBefore.height).toBeCloseTo(1.25,2);
            await page.keyboard.press('Escape');await viewer.getByRole('button',{name:'全屏查看',exact:true}).waitFor();expect(await viewer.isVisible()).toBe(true);await expect.poll(()=>zoom.textContent()).toBe('100%');
            await viewport.hover();await page.mouse.wheel(0,-500);await expect.poll(async()=>Number((await zoom.textContent())?.replace('%',''))).toBeGreaterThan(200);
            const box=await viewport.boundingBox();if(!box)throw new Error('MISSING_IMAGE_VIEWPORT');
            const left=await viewport.evaluate(element=>element.scrollLeft);await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();await page.mouse.move(box.x+box.width/2-70,box.y+box.height/2-40,{steps:4});await page.mouse.up();expect(await viewport.evaluate(element=>element.scrollLeft)).toBeGreaterThan(left);
            await viewer.getByRole('button',{name:'重置图片',exact:true}).click();await expect.poll(()=>zoom.textContent()).toBe('100%');expect(await viewport.evaluate(el=>({x:el.scrollLeft,y:el.scrollTop}))).toEqual({x:0,y:0});await viewport.dblclick();await expect.poll(()=>zoom.textContent()).toBe('200%');
            await page.setViewportSize({width:390,height:844});await expect.poll(()=>zoom.textContent()).toBe('100%');expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
            if(engine==='chrome'){
                const touch=await page.context().newCDPSession(page), area=await viewport.boundingBox();if(!area)throw new Error('MISSING_PINCH_VIEWPORT');
                const x=area.x+area.width/2,y=area.y+area.height/2;
                try{await touch.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{id:1,x:x-30,y},{id:2,x:x+30,y}]});await touch.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{id:1,x:x-65,y},{id:2,x:x+65,y}]});await touch.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await expect.poll(async()=>Number((await zoom.textContent())?.replace('%',''))).toBeGreaterThan(180);await viewer.getByRole('button',{name:'重置图片',exact:true}).click();}finally{await touch.detach();}
            }
            await viewer.getByRole('button',{name:'全屏查看',exact:true}).click();await viewer.getByRole('button',{name:'退出全屏查看',exact:true}).waitFor();
            const mobileFull=await viewer.boundingBox();if(!mobileFull)throw new Error('MISSING_MOBILE_FULLSCREEN');expect(mobileFull.width).toBeGreaterThanOrEqual(370);expect(mobileFull.height).toBeGreaterThanOrEqual(843);const mobilePicture=await displayed.boundingBox(),mobileArea=await viewport.boundingBox();expect(mobilePicture&&mobileArea&&mobilePicture.y-mobileArea.y<=20).toBe(true);expect(await viewer.locator('.image-viewer-tools').evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);
            await page.evaluate(()=>document.documentElement.dataset.theme='dark');const screens=join(process.cwd(),'.runtime/silent-refresh');await mkdir(screens,{recursive:true});await page.screenshot({path:join(screens,`original-${role}-${engine}-mobile.png`),animations:'disabled'});await viewer.getByRole('button',{name:'退出全屏查看',exact:true}).click();
            await viewer.getByRole('button',{name:'关闭',exact:true}).click();expect(await detail.getByRole('button',{name:'查看原图',exact:true}).evaluate(el=>el===document.activeElement)).toBe(true);
            failSource=true;await detail.getByRole('button',{name:'查看补图',exact:true}).click();await expect.poll(()=>viewer.getByRole('button',{name:'重置图片',exact:true}).isEnabled()).toBe(true);await enlargePicture(viewer);await viewer.getByText('高清原图加载失败',{exact:true}).waitFor();expect(await displayed.getAttribute('alt')).toBe('题目清晰预览');failSource=false;await viewer.getByRole('button',{name:'重试原图',exact:true}).click();await expect.poll(()=>displayed.getAttribute('alt')).toBe('题目原图');
            await viewer.getByRole('button',{name:'关闭',exact:true}).click();await detail.getByRole('button',{name:'查看补图',exact:true}).click();await viewer.waitFor();await viewer.getByRole('button',{name:'关闭',exact:true}).click();expect(sources).toBeGreaterThanOrEqual(3);expect(writes).toBe(0);expect(errors).toEqual([]);
            await page.setViewportSize({width:1280,height:960});await page.screenshot({path:join(screens,`question-${role}-${engine}-desktop.png`),animations:'disabled'});
        }finally{releaseSource();await browser.close();}
    },30000);

    for (const engine of ['chrome','webkit'] as const) it(`console: progressive image sessions reuse authorized blobs and fence late pictures in ${engine}`, async () => {
        const a=randomUUID(),b=randomUUID();
        const picture=await sharp({create:{width:1600,height:1200,channels:3,background:'#e3ebfc'}}).png().toBuffer();
        const otherPicture=await sharp({create:{width:1600,height:1000,channels:3,background:'#d8eee3'}}).png().toBuffer();
        const bundle=await browserHarness(`import{useState}from'react';import{createRoot}from'react-dom/client';import{ImageViewer}from'./src/browser/image-viewer.tsx';import{ImageSession}from'./src/browser/image-session.tsx';function Preview(){const[image,setImage]=useState(null),[session,setSession]=useState(0);return <><button onClick={()=>setImage('${a}')}>图片A</button><button onClick={()=>setImage('${b}')}>图片B</button><button onClick={()=>setSession(value=>value+1)}>切换登录会话</button><ImageSession key={session}>{image&&<ImageViewer key={image} src={'/api/v2/media/'+image+'?view=source'} onClose={()=>setImage(null)}/>}</ImageSession></>};createRoot(document.getElementById('root')).render(<Preview/>);`);
        let release=()=>{},started=()=>{},revoked=false;const gate=new Promise<void>(resolve=>release=resolve),sourceStarted=new Promise<void>(resolve=>started=resolve);
        const requests:{id:string;view:string;method:string}[]=[],browser=await(engine==='webkit'?webkit.launch():chromium.launch({executablePath:'/usr/bin/google-chrome'}));
        try{
            const page=await browser.newPage({viewport:{width:390,height:844}}),errors:string[]=[];page.setDefaultTimeout(3000);page.on('pageerror',error=>errors.push(error.message));
            await page.route('http://127.0.0.1:3199/**',async route=>{
                const url=new URL(route.request().url()),path=url.pathname;
                if(path.includes('/media/')){
                    const id=path.split('/').at(-1)??'',view=url.searchParams.get('view')??'',method=route.request().method();requests.push({id,view,method});
                    if(method==='HEAD')return route.fulfill({status:revoked?404:200});
                    if(id===a&&view==='source'){started();await gate;}
                    try{return await route.fulfill({contentType:'image/png',body:id===a?picture:otherPicture});}catch{/* The closed viewer aborted this synthetic download. */return;}
                }
                return route.fulfill({contentType:path.endsWith('.js')?'text/javascript':path.endsWith('.css')?'text/css':'text/html',body:path==='/harness.js'?bundle.js:path==='/harness.css'?bundle.css:'<!doctype html>'+bundle.html});
            });
            const count=(id:string,view:string,method='GET')=>requests.filter(value=>value.id===id&&value.view===view&&value.method===method).length;
            await page.goto('http://127.0.0.1:3199/');await page.getByRole('button',{name:'图片A',exact:true}).click();
            const viewer=page.getByRole('dialog',{name:'题图',exact:true}),displayed=viewer.locator('[data-display-image=true]');
            await expect.poll(()=>displayed.count()).toBe(1);expect(count(a,'source')).toBe(0);await enlargePicture(viewer);await sourceStarted;
            expect(await displayed.getAttribute('alt')).toBe('题目清晰预览');await viewer.getByRole('button',{name:'关闭',exact:true}).click();
            await page.getByRole('button',{name:'图片B',exact:true}).click();await expect.poll(()=>displayed.count()).toBe(1);release();await page.waitForTimeout(100);
            expect(await displayed.evaluate(element=>element instanceof HTMLImageElement?element.naturalHeight:0)).toBe(1000);
            await enlargePicture(viewer);await expect.poll(()=>displayed.getAttribute('alt')).toBe('题目原图');
            await viewer.getByRole('button',{name:'关闭',exact:true}).click();await page.getByRole('button',{name:'图片B',exact:true}).click();await expect.poll(()=>displayed.getAttribute('alt')).toBe('题目原图');
            expect(count(b,'source')).toBe(1);expect(count(b,'source','HEAD')).toBe(1);expect(count(b,'model')).toBe(1);
            const screens=join(process.cwd(),'.runtime/progressive-images');await mkdir(screens,{recursive:true});
            for(const theme of ['light','dark']){await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);await page.screenshot({path:join(screens,engine+'-'+theme+'-390.png'),animations:'disabled'});}
            await page.setViewportSize({width:320,height:740});expect(await viewer.locator('.image-viewer-tools').evaluate(element=>element.scrollWidth<=element.clientWidth)).toBe(true);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
            await viewer.getByRole('button',{name:'关闭',exact:true}).click();revoked=true;await page.getByRole('button',{name:'图片B',exact:true}).click();await viewer.getByText('图片已失效或没有查看权限。',{exact:true}).waitFor();expect(await displayed.count()).toBe(0);expect(count(b,'source')).toBe(1);
            await viewer.getByRole('button',{name:'关闭',exact:true}).click();revoked=false;await page.getByRole('button',{name:'切换登录会话',exact:true}).click();await page.getByRole('button',{name:'图片B',exact:true}).click();await expect.poll(()=>displayed.getAttribute('alt')).toBe('题目清晰预览');
            expect(count(b,'model')).toBe(2);expect(count(b,'source')).toBe(1);expect(errors).toEqual([]);
        }finally{release();await browser.close();}
    },30000);

    for (const engine of ['chrome','webkit'] as const) it(`console: student exam header keeps mobile question central in ${engine}`, async () => {
        const base = ExamAttemptSchema.parse(await snapshot(pool(), student, attemptId)), first = base.slots[0], second = base.slots[1];
        if (!first || !second) throw new Error('MISSING_LAYOUT_SLOTS');
        const sourceModule = base.modules[0]; if (!sourceModule) throw new Error('MISSING_LAYOUT_MODULE');
        const modules = ['阅读与写作一','阅读与写作二','数学一','数学二'].map((title,index) => ({ ...sourceModule, id: index === 0 ? first.moduleId : randomUUID(), code: 'sat-'+index, title, position: index+1, questionCount: index < 2 ? 27 : 22 }));
        let ordinal = 0;
        const slots = modules.flatMap(module => Array.from({ length: module.questionCount }, (_, index) => ({ ...first, id: ordinal === 0 ? first.id : ordinal === 1 ? second.id : randomUUID(), moduleId: module.id, position: index+1, ordinal: ++ordinal, revision: 0, status: 'empty', completedOnce: false, deferred: false, skipped: false, runId: null, reviewId: null, errorCode: null, presentation: null, images: [] })));
        const current = ExamAttemptSchema.parse({ ...base, modules, slots, state: 'in_progress', title: '手机端测试考试 · SAT', nextSlotId: first.id, viewedSlotId: first.id, resolutions: [], timing: { ...base.timing, startedAt: new Date(Date.now()-125000).toISOString(), endedAt: null, endedBy: null, remainingSeconds: null, elapsedSeconds: 125 }, alerts: [{ id: randomUUID(), slotId: second.id, moduleId: first.moduleId, moduleTitle: '阅读与写作一', position: 2, revision: 1, reason: 'answer_failed', openedAt: new Date().toISOString() }] });
        const assignment = { id: randomUUID(), studentId: student.id, studentName: student.displayName, sittingId, title: current.title, exam: 'sat', opensAt: new Date(Date.now()-3600000).toISOString(), closesAt: null, state: 'assigned', attemptId: base.id };
        const bundle = await browserHarness(`import './src/browser/main.tsx';`), browser = await (engine === 'chrome' ? chromium.launch({ executablePath: '/usr/bin/google-chrome' }) : webkit.launch());
        let writes = 0;
        try {
            const page = await browser.newPage({ viewport: { width: 390, height: 844 } }); page.setDefaultTimeout(3000);
            await page.addInitScript(`window.WebSocket=class{static OPEN=1;readyState=0;send(){}close(){}};`);
            await page.route('http://127.0.0.1:3199/**', async route => {
                const url = new URL(route.request().url()), path = url.pathname;
                if (route.request().method() !== 'GET') { writes++; return route.fulfill({ status: 500, json: { message: '不应产生写入' } }); }
                if (path.endsWith('/session')) return route.fulfill({ json: { user: student, expiresAt: new Date(Date.now()+3600000).toISOString() } });
                if (path.endsWith('/assignments/page')) return route.fulfill({ json: { items: [assignment], total: 1, page: 1, pageSize: 20, selected: null, available: [assignment], attentionTotal: 0 } });
                if (path.endsWith('/snapshot')) return route.fulfill({ json: current });
                return route.fulfill({ contentType: path.endsWith('.js') ? 'text/javascript' : path.endsWith('.css') ? 'text/css' : 'text/html', body: path === '/harness.js' ? bundle.js : path === '/harness.css' ? bundle.css : bundle.html });
            });
            await page.goto('http://127.0.0.1:3199/'); await page.getByRole('button', { name: '拍摄第1题', exact: true }).waitFor();
            const screens = join(process.cwd(), '.runtime/student-toolbar-20261106/screens'); await mkdir(screens, { recursive: true });
            for (const width of [320,390,768,1440]) for (const theme of ['light','dark']) {
                await page.setViewportSize({ width, height: 900 }); await page.evaluate(theme => document.documentElement.dataset.theme = theme, theme);
                const header=page.locator('.header-bar'),status=header.getByRole('button',{name:'考试状态',exact:true});await status.waitFor();
                expect(await header.getByText(current.title,{exact:true}).count()).toBe(0);expect(await header.getByLabel('考试用时').count()).toBe(0);expect(current.timing.elapsedSeconds).toBe(125);
                expect(await page.getByRole('button',{name:'← 考试记录',exact:true}).count()).toBe(0);expect(await page.getByRole('button',{name:'结束考试',exact:true}).count()).toBe(0);expect(await page.getByRole('button',{name:'模块操作',exact:true}).count()).toBe(0);
                const headBox=await header.boundingBox(),statusBox=await status.boundingBox(),tools=await header.locator('.header-tools').boundingBox(),logo=await header.getByRole('button',{name:'返回首页',exact:true}).boundingBox(),capture=await page.locator('.capture-box').boundingBox();
                if(!headBox||!statusBox||!tools||!logo||!capture)throw new Error('MISSING_HEADER_CONTROLS');
                expect(Math.abs(statusBox.x+statusBox.width/2-headBox.x-headBox.width/2)).toBeLessThanOrEqual(2);expect(logo.x+logo.width).toBeLessThanOrEqual(statusBox.x);expect(statusBox.x+statusBox.width).toBeLessThanOrEqual(tools.x);
                expect(await page.getByRole('region',{name:'题目状态总览'}).count()).toBe(0);expect(capture.y).toBeLessThan(400);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
                await page.screenshot({path:join(screens,`header-${engine}-${width}-${theme}.png`),animations:'disabled'});
                await header.getByRole('button',{name:'账户菜单',exact:true}).click();const menu=page.getByRole('menu',{name:'账户',exact:true});await menu.waitFor();expect(await menu.getByRole('menuitem',{name:'考试记录',exact:true}).isVisible()).toBe(true);expect(await menu.evaluate(el=>el.getBoundingClientRect().right<=innerWidth)).toBe(true);
                await page.screenshot({path:join(screens,`account-${engine}-${width}-${theme}.png`),animations:'disabled'});await page.keyboard.press('Escape');expect(await header.getByRole('button',{name:'账户菜单',exact:true}).evaluate(el=>el===document.activeElement)).toBe(true);
            }
            await page.setViewportSize({width:390,height:844});await page.getByRole('button',{name:'考试状态',exact:true}).click();const state=page.getByRole('dialog',{name:'考试状态',exact:true});await state.getByText(current.title,{exact:true}).waitFor();expect(await state.getByLabel('考试用时').count()).toBe(0);await page.screenshot({path:join(screens,`status-${engine}.png`),animations:'disabled'});
            await state.getByRole('button',{name:'结束考试',exact:true}).click();const confirmation=page.getByRole('dialog',{name:'结束本场考试？',exact:true});await confirmation.waitFor();await confirmation.getByRole('button',{name:'继续考试',exact:true}).click();await state.getByRole('button',{name:'返回答题',exact:true}).click();expect(writes).toBe(0);
            await page.getByRole('button',{name:'账户菜单',exact:true}).click();await page.getByRole('menuitem',{name:'考试记录',exact:true}).click();await page.getByRole('heading',{name:'考试记录',exact:true}).waitFor();expect(await page.getByRole('button',{name:'考试状态',exact:true}).count()).toBe(0);await page.screenshot({path:join(screens,`history-${engine}.png`),animations:'disabled'});
            await page.getByRole('button',{name:'继续考试',exact:true}).click();await page.getByRole('button',{name:'考试状态',exact:true}).waitFor();await page.getByRole('button',{name:'返回首页',exact:true}).click();await page.getByRole('heading',{name:'我的考试',exact:true}).waitFor();await page.evaluate(()=>window.dispatchEvent(new Event('online')));expect(await page.getByRole('button',{name:'考试状态',exact:true}).count()).toBe(0);expect(writes).toBe(0);
        } finally { await browser.close(); }
    }, 30000);

    for (const engine of ['chrome','webkit'] as const) it(`console: teacher warning stays bottom right and opens the exact question in ${engine}`, async () => {
        const base = ExamAttemptSchema.parse(await snapshot(pool(), student, attemptId)), first = base.slots[0]; if (!first) throw new Error('MISSING_ALERT_SLOT');
        const issue = { id: randomUUID(), slotId: first.id, moduleId: first.moduleId, moduleTitle: '阅读与写作一', position: first.position, revision: 1, reason: 'answer_failed', openedAt: new Date().toISOString(), attemptId: base.id, studentId: student.id, studentName: '合成学生', title: base.title };
        const bundle = await browserHarness(`import{useState}from'react';import{createRoot}from'react-dom/client';import{TeacherAttention}from'./src/browser/teacher-attention.tsx';function Preview(){const[space,setSpace]=useState(0),[hidden,setHidden]=useState(false),[selected,setSelected]=useState('');return <div className="admin-shell" style={{display:"block"}}><main className="admin-content" style={{height:1500,display:"flex",flexDirection:"column",paddingBottom:space}}><button onClick={()=>setHidden(value=>!value)}>切换处理窗口</button><output aria-label="处理题位">{selected}</output><button style={{marginTop:"auto",alignSelf:"flex-end"}}>最后一行操作</button></main><TeacherAttention onSpaceChange={setSpace} hidden={hidden} onOpen={item=>{setSelected(item.attemptId+':'+item.slotId);setHidden(true);}} onViewAll={()=>setSelected('all')}/></div>};createRoot(document.getElementById('root')).render(<Preview/>);`);
        const browser = await (engine === 'chrome' ? chromium.launch({ executablePath: '/usr/bin/google-chrome' }) : webkit.launch());
        let total = 4, fail = false, writes = 0;
        try {
            const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } }); page.setDefaultTimeout(3000); await page.clock.install();
            await page.route('http://127.0.0.1:3199/**', async route => { const url = new URL(route.request().url()), path = url.pathname;
                if (route.request().method() !== 'GET') { writes++; return route.fulfill({ status: 500 }); }
                if (path.endsWith('/admin/issues')) { expect(url.searchParams.get('limit')).toBe('3'); return route.fulfill(fail ? { status: 503, json: { message: '合成网络失败' } } : { json: { total, items: total ? [issue] : [], nextCursor: total > 1 ? 'next' : null } }); }
                return route.fulfill({ contentType: path.endsWith('.js') ? 'text/javascript' : path.endsWith('.css') ? 'text/css' : 'text/html', body: path === '/harness.js' ? bundle.js : path === '/harness.css' ? bundle.css : bundle.html });
            });
            await page.goto('http://127.0.0.1:3199/'); const reminder = page.getByRole('complementary', { name: '教师待处理提醒' }); await reminder.waitFor();
            const screens = join(process.cwd(), '.runtime/silent-refresh'); await mkdir(screens, { recursive: true });
            for (const width of [1440,390]) { await page.setViewportSize({ width, height: 1000 }); await page.evaluate(() => document.documentElement.dataset.theme = 'dark');
                const box = await reminder.boundingBox(); if (!box) throw new Error('MISSING_TEACHER_WARNING');
                const clientWidth = await page.evaluate(() => document.documentElement.clientWidth);
                expect(box.width).toBeGreaterThan(340); expect(clientWidth-box.x-box.width).toBeLessThanOrEqual(24); expect(1000-box.y-box.height).toBeLessThanOrEqual(24);
                expect(await reminder.getByRole('button', { name: /关闭/ }).count()).toBe(0); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
                await page.screenshot({ path: join(screens, `teacher-warning-${engine}-${width}.png`), animations: 'disabled' });
            }
            const last = page.getByRole('button', { name: '最后一行操作', exact: true }); await last.scrollIntoViewIfNeeded();
            const lastBox = await last.boundingBox(), alertBox = await reminder.boundingBox(); if (!lastBox || !alertBox) throw new Error('MISSING_FINAL_CONTROL'); expect(lastBox.y+lastBox.height).toBeLessThanOrEqual(alertBox.y); await last.click();
            await reminder.getByRole('button', { name: '打开教师待处理提醒' }).click();
            await page.screenshot({ path: join(screens, `teacher-warning-${engine}-expanded.png`), animations: 'disabled' });
            await reminder.getByRole('button', { name: '查看全部待处理题' }).click(); expect(await page.getByLabel('处理题位').textContent()).toBe('all');
            await reminder.getByRole('button', { name: /合成学生/ }).click(); expect(await page.getByLabel('处理题位').textContent()).toBe(base.id+':'+first.id); expect(await reminder.count()).toBe(0);
            await page.getByRole('button', { name: '切换处理窗口' }).click(); await reminder.waitFor();
            fail = true; await page.clock.fastForward(5000); await reminder.getByText('合成网络失败', { exact: true }).waitFor(); expect(await reminder.getByRole('button', { name: /合成学生/ }).count()).toBe(1);
            fail = false; total = 1; await page.clock.fastForward(5000); await expect.poll(() => reminder.getByRole('button', { name: '查看全部待处理题' }).count()).toBe(0);
            await reminder.getByRole('button', { name: '打开教师待处理提醒' }).click(); expect(await reminder.count()).toBe(0);
            await page.getByRole('button', { name: '切换处理窗口' }).click(); total = 0; await page.clock.fastForward(5000); await expect.poll(() => reminder.count()).toBe(0); expect(writes).toBe(0);
        } finally { await browser.close(); }
    }, 30000);

    for(const engine of ['chrome','webkit'] as const)for(const kind of ['dashboard','list'] as const)it(`paging: silent refresh preserves content and manual animation in ${kind} ${engine}`,async()=>{
        const bundle=await browserHarness(`import {createRoot} from 'react-dom/client';import {Dashboard} from './src/browser/dashboard.tsx';import {UserList} from './src/browser/management-lists.tsx';createRoot(document.getElementById('root')).render(${kind==='dashboard'?'<Dashboard onWatch={()=>{}} onIssues={()=>{}}/>':'<UserList admin version={0} onEdit={()=>{}}/>'});`);
        const baseline=ExamDashboardSchema.parse({generatedAt:new Date().toISOString(),sittings:[],summary:{students:1,online:1,total:100,answered:10,verified:8,humanConfirmed:0,active:0,attention:0},distribution:[{state:'unphotographed',count:90},{state:'processing',count:0},{state:'attention',count:0},{state:'answered',count:10},{state:'waiting',count:0}],throughput:Array.from({length:12},(_,i)=>({at:new Date(Date.now()-(11-i)*300000).toISOString(),ai:i,human:0})),issues:[],modules:[],students:[]});
        const person={id:randomUUID(),username:'silent_student',displayName:'静默测试学生',roles:['student'],state:'active'};
        const endpoint=kind==='dashboard'?'/api/v2/admin/dashboard':'/api/v2/admin/users/page';
        let calls=0,closed=false;const gates=new Map<number,()=>void>(),pending=new Map<number,Promise<void>>();
        for(const index of [2,3])pending.set(index,new Promise<void>(resolve=>gates.set(index,resolve)));
        const browser=await(engine==='chrome'?chromium.launch({executablePath:'/usr/bin/google-chrome'}):webkit.launch());
        const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
        try{
            await page.clock.install();
            await page.route('http://127.0.0.1:3199/**',async route=>{
                const path=new URL(route.request().url()).pathname;
                if(path===endpoint){const index=++calls;await pending.get(index);if(closed)return;
                    try{if(index===4)await route.fulfill({status:503,json:{message:'合成静默同步失败'}});else await route.fulfill({json:kind==='dashboard'?{...baseline,summary:{...baseline.summary,answered:index===1?10:11}}:{items:[{...person,displayName:index===1?person.displayName:'静默测试学生已更新'}],total:1,page:1,pageSize:20,selected:null}});}catch(error){if(!closed)throw error;}return;}
                if(path.startsWith('/api/'))return route.fulfill({json:{items:[],total:0,page:1,pageSize:20,selected:null}});
                return route.fulfill({contentType:path.endsWith('.js')?'text/javascript':path.endsWith('.css')?'text/css':'text/html',body:path==='/harness.js'?bundle.js:path==='/harness.css'?bundle.css:bundle.html});
            });
            await page.goto('http://127.0.0.1:3199/');
            const stable=page.locator(kind==='dashboard'?'.publication-frame':'tbody tr').first(),refresh=page.getByRole('button',{name:'刷新',exact:true});await stable.waitFor();await expect.poll(()=>refresh.isDisabled()).toBe(false);await stable.evaluate(node=>node.setAttribute('data-stable-node','yes'));
            await page.evaluate(()=>{for(const animation of document.getAnimations())if(Number.isFinite(animation.effect?.getTiming().iterations??1))animation.finish();});const before=await stable.boundingBox();if(!before)throw new Error('MISSING_STABLE_CONTENT');
            if(kind==='list'){await page.getByRole('searchbox').fill('未提交的搜索');await page.getByRole('searchbox').focus();}else await stable.focus();
            await page.clock.fastForward(5100);await expect.poll(()=>calls).toBe(2);await page.clock.runFor(40);
            expect(await refresh.isDisabled()).toBe(false);expect(await refresh.getAttribute('aria-busy')).not.toBe('true');expect(await stable.getAttribute('data-stable-node')).toBe('yes');expect((await stable.boundingBox())?.y).toBe(before.y);expect(await refresh.innerText()).toBe('刷新');
            if(kind==='list')expect(await page.getByRole('searchbox').evaluate(node=>node===document.activeElement)).toBe(true);else expect(await stable.evaluate(node=>node===document.activeElement)).toBe(true);
            const folder=join(process.cwd(),'.runtime/silent-refresh');await mkdir(folder,{recursive:true});await page.screenshot({path:join(folder,`${kind}-${engine}-automatic.png`),fullPage:true});
            await refresh.click();await expect.poll(()=>refresh.getAttribute('aria-busy')).toBe('true');expect(await refresh.isDisabled()).toBe(true);expect(await refresh.locator('.icon').evaluate(node=>getComputedStyle(node).animationName)).toBe('refresh-spin');expect(await refresh.innerText()).toBe('刷新');
            await page.clock.fastForward(5000);expect(calls).toBe(2);gates.get(2)?.();await expect.poll(()=>refresh.isDisabled()).toBe(false);expect(await stable.getAttribute('data-stable-node')).toBe('yes');
            if(kind==='list')expect(await page.getByRole('searchbox').inputValue()).toBe('未提交的搜索');
            await refresh.click();await expect.poll(()=>calls).toBe(3);await expect.poll(()=>refresh.getAttribute('aria-busy')).toBe('true');await page.screenshot({path:join(folder,`${kind}-${engine}-manual.png`),fullPage:true});gates.get(3)?.();await expect.poll(()=>refresh.isDisabled()).toBe(false);
            await page.clock.fastForward(5100);await page.getByRole('alert').filter({hasText:'合成静默同步失败'}).waitFor();expect(await stable.getAttribute('data-stable-node')).toBe('yes');expect(await refresh.getAttribute('aria-busy')).not.toBe('true');
            await page.clock.fastForward(5100);await page.getByRole('alert').waitFor({state:'hidden'});expect(await stable.getAttribute('data-stable-node')).toBe('yes');expect(errors).toEqual([]);
        }finally{closed=true;for(const release of gates.values())release();await browser.close();}
    },30000);

    for(const engine of ['chrome','webkit'] as const)it(`console: student table columns align with their values in ${engine}`,async()=>{
        const timing={startedAt:new Date(Date.now()-125000).toISOString(),endedAt:null,endedBy:null,elapsedSeconds:125,remainingSeconds:null,serverNow:new Date().toISOString()};
        const running=ExamProgressSchema.parse({assignmentId:randomUUID(),attemptId:randomUUID(),studentName:'已进入学生',title:'合成场次',moduleTitle:'阅读与写作一',currentPosition:2,answered:1,verified:1,total:98,active:0,attention:0,online:true,timing});
        const waiting=ExamProgressSchema.parse({...running,assignmentId:randomUUID(),attemptId:null,studentName:'未进入学生',moduleTitle:'',currentPosition:null,answered:0,verified:0,online:false,timing:{...timing,startedAt:null,elapsedSeconds:0}});
        const bundle=await browserHarness(`import './src/browser/exam-clock.css';import {createRoot} from 'react-dom/client';import {StudentProgressTable} from './src/browser/dashboard.tsx';createRoot(document.getElementById('root')).render(<main className="dashboard dashboard-home"><section className="panel students-panel"><StudentProgressTable progress={${JSON.stringify([running,waiting])}} onWatch={()=>{}}/></section></main>);`);
        const browser=await(engine==='chrome'?chromium.launch({executablePath:'/usr/bin/google-chrome'}):webkit.launch()),page=await browser.newPage({viewport:{width:1440,height:1000}});
        try{
            await page.route('http://127.0.0.1:3199/**',route=>{const path=new URL(route.request().url()).pathname;return route.fulfill({contentType:path.endsWith('.js')?'text/javascript':path.endsWith('.css')?'text/css':'text/html',body:path==='/harness.js'?bundle.js:path==='/harness.css'?bundle.css:bundle.html});});await page.goto('http://127.0.0.1:3199/');await page.locator('tbody tr').first().waitFor();
            const deltas=await page.locator('table').evaluate(table=>{const headings=[...table.querySelectorAll('th')];return [...table.querySelectorAll('tbody tr')].flatMap(row=>[...row.querySelectorAll('td')].slice(2).map((cell,i)=>{const center=(node:Node)=>{const range=document.createRange();range.selectNodeContents(node);const rect=range.getBoundingClientRect();return rect.x+rect.width/2;};const heading=headings[i+2];if(!heading)throw new Error('MISSING_TABLE_HEADER');return Math.abs(center(cell)-center(heading));}));});for(const delta of deltas)expect(delta).toBeLessThan(1.5);
            expect(await page.locator('tbody tr').first().locator('time').innerText()).toMatch(/^00:02:/);expect(await page.locator('tbody tr').first().getByText('未进入',{exact:true}).count()).toBe(0);expect(await page.locator('tbody tr').last().getByText('未进入',{exact:true}).count()).toBe(1);
            const folder=join(process.cwd(),'.runtime/silent-refresh');await mkdir(folder,{recursive:true});await page.screenshot({path:join(folder,`student-columns-${engine}.png`),fullPage:true});await page.setViewportSize({width:390,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.emulateMedia({colorScheme:'dark'});await page.screenshot({path:join(folder,`student-columns-${engine}-mobile.png`),fullPage:true});
        }finally{await browser.close();}
    },30000);

    beforeAll(async()=>{await mkdir(join(process.cwd(),'.runtime/audit-fixes/screens'),{recursive:true});});
    it('boundary: retained image families must not starve orphan collection',async()=>{
        const modelIds:string[]=[];
        for(let i=0;i<10;i++){
            const item=await queuedReviewSlot('audit_gc_'+i);
            await cancelJob(pool(),item.child,item.run.runId);
            const current=await slotDetail(pool(),admin,item.slot.id);modelIds.push(z.uuid().parse(current.slot.images[0]?.id));
        }
        const lastId=modelIds.at(-1);if(!lastId)throw new Error('NO_RETAINED_IMAGE');
        const owner=await one(pool(),z.uuid(),'SELECT owner_user_id AS value FROM exam_app.media_assets WHERE id=$1',[lastId]);
        const orphanUser=await(await import('@solveflow/db')).userById(pool(),owner);
        const orphanSlot=(await pool().query('SELECT slot_id FROM exam_app.revision_images i JOIN exam_app.question_revisions v ON v.id=i.revision_id WHERE i.asset_id=$1',[lastId])).rows[0]?.slot_id;
        const orphanId=await asset(z.uuid().parse(orphanSlot),orphanUser);
        const retainedParents=(await pool().query('SELECT parent_asset_id FROM exam_app.media_assets WHERE id=ANY($1::uuid[])',[modelIds])).rows.map(row=>row.parent_asset_id);
        await pool().query("UPDATE exam_app.media_assets SET created_at=now()-interval '3 days' WHERE id=ANY($1::uuid[]) OR parent_asset_id=ANY($1::uuid[])",[retainedParents]);
        const orphanParent=await one(pool(),z.uuid(),'SELECT parent_asset_id AS value FROM exam_app.media_assets WHERE id=$1',[orphanId]);
        await pool().query("UPDATE exam_app.media_assets SET created_at=now()-interval '2 days' WHERE id=$1 OR parent_asset_id=$1",[orphanParent]);
        const collected=[];for(let i=0;i<3;i++)collected.push(await collectGarbage(pool(),storage));
        const state=await one(pool(),z.string(),'SELECT state AS value FROM exam_app.media_assets WHERE id=$1',[orphanId]);
        console.log('AUDIT_GC',JSON.stringify({collected,orphanState:state,retainedFamilies:retainedParents.length}));
        expect(state).toBe('deleted');
    },30000);
    it('boundary: revocation before a management write must reject the in-flight request',async()=>{
        const actor=await createUser(pool(),admin,{username:'audit_revoked_manager',displayName:'权限撤销回归',password:'synthetic-password-123',roles:['manager']},password),cookie=await login(actor.username);
        let revoked=false;
        const guarded=new Proxy(pool(),{get(target,property){if(property==='query')return async(...args:unknown[])=>{
            const result=await Reflect.apply(target.query,target,args);
            if(!revoked&&typeof args[0]==='string'&&(args[0].startsWith('UPDATE exam_app.auth_sessions s SET last_seen_at=')||args[0].startsWith("SELECT jsonb_build_object('user',"))){
                revoked=true;await updateUser(pool(),admin,actor.id,{displayName:actor.displayName,state:'disabled',roles:['manager']},undefined);
            }
            return result;
        };const value:unknown=Reflect.get(target,property);return typeof value==='function'?value.bind(target):value;}});
        const local=createExamService({pool:guarded,storage,origin,publicDir:root,clientAddress:()=>randomUUID()});
        const response=await local.app.request('/api/v2/admin/users',{method:'POST',headers:{origin,cookie,'content-type':'application/json'},body:JSON.stringify({username:'audit_created_after_revoke',displayName:'撤权后创建',password:'synthetic-password-123',roles:['student']})});
        expect(revoked).toBe(true);expect((await json('/session',cookie)).status).toBe(401);
        console.log('AUDIT_REVOCATION',JSON.stringify({responseStatus:response.status,sessionStatus:401}));
        expect(response.status).toBe(404);expect(await one(pool(),z.coerce.number(),"SELECT count(*) AS value FROM exam_app.users WHERE username='audit_created_after_revoke'")).toBe(0);
    });
    for(const engine of ['chrome','webkit'] as const)it(`boundary: empty final issue page must recover to existing unresolved items in ${engine}`,async()=>{
        const item=await (await import('@solveflow/db')).issueQueue(pool(),admin,{limit:1});if(!item.items[0])throw new Error('AUDIT_MISSING_ISSUE');
        const example=item.items[0];if(!example)throw new Error('NO_ISSUE');const items=Array.from({length:31},(_,i)=>({...example,id:randomUUID(),studentName:'游标回归 '+i}));let reduced=false;
        const bundle=await browserHarness(`import{createRoot}from'react-dom/client';import{IssueQueue}from'./src/browser/issue-queue.tsx';createRoot(document.getElementById('root')).render(<IssueQueue onOpen={()=>{}}/>);`);
        const browser=await(engine==='chrome'?chromium.launch({executablePath:'/usr/bin/google-chrome'}):webkit.launch());
        try{const page=await browser.newPage({viewport:{width:390,height:844}});await page.route('http://127.0.0.1:3199/**',route=>{
            const u=new URL(route.request().url());if(u.pathname==='/api/v2/admin/issues'){const cursor=u.searchParams.get('cursor');return route.fulfill({json:{items:cursor?(reduced?[]:items.slice(30)):items.slice(0,30),total:reduced?30:31,nextCursor:cursor?null:'audit-next'}});}
            if(u.pathname.startsWith('/api/'))return route.fulfill({json:{items:[],total:0,page:1,pageSize:20,selected:null}});
            return route.fulfill({contentType:u.pathname.endsWith('.js')?'text/javascript':u.pathname.endsWith('.css')?'text/css':'text/html',body:u.pathname==='/harness.js'?bundle.js:u.pathname==='/harness.css'?bundle.css:bundle.html});
        });await page.goto('http://127.0.0.1:3199/');await page.getByRole('button',{name:'下一页',exact:true}).click();await page.locator('.issue-row').filter({hasText:'游标回归 30'}).waitFor();reduced=true;await expect.poll(()=>page.locator('.issue-row').count(),{timeout:7000}).toBe(30);
        await page.screenshot({path:join(process.cwd(),'.runtime/audit-fixes/screens','empty-issue-page-'+engine+'.png'),fullPage:true,animations:'disabled'});
        console.log('AUDIT_CURSOR',JSON.stringify({engine,visibleRows:await page.locator('.issue-row').count(),total:30,page:await page.locator('.queue-pages').count()}));
        expect(await page.locator('.issue-row').count()).toBe(30);expect(await page.getByText('暂无待处理题',{exact:true}).count()).toBe(0);
        }finally{await browser.close();}
    },20000);
    for(const engine of ['chrome','webkit'] as const)it(`boundary: late initial session must not restore an identity cleared by another tab in ${engine}`,async()=>{
        const bundle=await browserHarness(`import './src/browser/main.tsx';`),cookie=await login('test_admin');
        const browser=await(engine==='chrome'?chromium.launch({executablePath:'/usr/bin/google-chrome'}):webkit.launch());
        try{const page=await browser.newPage({viewport:{width:1440,height:1000}});let release:()=>void=()=>{},observed:()=>void=()=>{};const pending=new Promise<void>(resolve=>release=resolve),started=new Promise<void>(resolve=>observed=resolve);
        await page.route('http://127.0.0.1:3199/**',async route=>{const u=new URL(route.request().url());if(u.pathname==='/api/v2/session'){observed();await pending;return route.fulfill({json:{user:admin,expiresAt:new Date(Date.now()+3600000).toISOString()}});}
            if(u.pathname.startsWith('/api/v2/')){const response=await json(u.pathname.slice('/api/v2'.length)+u.search,cookie);return route.fulfill({status:response.status,contentType:'application/json',body:await response.text()});}
            return route.fulfill({contentType:u.pathname.endsWith('.js')?'text/javascript':u.pathname.endsWith('.css')?'text/css':'text/html',body:u.pathname==='/harness.js'?bundle.js:u.pathname==='/harness.css'?bundle.css:bundle.html});});
        await page.goto('http://127.0.0.1:3199/');await started;await page.evaluate(()=>window.dispatchEvent(new StorageEvent('storage',{key:'solveflow-exam-auth-change',newValue:'audit-other-tab-login'})));release();
        await page.getByRole('heading',{name:'登录考试',exact:true}).waitFor();await page.screenshot({path:join(process.cwd(),'.runtime/audit-fixes/screens','late-initial-session-'+engine+'.png'),fullPage:true,animations:'disabled'});
        console.log('AUDIT_SESSION',JSON.stringify({engine,adminRestored:await page.getByRole('navigation',{name:'管理导航'}).count()>0,loginVisible:await page.getByRole('heading',{name:'登录考试',exact:true}).count()}));
        expect(await page.getByRole('heading',{name:'登录考试',exact:true}).isVisible()).toBe(true);expect(await page.getByRole('navigation',{name:'管理导航'}).count()).toBe(0);
        }finally{await browser.close();}
    },20000);
    it('boundary: dashboard issue drilldown must retain the selected sitting',async()=>{
        const second=await createSitting(pool(),admin,{templateId,title:'审查第二场次',opensAt:new Date(Date.now()-60000).toISOString(),closesAt:new Date(Date.now()+3600000).toISOString()}),child=await createUser(pool(),admin,{username:'audit_scene_child',displayName:'另一场学生',password:'synthetic-password-123',roles:['student']},password);
        const assignment=await createAssignment(pool(),admin,{sittingId:second.id,studentId:child.id}),attempt=(await startAttempt(pool(),child,assignment.id)).id,slot=(await snapshot(pool(),child,attempt)).slots[0];if(!slot)throw new Error('NO_SCENE_SLOT');
        const run=await submit(pool(),child,slot.id,{requestId:randomUUID(),expectedRevision:0,kind:'initial',assetIds:[await asset(slot.id,child)]});
        await cancelJob(pool(),child,run.runId);
        await pool().query(`INSERT INTO exam_app.verification_incidents(id,slot_id,attempt_id,student_id,revision_id,source_run_id,reason) SELECT gen_random_uuid(),q.id,q.attempt_id,q.student_id,q.current_revision_id,q.current_run_id,'answer_failed' FROM exam_app.question_slots q WHERE q.id=$1`,[slot.id]);
        const cookie=await login('test_admin'),bundle=await browserHarness(`import{createRoot}from'react-dom/client';import{Admin}from'./src/browser/admin.tsx';createRoot(document.getElementById('root')).render(<Admin user={${JSON.stringify(admin)}}/>);`);
        const browser=await chromium.launch({executablePath:'/usr/bin/google-chrome'});let queueUrl='';
        try{const page=await browser.newPage({viewport:{width:1440,height:1000}});await page.route('http://127.0.0.1:3199/**',async route=>{const u=new URL(route.request().url());if(u.pathname.startsWith('/api/v2/')){if(u.pathname==='/api/v2/admin/issues')queueUrl=u.href;const response=await json(u.pathname.slice('/api/v2'.length)+u.search,cookie);return route.fulfill({status:response.status,contentType:'application/json',body:await response.text()});}return route.fulfill({contentType:u.pathname.endsWith('.js')?'text/javascript':u.pathname.endsWith('.css')?'text/css':'text/html',body:u.pathname==='/harness.js'?bundle.js:u.pathname==='/harness.css'?bundle.css:bundle.html});});
        await page.goto('http://127.0.0.1:3199/');await page.getByRole('combobox',{name:'具体考试',exact:true}).click();await page.getByRole('searchbox',{name:'搜索具体考试',exact:true}).fill('合成考试');await page.getByRole('searchbox',{name:'搜索具体考试',exact:true}).press('Enter');await page.getByRole('option',{name:'合成考试',exact:true}).click();
        await page.getByRole('button',{name:'查看待处理题',exact:true}).click();await page.getByRole('region',{name:'待处理题队列'}).locator('.issue-row').first().waitFor();expect(await page.getByRole('region',{name:'待处理题队列'}).getByText('另一场学生',{exact:true}).count()).toBe(0);await page.screenshot({path:join(process.cwd(),'.runtime/audit-fixes/screens','issue-drilldown-lost-sitting.png'),fullPage:true,animations:'disabled'});
        console.log('AUDIT_DRILLDOWN',JSON.stringify({selectedSitting:sittingId,queueQuery:new URL(queueUrl).search,unrelatedStudentVisible:await page.getByText('另一场学生',{exact:true}).count()>0}));expect(new URL(queueUrl).searchParams.get('sittingId')).toBe(sittingId);
        const {ExamIssueQueueSchema}=await import('@solveflow/contracts/managed-exam');
        const secondQueue=ExamIssueQueueSchema.parse(await(await json('/admin/issues?sittingId='+second.id,cookie)).json());expect(secondQueue.total).toBe(1);expect(secondQueue.items[0]?.studentId).toBe(child.id);
        const unassigned=await createUser(pool(),admin,{username:'repair_unassigned_teacher',displayName:'未授权老师',password:'synthetic-password-123',roles:['support']},password);
        const hidden=await(await import('@solveflow/db')).issueQueue(pool(),unassigned,{sittingId:second.id});expect(hidden.total).toBe(0);expect(hidden.items).toEqual([]);
        }finally{await browser.close();}
    },20000);

    it('boundary: stale manager roles cannot publish or assign through any catalog write',async()=>{
        const manager=await createUser(pool(),admin,{username:'repair_stale_manager',displayName:'管理写入回归',password:'synthetic-password-123',roles:['manager']},password);
        const child=await createUser(pool(),manager,{username:'repair_stale_child',displayName:'授权范围回归',password:'synthetic-password-123',roles:['student']},password);
        const sitting=await createSitting(pool(),manager,{templateId,title:'撤权场次回归',opensAt:new Date(Date.now()-60000).toISOString(),closesAt:new Date(Date.now()+3600000).toISOString()});
        await updateUser(pool(),admin,manager.id,{displayName:manager.displayName,state:'active',roles:['student']},undefined);
        await expect(createUser(pool(),manager,{username:'repair_not_created',displayName:'不可创建',password:'synthetic-password-123',roles:['student']},password)).rejects.toMatchObject({status:404});
        await expect(createTemplate(pool(),manager,{code:'repair-not-published',title:'不可发布',exam:'sat',modules:[{code:'m',title:'模块',sectionCode:'math',questionCount:1,durationSeconds:null}]})).rejects.toMatchObject({status:404});
        await expect(createSitting(pool(),manager,{templateId,title:'不可创建',opensAt:new Date(Date.now()).toISOString(),closesAt:new Date(Date.now()+3600000).toISOString()})).rejects.toMatchObject({status:404});
        await expect(createAssignment(pool(),manager,{sittingId:sitting.id,studentId:child.id})).rejects.toMatchObject({status:404});
    });
    it('boundary: account revocation waits for an authorized write that already owns its lock',async()=>{
        const manager=await createUser(pool(),admin,{username:'repair_lock_manager',displayName:'撤权锁序回归',password:'synthetic-password-123',roles:['manager']},password);
        let release:()=>void=()=>{},observed:()=>void=()=>{};
        const gate=new Promise<void>(resolve=>release=resolve),started=new Promise<void>(resolve=>observed=resolve);
        const guarded=interceptClientQueries(async(sql,perform)=>{const result=await perform();if(sql==='SELECT id FROM exam_app.users WHERE id=$1 FOR SHARE'){observed();await gate;}return result;});
        const write=createUser(guarded,manager,{username:'repair_before_revoke',displayName:'撤权前提交',password:'synthetic-password-123',roles:['student']},password);
        await started;
        const revoke=updateUser(pool(),admin,manager.id,{displayName:manager.displayName,state:'disabled',roles:['manager']},undefined);
        try{
            await expect.poll(()=>one(pool(),z.coerce.number(),"SELECT count(*) AS value FROM pg_stat_activity WHERE wait_event_type='Lock' AND query LIKE 'UPDATE exam_app.users SET display_name=%'"),{timeout:2000}).toBeGreaterThan(0);
        }finally{release();await Promise.all([write,revoke]);}
        expect((await(await import('@solveflow/db')).userById(pool(),manager.id)).state).toBe('disabled');
    });
    it('boundary: a revoked teacher cannot start AI or confirm with a stale identity',async()=>{
        const teacher=await createUser(pool(),admin,{username:'repair_stale_teacher',displayName:'撤权老师',password:'synthetic-password-123',roles:['support']},password);
        const child=await createUser(pool(),admin,{username:'repair_teacher_child',displayName:'老师授权回归',password:'synthetic-password-123',roles:['student']},password);
        const assignment=await createAssignment(pool(),admin,{sittingId,studentId:child.id,supportIds:[teacher.id]}),attempt=await startAttempt(pool(),child,assignment.id),slot=(await snapshot(pool(),child,attempt.id)).slots[0];if(!slot)throw new Error('NO_REVIEW_SLOT');
        const run=await submit(pool(),child,slot.id,{requestId:randomUUID(),expectedRevision:0,kind:'initial',assetIds:[await asset(slot.id,child)]});
        await cancelJob(pool(),child,run.runId);
        await pool().query(`INSERT INTO exam_app.verification_incidents(id,slot_id,attempt_id,student_id,revision_id,source_run_id,reason) SELECT gen_random_uuid(),q.id,q.attempt_id,q.student_id,q.current_revision_id,q.current_run_id,'answer_failed' FROM exam_app.question_slots q WHERE q.id=$1`,[slot.id]);
        const detail=await slotDetail(pool(),teacher,slot.id),expected={expectedRevision:detail.slot.revision,expectedRunId:detail.slot.runId,expectedReviewId:detail.slot.reviewId};
        await updateUser(pool(),admin,teacher.id,{displayName:teacher.displayName,state:'disabled',roles:['support']},undefined);
        await expect(teacherRun(pool(),teacher,slot.id,{...expected,requestId:randomUUID(),action:'solve'})).rejects.toMatchObject({status:404});
        await expect(teacherConfirm(pool(),teacher,slot.id,{...expected,requestId:randomUUID(),answer:'B',selectedOptions:null,note:'不可发布'})).rejects.toMatchObject({status:404});
        expect((await snapshot(pool(),child,attempt.id)).alerts).toHaveLength(1);
    });
    for(const engine of ['chrome','webkit'] as const)it(`boundary: orbit labels remain readable without SVG scaling in ${engine}`,async()=>{
        const summary={students:1,assignments:1,online:0,total:10,answered:10,verified:10,humanConfirmed:0,active:0,attention:0};
        const bundle=await browserHarness(`import{createRoot}from'react-dom/client';import{CoverageOrbit}from'./src/browser/charts.tsx';createRoot(document.getElementById('root')).render(<main className="dashboard-home" style={{maxWidth:700}}><section className="panel home-progress"><div className="home-progress-body"><div className="home-answer-total"><strong>10</strong></div><CoverageOrbit summary={${JSON.stringify(summary)}}/></div></section></main>);`);
        const browser=await(engine==='chrome'?chromium.launch({executablePath:'/usr/bin/google-chrome'}):webkit.launch());
        try{const page=await browser.newPage();await page.route('http://127.0.0.1:3199/**',route=>{const path=new URL(route.request().url()).pathname;return route.fulfill({contentType:path.endsWith('.js')?'text/javascript':path.endsWith('.css')?'text/css':'text/html',body:path==='/harness.js'?bundle.js:path==='/harness.css'?bundle.css:bundle.html});});await page.goto('http://127.0.0.1:3199/');
        for(const width of [320,390,1440]){await page.setViewportSize({width,height:900});for(const dark of [false,true]){await page.emulateMedia({colorScheme:dark?'dark':'light'});
            const metrics=await page.locator('.orbit-caption').evaluate(node=>{const font=parseFloat(getComputedStyle(node).fontSize),matrix=node instanceof SVGGraphicsElement?node.getScreenCTM():null;const box=node.getBoundingClientRect(),root=node.closest('.coverage-orbit')?.getBoundingClientRect();if(!root)throw new Error('NO_ORBIT');return{font:font*(matrix?Math.hypot(matrix.a,matrix.b):1),height:box.height,inside:box.left>=root.left&&box.right<=root.right};});
            expect(metrics.font).toBeGreaterThanOrEqual(12);expect(metrics.height).toBeGreaterThanOrEqual(11);expect(metrics.inside).toBe(true);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
            await page.screenshot({path:join(process.cwd(),'.runtime/audit-fixes/screens',`orbit-${engine}-${width}-${dark?'dark':'light'}.png`),animations:'disabled'});
        }}
        }finally{await browser.close();}
    },20000);
    for(const engine of ['chrome','webkit'] as const)it(`boundary: stale login and logout cannot overwrite a newer identity in ${engine}`,async()=>{
        const bundle=await browserHarness(`import './src/browser/main.tsx';`),cookie=await login('test_admin');
        const browser=await(engine==='chrome'?chromium.launch({executablePath:'/usr/bin/google-chrome'}):webkit.launch());
        let releaseLogin:()=>void=()=>{},releaseLogout:()=>void=()=>{},startedLogin:()=>void=()=>{},startedLogout:()=>void=()=>{},holdLogin=true,holdLogout=true,who=student;
        const loginGate=new Promise<void>(r=>releaseLogin=r),logoutGate=new Promise<void>(r=>releaseLogout=r),loginStarted=new Promise<void>(r=>startedLogin=r),logoutStarted=new Promise<void>(r=>startedLogout=r);
        try{const page=await browser.newPage({viewport:{width:1440,height:1000}});await page.route('http://127.0.0.1:3199/**',async route=>{const u=new URL(route.request().url());
            if(u.pathname==='/api/v2/session')return route.fulfill({status:401,json:{message:'请先登录。'}});
            if(u.pathname==='/api/v2/auth/login'){const user=who;if(holdLogin){startedLogin();await loginGate;}return route.fulfill({json:{user,expiresAt:new Date(Date.now()+3600000).toISOString()}});}
            if(u.pathname==='/api/v2/auth/logout'){if(holdLogout){startedLogout();await logoutGate;}return route.fulfill({json:{ok:true}});}
            if(u.pathname==='/api/v2/me/assignments/page')return route.fulfill({json:{items:[],total:0,page:1,pageSize:20,selected:null,available:[],attentionTotal:0}});
            if(u.pathname.startsWith('/api/v2/')){const response=await json(u.pathname.slice('/api/v2'.length)+u.search,cookie);return route.fulfill({status:response.status,contentType:'application/json',body:await response.text()});}
            return route.fulfill({contentType:u.pathname.endsWith('.js')?'text/javascript':u.pathname.endsWith('.css')?'text/css':'text/html',body:u.pathname==='/harness.js'?bundle.js:u.pathname==='/harness.css'?bundle.css:bundle.html});});
        const signIn=async()=>{await page.getByLabel('用户名',{exact:true}).fill('synthetic');await page.getByLabel('密码',{exact:true}).fill('synthetic-password-123');await page.getByRole('button',{name:'登录',exact:true}).click();};
        const changed=()=>page.evaluate(()=>window.dispatchEvent(new StorageEvent('storage',{key:'solveflow-exam-auth-change',newValue:'new-identity'})));
        await page.goto('http://127.0.0.1:3199/');await signIn();await loginStarted;await changed();releaseLogin();holdLogin=false;
        await page.getByRole('button',{name:'登录',exact:true}).waitFor();expect(await page.locator('.user-name').count()).toBe(0);
        await signIn();await expect.poll(()=>page.locator('.user-name').textContent()).toBe(student.displayName);
        await page.getByRole('button',{name:'账户菜单',exact:true}).click();await page.getByRole('menuitem',{name:'退出登录',exact:true}).click();await logoutStarted;await changed();who=admin;await signIn();await page.getByRole('navigation',{name:'管理导航'}).waitFor();releaseLogout();holdLogout=false;
        await page.waitForTimeout(150);expect(await page.locator('.user-name').innerText()).toBe(admin.displayName);expect(await page.getByRole('navigation',{name:'管理导航'}).isVisible()).toBe(true);
        }finally{releaseLogin();releaseLogout();await browser.close();}
    },20000);

    for (const engine of ['chrome', 'webkit'] as const) it(`boundary: student warnings and teacher resolutions demand attention without interrupting drafts in ${engine}`, async () => {
        const base = ExamAttemptSchema.parse(await snapshot(pool(), student, attemptId));
        const [first, second, third] = base.slots;
        if (!first || !second || !third) throw new Error('MISSING_SLOTS');
        let current = structuredClone(base), reads = 0, failDetail = false;
        current.nextSlotId = third.id; current.viewedSlotId = third.id;
        current.alerts = [first, second].map(slot => ({ id: randomUUID(), slotId: slot.id, moduleId: slot.moduleId, moduleTitle: '阅读与写作一', position: slot.position, revision: 1, reason: 'answer_failed', openedAt: new Date().toISOString() }));
        const notices = current.alerts.map(alert => ({ id: alert.id, slotId: alert.slotId, moduleId: alert.moduleId, moduleTitle: alert.moduleTitle, position: alert.position, revision: 1, resolution: 'human_confirmed' as const, resolvedAt: new Date().toISOString() }));
        const presentation = { answer: 'B. 4', selectedOptions: ['B'], simulated: false, verified: false, humanConfirmed: true, notAppliedReason: null };
        const bundle = await browserHarness(`import {createRoot} from 'react-dom/client';import {StudentAttempt} from './src/browser/student.tsx';createRoot(document.getElementById('root')).render(<><header className="header-bar"><div className="header">SolveFlow</div></header><main className="student-content" style={{minHeight:1800}}><StudentAttempt id="${base.id}"/></main></>);`);
        const browser = engine === 'chrome' ? await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true }) : await webkit.launch();
        const page = await browser.newPage({ viewport: { width: 390, height: 844 } }), errors: string[] = [];
        page.setDefaultTimeout(3000);
        page.on('pageerror', error => errors.push(error.message));
        await page.addInitScript(`window.WebSocket=class{static OPEN=1;readyState=0;send(){}close(){}};`);
        const sync = async () => { current.lastSeq++; await page.evaluate(() => window.dispatchEvent(new Event('online'))); };
        const resolve = (index: number) => {
            const notice = notices[index]; if (!notice) throw new Error('MISSING_NOTICE');
            current.alerts = current.alerts.filter(alert => alert.id !== notice.id); current.resolutions.push(notice);
            current.slots = current.slots.map(slot => slot.id === notice.slotId ? { ...slot, status: 'completed', revision: 1, completedOnce: true, presentation } : slot);
        };
        try {
            await page.route('http://127.0.0.1:3199/**', async route => {
                const path = new URL(route.request().url()).pathname;
                if (path.endsWith('/snapshot')) return route.fulfill({ json: current });
                if (path.endsWith('/navigation')) {
                    const action = z.object({ slotId: z.uuid().optional() }).parse(route.request().postDataJSON());
                    current.viewedSlotId = action.slotId ?? third.id; current.navigationVersion++; current.lastSeq++;
                    return route.fulfill({ json: { id: current.id, slotId: current.viewedSlotId, navigationVersion: current.navigationVersion } });
                }
                if (path.includes('/slots/')) {
                    if (failDetail) return route.fulfill({ status: 503, json: { message: '合成读取失败' } });
                    const slot = current.slots.find(slot => path.endsWith(slot.id));
                    return route.fulfill({ json: { slot, problem: null, outcome: null, revisions: [] } });
                }
                if (path.endsWith('/read')) { reads++; current.resolutions = current.resolutions.filter(notice => !path.includes(notice.id)); current.lastSeq++; return route.fulfill({ json: { ok: true } }); }
                if (path.startsWith('/api/')) return route.fulfill({ status: 404, body: '{}' });
                return route.fulfill({ contentType: path.endsWith('.js') ? 'text/javascript' : path.endsWith('.css') ? 'text/css' : 'text/html', body: path === '/harness.js' ? bundle.js : path === '/harness.css' ? bundle.css : bundle.html });
            });
            await page.goto('http://127.0.0.1:3199/'); await page.getByRole('button', { name: '拍摄第3题', exact: true }).waitFor();
            const pendingNotice = page.getByRole('region', { name: '待处理核验问题' });
            expect(await pendingNotice.locator('summary strong').evaluate(el => parseFloat(getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(18);
            expect(await pendingNotice.getByRole('button', { name: /关闭/ }).count()).toBe(0);
            const screens = join(process.cwd(), '.runtime/student-attention/screens'); await mkdir(screens, { recursive: true });
            for (const theme of ['light', 'dark'] as const) {
                await page.evaluate(theme => document.documentElement.dataset.theme = theme, theme);
                await page.setViewportSize({ width: 320, height: 900 });
                await page.screenshot({ path: join(screens, `warning-${engine}-${theme}.png`), animations: 'disabled' });
                expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
                await page.evaluate(() => window.scrollTo(0, 500));
                const header = await page.locator('.header-bar').boundingBox(), warning = await pendingNotice.locator('summary').boundingBox();
                expect(header && warning && warning.y >= header.y + header.height).toBe(true);
                await page.screenshot({ path: join(screens, `sticky-${engine}-${theme}.png`), animations: 'disabled' });
                await page.evaluate(() => window.scrollTo(0, 0));
            }
            const chooser = page.waitForEvent('filechooser'); await page.getByRole('button', { name: '拍摄第3题', exact: true }).click();
            await (await chooser).setFiles({ name: 'synthetic.png', mimeType: 'image/png', buffer: image });
            const draft = page.getByRole('dialog', { name: '第3题 · 题图', exact: true }); await draft.waitFor();
            resolve(0); await sync(); await expect.poll(() => page.locator('.resolved-answers').count()).toBe(1);
            expect(await draft.isVisible()).toBe(true); expect(await page.getByRole('dialog', { name: '答案已更新', exact: true }).count()).toBe(0); expect(reads).toBe(0);
            await draft.getByRole('button', { name: '取消', exact: true }).click();
            const reminder = page.getByRole('dialog', { name: '答案已更新', exact: true }); await reminder.waitFor({ timeout: 3000 });
            expect(current.viewedSlotId).toBe(third.id); expect(reads).toBe(0);
            await reminder.getByText('老师已处理', { exact: true }).waitFor();
            resolve(1); await sync(); await expect.poll(() => reminder.locator('.alert-links button').count()).toBe(2);
            await reminder.getByRole('button', { name: '稍后查看', exact: true }).click(); await sync();
            expect(await reminder.count()).toBe(0); expect(reads).toBe(0); expect(current.resolutions).toHaveLength(2);
            // A reload still requires acknowledgement because neither answer has been viewed.
            await page.reload(); await reminder.waitFor();
            for (const theme of ['light', 'dark'] as const) {
                await page.evaluate(theme => document.documentElement.dataset.theme = theme, theme);
                for (const width of [320, 390, 1440]) { await page.setViewportSize({ width, height: 900 }); await page.screenshot({ path: join(screens, `resolved-${engine}-${width}-${theme}.png`), animations: 'disabled' }); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true); }
            }
            failDetail = true; await reminder.locator('.alert-links button').first().click(); await page.getByRole('alert').waitFor();
            expect(reads).toBe(0); expect(current.resolutions).toHaveLength(2);
            failDetail = false;
            const resolved = page.getByRole('region', { name: '已解决题目' }); await resolved.locator('summary').click(); await resolved.locator('.alert-links button').first().click();
            const answer = page.getByRole('dialog', { name: '第1题', exact: true }); await answer.getByText('B. 4', { exact: true }).waitFor(); await expect.poll(() => reads).toBe(1);
            await answer.getByRole('button', { name: '关闭', exact: true }).click();
            await resolved.locator('.alert-links button').click(); await page.getByRole('dialog', { name: '第2题', exact: true }).waitFor(); await expect.poll(() => reads).toBe(2);
            expect(current.resolutions).toHaveLength(0);
            await page.getByRole('dialog').getByRole('button', { name: '关闭', exact: true }).click();
            const cancelledPicker = page.waitForEvent('filechooser'); await page.getByRole('button', { name: '重拍本题', exact: true }).click(); await cancelledPicker;
            const previous = notices[0]; if (!previous) throw new Error('MISSING_NOTICE');
            current.resolutions = [{ ...previous, id: randomUUID() }];
            await sync(); await expect.poll(() => page.locator('.resolved-answers').count()).toBe(1);
            expect(await reminder.count()).toBe(0);
            await page.locator('input[type=file]').dispatchEvent('cancel'); await reminder.waitFor();
            // A newer failure removes the stale resolution instead of leaving an obsolete prompt.
            current.resolutions = []; current.alerts = [{ id: previous.id, slotId: previous.slotId, moduleId: previous.moduleId, moduleTitle: previous.moduleTitle, position: previous.position, revision: previous.revision, reason: 'verification_unknown', openedAt: new Date().toISOString() }];
            await sync(); await reminder.waitFor({ state: 'hidden' });
            await pendingNotice.getByText('待处理 · 1 题', { exact: true }).waitFor();
            expect(reads).toBe(2); expect(errors).toEqual([]);
        } finally { await browser.close(); }
    }, 20000);
    for (const engine of ['chrome','webkit'] as const) it(`console: workflow: client clock must not block server-available exams in ${engine}`, async () => {
        const child=await createUser(pool(),admin,{username:'clock_'+engine,displayName:'时钟偏差学生',password:'synthetic-password-123',roles:['student']},password);
        await createAssignment(pool(),admin,{sittingId,studentId:child.id});
        const extra=await createSitting(pool(),admin,{templateId,title:'另一场可进入考试',opensAt:new Date(Date.now()-60000).toISOString(),closesAt:new Date(Date.now()+3600000).toISOString()});
        await createAssignment(pool(),admin,{sittingId:extra.id,studentId:child.id});
        const cookie=await login(child.username),response=await json('/me/assignments/page?entryState=1',cookie),data=ExamAssignmentPageSchema.parse(await response.json());
        expect(data.available).toHaveLength(2);
        const bundle=await browserHarness(`import{createRoot}from'react-dom/client';import{StudentWorkspace}from'./src/browser/student-workspace.tsx';createRoot(document.getElementById('root')).render(<StudentWorkspace attempt={null} busy={false} error="" onAttempt={()=>{}} onStart={async()=>{}}/>);`);
        const browser=await(engine==='chrome'?chromium.launch({executablePath:'/usr/bin/google-chrome'}):webkit.launch());
        try{const page=await browser.newPage({viewport:{width:390,height:844}});page.setDefaultTimeout(3000);
            await page.route('http://127.0.0.1:3199/**',route=>{const path=new URL(route.request().url()).pathname;if(path.endsWith('/assignments/page'))return route.fulfill({json:data});return route.fulfill({contentType:path.endsWith('.js')?'text/javascript':path.endsWith('.css')?'text/css':'text/html',body:path==='/harness.js'?bundle.js:path==='/harness.css'?bundle.css:bundle.html});});
            await page.goto('http://127.0.0.1:3199/');const buttons=page.getByRole('button',{name:'进入考试',exact:true});await buttons.first().waitFor();expect(await buttons.first().isEnabled()).toBe(true);
            await page.addInitScript(`Date.now=()=>${Date.now()+86400000};`);await page.reload();await buttons.first().waitFor();
            await page.screenshot({path:join(process.cwd(),'.runtime/workflow-repairs/clock-'+engine+'.png'),fullPage:true});
            expect(await buttons.first().isEnabled()).toBe(true);
        }finally{await browser.close();}
    });
    for (const engine of ['chrome','webkit'] as const) it(`console: workflow: withdrawn exam must dismiss its ready dialog in ${engine}`, async () => {
        const child=await createUser(pool(),admin,{username:'ready_'+engine,displayName:'撤回考试学生',password:'synthetic-password-123',roles:['student']},password);
        const sitting=await createSitting(pool(),admin,{templateId,title:'稍后撤回的不限时考试',opensAt:new Date(Date.now()-60000).toISOString(),closesAt:null}),assignment=await createAssignment(pool(),admin,{sittingId:sitting.id,studentId:child.id});
        const cookie=await login(child.username);let data=ExamAssignmentPageSchema.parse(await(await json('/me/assignments/page?entryState=1',cookie)).json()),reads=0;
        const bundle=await browserHarness(`import{createRoot}from'react-dom/client';import{StudentWorkspace}from'./src/browser/student-workspace.tsx';createRoot(document.getElementById('root')).render(<StudentWorkspace attempt={null} busy={false} error="" onAttempt={()=>{}} onStart={async()=>{}}/>);`);
        const browser=await(engine==='chrome'?chromium.launch({executablePath:'/usr/bin/google-chrome'}):webkit.launch());
        try{const page=await browser.newPage({viewport:{width:390,height:844}});page.setDefaultTimeout(3000);
            await page.route('http://127.0.0.1:3199/**',route=>{const path=new URL(route.request().url()).pathname;if(path.endsWith('/assignments/page')){reads++;return route.fulfill({json:data});}return route.fulfill({contentType:path.endsWith('.js')?'text/javascript':path.endsWith('.css')?'text/css':'text/html',body:path==='/harness.js'?bundle.js:path==='/harness.css'?bundle.css:bundle.html});});
            await page.goto('http://127.0.0.1:3199/');const modal=page.getByRole('dialog',{name:'准备开始考试',exact:true});await modal.waitFor();
            await pool().query("UPDATE exam_app.exam_assignments SET state='revoked' WHERE id=$1",[assignment.id]);data=ExamAssignmentPageSchema.parse(await(await json('/me/assignments/page?entryState=1',cookie)).json());expect(data.available).toHaveLength(0);
            const previous=reads;await expect.poll(()=>reads,{timeout:6500}).toBeGreaterThan(previous);
            await page.screenshot({path:join(process.cwd(),'.runtime/workflow-repairs/withdrawn-'+engine+'.png'),fullPage:true});
            await expect.poll(()=>modal.count()).toBe(0);
        }finally{await browser.close();}
    });
    for (const engine of ['chrome','webkit'] as const) it(`console: workflow: practice original image has the exam zoom controls in ${engine}`, async () => {
        const bundle=await browserHarness(`import './src/browser/practice.css';import{createRoot}from'react-dom/client';import{StudentPractice}from'./src/browser/practice.tsx';createRoot(document.getElementById('root')).render(<main className="student-content"><StudentPractice/></main>);`);
        const browser=await(engine==='chrome'?chromium.launch({executablePath:'/usr/bin/google-chrome'}):webkit.launch());
        try{const page=await browser.newPage({viewport:{width:390,height:844}});page.setDefaultTimeout(3000);
            await page.route('http://127.0.0.1:3199/**',route=>{const path=new URL(route.request().url()).pathname;if(path==='/api/v2/practice')return route.fulfill({json:{schemaVersion:1,requestId:route.request().headers()['x-request-id'],status:'finished',phase:'verifying',outcome:outcome()}});return route.fulfill({contentType:path.endsWith('.js')?'text/javascript':path.endsWith('.css')?'text/css':'text/html',body:path==='/harness.js'?bundle.js:path==='/harness.css'?bundle.css:bundle.html});});
            await page.goto('http://127.0.0.1:3199/');await page.locator('input[type=file]').setInputFiles({name:'synthetic.png',mimeType:'image/png',buffer:image});await page.getByRole('heading',{name:'答案',exact:true}).waitFor();await page.getByRole('button',{name:'查看题图',exact:true}).click();
            const modal=page.getByRole('dialog',{name:'题图',exact:true});await modal.waitFor();await page.screenshot({path:join(process.cwd(),'.runtime/workflow-repairs/practice-image-'+engine+'.png'),fullPage:true});
            const reset=modal.getByRole('button',{name:'重置图片',exact:true});await expect.poll(()=>reset.isEnabled()).toBe(true);await enlargePicture(modal);expect(await modal.getByLabel('图片缩放比例').textContent()).toBe('125%');await modal.getByRole('button',{name:'全屏查看',exact:true}).click();expect(await modal.getByRole('button',{name:'退出全屏查看',exact:true}).count()).toBe(1);await modal.getByRole('button',{name:'关闭',exact:true}).click();await page.getByRole('button',{name:'查看题图',exact:true}).click();await expect.poll(()=>page.getByRole('dialog',{name:'题图',exact:true}).getByRole('button',{name:'重置图片',exact:true}).isEnabled()).toBe(true);
        }finally{await browser.close();}
    });
    for (const engine of ['chrome','webkit'] as const) for (const fault of ['receipt','offline','not-received','native-reset','read-rejected'] as const) it(`console: workflow: submission recovery ${fault} in ${engine}`,async()=>{
        const child=await createUser(pool(),admin,{username:'recover_'+engine+'_'+fault.replace('-','_'),displayName:'补图保存恢复',password:'synthetic-password-123',roles:['student']},password),assignment=await createAssignment(pool(),admin,{sittingId,studentId:child.id}),attempt=await startAttempt(pool(),child,assignment.id);
        let current=await snapshot(pool(),child,attempt.id);const slot=current.slots[0];if(!slot)throw new Error('MISSING_RECOVERY_SLOT');
        await submit(pool(),child,slot.id,{requestId:randomUUID(),expectedRevision:0,kind:'initial',assetIds:[await asset(slot.id,child)]});const job=await claimJob(pool());if(!job||job.slotId!==slot.id)throw new Error('MISSING_RECOVERY_JOB');await finishJob(pool(),job,outcome(),null);
        current=await snapshot(pool(),child,attempt.id);current.nextSlotId=slot.id;current.viewedSlotId=slot.id;const cookie=await login(child.username),requests:{requestId:string;assetIds:string[]}[]=[];let receipts=0;
        const bundle=await browserHarness(`import{createRoot}from'react-dom/client';import{StudentAttempt}from'./src/browser/student.tsx';createRoot(document.getElementById('root')).render(<main className="student-content"><StudentAttempt id="${attempt.id}"/></main>);`),browser=await(engine==='chrome'?chromium.launch({executablePath:'/usr/bin/google-chrome'}):webkit.launch());
        let server:Server|undefined;const serverErrors:string[]=[];
        try{const page=await browser.newPage({viewport:{width:390,height:844}});page.setDefaultTimeout(4000);await page.addInitScript(`window.recoveryPosts=0;const nativeFetch=window.fetch;window.fetch=(...args)=>{if(args[1]?.method==='POST'&&String(args[0]).endsWith('/submissions'))window.recoveryPosts++;return nativeFetch(...args)};window.WebSocket=class{static OPEN=1;readyState=0;send(){}close(){}};`);
            server=createServer((req,res)=>{void(async()=>{
                const u=new URL(req.url??'/',origin),path=u.pathname;
                if(path.endsWith('/snapshot')){res.setHeader('content-type','application/json');res.end(JSON.stringify(current));return;}
                if(path.startsWith('/api/v2')){
                    const chunks:Buffer[]=[];let size=0;for await(const chunk of req){const value=Buffer.isBuffer(chunk)?chunk:Buffer.from(chunk);size+=value.length;if(size>11*1024*1024)throw new Error('RECOVERY_TEST_BODY_LIMIT');chunks.push(value);}const body=Buffer.concat(chunks);
                    const isSubmission=path.endsWith('/submissions')&&req.method==='POST';
                    if(isSubmission){const raw:unknown=JSON.parse(body.toString());requests.push(z.object({requestId:z.uuid(),assetIds:z.array(z.uuid())}).parse(raw));if(fault==='not-received'&&requests.length===1){res.writeHead(503,{'content-type':'application/json'});res.end(JSON.stringify({message:'连接暂时中断。'}));return;}}
                    if(/\/submissions\//.test(path)){receipts++;if((fault==='offline'||fault==='read-rejected')&&receipts===1||fault==='read-rejected'&&receipts===2){res.writeHead(receipts===2?404:503,{'content-type':'application/json'});res.end(JSON.stringify({message:'暂时无法查询保存结果。'}));return;}}
                    const headers=new Headers({cookie,origin});for(const [key,value]of Object.entries(req.headers))if(typeof value==='string'&&!['cookie','origin','host','connection','content-length'].includes(key))headers.set(key,value);
                    const response=await service.app.request(path+u.search,{method:req.method??'GET',headers,...(body.length?{body:new Uint8Array(body).buffer}: {})}),bytes=Buffer.from(await response.arrayBuffer());
                    if(isSubmission&&requests.length===1){if(fault==='native-reset')res.destroy();else{res.writeHead(503,{'content-type':'application/json'});res.end(JSON.stringify({message:'连接暂时中断。'}));}return;}res.writeHead(response.status,Object.fromEntries(response.headers));res.end(bytes);return;
                }
                res.setHeader('content-type',path.endsWith('.js')?'text/javascript':path.endsWith('.css')?'text/css':'text/html');res.end(path==='/harness.js'?bundle.js:path==='/harness.css'?bundle.css:bundle.html);
            })().catch(error=>{serverErrors.push(String(error));res.statusCode=500;res.end();});});server.listen(0,'127.0.0.1');await new Promise<void>(resolve=>server?.once('listening',resolve));const address=server.address();if(!address||typeof address==='string')throw new Error('RECOVERY_SERVER_MISSING');
            await page.goto('http://127.0.0.1:'+address.port+'/');await page.getByRole('button',{name:'补图',exact:true}).click();await page.locator('input[type=file]').setInputFiles([{name:'first.png',mimeType:'image/png',buffer:image},{name:'second.png',mimeType:'image/png',buffer:image}]);
            const dialog=page.getByRole('dialog',{name:'第1题 · 补图',exact:true});await dialog.getByRole('button',{name:'保存并解答',exact:true}).click();
            if(fault!=='receipt'&&fault!=='native-reset'){
                const retry=dialog.getByRole('button',{name:'同步并重试',exact:true});await retry.waitFor();expect(await dialog.getByRole('button',{name:'移除第2张',exact:true}).isDisabled()).toBe(true);expect(requests).toHaveLength(1);
                expect(await page.getByText('保存结果暂未确认，图片已保留。请同步并重试。',{exact:true}).count()).toBe(1);
                await page.screenshot({path:join(process.cwd(),'.runtime/workflow-repairs/recovery-'+engine+'-'+fault+'.png'),fullPage:true});await retry.click();
                if(fault==='read-rejected'){
                    await retry.waitFor();expect(await dialog.getByRole('button',{name:'移除第2张',exact:true}).isDisabled()).toBe(true);expect(requests).toHaveLength(1);expect(receipts).toBe(2);
                    await retry.click();
                }
            }
            await expect.poll(()=>dialog.count()).toBe(0);expect(await page.evaluate(()=>'recoveryPosts' in window&&typeof window.recoveryPosts==='number'?window.recoveryPosts:0)).toBe(fault==='not-received'?2:1);if(fault!=='native-reset'){expect(requests).toHaveLength(fault==='not-received'?2:1);expect(receipts).toBe(fault==='receipt'?1:fault==='read-rejected'?3:2);}else expect(requests.length).toBeGreaterThan(0);
            for(const request of requests)expect(request).toEqual(requests[0]);
            const latest=await snapshot(pool(),child,attempt.id);expect(latest.slots.find(s=>s.id===slot.id)?.revision).toBe(2);
            const count=await one(pool(),z.number(),'SELECT count(*)::integer AS value FROM exam_app.answer_runs WHERE slot_id=$1',[slot.id]);expect(count).toBe(2);
        }finally{const latest=await snapshot(pool(),child,attempt.id),active=latest.slots.find(s=>s.id===slot.id);if(active?.runId)await cancelJob(pool(),child,active.runId);await browser.close();if(server){server.closeAllConnections();await new Promise<void>(resolve=>server?.close(()=>resolve()));}expect(serverErrors).toEqual([]);}
    });
    it('console: workflow: submission receipts enforce owner and slot without replay',async()=>{
        const child=await createUser(pool(),admin,{username:'receipt_owner',displayName:'只读回执学生',password:'synthetic-password-123',roles:['student']},password),assignment=await createAssignment(pool(),admin,{sittingId,studentId:child.id}),attempt=await startAttempt(pool(),child,assignment.id),slots=(await snapshot(pool(),child,attempt.id)).slots,slot=slots[0],second=slots[1];if(!slot||!second)throw new Error('MISSING_RECEIPT_SLOT');
        const cookie=await login(child.username),foreign=await login(student.username),requestId=randomUUID(),path='/slots/'+slot.id+'/submissions/'+requestId;
        const legacy=z.object({items:z.array(ExamAssignmentSchema.omit({entryState:true}))}).parse(await(await json('/me/assignments/page',cookie)).json());expect(legacy.items).toHaveLength(1);const capable=ExamAssignmentPageSchema.parse(await(await json('/me/assignments/page?entryState=1',cookie)).json());expect(capable.items[0]?.entryState).toBe('available');
        expect(await(await json(path,cookie)).json()).toEqual({runId:null});
        const run=await submit(pool(),child,slot.id,{requestId,expectedRevision:0,kind:'initial',assetIds:[await asset(slot.id,child)]});
        expect(await(await json(path,cookie)).json()).toEqual({runId:run.runId});expect((await json(path,foreign)).status).toBe(404);expect(await(await json('/slots/'+second.id+'/submissions/'+requestId,cookie)).json()).toEqual({runId:null});
        expect(await one(pool(),z.number(),'SELECT count(*)::integer AS value FROM exam_app.answer_runs WHERE slot_id=$1',[slot.id])).toBe(1);await cancelJob(pool(),child,run.runId);
    });
    for(const engine of ['chrome','webkit'] as const)it(`console: workflow: dashboard actions and student priority fit ${engine}`,async()=>{
        const cookie=await login('test_admin'),bundle=await browserHarness(`import './src/browser/main.tsx';`),browser=await(engine==='chrome'?chromium.launch({executablePath:'/usr/bin/google-chrome'}):webkit.launch());
        try{const page=await browser.newPage({viewport:{width:1440,height:1000}});page.setDefaultTimeout(4000);await page.addInitScript(`window.WebSocket=class{static OPEN=1;readyState=0;send(){}close(){}};`);
            await page.route('http://127.0.0.1:3199/**',async route=>{const req=route.request(),u=new URL(req.url()),path=u.pathname;if(path.startsWith('/api/v2')){if(req.method()!=='GET')throw new Error('DASHBOARD_READ_ONLY');const response=await json(path.slice(7)+u.search,cookie);return route.fulfill({status:response.status,headers:Object.fromEntries(response.headers),body:Buffer.from(await response.arrayBuffer())});}return route.fulfill({contentType:path.endsWith('.js')?'text/javascript':path.endsWith('.css')?'text/css':'text/html',body:path==='/harness.js'?bundle.js:path==='/harness.css'?bundle.css:bundle.html});});
            await page.goto('http://127.0.0.1:3199/');await page.locator('.students-panel tbody button').first().waitFor();
            for(const width of [1920,1440,1300,1281,1100,1024,901,768,640,390,320])for(const theme of ['light','dark']){
                await page.setViewportSize({width,height:width===1440?1000:844});await page.evaluate(theme=>{localStorage.setItem('solveflow-exam-appearance',theme);window.dispatchEvent(new CustomEvent('exam-appearance',{detail:theme}));},theme);
                const geometry=await page.locator('.students-panel').evaluate(panel=>{const wrap=panel.querySelector('.student-progress-table'),button=wrap?.querySelector('tbody button');if(!(wrap instanceof HTMLElement)||!button)throw new Error('MISSING_PROGRESS_GEOMETRY');return{top:panel.getBoundingClientRect().top+scrollY,width:wrap.clientWidth,scroll:wrap.scrollWidth,right:wrap.getBoundingClientRect().right,actionRight:button.getBoundingClientRect().right};});
                const question=page.locator('.students-panel .progress-question').first();await question.waitFor();expect(await question.evaluate(node=>{const text=document.createRange();text.selectNodeContents(node);const box=text.getBoundingClientRect(),cell=node.closest('td')?.getBoundingClientRect();return !!cell&&box.left>=cell.left&&box.right<=cell.right+1;})).toBe(true);
                expect(geometry.scroll).toBeLessThanOrEqual(geometry.width+1);expect(geometry.actionRight).toBeLessThanOrEqual(geometry.right+1);if(width<641)expect(geometry.top).toBeLessThan(750);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
                await page.screenshot({path:join(process.cwd(),'.runtime/workflow-repairs/home-'+engine+'-'+width+'-'+theme+'.png'),fullPage:true,animations:'disabled'});
            }
        }finally{await browser.close();}
    });

    async function studentFlowFixture(engine: 'chrome' | 'webkit') {
        const current = ExamAttemptSchema.parse(await snapshot(pool(), student, attemptId));
        current.timing = { ...current.timing, startedAt: new Date(Date.now() - 120000).toISOString(), endedAt: null, endedBy: null, elapsedSeconds: 120, remainingSeconds: null };
        current.state = 'in_progress'; current.alerts = []; current.resolutions = []; current.navigationVersion = 0;
        current.slots = current.slots.map(slot => ({ ...slot, revision: 0, runId: null, reviewId: null, images: [], status: 'empty', presentation: null, completedOnce: false, skipped: false }));
        const first = current.slots[0]; if (!first) throw new Error('MISSING_FLOW_SLOT');
        current.viewedSlotId = first.id; current.nextSlotId = first.id; current.latestAnswerSlotId = null;
        const generated = outcome(); if (generated.status !== 'completed') throw new Error('MISSING_FLOW_PROBLEM'); const problem = generated.candidate.problem;
        const control = { detail: async (slot: typeof first): Promise<{ status: number; body: unknown }> => ({ status: 200, body: { slot, problem: { ...problem, text: '题干 ' + slot.id }, outcome: null, humanReviews: [], revisions: [] } }), rerun: async (_raw: unknown): Promise<{ status: number; body: unknown }> => ({status:500,body:{message:'未配置合成重答'}}) };
        const bundle = await browserHarness(`import{createRoot}from'react-dom/client';import{StudentAttempt}from'./src/browser/student.tsx';createRoot(document.getElementById('root')).render(<main className="student-content"><StudentAttempt id="${current.id}"/></main>);`);
        const browser = await (engine === 'chrome' ? chromium.launch({ executablePath: '/usr/bin/google-chrome' }) : webkit.launch());
        const page = await browser.newPage({ viewport: { width: 390, height: 844 } }), errors: string[] = [], writes: string[] = [];
        page.setDefaultTimeout(3000); page.on('pageerror', error => errors.push(error.message));
        await page.addInitScript(`window.WebSocket=class{static OPEN=1;readyState=0;send(){}close(){}};`);
        await page.route('http://127.0.0.1:3199/**', async route => {
            const request = route.request(), path = new URL(request.url()).pathname;
            if (path.endsWith('/snapshot')) return route.fulfill({ json: current });
            if (path.endsWith('/run')) { writes.push(path);const response=await control.rerun(request.postDataJSON());return route.fulfill({status:response.status,json:response.body}); }
            if (path.endsWith('/navigation')) {
                writes.push(path); const input = ExamNavigationSchema.parse(request.postDataJSON());
                const target = 'slotId' in input ? current.slots.find(slot => slot.id === input.slotId) : current.slots.find(slot => slot.moduleId === input.moduleId);
                if (!target) throw new Error('MISSING_FLOW_TARGET');
                current.viewedSlotId = target.id; current.nextSlotId = target.id; current.navigationVersion++; current.lastSeq++;
                return route.fulfill({ json: { id: current.id, slotId: target.id, navigationVersion: current.navigationVersion } });
            }
            if (path.startsWith('/api/v2/runs/') && path.endsWith('/cancel')) { const slot = current.slots.find(slot=>path.includes(slot.runId??'missing')); if(!slot)throw new Error('MISSING_CANCEL_SLOT');writes.push(path);slot.status='cancelled';current.lastSeq++;return route.fulfill({json:{ok:true}}); }
            if (path.startsWith('/api/v2/slots/')) {
                const slot = current.slots.find(slot => path.endsWith('/' + slot.id)); if (!slot) throw new Error('MISSING_FLOW_DETAIL');
                const result = await control.detail(structuredClone(slot)); return route.fulfill({ status: result.status, json: result.body });
            }
            if (path.startsWith('/api/v2/media/')) return route.fulfill({ contentType: 'image/jpeg', body: image });
            if (path.startsWith('/api/')) throw new Error('UNEXPECTED_FLOW_REQUEST ' + path);
            return route.fulfill({ contentType: path.endsWith('.js') ? 'text/javascript' : path.endsWith('.css') ? 'text/css' : 'text/html', body: path === '/harness.js' ? bundle.js : path === '/harness.css' ? bundle.css : bundle.html });
        });
        return { current, control, page, browser, errors, writes, sync: async () => { current.lastSeq++; await page.evaluate(() => window.dispatchEvent(new Event('online'))); } };
    }
    function flowAnswer(slot: z.infer<typeof ExamAttemptSchema>['slots'][number], label: string, text = label) {
        slot.revision = 1; slot.runId = randomUUID(); slot.status = 'completed'; slot.completedOnce = true;
        slot.presentation = { answer: text, selectedOptions: label ? [label] : [], simulated: false, verified: true, humanConfirmed: false, notAppliedReason: null };
    }
    for (const engine of ['chrome','webkit'] as const) it(`console: teacher inline: navigation is expanded and time stays centered in ${engine}`, async () => {
        const current = ExamAttemptSchema.parse(await snapshot(pool(),student,attemptId));
        current.studentName = '测试学生与较长姓名'; current.resolutions=[]; current.alerts=[];
        current.timing = {...current.timing,startedAt:new Date(Date.now()-120000).toISOString(),endedAt:null,endedBy:null,elapsedSeconds:120,remainingSeconds:null};
        const moduleSeed=current.modules[0],slotSeed=current.slots[0];if(!moduleSeed||!slotSeed)throw new Error('MISSING_TEACHER_LAYOUT_SEED');
        current.modules=[27,27,22,22].map((questionCount,i)=>({...moduleSeed,id:randomUUID(),position:i+1,code:'m'+i,title:['阅读与写作一','阅读与写作二','数学一','数学二'][i]??'模块',questionCount}));
        let ordinal=0;current.slots=current.modules.flatMap(module=>Array.from({length:module.questionCount},(_,i)=>({...slotSeed,id:randomUUID(),moduleId:module.id,position:i+1,ordinal:++ordinal,revision:0,runId:null,reviewId:null,status:'empty' as const,presentation:null,images:[],completedOnce:false,skipped:false})));
        const slot=current.slots[0];if(!slot)throw new Error('MISSING_TEACHER_LAYOUT_SLOT');flowAnswer(slot,'B','B. $4.25');current.viewedSlotId=slot.id;current.nextSlotId=slot.id;
        const [solving,verifying,failed,manual]=current.slots.slice(1,5);if(!solving||!verifying||!failed||!manual)throw new Error('MISSING_TEACHER_PALETTE_SLOTS');
        flowAnswer(solving,'A');solving.status='solving';flowAnswer(verifying,'C');verifying.status='verifying';flowAnswer(failed,'D');failed.status='failed';flowAnswer(manual,'C');if(manual.presentation){manual.presentation.verified=false;manual.presentation.humanConfirmed=true;}
        const result=outcome(); if(result.status!=='completed')throw new Error('NO_TEACHER_LAYOUT_OUTCOME');
        const problem={...result.candidate.problem,text:'Josie purchased a pass that cost $19.50 to tour a nature preserve. She also purchased 10 identical stickers to give to her nieces and nephews. The pass and the stickers cost $62.00 total. What was the cost of one sticker?'};
        const bundle=await browserHarness(`import{createRoot}from'react-dom/client';import{Monitor}from'./src/browser/monitor.tsx';createRoot(document.getElementById('root')).render(<Monitor id="${current.id}" onClose={()=>{}}/>);`);
        const browser=await(engine==='chrome'?chromium.launch({executablePath:'/usr/bin/google-chrome'}):webkit.launch());const page=await browser.newPage({viewport:{width:1440,height:1000}});page.setDefaultTimeout(3000);
        const writes:string[]=[],errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));await page.addInitScript(`window.WebSocket=class{static OPEN=1;readyState=0;send(){}close(){}};`);
        await page.route('http://127.0.0.1:3199/**',async route=>{const request=route.request(),path=new URL(request.url()).pathname;
            if(request.method()!=='GET'){writes.push(path);return route.fulfill({status:500});}
            if(path.endsWith('/snapshot'))return route.fulfill({json:current});
            if(path.includes('/slots/')){const selected=current.slots.find(item=>path.endsWith(item.id));return route.fulfill({json:{slot:selected,problem,outcome:result,humanReviews:[],revisions:[]}});}
            if(path.includes('/media/'))return route.fulfill({contentType:'image/jpeg',body:image});
            return route.fulfill({contentType:path.endsWith('.js')?'text/javascript':path.endsWith('.css')?'text/css':'text/html',body:path==='/harness.js'?bundle.js:path==='/harness.css'?bundle.css:bundle.html});
        });
        try{
            await page.goto('http://127.0.0.1:3199/');const navigation=page.getByRole('region',{name:'题目导航',exact:true});await navigation.waitFor();
            expect(await page.getByRole('dialog').count()).toBe(1);expect(await page.getByRole('button',{name:'题目导航',exact:true}).getAttribute('aria-expanded')).toBe('true');
            await navigation.getByRole('button',{name:/第1题$/}).first().click();await page.getByRole('tab',{name:'手动作答',exact:true}).waitFor();
            expect(await navigation.isVisible()).toBe(true);expect(await page.getByRole('dialog').count()).toBe(1);
            expect(await page.getByRole('list',{name:'题目状态图例'}).innerText()).toBe('未答\n正在回答\n校验\n通过\n出错');
            for(const [position,label] of [[1,'通过'],[2,'正在回答'],[3,'校验'],[4,'出错'],[5,'通过'],[6,'未答']] as const)expect(await navigation.getByRole('button',{name:current.modules[0]?.title+' · 第'+position+'题',exact:true}).innerText()).toContain(label);
            expect(await navigation.getByRole('button').first().getAttribute('aria-current')).toBe('step');
            const screens=join(process.cwd(),'.runtime/teacher-layout-20261105/screens');await mkdir(screens,{recursive:true});
            for(const width of [320,390,768,1440])for(const theme of ['light','dark']){
                await page.setViewportSize({width,height:1000});await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);
                const dialog=page.getByRole('dialog').first(),header=dialog.locator(':scope > .dialog-head'),clock=header.getByLabel('考试用时');await clock.waitFor();
                const headBox=await header.boundingBox(),clockBox=await clock.boundingBox();if(!headBox||!clockBox)throw new Error('MISSING_HEADER_CLOCK');
                expect(Math.abs(clockBox.x+clockBox.width/2-headBox.x-headBox.width/2)).toBeLessThanOrEqual(2);
                expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
                const phase=navigation.locator('.navigation-phase').first(),phaseBox=await phase.boundingBox();
                expect(phaseBox?.height).toBeLessThanOrEqual(18);
                expect(await navigation.getByRole('button').first().evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);
                expect(await navigation.locator('.overview-phase').evaluateAll(elements=>elements.every(el=>el.scrollWidth<=el.clientWidth+1))).toBe(true);
                const question=page.getByRole('region',{name:'题目与原图'});expect(await question.locator('.katex').count()).toBe(0);expect(await question.innerText()).toContain('$19.50');expect(await question.innerText()).toContain('$62.00');
                expect(await question.evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);
                await page.screenshot({path:join(screens,`${engine}-${width}-${theme}.png`),fullPage:true,animations:'disabled'});
            }
            await page.getByRole('button',{name:'题目导航',exact:true}).click();expect(await navigation.count()).toBe(0);
            await page.evaluate(()=>window.dispatchEvent(new Event('online')));expect(await navigation.count()).toBe(0);
            await page.getByRole('button',{name:'题目导航',exact:true}).click();await navigation.waitFor();
            await page.getByRole('tab',{name:'手动作答',exact:true}).click();
            expect(await navigation.getByRole('button').first().isEnabled()).toBe(true);expect(await page.getByRole('button',{name:'定位当前题',exact:true}).count()).toBeLessThanOrEqual(1);
            expect(await page.getByRole('textbox',{name:'确认答案',exact:true}).count()).toBe(0);
            await page.getByRole('radio',{name:'C',exact:true}).check();await page.getByLabel('处理意见',{exact:true}).fill('合成草稿，不应自动保存。');expect(await navigation.getByRole('button').first().isDisabled()).toBe(true);expect(await page.getByRole('button',{name:'保存并通知学生',exact:true}).isEnabled()).toBe(true);expect(await page.locator('.review-current-answer').innerText()).toContain('B. $4.25');await page.getByRole('button',{name:'取消',exact:true}).click();
            expect(await navigation.getByRole('button').first().isEnabled()).toBe(true);
            expect(writes).toEqual([]);expect(errors).toEqual([]);
        }finally{await browser.close();}
    });

    it('student rerun: retains materials and answer, deduplicates explicit retries and publishes to the same slot', async () => {
        const f=await queuedReviewSlot('rerun_owner');
        await pool().query("UPDATE exam_app.answer_runs SET created_at=now()-interval '1 day' WHERE id=$1",[f.run.runId]);
        const original=await claimJob(pool());if(!original||original.id!==f.run.runId)throw new Error('WRONG_RERUN_FIXTURE');
        await finishJob(pool(),original,outcome(),null);
        const before=ExamAttemptSchema.parse(await snapshot(pool(),f.child,original.attemptId)),detail=await slotDetail(pool(),f.child,f.slot.id),cookie=await login(f.child.username);
        const input={requestId:randomUUID(),expectedRevision:detail.slot.revision,expectedRunId:detail.slot.runId,expectedReviewId:detail.slot.reviewId};
        const responses=await Promise.all([json('/slots/'+f.slot.id+'/run',cookie,'POST',input),json('/slots/'+f.slot.id+'/run',cookie,'POST',input)]);
        expect(responses.map(r=>r.status)).toEqual([202,202]);
        const ids=await Promise.all(responses.map(async r=>z.object({id:z.uuid()}).parse(await r.json()).id));expect(ids[0]).toBe(ids[1]);
        const queued=await slotDetail(pool(),f.child,f.slot.id);expect(queued.slot).toMatchObject({id:f.slot.id,revision:detail.slot.revision,runId:ids[0],status:'queued',presentation:detail.slot.presentation});expect(queued.slot.images).toEqual(detail.slot.images);
        expect((await snapshot(pool(),f.child,original.attemptId)).viewedSlotId).toBe(before.viewedSlotId);
        expect(await one(pool(),z.coerce.number(),'SELECT count(*) AS value FROM exam_app.answer_runs WHERE slot_id=$1',[f.slot.id])).toBe(2);
        expect((await json('/slots/'+f.slot.id+'/run',cookie,'POST',{...input,requestId:randomUUID(),expectedRunId:ids[0]})).status).toBe(409);
        await pool().query("UPDATE exam_app.answer_runs SET created_at=now()-interval '1 day' WHERE id=$1",[ids[0]]);
        const next=await claimJob(pool());if(!next||next.id!==ids[0])throw new Error('RERUN_NOT_CLAIMABLE');
        const result=outcome();if(result.status!=='completed')throw new Error('MISSING_RERUN_OUTCOME');result.candidate.answer='C. 5';result.candidate.selectedOptions=['C'];await finishJob(pool(),next,result,null);
        expect((await slotDetail(pool(),f.child,f.slot.id)).slot.presentation?.answer).toBe('C. 5');expect((await snapshot(pool(),f.child,next.attemptId)).viewedSlotId).toBe(before.viewedSlotId);
        expect((await json('/slots/'+f.slot.id+'/run',cookie,'POST',input)).status).toBe(202);
        expect(await one(pool(),z.coerce.number(),'SELECT count(*) AS value FROM exam_app.run_results WHERE slot_id=$1',[f.slot.id])).toBe(2);
        const raceInput={...input,expectedRunId:next.id};const race=await Promise.all([json('/slots/'+f.slot.id+'/run',cookie,'POST',{...raceInput,requestId:randomUUID()}),json('/slots/'+f.slot.id+'/run',cookie,'POST',{...raceInput,requestId:randomUUID()})]);expect(race.map(r=>r.status).sort()).toEqual([202,409]);
        const latest=await slotDetail(pool(),f.child,f.slot.id);if(!latest.slot.runId)throw new Error('MISSING_RACE_RUN');expect(await one(pool(),z.boolean(),'SELECT initiated_by IS NULL AND review_deadline IS NULL AS value FROM exam_app.answer_runs WHERE id=$1',[latest.slot.runId])).toBe(true);await cancelJob(pool(),f.child,latest.slot.runId);
    });

    it('student rerun: rejects wrong owners, active tasks, stale versions and ended exams without dispatch', async () => {
        const f=await queuedReviewSlot('rerun_guards'),cookie=await login(f.child.username);
        const stranger=await createUser(pool(),admin,{username:'rerun_stranger',displayName:'其他学生',password:'synthetic-password-123',roles:['student']},password),teacher=await createUser(pool(),admin,{username:'rerun_staff',displayName:'无关老师',password:'synthetic-password-123',roles:['support']},password);
        const outsider=await login(stranger.username),staff=await login(teacher.username);
        const d=await slotDetail(pool(),f.child,f.slot.id),input={requestId:randomUUID(),expectedRevision:d.slot.revision,expectedRunId:d.slot.runId,expectedReviewId:d.slot.reviewId},path='/slots/'+f.slot.id+'/run';
        expect((await json(path,outsider,'POST',input)).status).toBe(404);expect((await json(path,staff,'POST',input)).status).toBe(404);expect((await json(path,cookie,'POST',input)).status).toBe(409);
        await cancelJob(pool(),f.child,f.run.runId);
        expect((await json(path,cookie,'POST',{...input,action:'verify'})).status).toBe(400);
        expect((await json(path,cookie,'POST',{...input,expectedRevision:2})).status).toBe(409);
        expect((await json(path,cookie,'POST',{...input,expectedReviewId:randomUUID()})).status).toBe(409);
        const id=await one(pool(),z.uuid(),'SELECT attempt_id AS value FROM exam_app.question_slots WHERE id=$1',[f.slot.id]);
        const empty=(await snapshot(pool(),f.child,id)).slots.find(s=>!s.revision);if(!empty)throw new Error('MISSING_EMPTY_SLOT');
        expect((await json('/slots/'+empty.id+'/run',cookie,'POST',{...input,expectedRunId:null})).status).toBe(409);
        const usedRequest=await one(pool(),z.uuid(),'SELECT client_request_id AS value FROM exam_app.answer_runs WHERE id=$1',[f.run.runId]);expect((await json(path,cookie,'POST',{...input,requestId:usedRequest})).status).toBe(409);
        await pool().query("UPDATE exam_app.exam_assignments SET closes_at=now()-interval '1 second' WHERE id=(SELECT assignment_id FROM exam_app.exam_attempts WHERE id=$1)",[id]);expect((await json(path,cookie,'POST',input)).status).toBe(409);
        await pool().query("UPDATE exam_app.exam_assignments SET closes_at=now()+interval '1 hour',state='revoked' WHERE id=(SELECT assignment_id FROM exam_app.exam_attempts WHERE id=$1)",[id]);expect((await json(path,cookie,'POST',input)).status).toBe(409);
        await pool().query("UPDATE exam_app.exam_assignments SET state='assigned' WHERE id=(SELECT assignment_id FROM exam_app.exam_attempts WHERE id=$1)",[id]);
        const unavailable=createExamService({pool:pool(),storage,origin,publicDir:root,canSolve:()=>false});expect((await unavailable.app.request('/api/v2'+path,{method:'POST',headers:{origin,cookie,'content-type':'application/json'},body:JSON.stringify(input)})).status).toBe(503);
        expect((await json('/attempts/'+id+'/finish',cookie,'POST')).status).toBe(200);expect((await json(path,cookie,'POST',input)).status).toBe(409);
        expect(await one(pool(),z.coerce.number(),'SELECT count(*) AS value FROM exam_app.answer_runs WHERE slot_id=$1',[f.slot.id])).toBe(1);
    });

    for (const engine of ['chrome', 'webkit'] as const) {
        it(`console: student status palette: overview separates verification from answers and highlights only the selected question in ${engine}`, async () => {
            const f = await studentFlowFixture(engine), [first, second, third] = f.current.slots, module = f.current.modules[0];
            if (!first || !second || !third || !module) throw new Error('MISSING_STATUS_PALETTE_SLOTS');
            module.questionCount = 12;
            const extra = Array.from({length:9}, (_, i) => ({...structuredClone(first), id:randomUUID(), position:i+4, ordinal:i+20}));
            f.current.slots.push(...extra);
            const [empty, failed, unchecked, manual, simulated, stopped, skipped, incomplete, interrupted] = extra;
            if (!empty || !failed || !unchecked || !manual || !simulated || !stopped || !skipped || !incomplete || !interrupted) throw new Error('MISSING_STATUS_PALETTE_CASES');
            flowAnswer(first, 'B', '已核验答案'); flowAnswer(second, 'A'); second.status = 'solving'; flowAnswer(third, 'C'); third.status = 'verifying';
            flowAnswer(failed, 'D'); failed.status = 'failed'; flowAnswer(unchecked, 'A'); if (unchecked.presentation) unchecked.presentation.verified = false;
            flowAnswer(manual, 'C'); if (manual.presentation) { manual.presentation.verified = false; manual.presentation.humanConfirmed = true; }
            flowAnswer(simulated, 'D'); if (simulated.presentation) { simulated.presentation.verified = false; simulated.presentation.simulated = true; }
            stopped.status = 'cancelled'; stopped.revision = 1; skipped.skipped = true; incomplete.status = 'needs_clarification'; interrupted.status = 'interrupted';
            f.current.alerts = [{id:randomUUID(),slotId:failed.id,moduleId:module.id,moduleTitle:module.title,position:failed.position,revision:1,reason:'verification_failed',openedAt:new Date().toISOString()}];
            try {
                await f.page.goto('http://127.0.0.1:3199/'); await f.page.locator('.current-answer .answer-options').waitFor();
                const screens = join(process.cwd(), '.runtime/status-palette-20261106/screens'); await mkdir(screens,{recursive:true});
                for (const theme of ['light','dark']) {
                    await f.page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);
                    const color = await f.page.locator('.current-answer .answer-options').evaluate(el=>getComputedStyle(el).backgroundColor);
                    expect(color).toBe(theme==='light'?'rgb(239, 249, 244)':'rgb(21, 44, 37)');
                    await f.page.screenshot({path:join(screens,`answer-${engine}-${theme}.png`),fullPage:true,animations:'disabled'});
                }
                await f.page.getByRole('button',{name:'总览',exact:true}).click(); const overview=f.page.getByRole('region',{name:'本节答案总览',exact:true});
                const question=(position:number)=>overview.getByRole('button',{name:'第'+position+'题',exact:true});
                expect(await overview.getByRole('list',{name:'题目状态图例'}).innerText()).toBe('未答\n正在回答\n校验\n通过\n出错');
                for (const [position,label] of [[1,'通过'],[2,'正在回答'],[3,'校验'],[4,'未答'],[5,'出错'],[6,'校验'],[7,'通过'],[8,'校验'],[9,'未答'],[10,'未答'],[11,'出错'],[12,'出错']] as const) expect(await question(position).innerText()).toContain(label);
                expect(await question(1).innerText()).toContain('B'); expect(await question(7).getAttribute('title')).toContain('老师已确认'); expect(await question(6).getAttribute('title')).toContain('待核验');
                for (const width of [320,390,768,1440]) for (const theme of ['light','dark']) {
                    await f.page.setViewportSize({width,height:900}); await f.page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);
                    expect(await f.page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
                    expect(await overview.locator('.overview-phase').evaluateAll(elements=>elements.every(el=>el.scrollWidth<=el.clientWidth+1))).toBe(true);
                    expect(await question(1).getAttribute('aria-current')).toBe('step'); expect(await question(5).getAttribute('aria-current')).toBeNull();
                    expect(await question(1).evaluate(el=>getComputedStyle(el).borderColor)).toBe('rgb(40, 103, 221)');
                    await f.page.screenshot({path:join(screens,`overview-${engine}-${width}-${theme}.png`),fullPage:true,animations:'disabled'});
                }
                await question(6).click();
                const selectedAnswer = f.page.getByRole('region',{name:'第6题答案',exact:true});
                await selectedAnswer.locator('.answer-options').waitFor();
                for (const theme of ['light','dark']) { await f.page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);expect(await selectedAnswer.locator('.answer-options').evaluate(el=>getComputedStyle(el).backgroundColor)).toBe(theme==='light'?'rgb(255, 248, 233)':'rgb(50, 42, 29)'); }
                expect(await selectedAnswer.innerText()).toContain('待核验');
                await f.page.getByRole('button',{name:'总览',exact:true}).click(); await question(5).click(); await f.page.locator('.capture-box h2').getByText('第5题',{exact:true}).waitFor(); await f.page.getByRole('button',{name:'总览',exact:true}).click();
                expect(await question(5).getAttribute('aria-current')).toBe('step'); expect(await question(5).innerText()).toContain('出错'); expect(await question(5).getByLabel('待处理').count()).toBe(1); expect(await question(1).getAttribute('aria-current')).toBeNull();
                flowAnswer(failed,'B','重新核验通过'); await f.sync(); await expect.poll(()=>question(5).innerText()).toContain('出错');
                f.current.alerts=[]; second.status='queued'; third.status='revising'; await f.sync();
                await expect.poll(()=>question(5).innerText()).toContain('通过'); expect(await question(5).getByLabel('待处理').count()).toBe(0);
                expect(await question(5).getAttribute('aria-current')).toBe('step'); expect(await question(2).innerText()).toContain('正在回答'); expect(await question(3).getAttribute('title')).toContain('修正中');
                expect(f.errors).toEqual([]);
            } finally { await f.browser.close(); }
        });
        it(`console: student rerun: explicit retries keep the current question and previous answer in ${engine}`, async () => {
            const f=await studentFlowFixture(engine),[first,second]=f.current.slots;if(!first||!second)throw new Error('MISSING_RERUN_UI_SLOTS');
            flowAnswer(first,'B','ORIGINAL CURRENT ANSWER');flowAnswer(second,'D','ANSWER ELSEWHERE');first.images=[{id:randomUUID(),role:'primary'}];
            const requests:z.infer<typeof ExamStudentRunSchema>[]=[];let release:()=>void=()=>{};const gate=new Promise<void>(resolve=>release=resolve);
            f.control.rerun=async raw=>{const input=ExamStudentRunSchema.parse(raw);requests.push(input);if(requests.length===1)return{status:503,body:{message:'合成重答失败'}};await gate;first.runId=randomUUID();first.status='queued';f.current.lastSeq++;return{status:202,body:{id:first.runId}};};
            try{
                await f.page.goto('http://127.0.0.1:3199/');const answer=f.page.locator('.current-answer'),rerun=f.page.getByRole('button',{name:'重新解答',exact:true});await rerun.waitFor();await rerun.click();await f.page.getByRole('alert').getByText('合成重答失败',{exact:true}).waitFor();expect(await answer.innerText()).toContain('ORIGINAL CURRENT ANSWER');expect(requests).toHaveLength(1);
                await f.sync();expect(requests).toHaveLength(1);await rerun.click();await expect.poll(()=>requests.length).toBe(2);expect(await rerun.isDisabled()).toBe(true);expect(await f.page.getByRole('button',{name:'下一题',exact:true}).isDisabled()).toBe(true);release();
                await answer.getByText('排队中',{exact:true}).waitFor();expect(await answer.innerText()).toContain('ORIGINAL CURRENT ANSWER');expect(await rerun.isDisabled()).toBe(true);expect(requests[0]?.requestId).toBe(requests[1]?.requestId);expect(requests[1]).toMatchObject({expectedRevision:1,expectedReviewId:null});
                const completedRun=first.runId;flowAnswer(first,'C','UPDATED CURRENT ANSWER');first.runId=completedRun;await f.sync();await answer.getByText('UPDATED CURRENT ANSWER',{exact:true}).waitFor();expect(await answer.innerText()).not.toContain('ANSWER ELSEWHERE');expect(await f.page.locator('.capture-box h2').innerText()).toBe('第1题');
                const screens=join(process.cwd(),'.runtime/student-toolbar-20261106/screens');await mkdir(screens,{recursive:true});for(const width of [320,390])for(const theme of ['light','dark']){await f.page.setViewportSize({width,height:844});await f.page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);expect(await f.page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await f.page.screenshot({path:join(screens,`rerun-${engine}-${width}-${theme}.png`),fullPage:true,animations:'disabled'});}
                await rerun.click();await expect.poll(()=>requests.length).toBe(3);expect(requests[2]?.requestId).not.toBe(requests[1]?.requestId);expect(requests[2]?.expectedRunId).toBe(completedRun);expect(f.errors).toEqual([]);
            }finally{release();await f.browser.close();}
        });
        it(`console: mobile refinement: compact controls and overview reflect current tasks in ${engine}`, async () => {
            const f = await studentFlowFixture(engine), [first, second, third] = f.current.slots;
            if (!first || !second || !third) throw new Error('MISSING_REFINEMENT_SLOTS');
            first.revision = 1; first.runId = randomUUID(); first.status = 'queued'; first.skipped = true;
            flowAnswer(second, 'B', '旧答案'); second.revision = 2; second.runId = randomUUID(); second.presentation = null; second.status = 'verifying';
            third.revision = 1; third.status = 'failed'; third.runId = randomUUID();
            try {
                await f.page.goto('http://127.0.0.1:3199/'); await f.page.getByRole('heading', { name: '第1题答案', exact: true }).waitFor();
                expect(await f.page.getByRole('region', { name: '题目状态总览', exact: true }).count()).toBe(0);
                expect(await f.page.getByRole('region', { name: '本节答案总览', exact: true }).count()).toBe(0);
                expect(await f.page.getByRole('button', { name: '跳过本题', exact: true }).count()).toBe(0);expect(await f.page.locator('.skipped-link').count()).toBe(0);
                const controls = f.page.getByRole('navigation', { name: '逐题导航' });
                await controls.getByRole('button', { name: '停止作答', exact: true }).waitFor();
                const [previous, stop, next] = await Promise.all(['上一题', '停止作答', '下一题'].map(name => controls.getByRole('button', {name, exact:true}).boundingBox()));
                expect(previous && stop && next && previous.x < stop.x && stop.x < next.x && Math.abs(previous.y - next.y) < 2).toBe(true);
                const screens = join(process.cwd(), '.runtime/student-refinement-20261105/screens'); await mkdir(screens,{recursive:true});
                for(const theme of ['light','dark']){await f.page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);await f.page.screenshot({path:join(screens,`controls-${engine}-${theme}.png`),fullPage:true,animations:'disabled'});}
                await f.page.getByRole('button', { name: '总览', exact: true }).click();
                const overview = f.page.getByRole('dialog', { name: '题目总览', exact: true });
                const queued = overview.getByRole('button', { name: '第1题', exact: false });
                await queued.waitFor(); expect(await queued.innerText()).toContain('正在回答'); expect(await queued.getAttribute('title')).toContain('排队中');
                expect(await overview.getByRole('button', { name: '第2题', exact: false }).innerText()).toContain('校验');
                expect(await overview.getByRole('button', { name: '第3题', exact: false }).innerText()).toContain('出错');
                await f.page.screenshot({path:join(screens,`pending-overview-${engine}.png`),fullPage:true,animations:'disabled'});
                flowAnswer(first, 'C', '当前答案'); await f.sync();
                await expect.poll(() => queued.innerText()).toContain('C');
                await overview.getByRole('button', { name: '第2题', exact: false }).click();
                await f.page.getByRole('heading', { name: '第2题答案', exact: true }).waitFor();
                expect(await f.page.locator('.current-answer').innerText()).not.toContain('当前答案');
                await f.page.getByRole('button',{name:'停止作答',exact:true}).click(); await f.page.locator('.capture-box .badge').getByText('已停止',{exact:true}).waitFor(); expect(second.status).toBe('cancelled');expect(first.status).toBe('completed');
                expect(f.errors).toEqual([]);
            } finally { await f.browser.close(); }
        });
        it(`console: mobile refinement: question and answer math render without swallowing currency in ${engine}`, async () => {
            const f = await studentFlowFixture(engine), first = f.current.slots[0]; if (!first) throw new Error('MISSING_REFINEMENT_SLOT');
            flowAnswer(first, '', String.raw`由公式 \(x=\frac{-7+\sqrt{29}}{2}\) 得到 \(k=29\)。贴纸价格为 $12 each or $20 per pair. 计算 42.50\div 10=4.25。`);
            const normal = f.control.detail;
            f.control.detail = async slot => { const result = await normal(slot); return { ...result, body: {slot, problem: {subject: 'math', text: String.raw`求解 \(x^2+7x+5=0\)，且 \[y=\sqrt{x}\]。代码保留：` + '`\\frac{literal}{2}`', uncertainties: []}, outcome: null, humanReviews: [], revisions: []} }; };
            try {
                await f.page.goto('http://127.0.0.1:3199/'); const answer = f.page.locator('.current-answer');
                await answer.locator('summary').filter({ hasText: '题目详情' }).click(); await answer.getByRole('region', { name: '识别题目' }).waitFor();
                expect(await answer.locator('.katex').count()).toBeGreaterThanOrEqual(5);
                expect(await answer.innerText()).toContain('$12 each or $20 per pair.');
                expect(await answer.locator('code').innerText()).toBe(String.raw`\frac{literal}{2}`);
                expect(await answer.locator('.katex-error').count()).toBe(0);
                const screens = join(process.cwd(), '.runtime/student-refinement-20261105/screens'); await mkdir(screens,{recursive:true});
                for(const width of [320,390,1280])for(const theme of ['light','dark']){await f.page.setViewportSize({width,height:900});await f.page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);expect(await f.page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await f.page.screenshot({path:join(screens,`math-${engine}-${width}-${theme}.png`),fullPage:true,animations:'disabled'});}
                expect(await f.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true); expect(f.errors).toEqual([]);
            } finally { await f.browser.close(); }
        });
    }

    for (const engine of ['chrome', 'webkit'] as const) {
        it(`console: answer choice preview: shows matching content, truncates and reuses the current detail in ${engine}`, async () => {
            const f = await studentFlowFixture(engine), [first, second] = f.current.slots;
            if (!first || !second) throw new Error('MISSING_CHOICE_PREVIEW_SLOTS');
            const content = 'Exposure to the treatment changed the plants’ absorption of iron and zinc, supporting the researchers’ hypothesis. '.repeat(8).trim();
            flowAnswer(first, 'B', '合成解释：选择支持研究假设的观察。'); first.images = [{ id: randomUUID(), role: 'primary' }];
            flowAnswer(second, 'C', '合成多选解释。'); if (second.presentation) second.presentation.selectedOptions = ['C', 'D'];
            const normal = f.control.detail; let reads = 0;
            f.control.detail = async slot => {
                reads++;
                const response = await normal(slot);
                return { ...response, body: { slot, problem: { text: '合成题干', subject: 'math', uncertainties: [], options: [{ label: 'A', text: '干扰选项内容' }, { label: 'B', text: content }, { label: 'C', text: String.raw`\(x=\frac{1}{2}\)` }, { label: 'D', text: '另一个已选选项' }] }, outcome: null, humanReviews: [], revisions: [] } };
            };
            try {
                await f.page.goto('http://127.0.0.1:3199/');
                const answer = f.page.locator('.current-answer'), preview = answer.locator('.answer-choice-text');
                await preview.waitFor(); expect(await preview.innerText()).toContain('Exposure to the treatment');
                expect(await answer.locator('.answer-options').innerText()).toBe('B');
                expect(await preview.getAttribute('title')).toBe(content);
                expect(await answer.locator('.answer-question-details').getAttribute('open')).toBeNull();
                const screens = join(process.cwd(), '.runtime/answer-choice-preview-20261106/screens'); await mkdir(screens, { recursive: true });
                for (const width of [320, 390, 1280]) for (const theme of ['light', 'dark']) {
                    await f.page.setViewportSize({ width, height: 900 }); await f.page.evaluate(theme => document.documentElement.dataset.theme = theme, theme);
                    const geometry = await preview.evaluate(el => ({ clipped: el.scrollHeight > el.clientHeight, clamp: getComputedStyle(el).webkitLineClamp, width: el.getBoundingClientRect().right <= innerWidth }));
                    expect(geometry).toEqual({ clipped: true, clamp: '2', width: true });
                    expect(await f.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
                    await f.page.screenshot({ path: join(screens, `${engine}-${width}-${theme}.png`), fullPage: true, animations: 'disabled' });
                }
                await f.sync(); await answer.locator('.answer-question-details > summary').click();
                await answer.getByRole('region', { name: '识别题目', exact: true }).waitFor(); expect(reads).toBe(1);
                await f.page.getByRole('button', { name: '下一题', exact: true }).click();
                await expect.poll(() => answer.locator('.answer-choice-row').count()).toBe(2);
                await answer.locator('.answer-choice-text .katex').waitFor();
                expect(await answer.locator('.answer-options').allTextContents()).toEqual(['C', 'D']);
                expect(await answer.innerText()).not.toContain('Exposure to the treatment');
                expect(await answer.locator('.answer-choice-text').last().innerText()).toBe('另一个已选选项');
                expect(f.errors).toEqual([]); expect(f.writes.filter(path => !path.endsWith('/navigation'))).toEqual([]);
            } finally { await f.browser.close(); }
        });
        it(`console: answer choice preview: ignores late detail and material changes and keeps the answer on read failure in ${engine}`, async () => {
            const f = await studentFlowFixture(engine), [first, second] = f.current.slots;
            if (!first || !second) throw new Error('MISSING_CHOICE_PREVIEW_SLOTS');
            flowAnswer(first, 'A', '第一题答案'); flowAnswer(second, 'C', '第二题答案');
            let release: () => void = () => {}, started = false, fail = true;
            const held = new Promise<void>(resolve => release = resolve);
            f.control.detail = async slot => {
                if (slot.id === first.id) { started = true; await held; }
                if (slot.id === second.id && fail) return { status: 503, body: { message: '合成读取失败' } };
                return { status: 200, body: { slot, problem: { text: '合成题干', subject: 'math', uncertainties: [], options: [{ label: 'A', text: '迟到的第一题选项' }, { label: 'C', text: '当前第二题选项' }] }, outcome: null, humanReviews: [], revisions: [] } };
            };
            try {
                await f.page.goto('http://127.0.0.1:3199/'); await expect.poll(() => started).toBe(true);
                await f.page.getByRole('button', { name: '下一题', exact: true }).click(); release();
                const answer = f.page.locator('.current-answer'); await answer.getByText('第二题答案', { exact: true }).waitFor();
                await answer.locator('.answer-question-details > summary').click(); await answer.getByRole('alert').waitFor();
                expect(await answer.locator('.answer-choice-text').count()).toBe(0);
                expect(await answer.innerText()).not.toContain('迟到的第一题选项');
                fail = false; await answer.getByRole('button', { name: '重新读取题目', exact: true }).click();
                await answer.locator('.answer-choice-text').getByText('当前第二题选项', { exact: true }).waitFor();
                second.revision++; second.runId = randomUUID(); second.presentation = null; second.status = 'verifying'; await f.sync();
                await answer.getByText('校验中', { exact: true }).waitFor(); expect(await answer.locator('.answer-choice-text').count()).toBe(0);
                expect(await answer.innerText()).not.toContain('当前第二题选项'); expect(f.errors).toEqual([]);
            } finally { release(); await f.browser.close(); }
        });
        it(`console: student flow: answer waits for manual Next and reload keeps the viewed question in ${engine}`, async () => {
            const f = await studentFlowFixture(engine); const [first, second] = f.current.slots; if (!first || !second) throw new Error('MISSING_FLOW_SLOTS');
            first.revision = 1; first.runId = randomUUID(); first.status = 'verifying';
            try {
                await f.page.goto('http://127.0.0.1:3199/'); await f.page.getByText('校验中', { exact: true }).waitFor();
                flowAnswer(first, 'B', 'B. 4'); f.current.nextSlotId = second.id; f.current.latestAnswerSlotId = first.id; await f.sync();
                await f.page.getByRole('heading', { name: '第1题答案', exact: true }).waitFor();
                expect(await f.page.locator('.capture-box > .section-head h2').innerText()).toBe('第1题');
                expect(await f.page.locator('.current-answer').innerText()).toContain('B. 4');
                expect(await f.page.getByLabel('考试用时', { exact: true }).count()).toBe(0);
                await f.page.reload(); await f.page.getByRole('heading', { name: '第1题答案', exact: true }).waitFor();
                expect(await f.page.getByRole('button', { name: '上一题', exact: true }).isDisabled()).toBe(true);
                await f.page.getByRole('button', { name: '下一题', exact: true }).click();
                await f.page.getByRole('button', { name: '拍摄第2题', exact: true }).waitFor();
                expect(await f.page.locator('.current-answer').innerText()).not.toContain('B. 4');
                await f.page.getByRole('button', { name: '上一题', exact: true }).click();
                await f.page.getByRole('heading', { name: '第1题答案', exact: true }).waitFor();
                expect(f.writes.every(path => path.endsWith('/navigation'))).toBe(true); expect(f.errors).toEqual([]);
            } finally { await f.browser.close(); }
        });
        it(`console: student flow: section overview and boundary buttons never display another question answer in ${engine}`, async () => {
            const f = await studentFlowFixture(engine), [module1, module2] = f.current.modules;
            if (!module1 || !module2) throw new Error('MISSING_FLOW_MODULES');
            const first = f.current.slots.filter(slot => slot.moduleId === module1.id), second = f.current.slots.filter(slot => slot.moduleId === module2.id);
            const [a, b, c] = first, [d, e] = second; if (!a || !b || !c || !d || !e) throw new Error('MISSING_FLOW_SLOTS');
            flowAnswer(a, 'B', 'FIRST ANSWER'); flowAnswer(b, '', '12.5'); flowAnswer(c, 'C', 'LAST SECTION ONE'); flowAnswer(d, 'A', 'FIRST SECTION TWO'); flowAnswer(e, 'D', 'LATEST ELSEWHERE');
            f.current.latestAnswerSlotId = e.id;
            try {
                await f.page.goto('http://127.0.0.1:3199/'); await f.page.getByRole('heading', { name: '第1题答案', exact: true }).waitFor();
                await f.page.getByRole('button',{name:'总览',exact:true}).click();
                const overview = () => f.page.getByRole('region', { name: '本节答案总览', exact: true });
                expect(await overview().getByRole('button').count()).toBe(3); expect(await overview().innerText()).toContain('12.5');
                expect(await f.page.locator('.current-answer').innerText()).toContain('FIRST ANSWER');
                expect(await f.page.getByRole('button', { name: '进入' + module2.title, exact: true }).count()).toBe(0);
                await overview().getByRole('button', { name: '第3题', exact: false }).click();
                await f.page.locator('.current-answer').getByText('LAST SECTION ONE', { exact: true }).waitFor();
                await f.page.getByRole('button', { name: '进入' + module2.title, exact: true }).click();
                await f.page.locator('.current-answer').getByText('FIRST SECTION TWO', { exact: true }).waitFor();
                expect(await f.page.locator('.current-answer').innerText()).not.toContain('LAST SECTION ONE');
                await f.page.getByRole('button',{name:'总览',exact:true}).click();
                expect(await overview().getByRole('button').count()).toBe(2);
                await overview().getByRole('button', { name: '第2题', exact: false }).click();
                await f.page.locator('.current-answer').getByText('LATEST ELSEWHERE', { exact: true }).waitFor();
                expect(await f.page.getByRole('button', { name: /^进入/ }).count()).toBe(0);
                expect(await f.page.getByRole('button', { name: '下一题', exact: true }).isDisabled()).toBe(true);
                // Use a full 27-question section for the visual and compact overview checks.
                module2.questionCount = 27; module2.title = '阅读与写作二';
                for (let position = 3; position <= 27; position++) {
                    const extra = { ...structuredClone(e), id: randomUUID(), ordinal: 3 + position, position };
                    flowAnswer(extra, ['A', 'B', 'C', 'D'][position % 4] ?? 'A'); f.current.slots.push(extra);
                }
                e.images = [{ id: randomUUID(), role: 'primary' }]; await f.sync();
                await f.page.getByRole('heading',{name:'阅读与写作二',exact:true}).waitFor();
                await f.page.getByRole('button',{name:'总览',exact:true}).click(); expect(await overview().getByRole('button').count()).toBe(27);
                await f.page.getByRole('dialog',{name:'题目总览',exact:true}).getByRole('button',{name:'关闭',exact:true}).click();
                await f.sync(); expect(await overview().count()).toBe(0);
                const screenshots = join(process.cwd(), '.runtime/student-refinement-20261105/screens'); await mkdir(screenshots, { recursive: true });
                for (const width of [320, 390, 768, 1440]) for (const theme of ['light', 'dark']) {
                    await f.page.setViewportSize({ width, height: 900 }); await f.page.evaluate(theme => document.documentElement.dataset.theme = theme, theme);
                    expect(await f.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
                    await f.page.screenshot({ path: join(screenshots, `${engine}-${width}-${theme}.png`), fullPage: true, animations: 'disabled' });
                    await f.page.getByRole('button',{name:'总览',exact:true}).click(); expect(await f.page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
                    await f.page.screenshot({path:join(screenshots, `${engine}-${width}-${theme}-overview.png`),fullPage:true,animations:'disabled'});
                    await f.page.getByRole('dialog',{name:'题目总览',exact:true}).getByRole('button',{name:'关闭',exact:true}).click();
                }
                expect(f.errors).toEqual([]);
            } finally { await f.browser.close(); }
        });
        it(`console: student flow: late detail and material changes cannot replace the selected answer in ${engine}`, async () => {
            const f = await studentFlowFixture(engine), [a, b] = f.current.slots; if (!a || !b) throw new Error('MISSING_FLOW_SLOTS');
            flowAnswer(a, 'B', 'ANSWER ONE'); flowAnswer(b, 'C', 'ANSWER TWO'); f.current.latestAnswerSlotId = a.id;
            let release: () => void = () => {}, readingStarted = false, fail = false;
            const held = new Promise<void>(resolve => release = resolve), normal = f.control.detail;
            f.control.detail = async slot => { if (slot.id === a.id) { readingStarted = true; await held; } if (fail && slot.id === b.id) return { status: 503, body: { message: '合成题目读取失败' } }; return normal(slot); };
            try {
                await f.page.goto('http://127.0.0.1:3199/'); await f.page.locator('.current-answer summary').filter({ hasText: '题目详情' }).click(); await expect.poll(() => readingStarted, { timeout: 3000 }).toBe(true);
                await f.page.getByRole('button', { name: '下一题', exact: true }).click();
                await f.page.locator('.current-answer').getByText('ANSWER TWO', { exact: true }).waitFor(); await f.page.locator('.current-answer summary').filter({ hasText: '题目详情' }).click(); release();
                await f.page.locator('.current-answer').getByText('题干 ' + b.id, { exact: true }).waitFor();
                expect(await f.page.locator('.current-answer').innerText()).not.toContain('ANSWER ONE');
                b.revision = 2; b.runId = randomUUID(); b.status = 'verifying'; b.presentation = null; await f.sync();
                await f.page.getByText('校验中', { exact: true }).waitFor(); expect(await f.page.locator('.current-answer').innerText()).not.toContain('ANSWER TWO');
                b.status = 'completed'; b.presentation = { answer: 'UPDATED ANSWER', selectedOptions: ['D'], simulated: false, verified: true, humanConfirmed: false, notAppliedReason: null }; fail = true; await f.sync();
                await f.page.locator('.current-answer').getByText('UPDATED ANSWER', { exact: true }).waitFor();
                await f.page.locator('.current-answer').getByRole('alert').waitFor(); fail = false;
                await f.page.getByRole('button', { name: '重新读取题目', exact: true }).click(); await f.page.locator('.current-answer').getByText('题干 ' + b.id, { exact: true }).waitFor();
                expect(f.errors).toEqual([]);
            } finally { release(); await f.browser.close(); }
        });
    }

    it('performance: SAT entry batches writes while preserving every slot and concurrent entry',async()=>{
        const child=await createUser(pool(),admin,{username:'perf_entry',displayName:'合成批量入场',password:'synthetic-password-123',roles:['student']},password);
        const template=await createTemplate(pool(),admin,{code:'perf-entry-sat',title:'合成入场',exam:'sat',modules:[27,27,22,22].map((questionCount,i)=>({code:'m'+i,title:'模块'+i,sectionCode:i<2?'reading':'math',questionCount,durationSeconds:null}))});
        const sitting=await createSitting(pool(),admin,{templateId:template.id,title:'合成批量入场',opensAt:new Date(Date.now()-10000).toISOString(),closesAt:null});
        const allocation=await createAssignment(pool(),admin,{sittingId:sitting.id,studentId:child.id,mode:'practice_simulation',wrongCounts:[3,2,1,4]});
        let queries=0;const traced=interceptClientQueries(async(_sql,perform)=>{queries++;return perform();});
        const first=await startAttempt(traced,child,allocation.id);
        const value=await snapshot(pool(),child,first.id);expect(value.slots).toHaveLength(98);expect(value.slots.map(slot=>slot.ordinal)).toEqual(Array.from({length:98},(_,i)=>i+1));
        expect(value.nextSlotId).toBe(value.slots[0]?.id);expect(value.modules.map(module=>value.slots.filter(slot=>slot.moduleId===module.id).length)).toEqual([27,27,22,22]);
        const plan=await pool().query("SELECT m.position,count(*) FILTER(WHERE p.action='simulate_alternative')::int AS wrong FROM exam_app.answer_plan_items p JOIN exam_app.question_slots q ON q.id=p.slot_id JOIN exam_app.attempt_modules m ON m.id=q.module_id WHERE q.attempt_id=$1 GROUP BY m.position ORDER BY m.position",[first.id]);expect(plan.rows.map(row=>row.wrong)).toEqual([3,2,1,4]);
        expect(queries).toBeLessThanOrEqual(40);
        expect(await Promise.all([startAttempt(pool(),child,allocation.id),startAttempt(pool(),child,allocation.id)])).toEqual([first,first]);
    });
    it('performance: authentication skips fresh presence writes and concurrent stale touches write once',async()=>{
        const {authenticate,createSession}=await import('@solveflow/db');
        const actor=await createUser(pool(),admin,{username:'perf_auth',displayName:'合成认证',password:'synthetic-password-123',roles:['student']},password),session=await createSession(pool(),actor,1);
        const version=async()=>one(pool(),z.string(),'SELECT xmin::text AS value FROM exam_app.auth_sessions WHERE user_id=$1',[actor.id]);
        const before=await version();await Promise.all(Array.from({length:12},()=>authenticate(pool(),session.token)));expect(await version()).toBe(before);
        await pool().query("UPDATE exam_app.auth_sessions SET last_seen_at=now()-interval '6 seconds' WHERE user_id=$1",[actor.id]);
        let touched=0;const observed=new Proxy(pool(),{get(target,property){if(property==='query')return async(...args:unknown[])=>{const result:unknown=await Reflect.apply(target.query,target,args);if(typeof args[0]==='string'&&args[0].startsWith('UPDATE exam_app.auth_sessions s SET last_seen_at='))touched+=z.object({rowCount:z.number()}).parse(result).rowCount;return result;};const value:unknown=Reflect.get(target,property);return typeof value==='function'?value.bind(target):value;}});
        await Promise.all(Array.from({length:32},()=>authenticate(observed,session.token)));expect(touched).toBe(1);
        await updateUser(pool(),admin,actor.id,{displayName:actor.displayName,state:'disabled',roles:['student']},undefined);
        await expect(authenticate(pool(),session.token)).rejects.toMatchObject({status:401});
    });
    it('performance: repeat image reads reuse bytes but recheck teacher access and HEAD',async()=>{
        const child=await createUser(pool(),admin,{username:'perf_media_child',displayName:'合成图片',password:'synthetic-password-123',roles:['student']},password);
        const teacher=await createUser(pool(),admin,{username:'perf_media_teacher',displayName:'合成图片老师',password:'synthetic-password-123',roles:['support']},password);
        const allocation=await createAssignment(pool(),admin,{sittingId,studentId:child.id,supportIds:[teacher.id]}),attempt=await startAttempt(pool(),child,allocation.id),slot=(await snapshot(pool(),child,attempt.id)).slots[0];if(!slot)throw new Error('NO_PERF_MEDIA_SLOT');
        const media=await asset(slot.id,child),run=await submit(pool(),child,slot.id,{requestId:randomUUID(),expectedRevision:0,kind:'initial',assetIds:[media]});await cancelJob(pool(),child,run.runId);
        let reads=0;const scopedStorage={put:storage.put.bind(storage),remove:storage.remove.bind(storage),close:()=>{},async get(key:string){reads++;return storage.get(key);}};
        const local=createExamService({pool:pool(),storage:scopedStorage,origin,publicDir:root}),cookie=await login(teacher.username);
        const get=(method='GET')=>local.app.request('/api/v2/media/'+media,{method,headers:{origin,cookie}});
        const first=await get();expect(first.status).toBe(200);const original=await first.arrayBuffer();
        const second=await get();expect(second.status).toBe(200);expect(await second.arrayBuffer()).toEqual(original);expect(reads).toBe(1);
        expect((await get('HEAD')).status).toBe(200);expect(reads).toBe(1);
        await pool().query('UPDATE exam_app.staff_assignments SET revoked_at=now() WHERE staff_id=$1',[teacher.id]);expect((await get()).status).toBe(404);expect(reads).toBe(1);
    });
    it('performance: upload joins all three writes before recording a failed family',async()=>{
        const child=await createUser(pool(),admin,{username:'perf_upload_child',displayName:'合成上传',password:'synthetic-password-123',roles:['student']},password),allocation=await createAssignment(pool(),admin,{sittingId,studentId:child.id}),attempt=await startAttempt(pool(),child,allocation.id),slot=(await snapshot(pool(),child,attempt.id)).slots[0];if(!slot)throw new Error('NO_PERF_UPLOAD_SLOT');
        let started=0,release=()=>{},settled=false;const held=new Promise<void>(resolve=>release=resolve),requestId=randomUUID();
        const fake={get:storage.get.bind(storage),remove:storage.remove.bind(storage),close:()=>{},async put(){started++;if(started===1)throw new Error('SYNTHETIC_PUT_FAILURE');await held;}};
        const task=upload(pool(),fake,child,slot.id,requestId,image).then(()=>null,error=>error).finally(()=>{settled=true;});
        try{await expect.poll(()=>started,{timeout:2000}).toBe(3);expect(settled).toBe(false);}finally{release();await task;}
        expect(await one(pool(),z.string(),'SELECT state AS value FROM exam_app.upload_intents WHERE student_id=$1 AND client_request_id=$2',[child.id,requestId])).toBe('rejected');
        const states=await pool().query('SELECT state FROM exam_app.media_assets WHERE owner_user_id=$1',[child.id]);expect(states.rows).toHaveLength(3);expect(states.rows.every(row=>row.state==='deleting')).toBe(true);
    });
    it('performance: additive image indexes support reverse references and variants',async()=>{
        const indexes=await pool().query("SELECT indexname FROM pg_indexes WHERE schemaname='exam_app' AND indexname IN ('revision_images_asset','media_assets_parent_variant')");expect(indexes.rows).toHaveLength(2);
    });

    it('performance: failed batched entry rolls back and a later explicit entry creates the full maximum template',async()=>{
        const child=await createUser(pool(),admin,{username:'perf_entry_rollback',displayName:'合成入场回滚',password:'synthetic-password-123',roles:['student']},password);
        const template=await createTemplate(pool(),admin,{code:'perf-entry-max',title:'合成最大模板',exam:'sat',modules:Array.from({length:16},(_,i)=>({code:'m'+i,title:'模块'+i,sectionCode:'math',questionCount:300,durationSeconds:null}))});
        const sitting=await createSitting(pool(),admin,{templateId:template.id,title:'合成回滚',opensAt:new Date(Date.now()-10000).toISOString(),closesAt:null}),allocation=await createAssignment(pool(),admin,{sittingId:sitting.id,studentId:child.id});
        const failed=interceptClientQueries(async(sql,perform)=>{if(sql.startsWith('INSERT INTO exam_app.answer_plan_items'))throw new Error('SYNTHETIC_PLAN_WRITE');return perform();});
        await expect(startAttempt(failed,child,allocation.id)).rejects.toThrow('SYNTHETIC_PLAN_WRITE');
        expect(await one(pool(),z.coerce.number(),'SELECT count(*) AS value FROM exam_app.exam_attempts WHERE assignment_id=$1',[allocation.id])).toBe(0);
        expect(await one(pool(),z.coerce.number(),'SELECT count(*) AS value FROM exam_app.question_slots WHERE student_id=$1',[child.id])).toBe(0);
        let queries=0;const traced=interceptClientQueries(async(_sql,perform)=>{queries++;return perform();}),attempt=await startAttempt(traced,child,allocation.id);
        expect(queries).toBeLessThanOrEqual(40);
        const totals=await pool().query('SELECT count(*)::int AS total,count(DISTINCT ordinal)::int AS ordinals,count(DISTINCT module_id)::int AS modules FROM exam_app.question_slots WHERE attempt_id=$1',[attempt.id]);expect(totals.rows[0]).toEqual({total:4800,ordinals:4800,modules:16});
    });
    it('performance: a stale presence touch waiting behind revocation cannot restore authentication',async()=>{
        const {authenticate,createSession}=await import('@solveflow/db');
        const actor=await createUser(pool(),admin,{username:'perf_auth_revocation',displayName:'合成撤权竞争',password:'synthetic-password-123',roles:['student']},password),session=await createSession(pool(),actor,1);
        await pool().query("UPDATE exam_app.auth_sessions SET last_seen_at=now()-interval '6 seconds' WHERE user_id=$1",[actor.id]);
        const blocker=await pool().connect();let started=()=>{},pending:Promise<unknown>|undefined;
        const entered=new Promise<void>(resolve=>started=resolve),observed=new Proxy(pool(),{get(target,property){if(property==='query')return(...args:unknown[])=>{if(typeof args[0]==='string'&&args[0].startsWith('UPDATE exam_app.auth_sessions s SET last_seen_at='))started();return Reflect.apply(target.query,target,args);};const value:unknown=Reflect.get(target,property);return typeof value==='function'?value.bind(target):value;}});
        try{
            await blocker.query('BEGIN');await blocker.query('SELECT id FROM exam_app.auth_sessions WHERE user_id=$1 FOR UPDATE',[actor.id]);
            pending=authenticate(observed,session.token);const rejected=expect(pending).rejects.toMatchObject({status:401});await entered;
            await blocker.query('UPDATE exam_app.auth_sessions SET revoked_at=now() WHERE user_id=$1',[actor.id]);await blocker.query('COMMIT');await rejected;
        }finally{await blocker.query('ROLLBACK');blocker.release();await pending?.catch(()=>{});}
    });

    it('performance: cancelling during solver image reads stops storage before model dispatch',async()=>{
        const f=await queuedReviewSlot('perf_solver_image_abort'),job=await claimJob(pool());if(!job||job.id!==f.run.runId)throw new Error('NO_PERF_IMAGE_JOB');
        let started=()=>{},calls=0;const reading=new Promise<void>(resolve=>started=resolve),abort=new AbortController();
        const profile={provider:'openai',baseURL:'https://synthetic.invalid/v1',model:'synthetic',api:'openai-completions',contextWindow:32768,maxTokens:4096,maxTokensField:'max_tokens'};
        const models=WebStoredModelsSchema.parse({schemaVersion:1,models:{solver:profile,verifier:profile,backup:null},keys:{solver:'synthetic',verifier:'synthetic',backup:null}});
        const fake={put:storage.put.bind(storage),remove:storage.remove.bind(storage),close:()=>{},get:async(_key:string,signal?:AbortSignal)=>{started();if(!signal)throw new Error('READ_NOT_CANCELLABLE');return new Promise<Uint8Array>((_resolve,reject)=>{signal.addEventListener('abort',()=>reject(signal.reason),{once:true});if(signal.aborted)reject(signal.reason);});}};
        const solve=modelSolver(pool(),fake,models,{solver:8,verifier:8,daily:100},async()=>{calls++;throw new Error('UNEXPECTED_MODEL_DISPATCH');});
        try{const rejected=expect(solve(job,abort.signal,()=>{})).rejects.toMatchObject({name:'AbortError'});await reading;abort.abort();await rejected;expect(calls).toBe(0);}finally{abort.abort();await cancelJob(pool(),f.child,job.id);}
    });

});
