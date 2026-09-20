import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { loadEnvFile } from 'node:process';
import { chromium } from '@playwright/test';
import { BootstrapSchema, RunViewSchema, parseRunEvent } from '../packages/contracts/dist/http.js';
if (!process.argv.includes('--live')) throw new Error('Explicit --live required');
loadEnvFile('.env');
const origin = 'http://127.0.0.1:3100';
const cases = [
  { subject: 'physics', text: '物理课程题（自编）\n质量2 kg的物体沿水平直线运动，初速度为0。\n正向拉力10 N、反向滑动摩擦力2 N均恒定，持续3 s。\n求加速度、3 s末速度和这3 s内的位移。', truth: { acceleration: 4, velocity: 12, displacement: 18 }, check(answer) { assert.match(answer, /(?:加速度|a)[\s\S]{0,45}(?<![\d.])4(?![\d.])/); assert.match(answer, /(?:速度|v)[\s\S]{0,45}(?<![\d.])12(?![\d.])/); assert.match(answer, /(?:位移|s|x)[\s\S]{0,45}(?<![\d.])18(?![\d.])/); } },
  { subject: 'chemistry', text: '化学课程题（自编，纸面计量题）\n10 g纯碳酸钙CaCO₃与足量稀盐酸完全反应。\n已知M(CaCO₃)=100 g/mol，M(CO₂)=44 g/mol。\n写出配平的化学方程式，求生成CO₂的质量。', truth: { massGrams: 4.4 }, check(answer) { assert.match(answer, /(?<![\d.])4\.4(?![\d.])/); } },
  { subject: 'biology', text: '生物课程题（自编）\n某单基因性状符合孟德尔分离规律，A对a完全显性。\n两个亲本均为Aa，无致死、无选择差异。\n求子代隐性表型的概率；在显性子代中，杂合子的概率是多少？\n说明两个概率的样本空间为何不同。', truth: { recessive: 1 / 4, heterozygousGivenDominant: 2 / 3 }, check(answer) { assert.match(answer, /(?:frac14|1\/4|25%|0\.25)/); assert.match(answer, /(?:frac23|2\/3|66\.6\d*%|0\.66\d*)/); } },
];
const report = { schemaVersion: 1, mode: 'live', startedAt: new Date().toISOString(), fixtureSource: 'Self-authored curriculum questions; explicit analytic ground truths', runs: [], passed: false };
const browser = await chromium.launch({ executablePath: process.env.SOLVEFLOW_TEST_CHROME ?? '/usr/bin/google-chrome' });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
await mkdir('.runtime/screenshots', { recursive: true });
try {
  for (const fixture of cases) {
    let sessionId; const row = { subject: fixture.subject, truth: fixture.truth, passed: false }; report.runs.push(row);
    const page = await context.newPage(); const errors = []; page.on('pageerror', error => errors.push(error.name));
    try {
      const source = await context.newPage(); await source.setViewportSize({ width: 1000, height: 450 });
      await source.setContent('<html lang="zh"><body style="margin:35px;background:white;color:black;font:28px/1.8 sans-serif;white-space:pre-line"></body></html>');
      await source.locator('body').evaluate((body, text) => { body.textContent = text; }, fixture.text);
      const image = await source.screenshot(); await source.close();
      const initialized = page.waitForResponse(response => response.url() === `${origin}/api/v1/bootstrap`); await page.goto(origin);
      assert.equal(BootstrapSchema.parse(await (await initialized).json()).mode, 'live');
      await page.getByLabel('从相册上传图片').setInputFiles({ name: `self-authored-${fixture.subject}.png`, mimeType: 'image/png', buffer: image });
      await page.getByLabel('补充说明').fill('请使用对应学科Skill解答图片中的课程题，给出完整题干、必要推导、结论和本题知识点。');
      const submitted = page.waitForResponse(response => /\/sessions\/[^/]+\/runs$/.test(response.url()) && response.request().method() === 'POST');
      const started = Date.now(); await page.getByRole('button', { name: '开始解题' }).click(); const response = await submitted; assert.equal(response.status(), 202);
      let run = RunViewSchema.parse(await response.json()); sessionId = run.sessionId;
      while (!run.outcome && Date.now() - started < 135000) { await new Promise(resolve => setTimeout(resolve, 500)); run = RunViewSchema.parse(await (await context.request.get(`${origin}/api/v1/runs/${run.id}`)).json()); }
      Object.assign(row, { id: run.id, status: run.status, verified: run.outcome?.verified, elapsedMs: Date.now() - started, ...(run.outcome?.status === 'failed' ? { errorCode: run.outcome.error.code } : {}) });
      await writeFile(`.runtime/course-${fixture.subject}-candidate.json`, JSON.stringify(run, null, 2), { mode: 0o600 });
      assert.equal(run.outcome?.status, 'completed'); assert(run.outcome.verified);
      const candidate = run.outcome.candidate; assert.equal(candidate.problem.subject, fixture.subject); assert(candidate.knowledgeDetails?.length); assert(candidate.steps.length >= 2);
      fixture.check(candidate.answer.replace(/[\\{}\s$]/g, ''));
      const replay = await (await context.request.get(`${origin}/api/v1/runs/${run.id}/events`)).text();
      const events = replay.split('\n').filter(line => line.startsWith('data:')).map(line => parseRunEvent(JSON.parse(line.slice(5).trim())));
      row.reads = events.filter(event => event.type === 'tool.status' && event.toolName === 'read' && event.status === 'completed').length;
      row.calculations = events.filter(event => event.type === 'tool.status' && event.toolName === 'calculate' && event.status === 'completed').length;
      assert(row.reads > 0); assert(row.calculations > 0);
      await page.reload(); await page.locator('.knowledge-panel').waitFor(); await page.locator('.knowledge-panel details').first().locator('summary').click();
      await page.setViewportSize({ width: 320, height: 844 }); assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)); assert.deepEqual(errors, []);
      await page.screenshot({ path: `.runtime/screenshots/course-${fixture.subject}-live.png`, fullPage: true }); row.passed = true;
    } catch (error) { row.failure = error instanceof Error ? error.message.slice(0, 250) : 'COURSE_CHECK_FAILED'; }
    finally { if (sessionId) row.fixtureDeleted = (await context.request.delete(`${origin}/api/v1/sessions/${sessionId}`, { headers: { origin } })).ok(); await page.close(); console.log(JSON.stringify(row)); }
  }
  report.passed = report.runs.every(run => run.passed); if (!report.passed) process.exitCode = 1;
} finally {
  await browser.close(); report.finishedAt = new Date().toISOString(); const data = JSON.stringify(report, null, 2) + '\n';
  await writeFile(`.runtime/course-skills-live-${report.startedAt.replace(/[:.]/g, '-')}.json`, data, { mode: 0o600 }); await writeFile('.runtime/course-skills-live.json', data, { mode: 0o600 }); console.log(data);
}
