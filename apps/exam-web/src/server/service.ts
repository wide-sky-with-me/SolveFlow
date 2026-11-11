import { MediaReader } from './media-reader.js';
// Decision: .agents/notes/implemented/architecture/2026-11-05-exam-client-recovery.md
import { Hono } from 'hono';
import { getConnInfo } from '@hono/node-server/conninfo';
import { getCookie, setCookie } from 'hono/cookie';
import { hash as passwordHash, verify } from '@node-rs/argon2';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { z } from 'zod';
import type { Pool } from 'pg';
import { EXAM_SOURCE_IMAGE_BYTES, ExamAssignmentSchema, ExamAssignmentPageQuerySchema, ExamLoginSchema, ExamUserCreateSchema, ExamUserUpdateSchema, ExamMediaViewSchema } from '@solveflow/contracts/managed-exam';
import { EXAM_ANSWER_VALUES_HEADER } from '@solveflow/contracts/managed-exam';
import { allocationPage, publishSitting, addSittingStudents, updateAllocationStaff, updateAllocationState } from '@solveflow/db';
import { userPage, templatePage, sittingPage, assignmentPage, progressPage, studentChoicePage, dashboardSittingPage, assignments, authenticate, createAssignment, createSession, createSitting, createTemplate, createUser, enterModule, events, ExamError, forbidden, hash, isManager, listUsers, progress, loginThrottle, one, rows, sittings, slotDetail, snapshot, startAttempt, submissionReceipt, submit, templates, updateUser, userById, cancelJob } from '@solveflow/db';
import { buildCatalogTemplate, EXAM_CATALOG } from '@solveflow/contracts/exam-catalog';
// Decision: .agents/notes/implemented/architecture/2026-11-06-student-rerun.md
import { hasAvailableExam, endExamAttempt, studentRun, teacherRun, teacherConfirm, deferSlot, navigateAttempt, issueQueue, readResolution, readAnswerRevision, dashboard } from '@solveflow/db';
import { upload, imageAccess } from './images.js';
import type { ExamStorage } from './storage.js';
import { clientAddressResolver } from './client-address.js';
import { ExamPracticeRequestSchema } from '@solveflow/contracts/exam-practice';
import type { PracticeJobs } from './practice.js';
import { examTransport, examOrigins } from './transport.js';
import type { ModelServices } from './model-services.js';
import { ExamModelServiceCodeSchema, ExamModelServiceSelectSchema, ExamModelServiceUpdateSchema, ExamModelServiceCheckSchema } from '@solveflow/contracts/exam-model-services';
import { ExamTeacherMessageCreateSchema } from '@solveflow/contracts/managed-exam';
import { sendTeacherMessage, teacherMessages, readTeacherMessage } from '@solveflow/db';
import { createExamEvent, examEventPage, examEventDetail, examEventMembers, updateExamEvent, deleteExamEvent, concreteExamPage, createConcreteExam, updateConcreteExam, deleteConcreteExam, updateAllocation } from '@solveflow/db';
function legacyAssignment({ entryState: _entryState, ...value }: z.infer<typeof ExamAssignmentSchema>) { return value; }
function assignmentResponse(value: Awaited<ReturnType<typeof assignmentPage>>, includeEntry: boolean, includeMessages=false) {
    const {messages,...legacy}=value;
    const result=includeMessages?value:legacy;
    return includeEntry ? result : { ...result, items: value.items.map(legacyAssignment), available: value.available.map(legacyAssignment), selected: value.selected ? legacyAssignment(value.selected) : null };
}
let hashJobs = 0;
const hashQueue: (() => void)[] = [];
async function boundedHash<T>(action: () => Promise<T>) {
    if (hashJobs >= 2) {
        if (hashQueue.length >= 16)
            throw new ExamError(429, 'AUTH_BUSY', '登录较多，请稍后重试。');
        await new Promise<void>((resolve, reject) => { const start = () => { clearTimeout(timer); hashJobs++; resolve(); }; const timer = setTimeout(() => { const i = hashQueue.indexOf(start); if (i >= 0)
            hashQueue.splice(i, 1); reject(new ExamError(429, 'AUTH_BUSY', '登录超时，请重试。')); }, 10000); hashQueue.push(start); });
    }
    else
        hashJobs++;
    try {
        return await action();
    }
    finally {
        hashJobs--;
        hashQueue.shift()?.();
    }
}
// Argon2id is algorithm 2 in the native library's declared API.
export const hashPassword = (password: string) => boundedHash(() => passwordHash(password, { algorithm: 2, memoryCost: 19456, timeCost: 2, parallelism: 1, outputLen: 32 }));
export async function readBytes(request: Request, max: number) {
    const length = Number(request.headers.get('content-length'));
    if (length > max)
        throw new ExamError(413, 'BODY_LIMIT', '上传内容过大。');
    const reader = request.body?.getReader();
    if (!reader)
        throw new ExamError(400, 'EMPTY_BODY', '请求内容为空。');
    const chunks: Uint8Array[] = [];
    let size = 0, timedOut = false;
    const timer = setTimeout(() => { timedOut = true; void reader.cancel().catch(() => { }); }, 45000);
    try {
        for (;;) {
            const part = await reader.read();
            if (timedOut)
                throw new ExamError(408, 'BODY_TIMEOUT', '上传超时，请重试。');
            if (part.done)
                break;
            size += part.value.byteLength;
            if (size > max)
                throw new ExamError(413, 'BODY_LIMIT', '上传内容过大。');
            chunks.push(part.value);
        }
        return Buffer.concat(chunks);
    }
    finally {
        clearTimeout(timer);
        await reader.cancel();
        reader.releaseLock();
    }
}
async function jsonBody(request: Request) { if (!request.headers.get('content-type')?.startsWith('application/json'))
    throw new ExamError(415, 'CONTENT_TYPE', '请求格式无效。'); try {
    const value: unknown = JSON.parse((await readBytes(request, 65536)).toString('utf8'));
    return value;
}
catch (error) {
    if (error instanceof ExamError)
        throw error;
    throw new ExamError(400, 'INVALID_JSON', '请求内容无效。');
} }
export interface ExamServiceOptions {
    pool: Pool;
    storage: ExamStorage;
    origin: string;
    insecureHttpTrial?: boolean;
    httpTrialAliases?: readonly string[];
    publicDir: string;
    clientAddress?: (request: Request) => string;
    trustedProxyCidrs?: readonly string[];
    canSolve?: () => boolean;
    practice?: PracticeJobs;
    modelServices?: ModelServices;
}
export function createExamService(options: ExamServiceOptions) {
    const { pool, storage, origin } = options;
    const { secure, cookieName } = examTransport(origin, options.insecureHttpTrial);
    const allowedOrigins = new Set(examOrigins(origin, options.insecureHttpTrial, options.httpTrialAliases));
    const app = new Hono();
    const clientAddress = clientAddressResolver(options.trustedProxyCidrs);
    let imageJobs = 0;
    const media = new MediaReader(storage);
    const dummyHash = passwordHash('synthetic-invalid-account', { algorithm: 2, memoryCost: 19456, timeCost: 2, parallelism: 1, outputLen: 32 });
    app.use('*', async (c, next) => { c.header('Cache-Control', 'no-store'); c.header('X-Content-Type-Options', 'nosniff'); c.header('Referrer-Policy', 'no-referrer'); c.header('Content-Security-Policy', "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'"); c.header('Permissions-Policy', 'camera=(self), microphone=(), geolocation=()'); if (secure)
        c.header('Strict-Transport-Security', 'max-age=31536000'); if (!['GET', 'HEAD'].includes(c.req.method) && !allowedOrigins.has(c.req.header('origin') ?? ''))
        throw new ExamError(403, 'ORIGIN', '仅允许同源请求。'); await next(); });
    app.get('/health', async (c) => { await pool.query('SELECT 1'); return c.json({ ok: true }); });
    app.post('/api/v2/auth/login', async (c) => {
        await loginThrottle(pool, options.clientAddress?.(c.req.raw) ?? clientAddress(getConnInfo(c).remote.address, c.req.header('x-forwarded-for')));
        const input = ExamLoginSchema.parse(await jsonBody(c.req.raw));
        const found = await rows(pool, z.object({ id: z.uuid(), passwordHash: z.string(), authVersion: z.number().int().positive() }), `SELECT jsonb_build_object('id',id,'passwordHash',password_hash,'authVersion',auth_version) AS value FROM exam_app.users WHERE lower(username)=lower($1) AND state='active' AND password_hash IS NOT NULL`, [input.username]);
        const stored = found[0];
        const valid = await boundedHash(async () => verify(stored?.passwordHash ?? await dummyHash, input.password));
        if (!valid || !stored)
            throw new ExamError(401, 'LOGIN_FAILED', '用户名或密码不正确。');
        const user = await userById(pool, stored.id);
        const session = await createSession(pool, user, stored.authVersion);
        setCookie(c, cookieName, session.token, { httpOnly: true, secure: secure, sameSite: 'Strict', path: '/', maxAge: 43200 });
        return c.json({ user, expiresAt: session.expiresAt });
    });
    // Cookie parsing lives in Hono for HTTP; the returned resolver also authenticates upgrades.
    const session = async (cookie: string | undefined) => { const token = cookie?.split(';').map(p => p.trim()).find(p => p.startsWith(cookieName + '='))?.slice(cookieName.length + 1); return authenticate(pool, token); };
    app.get('/api/v2/session', async (c) => c.json(await session(c.req.header('cookie'))));
    const modelServices = () => { if (!options.modelServices) throw new ExamError(503,'MODEL_SETTINGS_UNAVAILABLE','服务方案尚未启用，请联系管理员。'); return options.modelServices; };
    app.get('/api/v2/me/model-service', async c => c.json(await modelServices().selection((await session(c.req.header('cookie'))).user)));
    app.get('/api/v2/me/messages', async c => c.json(await teacherMessages(pool, (await session(c.req.header('cookie'))).user)));
    app.post('/api/v2/messages/:id/read', async c => c.json(await readTeacherMessage(pool, (await session(c.req.header('cookie'))).user, z.uuid().parse(c.req.param('id')))));
    app.post('/api/v2/admin/slots/:id/messages', async c => { const actor=(await session(c.req.header('cookie'))).user; return c.json(await sendTeacherMessage(pool, actor, z.uuid().parse(c.req.param('id')), ExamTeacherMessageCreateSchema.parse(await jsonBody(c.req.raw)))); });
    app.post('/api/v2/me/model-service', async c => { const user=(await session(c.req.header('cookie'))).user,input=ExamModelServiceSelectSchema.parse(await jsonBody(c.req.raw));return c.json(await modelServices().select(user,input.code,input.expectedVersion)); });
    app.get('/api/v2/admin/model-services', async c => c.json(await modelServices().list((await session(c.req.header('cookie'))).user)));
    app.post('/api/v2/admin/model-services/:code', async c => { const user=(await session(c.req.header('cookie'))).user,code=ExamModelServiceCodeSchema.parse(c.req.param('code')),input=ExamModelServiceUpdateSchema.parse(await jsonBody(c.req.raw));return c.json(await modelServices().update(user,code,input)); });
    app.post('/api/v2/admin/model-services/:code/check', async c => { const user=(await session(c.req.header('cookie'))).user,code=ExamModelServiceCodeSchema.parse(c.req.param('code')),input=ExamModelServiceCheckSchema.parse(await jsonBody(c.req.raw));return c.json(await modelServices().check(user,code,input)); });
    app.post('/api/v2/auth/logout', async (c) => { const current = await session(c.req.header('cookie')); options.practice?.cancelOwner(current.user.id); const token = getCookie(c, cookieName); if (token)
        await pool.query(`UPDATE exam_app.auth_sessions SET revoked_at=now() WHERE token_hash=decode($1,'hex')`, [hash(token)]); setCookie(c, cookieName, '', { httpOnly: true, secure: secure, sameSite: 'Strict', path: '/', maxAge: 0 }); return c.json({ ok: true }); });
    app.get('/api/v2/me/assignments', async (c) => c.json((await assignments(pool, (await session(c.req.header('cookie'))).user)).map(legacyAssignment)));
    const practiceUser = async (cookie: string | undefined) => {
        const { user } = await session(cookie);
        if (!user.roles.includes('student')) throw forbidden();
        return user;
    };
    app.post('/api/v2/practice', async c => {
        const cookie = c.req.header('cookie'), user = await practiceUser(cookie);
        const practice = options.practice;
        if (!practice || options.canSolve && !options.canSolve()) throw new ExamError(503, 'SOLVING_UNAVAILABLE', '答题服务尚未配置，请联系管理员。');
        const request = ExamPracticeRequestSchema.parse({ requestId: c.req.header('x-request-id'), exam: c.req.header('x-exam-type') });
        if (!c.req.header('content-type')?.startsWith('image/')) throw new ExamError(415, 'IMAGE_TYPE', '请选择图片。');
        const authorize = async () => {
            await practiceUser(cookie);
            const scheduled = await hasAvailableExam(pool, user.id);
            if (scheduled) throw new ExamError(409, 'EXAM_AVAILABLE', '当前已有考试安排，请进入考试拍题。');
        };
        await authorize();
        return c.json(await practice.start(user.id, request, () => readBytes(c.req.raw, EXAM_SOURCE_IMAGE_BYTES), authorize), 202);
    });
    app.get('/api/v2/practice/:id', async c => {
        const user = await practiceUser(c.req.header('cookie'));
        if (!options.practice) throw new ExamError(503, 'SOLVING_UNAVAILABLE', '临时答题暂不可用。');
        return c.json(options.practice.status(user.id, z.uuid().parse(c.req.param('id'))));
    });
    app.post('/api/v2/practice/:id/cancel', async c => {
        const user = await practiceUser(c.req.header('cookie'));
        if (!options.practice) throw new ExamError(503, 'SOLVING_UNAVAILABLE', '临时答题暂不可用。');
        return c.json(options.practice.cancel(user.id, z.uuid().parse(c.req.param('id'))));
    });
    app.post('/api/v2/assignments/:id/start', async (c) => c.json(await startAttempt(pool, (await session(c.req.header('cookie'))).user, z.uuid().parse(c.req.param('id')))));
    app.post('/api/v2/attempts/:id/finish', async c => c.json(await endExamAttempt(pool, (await session(c.req.header('cookie'))).user, z.uuid().parse(c.req.param('id')))));
    app.get('/api/v2/attempts/:id/snapshot', async (c) => c.json(await snapshot(pool, (await session(c.req.header('cookie'))).user, z.uuid().parse(c.req.param('id')), {answerValues:c.req.header(EXAM_ANSWER_VALUES_HEADER)==='1'})));
    app.post('/api/v2/attempts/:id/navigation', async c => c.json(await navigateAttempt(pool, (await session(c.req.header('cookie'))).user, z.uuid().parse(c.req.param('id')), await jsonBody(c.req.raw))));
    app.get('/api/v2/attempts/:id/events', async (c) => c.json(await events(pool, (await session(c.req.header('cookie'))).user, z.uuid().parse(c.req.param('id')), z.coerce.number().int().min(0).max(Number.MAX_SAFE_INTEGER).parse(c.req.query('after') ?? 0))));
    app.post('/api/v2/modules/:id/enter', async (c) => c.json(await enterModule(pool, (await session(c.req.header('cookie'))).user, z.uuid().parse(c.req.param('id')))));
    app.get('/api/v2/slots/:id', async (c) => c.json(await slotDetail(pool, (await session(c.req.header('cookie'))).user, z.uuid().parse(c.req.param('id')))));
    app.get('/api/v2/slots/:id/submissions/:requestId', async c => c.json(await submissionReceipt(pool, (await session(c.req.header('cookie'))).user, z.uuid().parse(c.req.param('id')), z.uuid().parse(c.req.param('requestId')))));
    app.post('/api/v2/slots/:id/submissions', async (c) => { if (options.canSolve && !options.canSolve())
        throw new ExamError(503, 'SOLVING_UNAVAILABLE', '答题服务尚未配置，请联系管理员。'); return c.json(await submit(pool, (await session(c.req.header('cookie'))).user, z.uuid().parse(c.req.param('id')), await jsonBody(c.req.raw)), 202); });
    app.post('/api/v2/slots/:id/images', async (c) => { const { user } = await session(c.req.header('cookie')); const id = z.uuid().parse(c.req.param('id')); const requestId = z.uuid().parse(c.req.header('x-request-id')); if (!c.req.header('content-type')?.startsWith('image/'))
        throw new ExamError(415, 'IMAGE_TYPE', '请选择图片。'); if (imageJobs >= 4)
        throw new ExamError(429, 'IMAGE_BUSY', '图片处理较多，请稍后重试。'); imageJobs++; try {
        return c.json(await upload(pool, storage, user, id, requestId, await readBytes(c.req.raw, EXAM_SOURCE_IMAGE_BYTES)), 201);
    }
    finally {
        imageJobs--;
    } });
    app.get('/api/v2/media/:id', async (c) => {
        const actor=(await session(c.req.header('cookie'))).user,id=z.uuid().parse(c.req.param('id')),view=ExamMediaViewSchema.parse(c.req.query('view')??'model');
        const headers={'content-type':'image/jpeg','cache-control':'private, no-store','x-content-type-options':'nosniff'};
        // Hono dispatches HEAD through GET; authorize it before touching object storage.
        if(c.req.method==='HEAD'){const access=await imageAccess(pool,actor,id,view);return new Response(null,{headers:{...headers,'content-length':String(access.byteSize)}});}
        const access=await imageAccess(pool,actor,id,view);
        return new Response(await media.read(access,view!=='source',c.req.raw.signal),{headers:{...headers,'content-length':String(access.byteSize)}});
    });
    app.post('/api/v2/runs/:id/cancel', async (c) => c.json(await cancelJob(pool, (await session(c.req.header('cookie'))).user, z.uuid().parse(c.req.param('id')))));
    app.post('/api/v2/slots/:id/run', async c => {
        if (options.canSolve && !options.canSolve()) throw new ExamError(503, 'SOLVING_UNAVAILABLE', '答题服务尚未配置，请联系管理员。');
        return c.json(await studentRun(pool, (await session(c.req.header('cookie'))).user, z.uuid().parse(c.req.param('id')), await jsonBody(c.req.raw)), 202);
    });
    app.post('/api/v2/slots/:id/continue', async c => c.json(await deferSlot(pool, (await session(c.req.header('cookie'))).user, z.uuid().parse(c.req.param('id')), await jsonBody(c.req.raw))));
    app.post('/api/v2/admin/slots/:id/run', async c => {
        if (options.canSolve && !options.canSolve()) throw new ExamError(503, 'SOLVING_UNAVAILABLE', '答题服务尚未配置，请联系管理员。');
        return c.json(await teacherRun(pool, (await session(c.req.header('cookie'))).user, z.uuid().parse(c.req.param('id')), await jsonBody(c.req.raw)), 202);
    });
    app.post('/api/v2/admin/slots/:id/confirm', async c => c.json(await teacherConfirm(pool, (await session(c.req.header('cookie'))).user, z.uuid().parse(c.req.param('id')), await jsonBody(c.req.raw))));
    app.get('/api/v2/admin/issues', async c => c.json(await issueQueue(pool, (await session(c.req.header('cookie'))).user, c.req.query())));
    app.get('/api/v2/admin/dashboard', async c => c.json(await dashboard(pool, (await session(c.req.header('cookie'))).user, c.req.query())));
    app.post('/api/v2/resolutions/:id/read', async c => c.json(await readResolution(pool, (await session(c.req.header('cookie'))).user, z.uuid().parse(c.req.param('id')))));
    app.post('/api/v2/answer-revisions/:id/read', async c => c.json(await readAnswerRevision(pool, (await session(c.req.header('cookie'))).user, z.uuid().parse(c.req.param('id')))));
    app.get('/api/v2/admin/exam-catalog', async c => { const { user } = await session(c.req.header('cookie')); if (!isManager(user)) throw forbidden(); return c.json(EXAM_CATALOG); });
    app.post('/api/v2/admin/exam-catalog', async c => { const { user } = await session(c.req.header('cookie')); if (!isManager(user)) throw forbidden(); let template; try { template = buildCatalogTemplate(await jsonBody(c.req.raw)); } catch { throw new ExamError(400, 'EXAM_OPTIONS', '请选择有效的考试版本和科目组合。'); } return c.json(await createTemplate(pool, user, template), 201); });
    app.get('/api/v2/me/assignments/page', async c => { const query=ExamAssignmentPageQuerySchema.parse(c.req.query());return c.json(assignmentResponse(await assignmentPage(pool,(await session(c.req.header('cookie'))).user,query,true),query.entryState==='1',query.messages==='1')); });
    app.get('/api/v2/admin/assignments/page', async c => { const query=ExamAssignmentPageQuerySchema.parse(c.req.query());return c.json(assignmentResponse(await assignmentPage(pool,(await session(c.req.header('cookie'))).user,query),query.entryState==='1')); });
    app.get('/api/v2/admin/users/page', async c => c.json(await userPage(pool,(await session(c.req.header('cookie'))).user,c.req.query())));
    app.get('/api/v2/admin/templates/page', async c => c.json(await templatePage(pool,(await session(c.req.header('cookie'))).user,c.req.query())));
    app.get('/api/v2/admin/sittings/page', async c => c.json(await sittingPage(pool,(await session(c.req.header('cookie'))).user,c.req.query())));
    app.get('/api/v2/admin/progress/page', async c => c.json(await progressPage(pool,(await session(c.req.header('cookie'))).user,c.req.query())));
    app.get('/api/v2/admin/student-options/page', async c => c.json(await studentChoicePage(pool,(await session(c.req.header('cookie'))).user,c.req.query())));
    app.get('/api/v2/admin/dashboard/sittings/page', async c => c.json(await dashboardSittingPage(pool,(await session(c.req.header('cookie'))).user,c.req.query())));
    app.get('/api/v2/admin/progress', async (c) => c.json(await progress(pool, (await session(c.req.header('cookie'))).user)));
    app.get('/api/v2/admin/users', async (c) => c.json(await listUsers(pool, (await session(c.req.header('cookie'))).user)));
    app.post('/api/v2/admin/users', async (c) => { const { user } = await session(c.req.header('cookie')); const input = ExamUserCreateSchema.parse(await jsonBody(c.req.raw)); if (!isManager(user))
        throw forbidden(); return c.json(await createUser(pool, user, input, await hashPassword(input.password)), 201); });
    app.post('/api/v2/admin/users/:id', async (c) => { const { user } = await session(c.req.header('cookie')); if (!user.roles.includes('admin'))
        throw forbidden(); const input = ExamUserUpdateSchema.parse(await jsonBody(c.req.raw)); return c.json(await updateUser(pool, user, z.uuid().parse(c.req.param('id')), input, input.password ? await hashPassword(input.password) : undefined)); });
    app.get('/api/v2/admin/templates', async (c) => { const { user } = await session(c.req.header('cookie')); if (!isManager(user))
        throw forbidden(); return c.json(await templates(pool)); });
    app.post('/api/v2/admin/templates', async (c) => c.json(await createTemplate(pool, (await session(c.req.header('cookie'))).user, await jsonBody(c.req.raw)), 201));
    app.get('/api/v2/admin/sittings', async (c) => c.json(await sittings(pool, (await session(c.req.header('cookie'))).user)));
    app.post('/api/v2/admin/sittings', async (c) => c.json(await createSitting(pool, (await session(c.req.header('cookie'))).user, await jsonBody(c.req.raw)), 201));
    app.post('/api/v2/admin/sittings/publish',async c=>c.json(await publishSitting(pool,(await session(c.req.header('cookie'))).user,await jsonBody(c.req.raw)),201));
    app.get('/api/v2/admin/sittings/:id/allocations',async c=>c.json(await allocationPage(pool,(await session(c.req.header('cookie'))).user,z.uuid().parse(c.req.param('id')),c.req.query())));
    app.post('/api/v2/admin/sittings/:id/allocations/:assignmentId/update',async c=>c.json(await updateAllocation(pool,(await session(c.req.header('cookie'))).user,z.uuid().parse(c.req.param('id')),z.uuid().parse(c.req.param('assignmentId')),await jsonBody(c.req.raw))));
    app.get('/api/v2/admin/exam-events/page',async c=>c.json(await examEventPage(pool,(await session(c.req.header('cookie'))).user,c.req.query())));
    app.post('/api/v2/admin/exam-events',async c=>c.json(await createExamEvent(pool,(await session(c.req.header('cookie'))).user,await jsonBody(c.req.raw))));
    app.get('/api/v2/admin/exam-events/:id',async c=>c.json(await examEventDetail(pool,(await session(c.req.header('cookie'))).user,z.uuid().parse(c.req.param('id')))));
    app.get('/api/v2/admin/exam-events/:id/members/page',async c=>c.json(await examEventMembers(pool,(await session(c.req.header('cookie'))).user,z.uuid().parse(c.req.param('id')),c.req.query())));
    app.post('/api/v2/admin/exam-events/:id/edit',async c=>c.json(await updateExamEvent(pool,(await session(c.req.header('cookie'))).user,z.uuid().parse(c.req.param('id')),await jsonBody(c.req.raw))));
    app.post('/api/v2/admin/exam-events/:id/delete',async c=>c.json(await deleteExamEvent(pool,(await session(c.req.header('cookie'))).user,z.uuid().parse(c.req.param('id')),await jsonBody(c.req.raw))));
    app.get('/api/v2/admin/exam-events/:id/exams/page',async c=>c.json(await concreteExamPage(pool,(await session(c.req.header('cookie'))).user,z.uuid().parse(c.req.param('id')),c.req.query())));
    app.post('/api/v2/admin/exam-events/:id/exams',async c=>c.json(await createConcreteExam(pool,(await session(c.req.header('cookie'))).user,z.uuid().parse(c.req.param('id')),await jsonBody(c.req.raw))));
    app.post('/api/v2/admin/exam-events/:id/exams/:examId/edit',async c=>c.json(await updateConcreteExam(pool,(await session(c.req.header('cookie'))).user,z.uuid().parse(c.req.param('id')),z.uuid().parse(c.req.param('examId')),await jsonBody(c.req.raw))));
    app.post('/api/v2/admin/exam-events/:id/exams/:examId/delete',async c=>c.json(await deleteConcreteExam(pool,(await session(c.req.header('cookie'))).user,z.uuid().parse(c.req.param('id')),z.uuid().parse(c.req.param('examId')),await jsonBody(c.req.raw))));
    app.post('/api/v2/admin/sittings/:id/allocations',async c=>c.json(await addSittingStudents(pool,(await session(c.req.header('cookie'))).user,z.uuid().parse(c.req.param('id')),await jsonBody(c.req.raw)),201));
    app.post('/api/v2/admin/sittings/:id/allocations/:assignmentId/staff',async c=>c.json(await updateAllocationStaff(pool,(await session(c.req.header('cookie'))).user,z.uuid().parse(c.req.param('id')),z.uuid().parse(c.req.param('assignmentId')),await jsonBody(c.req.raw))));
    app.post('/api/v2/admin/sittings/:id/allocations/:assignmentId/state',async c=>c.json(await updateAllocationState(pool,(await session(c.req.header('cookie'))).user,z.uuid().parse(c.req.param('id')),z.uuid().parse(c.req.param('assignmentId')),await jsonBody(c.req.raw))));
    app.post('/api/v2/admin/assignments', async (c) => c.json(await createAssignment(pool, (await session(c.req.header('cookie'))).user, await jsonBody(c.req.raw)), 201));
    app.notFound(async (c) => {
        if (c.req.path.startsWith('/api/') || !['GET', 'HEAD'].includes(c.req.method))
            return c.json({ message: '入口不存在。' }, 404);
        const path = c.req.path === '/' || c.req.path === '/admin' ? 'index.html' : c.req.path.slice(1);
        if (!/^[a-zA-Z0-9_-]+\.(html|js|css|svg|woff2?|txt)$/.test(path))
            return c.json({ message: '入口不存在。' }, 404);
        try {
            const bytes = await readFile(resolve(options.publicDir, path));
            const types: Record<string, string> = { txt: 'text/plain; charset=utf-8', html: 'text/html; charset=utf-8', js: 'text/javascript', css: 'text/css', svg: 'image/svg+xml', woff2: 'font/woff2', woff: 'font/woff' };
            const type = types[path.split('.').at(-1) ?? ''] ?? 'application/octet-stream';
            const headers = { 'content-type': type, 'cache-control': path === 'index.html' ? 'no-store' : /^heic-worker-[a-z0-9-]+\.js$/.test(path) ? 'no-cache' : 'public, max-age=31536000, immutable' };
            return c.req.method === 'HEAD' ? c.body(null, 200, headers) : c.body(bytes, 200, headers);
        }
        catch (error) {
            if (error instanceof Error && 'code' in error && error.code === 'ENOENT')
                return c.json({ message: '入口不存在。' }, 404);
            throw error;
        }
    });
    app.onError((error, c) => { if (error instanceof ExamError)
        return c.json({ code: error.code, message: error.message }, error.status >= 500 ? 503 : error.status === 401 ? 401 : error.status === 403 ? 403 : error.status === 404 ? 404 : error.status === 409 ? 409 : error.status === 413 ? 413 : error.status === 415 ? 415 : error.status === 429 ? 429 : 400); if (error instanceof z.ZodError)
        return c.json({ code: 'INVALID_INPUT', message: '输入内容不符合要求，请检查后重试。' }, 400); if ('code' in error && error.code === '23505')
        return c.json({ code: 'CONFLICT', message: '记录已存在或操作已提交，请刷新后重试。' }, 409); console.error(JSON.stringify({ event: 'exam.request.failed', code: 'INTERNAL' })); return c.json({ code: 'UNAVAILABLE', message: '服务暂不可用，请稍后重试。' }, 503); });
    return { app, session, close: () => media.close() };
}
