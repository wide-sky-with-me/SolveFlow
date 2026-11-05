import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Server } from 'node:http';
import { serve } from '@hono/node-server';
import { chromium, webkit, expect as browserExpect } from '@playwright/test';
import { build } from 'esbuild';
import sharp from 'sharp';
import { assignmentPage, dashboard, progressPage, bootstrap, claimJob, connectDatabase, createAssignment, createSitting, createTemplate, createUser, endExamAttempt, finishJob, heartbeatJob, expireExams, migrate, navigateAttempt, progress, snapshot, startAttempt, submit, teacherConfirm, updateUser } from '@solveflow/db';
import { ExamAttemptSchema, type ExamUser } from '@solveflow/contracts/managed-exam';
import { SolveOutcomeSchema } from '@solveflow/contracts/agent';
import { createExamService, hashPassword } from './service.js';
import { LocalExamStorage } from './storage.js';
import { upload } from './images.js';
import { realtime } from './realtime.js';
const url = process.env.SOLVEFLOW_EXAM_TEST_DATABASE_URL;
if (url && (new URL(url).hostname !== '127.0.0.1' || !/^\/solveflow_exam_test_[a-f0-9]{12}$/.test(new URL(url).pathname))) throw new Error('ISOLATED_DATABASE_REQUIRED');
const database = url ? connectDatabase(url) : null;
function pool() { if (!database) throw new Error('NO_DATABASE'); return database.pool; }
let root = '', origin = '', password = '', templateId = '', admin: ExamUser, teacher: ExamUser, outside: ExamUser, storage: LocalExamStorage, image: Buffer, service: ReturnType<typeof createExamService>, server: ReturnType<typeof serve>, closeRealtime: () => void, expiryTimer: ReturnType<typeof setInterval>;
async function assignedExam(unlimited = true, username = 's_' + randomUUID().slice(0, 8)) {
  const student = await createUser(pool(), admin, { username, displayName: username, password: 'synthetic-password-123', roles: ['student'] }, password);
  const sitting = await createSitting(pool(), admin, { templateId, title: '计时验收 ' + username, opensAt: new Date(Date.now() - 7200000).toISOString(), closesAt: unlimited ? null : new Date(Date.now() + 3600000).toISOString() });
  const assignment = await createAssignment(pool(), admin, { sittingId: sitting.id, studentId: student.id, supportIds: [teacher.id] });
  return { student, sitting, assignment };
}
async function studentExam(unlimited = true, username = 's_' + randomUUID().slice(0, 8)) {
  const { student, sitting, assignment } = await assignedExam(unlimited, username);
  const attempt = await startAttempt(pool(), student, assignment.id);
  const first = (await snapshot(pool(), student, attempt.id)).slots[0]; if (!first) throw new Error('NO_SLOT');
  return { student, sitting, assignment, attempt, first };
}
const answer = () => SolveOutcomeSchema.parse({ schemaVersion: 1, status: 'completed', verified: false, verificationStatus: 'not_requested', verification: null, warning: null, candidate: { schemaVersion: 1, kind: 'answer', problem: { text: '2 + 2 = ?', subject: 'math', response: { type: 'single-choice' }, uncertainties: [], options: [{ label: 'A', text: '3' }, { label: 'B', text: '4' }] }, selectedOptions: ['B'], answer: 'B. 4', steps: [], knowledgePoints: [], citationIds: [], clarificationQuestions: [] } });
describe.skipIf(!url)('exam timing and ending', () => {
  beforeAll(async () => {
    await migrate(pool()); root = await mkdtemp(join(tmpdir(), 'solveflow-timing-')); storage = new LocalExamStorage(join(root, 'media'));
    password = await hashPassword('synthetic-password-123'); admin = await bootstrap(pool(), 'admin', '测试管理员', password);
    teacher = await createUser(pool(), admin, { username: 'teacher', displayName: '测试老师', password: 'synthetic-password-123', roles: ['support'] }, password);
    outside = await createUser(pool(), admin, { username: 'outside', displayName: '未分配老师', password: 'synthetic-password-123', roles: ['support'] }, password);
    templateId = (await createTemplate(pool(), admin, { code: 'timing-sat', title: '计时合成考试', exam: 'sat', modules: [{ code: 'm1', title: '数学模块', sectionCode: 'math', questionCount: 1, durationSeconds: null }] })).id;
    image = await sharp({ create: { width: 300, height: 200, channels: 3, background: '#fff' } }).jpeg().toBuffer();
    const built = await build({ entryPoints: ['src/browser/main.tsx'], absWorkingDir: join(process.cwd(), 'apps/exam-web'), outdir: root, bundle: true, platform: 'browser', jsx: 'automatic', format: 'esm', loader: { '.woff': 'dataurl', '.woff2': 'dataurl', '.ttf': 'dataurl', '.svg': 'dataurl' }, define: { 'process.env.NODE_ENV': '"production"' }, write: false });
    for (const file of built.outputFiles) await writeFile(file.path, file.contents);
    await writeFile(join(root, 'index.html'), '<meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/main.css"><div id="root"></div><script type="module" src="/main.js"></script>');
    server = serve({ hostname: '127.0.0.1', port: 0, fetch: req => service.app.fetch(req) });
    await new Promise<void>(resolve => server.once('listening', () => resolve()));
    if (!(server instanceof Server)) throw new Error('HTTP_REQUIRED');
    const address = server.address(); if (!address || typeof address === 'string') throw new Error('NO_PORT'); origin = 'http://127.0.0.1:' + address.port;
    service = createExamService({ pool: pool(), storage, origin, publicDir: root, clientAddress: () => randomUUID() }); closeRealtime = realtime(server, pool(), origin, service.session); expiryTimer = setInterval(() => { void expireExams(pool()).catch(() => {}); }, 100);
  }, 30000);
  afterAll(async () => { clearInterval(expiryTimer); closeRealtime?.(); if (server instanceof Server) server.closeAllConnections(); if (server) await new Promise<void>(resolve => server.close(() => resolve())); await database?.close(); if (root) await rm(root, { recursive: true, force: true }); });
  it('starts an unlimited exam once and shares authoritative elapsed time with the teacher', async () => {
    const exam = await studentExam();
    await pool().query("UPDATE exam_app.exam_attempts SET started_at=now()-interval '125 seconds' WHERE id=$1", [exam.attempt.id]);
    const a = await snapshot(pool(), exam.student, exam.attempt.id), b = await snapshot(pool(), teacher, exam.attempt.id);
    expect(a.closesAt).toBeNull(); expect(a.timing.remainingSeconds).toBeNull(); expect(a.timing.elapsedSeconds).toBeGreaterThanOrEqual(125); expect(b.timing.elapsedSeconds).toBe(a.timing.elapsedSeconds);
    expect((await startAttempt(pool(), exam.student, exam.assignment.id)).id).toBe(exam.attempt.id);
    expect((await snapshot(pool(), exam.student, exam.attempt.id)).timing.startedAt).toBe(a.timing.startedAt);
    expect((await progress(pool(), teacher)).find(item => item.attemptId === exam.attempt.id)?.timing.startedAt).toBe(a.timing.startedAt);
    await endExamAttempt(pool(), exam.student, exam.attempt.id);
  });
  it('dashboard timing agrees with entered, ended and unstarted student tracking', async () => {
    const running=await studentExam(true,'board_running'),waiting=await assignedExam(false,'board_waiting');
    await pool().query("UPDATE exam_app.exam_attempts SET started_at=now()-interval '125 seconds' WHERE id=$1",[running.attempt.id]);
    const getRow=async()=>{const row=(await dashboard(pool(),teacher,{sittingId:running.sitting.id})).students.find(item=>item.assignmentId===running.assignment.id);if(!row)throw new Error('NO_DASHBOARD_STUDENT');return row;};
    const board=await getRow(),student=await snapshot(pool(),running.student,running.attempt.id),tracking=(await progressPage(pool(),teacher,{sittingId:running.sitting.id})).items[0];
    expect(board.timing.startedAt).toBe(student.timing.startedAt);expect(board.timing.startedAt).not.toBeNull();expect(board.timing.elapsedSeconds).toBeGreaterThanOrEqual(125);expect(board.timing.startedAt).toBe(tracking?.timing.startedAt);
    const login=await fetch(origin+'/api/v2/auth/login',{method:'POST',headers:{Origin:origin,'content-type':'application/json'},body:JSON.stringify({username:waiting.student.username,password:'synthetic-password-123'})});expect(login.status).toBe(200);
    const notEntered=(await dashboard(pool(),teacher,{sittingId:waiting.sitting.id})).students[0];expect(notEntered?.online).toBe(true);expect(notEntered?.attemptId).toBeNull();expect(notEntered?.timing.startedAt).toBeNull();expect(notEntered?.timing.elapsedSeconds).toBe(0);
    await endExamAttempt(pool(),teacher,running.attempt.id);const ended=await getRow(),frozen=await snapshot(pool(),running.student,running.attempt.id);expect(ended.timing).toMatchObject({startedAt:frozen.timing.startedAt,endedAt:frozen.timing.endedAt,endedBy:'teacher',elapsedSeconds:frozen.timing.elapsedSeconds});
    await new Promise(resolve=>setTimeout(resolve,1100));expect((await getRow()).timing.endedAt).toBe(frozen.timing.endedAt);expect((await getRow()).timing.elapsedSeconds).toBe(frozen.timing.elapsedSeconds);
  });
  it('student ending is idempotent, freezes duration and rejects further submissions', async () => {
    const exam = await studentExam(), other = await studentExam();
    const asset = await upload(pool(), storage, exam.student, exam.first.id, randomUUID(), image);
    await pool().query("UPDATE exam_app.exam_attempts SET started_at=now()-interval '63 seconds' WHERE id=$1", [exam.attempt.id]);
    await endExamAttempt(pool(), exam.student, exam.attempt.id); const ended = await snapshot(pool(), exam.student, exam.attempt.id);
    await endExamAttempt(pool(), teacher, exam.attempt.id);
    expect((await snapshot(pool(), teacher, exam.attempt.id)).timing).toMatchObject({ startedAt: ended.timing.startedAt, endedAt: ended.timing.endedAt, elapsedSeconds: ended.timing.elapsedSeconds, endedBy: 'student' });
    expect(ended.state).toBe('closed');
    await expect(submit(pool(), exam.student, exam.first.id, { requestId: randomUUID(), expectedRevision: 0, kind: 'initial', assetIds: [asset.id] })).rejects.toThrow();
    await expect(upload(pool(), storage, exam.student, exam.first.id, randomUUID(), image)).rejects.toThrow();
    await expect(navigateAttempt(pool(), exam.student, exam.attempt.id, { requestId: randomUUID(), expectedVersion: 0, action: 'select_slot', slotId: exam.first.id })).rejects.toThrow();
    expect((await snapshot(pool(), other.student, other.attempt.id)).timing.endedAt).toBeNull();
    await endExamAttempt(pool(), other.student, other.attempt.id);
  });
  it('teacher ending respects assignment scope, stops jobs and rejects late publication', async () => {
    const exam = await studentExam(), asset = await upload(pool(), storage, exam.student, exam.first.id, randomUUID(), image);
    const run = await submit(pool(), exam.student, exam.first.id, { requestId: randomUUID(), expectedRevision: 0, kind: 'initial', assetIds: [asset.id] });
    const job = await claimJob(pool()); if (!job || job.id !== run.runId) throw new Error('NO_JOB');
    await expect(endExamAttempt(pool(), outside, exam.attempt.id)).rejects.toThrow();
    await endExamAttempt(pool(), teacher, exam.attempt.id);
    expect(await heartbeatJob(pool(), job)).toBe(false); expect(await finishJob(pool(), job, answer(), null)).toBe(false);
    const ended = await snapshot(pool(), exam.student, exam.attempt.id);
    expect(ended.timing.endedBy).toBe('teacher'); expect(ended.slots[0]?.presentation).toBeNull();
    await teacherConfirm(pool(), teacher, exam.first.id, { requestId: randomUUID(), expectedRevision: 1, expectedRunId: run.runId, expectedReviewId: null, answer: '4', selectedOptions: null, note: '人工核对' });
    const reviewed = await snapshot(pool(), exam.student, exam.attempt.id);
    expect(reviewed.timing.endedAt).toBe(ended.timing.endedAt); expect(reviewed.state).toBe('closed'); expect(reviewed.slots[0]?.presentation?.answer).toBe('4');
  });
  it('deadline ending freezes at the configured cutoff and keeps the accepted-job grace', async () => {
    const exam = await studentExam(false), asset = await upload(pool(), storage, exam.student, exam.first.id, randomUUID(), image);
    const run = await submit(pool(), exam.student, exam.first.id, { requestId: randomUUID(), expectedRevision: 0, kind: 'initial', assetIds: [asset.id] });
    const job = await claimJob(pool()); if (!job || job.id !== run.runId) throw new Error('NO_JOB');
    await pool().query("UPDATE exam_app.exam_attempts SET started_at=now()-interval '100 seconds' WHERE id=$1", [exam.attempt.id]);
    await pool().query("UPDATE exam_app.exam_assignments SET closes_at=now()-interval '5 seconds' WHERE id=$1", [exam.assignment.id]);
    const expired = await snapshot(pool(), exam.student, exam.attempt.id);
    expect(expired.timing.remainingSeconds).toBe(0); expect(expired.timing.endedBy).toBe('deadline'); expect(expired.timing.elapsedSeconds).toBeGreaterThanOrEqual(94); expect(expired.timing.elapsedSeconds).toBeLessThanOrEqual(96);
    expect(await heartbeatJob(pool(), job)).toBe(true); expect(await finishJob(pool(), job, answer(), null)).toBe(true);
    expect((await snapshot(pool(), exam.student, exam.attempt.id)).timing.elapsedSeconds).toBe(expired.timing.elapsedSeconds);
  });
  it('answer completion does not reset the clock and another exam requires an explicit end', async () => {
    const exam = await studentExam(), asset = await upload(pool(), storage, exam.student, exam.first.id, randomUUID(), image);
    await submit(pool(), exam.student, exam.first.id, { requestId: randomUUID(), expectedRevision: 0, kind: 'initial', assetIds: [asset.id] });
    const job = await claimJob(pool()); if (!job) throw new Error('NO_JOB'); await finishJob(pool(), job, answer(), null);
    const completed = await snapshot(pool(), exam.student, exam.attempt.id); expect(completed.state).toBe('completed'); expect(completed.timing.endedAt).toBeNull();
    const unfinished = await assignmentPage(pool(), exam.student, {}, true); expect(unfinished.items[0]?.attemptEnded).toBe(false); expect(unfinished.available.map(item => item.id)).toContain(exam.assignment.id);
    expect((await assignmentPage(pool(), exam.student, { state: 'ended' }, true)).total).toBe(0);
    const next = await createSitting(pool(), admin, { templateId, title: '下一场', opensAt: new Date(Date.now() - 10000).toISOString(), closesAt: null });
    const assignment = await createAssignment(pool(), admin, { sittingId: next.id, studentId: exam.student.id });
    await expect(startAttempt(pool(), exam.student, assignment.id)).rejects.toThrow('当前进行中');
    await endExamAttempt(pool(), exam.student, exam.attempt.id);
    const sealed = await assignmentPage(pool(), exam.student, { state: 'ended' }, true); expect(sealed.total).toBe(1); expect(sealed.items[0]?.attemptEnded).toBe(true);
    expect((await startAttempt(pool(), exam.student, assignment.id)).id).toBeTruthy();
  });
  for (const engine of ['chrome', 'webkit']) it('shows a consistent timer and manual ending in ' + engine, async () => {
    const exam = await studentExam(true, 'ui_' + engine), browser = await (engine === 'chrome' ? chromium.launch({ executablePath: '/usr/bin/google-chrome' }) : webkit.launch());
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } }), errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    try {
      await page.goto(origin); await page.getByLabel('用户名').fill(exam.student.username); await page.getByLabel('密码', { exact: true }).fill('synthetic-password-123'); await page.getByRole('button', { name: '登录', exact: true }).click();
      const clock = page.getByLabel('考试用时'); await browserExpect(clock).toBeVisible(); await browserExpect(clock).toContainText('不限时');
      const before = (await snapshot(pool(), exam.student, exam.attempt.id)).timing.startedAt;
      await page.reload(); await browserExpect(clock).toBeVisible(); expect((await snapshot(pool(), exam.student, exam.attempt.id)).timing.startedAt).toBe(before);
      await page.getByRole('button', { name: '结束考试', exact: true }).click(); await page.getByRole('button', { name: '继续考试', exact: true }).click(); expect((await snapshot(pool(), exam.student, exam.attempt.id)).timing.endedAt).toBeNull();
      await page.getByRole('button', { name: '结束考试', exact: true }).click(); const finishResponse = page.waitForResponse(response => response.url().endsWith('/finish')); await page.getByRole('button', { name: '确认结束', exact: true }).click(); const finished = await finishResponse; expect(finished.status(), JSON.stringify(await finished.json())).toBe(200); expect((await snapshot(pool(), exam.student, exam.attempt.id)).timing.endedBy).toBe('student');
      await browserExpect(clock).toContainText('学生已结束');
      expect(await page.getByRole('button', { name: '结束考试', exact: true }).count()).toBe(0);
      for (const width of [320, 390, 1440]) { await page.setViewportSize({ width, height: 900 }); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true); }
      const check = await service.app.request('/api/v2/attempts/' + exam.attempt.id + '/snapshot', { headers: { cookie: (await page.context().cookies()).map(c => c.name + '=' + c.value).join(';') } }); expect(ExamAttemptSchema.parse(await check.json()).timing.endedBy).toBe('student'); expect(errors).toEqual([]);
      await page.getByRole('button', { name: '← 考试记录', exact: true }).click(); await browserExpect(page.locator('.assignment-card .badge')).toHaveText('已结束');
    } finally { await page.close(); await browser.close(); }
  }, 30000);
  for (const engine of ['chrome', 'webkit']) it('publishes timed and unlimited exams with the shared controls in ' + engine, async () => {
    const browser = await (engine === 'chrome' ? chromium.launch({ executablePath: '/usr/bin/google-chrome' }) : webkit.launch());
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, timezoneId: 'UTC' });
    try {
      await page.goto(origin); await page.getByLabel('用户名').fill('admin'); await page.getByLabel('密码', { exact: true }).fill('synthetic-password-123'); await page.getByRole('button', { name: '登录', exact: true }).click();
      await page.getByRole('navigation', { name: '管理导航' }).getByRole('button', { name: '考试安排', exact: true }).click();
      for (const limited of [false, true]) {
        await page.getByRole('button', { name: '新建场次', exact: true }).click();
        const title = (limited ? '限时' : '不限时') + ' UI ' + engine;
        await page.getByLabel('场次名称').fill(title);
        await page.getByRole('combobox', { name: '考试模板', exact: true }).click(); await page.getByRole('option').filter({ hasText: '计时合成考试' }).click();
        if (!limited) { await page.getByRole('combobox', { name: '考试时间', exact: true }).click(); await page.getByRole('option', { name: '不限时间', exact: true }).click(); expect(await page.getByLabel('结束时间', { exact: true }).count()).toBe(0); }
        else { await page.getByLabel('开始时间', { exact: true }).fill(new Date(Date.now() - 60000).toISOString().slice(0, 16)); await page.getByLabel('结束时间', { exact: true }).fill(new Date(Date.now() + 3600000).toISOString().slice(0, 16)); }
        await mkdir('.runtime/exam-timing', { recursive: true }); await page.screenshot({ path: '.runtime/exam-timing/publish-' + (limited ? 'timed-' : 'unlimited-') + engine + '.png', fullPage: true });
        await page.getByRole('combobox', { name: '学生', exact: true }).click(); await page.getByRole('option').first().click(); await page.keyboard.press('Escape');
        await page.getByRole('button', { name: '保存', exact: true }).click();
        await browserExpect(page.getByRole('dialog')).toHaveCount(0);
        const row = await pool().query('SELECT closes_at FROM exam_app.exam_sittings WHERE title=$1', [title]); expect(row.rowCount).toBe(1); expect(row.rows[0]?.closes_at === null).toBe(!limited);
      }
    } finally { await page.close(); await browser.close(); }
  }, 30000);
  for (const engine of ['chrome', 'webkit']) it('teacher ending reaches the student and remains visually coherent in ' + engine, async () => {
    const exam = await studentExam(true, 'peer_' + engine), browser = await (engine === 'chrome' ? chromium.launch({ executablePath: '/usr/bin/google-chrome' }) : webkit.launch());
    const studentContext = await browser.newContext({ viewport: { width: 390, height: 844 } }), teacherContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const studentPage = await studentContext.newPage(), teacherPage = await teacherContext.newPage();
    try {
      for (const [page, username] of [[studentPage, exam.student.username], [teacherPage, 'teacher']] as const) { await page.goto(origin); await page.getByLabel('用户名').fill(username); await page.getByLabel('密码', { exact: true }).fill('synthetic-password-123'); await page.getByRole('button', { name: '登录', exact: true }).click(); }
      await browserExpect(studentPage.getByLabel('考试用时')).toBeVisible();
      await teacherPage.getByRole('navigation', { name: '管理导航' }).getByRole('button', { name: '实时跟踪', exact: true }).click();
      await teacherPage.getByRole('row').filter({ hasText: exam.student.username }).getByRole('button', { name: '查看', exact: true }).click();
      const teacherClock = teacherPage.getByRole('dialog').getByLabel('考试用时'); await browserExpect(teacherClock).toContainText('不限时');
      await teacherPage.getByRole('button', { name: '结束考试', exact: true }).click();
      await browserExpect(teacherPage.getByRole('dialog', { name: '结束本场考试？' })).toContainText(exam.student.username);
      await teacherPage.getByRole('button', { name: '确认结束', exact: true }).click();
      await browserExpect(studentPage.getByRole('dialog', { name: '考试已结束', exact: true })).toBeVisible({ timeout: 15000 }); await studentPage.getByRole('button', { name: '我已知晓', exact: true }).click(); await browserExpect(studentPage.getByLabel('考试用时')).toContainText('老师已结束');
      await browserExpect(teacherClock).toContainText('老师已结束');
      await browserExpect(studentPage.getByText('考试已结束', { exact: true })).toBeVisible();
      await mkdir('.runtime/exam-timing', { recursive: true });
      await studentPage.screenshot({ path: '.runtime/exam-timing/student-' + engine + '.png', fullPage: true });
      await teacherPage.screenshot({ path: '.runtime/exam-timing/teacher-' + engine + '.png', fullPage: true });
      await teacherPage.setViewportSize({ width: 390, height: 844 });
      const overflow=await teacherPage.evaluate(()=>[...document.querySelectorAll('*')].flatMap(node=>{const box=node.getBoundingClientRect();return box.right>innerWidth+1?[{tag:node.tagName,className:node.className,width:box.width,right:box.right,display:getComputedStyle(node).display}]:[];}).slice(0,30));
      if(await teacherPage.evaluate(()=>document.documentElement.scrollWidth>innerWidth)){await teacherPage.screenshot({path:'.runtime/exam-timing/overflow-'+engine+'.png',fullPage:true,animations:'disabled'});await writeFile('.runtime/exam-timing/overflow-'+engine+'.json',JSON.stringify(overflow,null,2));}
      expect(await teacherPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await teacherPage.emulateMedia({ colorScheme: 'dark' }); await teacherPage.screenshot({ path: '.runtime/exam-timing/teacher-dark-' + engine + '.png', fullPage: true });
      const ended = await snapshot(pool(), exam.student, exam.attempt.id); await studentPage.reload(); await studentPage.getByRole('button', { name: '继续查看', exact: true }).click(); await browserExpect(studentPage.getByLabel('考试用时')).toContainText('老师已结束'); expect((await snapshot(pool(), exam.student, exam.attempt.id)).timing.endedAt).toBe(ended.timing.endedAt);
    } finally { await studentContext.close(); await teacherContext.close(); await browser.close(); }
  }, 30000);
  for (const engine of ['chrome', 'webkit']) it('unlimited entry waits for Start and includes time spent away in ' + engine, async () => {
    const exam = await assignedExam(true, 'ready_' + engine), browser = await (engine === 'chrome' ? chromium.launch({ executablePath: '/usr/bin/google-chrome' }) : webkit.launch());
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    let page = await context.newPage();
    try {
      await page.goto(origin); await page.getByLabel('用户名').fill(exam.student.username); await page.getByLabel('密码', { exact: true }).fill('synthetic-password-123'); await page.getByRole('button', { name: '登录', exact: true }).click();
      await browserExpect(page.getByRole('dialog', { name: '准备开始考试' })).toBeVisible();
      expect((await pool().query('SELECT count(*)::integer AS n FROM exam_app.exam_attempts WHERE assignment_id=$1', [exam.assignment.id])).rows[0]?.n).toBe(0);
      const before = (await progress(pool(), teacher)).find(row => row.assignmentId === exam.assignment.id); expect(before?.timing.startedAt).toBeNull(); expect(before?.timing.elapsedSeconds).toBe(0);
      await mkdir('.runtime/exam-timing', { recursive: true }); await page.screenshot({ path: '.runtime/exam-timing/ready-' + engine + '.png', fullPage: true });
      await page.getByRole('dialog').getByRole('button', { name: '开始考试', exact: true }).click(); await browserExpect(page.getByLabel('考试用时')).toBeVisible();
      const started = (await progress(pool(), teacher)).find(row => row.assignmentId === exam.assignment.id); if (!started?.attemptId) throw new Error('NO_STARTED_ATTEMPT');
      await page.close(); await new Promise(resolve => setTimeout(resolve, 1200)); page = await context.newPage(); await page.goto(origin);
      await browserExpect(page.getByLabel('考试用时')).toContainText('不限时'); expect(await page.getByRole('dialog', { name: '准备开始考试' }).count()).toBe(0);
      await page.screenshot({ path: '.runtime/exam-timing/running-' + engine + '.png', fullPage: true });
      const resumed = await snapshot(pool(), exam.student, started.attemptId); expect(resumed.timing.startedAt).toBe(started.timing.startedAt); expect(resumed.timing.elapsedSeconds).toBeGreaterThanOrEqual(1);
      await endExamAttempt(pool(), exam.student, started.attemptId);
    } finally { await context.close(); await browser.close(); }
  }, 30000);
  for (const engine of ['chrome', 'webkit']) it('missed timed exams notify login without creating a clock in ' + engine, async () => {
    const exam = await assignedExam(false, 'missed_' + engine); await pool().query("UPDATE exam_app.exam_assignments SET closes_at=now()-interval '5 seconds' WHERE id=$1", [exam.assignment.id]);
    const browser = await (engine === 'chrome' ? chromium.launch({ executablePath: '/usr/bin/google-chrome' }) : webkit.launch()), page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    try {
      await page.goto(origin); await page.getByLabel('用户名').fill(exam.student.username); await page.getByLabel('密码', { exact: true }).fill('synthetic-password-123'); await page.getByRole('button', { name: '登录', exact: true }).click();
      await browserExpect(page.getByRole('dialog', { name: '有考试已过期' })).toContainText('未开始计时');
      await mkdir('.runtime/exam-timing', { recursive: true }); await page.screenshot({ path: '.runtime/exam-timing/missed-' + engine + '.png', fullPage: true });
      expect((await pool().query('SELECT count(*)::integer AS n FROM exam_app.exam_attempts WHERE assignment_id=$1', [exam.assignment.id])).rows[0]?.n).toBe(0);
      await page.getByRole('button', { name: '查看过期考试', exact: true }).click(); await browserExpect(page.locator('.assignment-card .badge')).toHaveText('已过期');
      await browserExpect(page.getByRole('button', { name: '进入考试', exact: true })).toBeDisabled(); expect(await page.getByRole('dialog').count()).toBe(0);
      const row = (await progress(pool(), teacher)).find(row => row.assignmentId === exam.assignment.id); expect(row?.timing.elapsedSeconds).toBe(0); expect(row?.timing.startedAt).toBeNull();
      expect((await assignmentPage(pool(), exam.student, { state: 'ended' }, true)).total).toBe(0);
    } finally { await page.close(); await browser.close(); }
  }, 30000);
  for (const engine of ['chrome', 'webkit']) it('timed entry starts on arrival and deadline closes before acknowledgement in ' + engine, async () => {
    const exam = await assignedExam(false, 'deadline_' + engine), browser = await (engine === 'chrome' ? chromium.launch({ executablePath: '/usr/bin/google-chrome' }) : webkit.launch()), page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    const trace:{kind:string;value:string}[]=[];page.on('request',req=>{if(req.url().includes('/snapshot'))trace.push({kind:'request',value:'snapshot'});});page.on('websocket',ws=>{ws.on('framereceived',frame=>trace.push({kind:'ws',value:String(frame.payload).slice(0,300)}));ws.on('close',()=>trace.push({kind:'ws',value:'closed'}));});
    try {
      await page.addInitScript(() => { const original = Date.now; Date.now = () => original() + 172800000; });
      await page.goto(origin); await page.getByLabel('用户名').fill(exam.student.username); await page.getByLabel('密码', { exact: true }).fill('synthetic-password-123'); await page.getByRole('button', { name: '登录', exact: true }).click();
      await browserExpect(page.getByLabel('考试用时')).toBeVisible(); expect(await page.getByRole('dialog', { name: '准备开始考试' }).count()).toBe(0);
      await browserExpect(page.getByRole('button', { name: '拍摄第1题', exact: true })).toBeVisible();
      const started = (await progress(pool(), teacher)).find(row => row.assignmentId === exam.assignment.id); if (!started?.attemptId) throw new Error('NO_TIMED_ATTEMPT');
      await page.getByRole('button', { name: '结束考试', exact: true }).click(); await browserExpect(page.getByRole('dialog', { name: '结束本场考试？' })).toBeVisible();
      await pool().query("UPDATE exam_app.exam_assignments SET closes_at=now()+interval '1500 milliseconds' WHERE id=$1", [exam.assignment.id]);
      await browserExpect(page.getByRole('dialog', { name: '考试已结束', exact: true })).toContainText('自动结束', { timeout: 15000 });
      await browserExpect(page.getByRole('dialog')).toHaveCount(1); expect(await page.getByRole('button', { name: '确认结束', exact: true }).count()).toBe(0);
      const ended = await snapshot(pool(), exam.student, started.attemptId); expect(ended.state).toBe('closed'); expect(ended.timing.endedBy).toBe('deadline');
      await new Promise(resolve => setTimeout(resolve, 1100)); expect((await snapshot(pool(), exam.student, started.attemptId)).timing.elapsedSeconds).toBe(ended.timing.elapsedSeconds);
      await mkdir('.runtime/exam-timing', { recursive: true }); await page.screenshot({ path: '.runtime/exam-timing/deadline-' + engine + '.png', fullPage: true });
      await page.getByRole('button', { name: '我已知晓', exact: true }).click(); await browserExpect(page.getByText('考试已结束', { exact: true })).toBeVisible();
    } catch(error){const row=(await pool().query("SELECT x.state,x.ended_at,a.closes_at,(SELECT last_seq FROM exam_app.attempt_streams z WHERE z.attempt_id=x.id) seq FROM exam_app.exam_attempts x JOIN exam_app.exam_assignments a ON a.id=x.assignment_id WHERE a.id=$1",[exam.assignment.id])).rows[0];console.error('DEADLINE_SYNC_DIAGNOSTIC',JSON.stringify({engine,row,trace}));throw error;} finally { await page.close(); await browser.close(); }
  }, 30000);
});
