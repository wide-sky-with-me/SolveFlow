import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { serve } from '@hono/node-server';
import { Server } from 'node:http';
import { chromium, webkit, type Browser } from '@playwright/test';
import { build } from 'esbuild';
import sharp from 'sharp';
import { bootstrap, connectDatabase, createAssignment, createSitting, createTemplate, createUser, migrate } from '@solveflow/db';
import { SolveOutcomeSchema, type SolveOutcome } from '@solveflow/contracts/agent';
import { createExamService, hashPassword } from './service.js';
import { PracticeJobs } from './practice.js';
import { LocalExamStorage } from './storage.js';

const url = process.env.SOLVEFLOW_EXAM_TEST_DATABASE_URL;
if (url && (new URL(url).hostname !== '127.0.0.1' || !/^\/solveflow_exam_test_[a-f0-9]{12}$/.test(new URL(url).pathname))) throw new Error('ISOLATED_DATABASE_REQUIRED');
const database = url ? connectDatabase(url) : null;
const outcome = () => SolveOutcomeSchema.parse({ schemaVersion: 1, status: 'completed', verificationStatus: 'not_requested', verified: false, verification: null, warning: null, candidate: { schemaVersion: 1, kind: 'answer', problem: { text: 'What is 2 + 2?', subject: 'math', uncertainties: [], options: [{ label: 'A', text: '3' }, { label: 'B', text: '4' }] }, selectedOptions: ['B'], answer: 'B. 4', steps: [], knowledgePoints: [], citationIds: [], clarificationQuestions: [] } });
let root = '', origin = '', server: ReturnType<typeof serve>, service: ReturnType<typeof createExamService>, practice: PracticeJobs, bytes: Buffer, calls = 0;
let complete: ((value: SolveOutcome) => void) | null = null, hold = false;
async function request(path: string, cookie = '', method = 'GET', body?: BodyInit, headers: Record<string, string> = {}) {
  return service.app.request('/api/v2' + path, { method, headers: { origin, cookie, ...headers }, ...body ? { body } : {} });
}
async function login(username: string) {
  const response = await request('/auth/login', '', 'POST', JSON.stringify({ username, password: 'synthetic-password-123' }), { 'content-type': 'application/json' });
  expect(response.status).toBe(200); return response.headers.get('set-cookie')?.split(';')[0] ?? '';
}
async function start(cookie: string, id = randomUUID()) { return request('/practice', cookie, 'POST', Uint8Array.from(bytes), { 'content-type': 'image/jpeg', 'x-request-id': id, 'x-exam-type': 'general' }); }
describe.skipIf(!url)('temporary practice integration', () => {
  beforeAll(async () => {
    if (!database) throw new Error('NO_DATABASE');
    await migrate(database.pool);
    const password = await hashPassword('synthetic-password-123'), admin = await bootstrap(database.pool, 'admin', '测试管理员', password);
    for (const username of ['student', 'other']) await createUser(database.pool, admin, { username, displayName: username, password: 'synthetic-password-123', roles: ['student'] }, password);
    root = await mkdtemp(join(tmpdir(), 'solveflow-practice-')); await mkdir(join(root, 'media'));
    bytes = await sharp({ create: { width: 4032, height: 3024, channels: 3, background: '#fff' } }).jpeg().toBuffer();
    practice = new PracticeJobs(async () => { calls++; return hold ? new Promise(resolve => { complete = resolve; }) : outcome(); });
    const built = await build({ entryPoints: ['src/browser/main.tsx'], absWorkingDir: join(process.cwd(), 'apps/exam-web'), outdir: root, bundle: true, platform: 'browser', jsx: 'automatic', format: 'esm', loader: { '.woff': 'dataurl', '.woff2': 'dataurl', '.ttf': 'dataurl', '.svg': 'dataurl' }, define: { 'process.env.NODE_ENV': '"production"' }, write: false });
    for (const file of built.outputFiles) await writeFile(file.path, file.contents);
    await writeFile(join(root, 'index.html'), '<meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/main.css"><div id="root"></div><script type="module" src="/main.js"></script>');
    server = serve({ hostname: '127.0.0.1', port: 0, fetch: req => service.app.fetch(req) });
    await new Promise<void>(resolve => server.once('listening', () => resolve()));
    const address = server.address(); if (!address || typeof address === 'string') throw new Error('NO_PORT'); origin = 'http://127.0.0.1:' + address.port;
    service = createExamService({ pool: database.pool, origin, publicDir: root, storage: new LocalExamStorage(join(root, 'media')), practice, clientAddress: () => 'synthetic' });
  }, 30000);
  afterAll(async () => { practice?.close(); if (server instanceof Server) server.closeAllConnections(); if (server) await new Promise<void>(resolve => server.close(() => resolve())); await database?.close(); if (root) await rm(root, { recursive: true, force: true }); });
  it('requires a student identity and keeps question content out of persistent tables', async () => {
    expect((await start('')).status).toBe(401);
    expect((await start(await login('admin'))).status).toBe(404);
    const cookie = await login('student'), id = randomUUID(), before = calls;
    const response = await start(cookie, id); expect(response.status).toBe(202);
    await vi.waitFor(async () => expect((await (await request('/practice/' + id, cookie)).json()).status).toBe('finished'));
    expect((await start(cookie, id)).status).toBe(202); expect(calls).toBe(before + 1);
    expect((await request('/practice/' + id, await login('other'))).status).toBe(404);
    for (const table of ['media_assets', 'question_revisions', 'answer_runs', 'run_results', 'exam_attempts']) expect((await database?.pool.query('SELECT count(*)::integer AS n FROM exam_app.' + table))?.rows[0]?.n).toBe(0);
  });
  it('stops active work on logout and prevents a late answer from reopening it', async () => {
    const cookie = await login('student'), id = randomUUID(); hold = true;
    expect((await start(cookie, id)).status).toBe(202);
    expect((await request('/auth/logout', cookie, 'POST')).status).toBe(200);
    complete?.(outcome()); hold = false;
    expect((await request('/practice/' + id, cookie)).status).toBe(401);
    expect((await (await request('/practice/' + id, await login('student'))).json()).status).toBe('cancelled');
  });
  for (const engine of ['chrome', 'webkit']) it('supports camera, gallery, transient answers and responsive layout in ' + engine, async () => {
    const browser: Browser = await (engine === 'chrome' ? chromium.launch({ executablePath: '/usr/bin/google-chrome' }) : webkit.launch());
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } }), errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    try {
      await page.goto(origin); await page.getByLabel('用户名').fill('student'); await page.getByLabel('密码', { exact: true }).fill('synthetic-password-123'); await page.getByRole('button', { name: '登录', exact: true }).click();
      await page.getByRole('heading', { name: '拍照解题', exact: true }).waitFor();
      expect(await page.getByRole('combobox', { name: '考试类型' }).textContent()).toContain('未指定');
      const chooser = page.waitForEvent('filechooser'); await page.getByRole('button', { name: '拍摄题目' }).click(); await (await chooser).setFiles([]);
      expect(await page.locator('input[type=file]').getAttribute('capture')).toBe('environment');
      const selection = page.waitForEvent('filechooser'); await page.getByRole('button', { name: '从相册选择' }).click(); await (await selection).setFiles({ name: 'synthetic.jpg', mimeType: 'image/jpeg', buffer: bytes });
      await page.getByRole('heading', { name: '答案', exact: true }).waitFor();
      expect(await page.getByText('B. 4', { exact: true }).count()).toBe(1);
      expect(await page.locator('input[type=file]').getAttribute('capture')).toBeNull();
      for (const width of [320, 390, 1440]) {
        await page.setViewportSize({ width, height: 900 });
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        await mkdir('.runtime/iphone-camera-practice', { recursive: true });
        await page.screenshot({ path: '.runtime/iphone-camera-practice/practice-' + engine + '-' + width + '.png', fullPage: true });
      }
      const before = calls; await page.reload(); await page.getByRole('button', { name: '拍摄题目' }).waitFor();
      expect(await page.getByRole('heading', { name: '答案', exact: true }).count()).toBe(0); expect(calls).toBe(before); expect(errors).toEqual([]);
    } finally { await page.close(); await browser.close(); }
  }, 30000);
  it('allows practice before a future exam and blocks dispatch once an assigned exam opens', async () => {
    if (!database) throw new Error('NO_DATABASE');
    const admin = (await service.session(await login('admin'))).user;
    const student = (await service.session(await login('student'))).user;
    const template = await createTemplate(database.pool, admin, { code: 'practice-gate', title: '合成门槛', exam: 'sat', modules: [{ code: 'm1', title: '模块一', sectionCode: 'math', questionCount: 1, durationSeconds: null }] });
    const sitting = await createSitting(database.pool, admin, { templateId: template.id, title: '未来考试', opensAt: new Date(Date.now() + 60000).toISOString(), closesAt: new Date(Date.now() + 3600000).toISOString() });
    const assignment = await createAssignment(database.pool, admin, { sittingId: sitting.id, studentId: student.id });
    const cookie = await login('student'), id = randomUUID();
    expect((await start(cookie, id)).status).toBe(202);
    await vi.waitFor(async () => expect((await (await request('/practice/' + id, cookie)).json()).status).toBe('finished'));
    await database.pool.query("UPDATE exam_app.exam_assignments SET opens_at=now()-interval '1 minute' WHERE id=$1", [assignment.id]);
    const before = calls;
    expect((await start(cookie)).status).toBe(409); expect(calls).toBe(before);
  });
});
