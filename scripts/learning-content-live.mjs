import assert from 'node:assert/strict';
import { loadEnvFile } from 'node:process';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from '@playwright/test';
import { originalIllustrationBounds } from '../packages/contracts/dist/agent.js';
import { BootstrapSchema, RunViewSchema, parseRunEvent } from '../packages/contracts/dist/http.js';
if (!process.argv.includes('--live')) throw new Error('Explicit --live required');
if (process.argv.includes('--math-only') && process.argv.includes('--economics-only')) throw new Error('Choose only one scope');
loadEnvFile('.env');
const origin = 'http://127.0.0.1:3100';
const browser = await chromium.launch({ executablePath: process.env.SOLVEFLOW_TEST_CHROME ?? '/usr/bin/google-chrome' });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
const report = { schemaVersion: 1, mode: 'live', startedAt: new Date().toISOString(), scope: process.argv.includes('--economics-only') ? 'economics-and-followup' : process.argv.includes('--math-only') ? 'math-and-followup' : 'math-economics-and-followup', fixtures: 'Self-authored right triangle AB=3 AC=4; economics P=14-Q P=2+2Q', runs: [], passed: false };
const sessions = new Set();
await mkdir('.runtime/screenshots', { recursive: true });
try {
  const page = await context.newPage(); const errors = []; page.on('pageerror', error => errors.push(error.name));
  async function initialize() {
    const ready = page.waitForResponse(response => response.url() === `${origin}/api/v1/bootstrap`);
    await page.goto(origin); const bootstrap = BootstrapSchema.parse(await (await ready).json()); assert.equal(bootstrap.mode, 'live'); assert(bootstrap.solvingAvailable);
  }
  async function upload(html, message) {
    const source = await context.newPage(); await source.setViewportSize({ width: 1000, height: 520 });
    await source.setContent(`<html lang="zh"><body style="margin:0;background:white;color:black;font:26px/1.8 sans-serif">${html}</body></html>`);
    const image = await source.screenshot(); await writeFile(`.runtime/learning-source-${sessions.size}.png`, image, { mode: 0o600 }); await source.close(); await initialize();
    await page.getByLabel('从相册上传图片').setInputFiles({ name: 'self-authored-learning.png', mimeType: 'image/png', buffer: image });
    await page.getByLabel('补充说明').fill(message);
  }
  async function complete(action, label) {
    const posted = page.waitForResponse(response => /\/sessions\/[^/]+\/runs$/.test(response.url()) && response.request().method() === 'POST');
    const started = Date.now(); await action(); const response = await posted; assert.equal(response.status(), 202);
    let run = RunViewSchema.parse(await response.json()); sessions.add(run.sessionId);
    while (!run.outcome && Date.now() - started < 135000) { await new Promise(resolve => setTimeout(resolve, 500)); run = RunViewSchema.parse(await (await context.request.get(`${origin}/api/v1/runs/${run.id}`)).json()); }
    const row = { label, id: run.id, status: run.status, verified: run.outcome?.verified, contextKind: run.context?.kind ?? null, elapsedMs: Date.now() - started };
    report.runs.push(row); console.log(JSON.stringify(row));
    await writeFile(`.runtime/learning-${label}-candidate.json`, JSON.stringify(run, null, 2), { mode: 0o600 });
    assert.equal(run.outcome?.status, 'completed'); assert(run.outcome.verified);
    const replay = await (await context.request.get(`${origin}/api/v1/runs/${run.id}/events`)).text();
    const events = replay.split('\n').filter(line => line.startsWith('data:')).map(line => parseRunEvent(JSON.parse(line.slice(5).trim())));
    row.calculations = events.filter(event => event.type === 'tool.status' && event.toolName === 'calculate' && event.status === 'completed').length;
    if (!label.includes('knowledge')) assert(row.calculations > 0, 'Numerical checks require an actual successful calculate call');
    await page.reload(); await page.locator('.answer-card').first().waitFor();
    await page.screenshot({ path: `.runtime/screenshots/learning-${label}-live-raw.png`, fullPage: true });
    return run;
  }
  const clean = value => value.replace(/[\\{}\s$]/g, '');
  if (!process.argv.includes('--economics-only')) {
  await upload('<div style="position:absolute;left:35px;top:60px;width:500px">数学题：如图，△ABC中，∠A=90°，AB=3 cm，AC=4 cm。<br>求边BC的长度和△ABC的面积，并说明理由。</div><svg style="position:absolute;left:580px;top:100px" width="380" height="350" viewBox="0 0 380 350"><path d="M65 270 L275 270 L65 50 Z" fill="none" stroke="black" stroke-width="3"/><path d="M65 248 L87 248 L87 270" fill="none" stroke="black" stroke-width="2"/><g font-size="25" font-family="sans-serif"><text x="35" y="300">A</text><text x="285" y="290">B</text><text x="47" y="38">C</text><text x="145" y="307">3 cm</text><text x="0" y="170">4 cm</text></g></svg>', '请解答这道数学题，完整复述题干并保留原题图，用辅助图解释方法，列出本题知识点。');
  const math = await complete(() => page.getByRole('button', { name: '开始解题' }).click(), 'math');
  const mc = math.outcome.candidate;
  assert.match(clean(mc.answer), /BC.{0,25}5/); assert.match(clean(mc.answer), /6/);
  assert.equal(Math.sqrt(3 ** 2 + 4 ** 2), 5); assert.equal(3 * 4 / 2, 6);
  assert(mc.problem.text.includes('3') && mc.problem.text.includes('4')); assert(mc.problem.illustrations?.length); assert(mc.knowledgeDetails?.length >= 2); assert(mc.figures?.length);
  const crop = originalIllustrationBounds(mc.problem.illustrations[0]);
  // The known original drawing and its labels occupy this rectangle on the source.
  assert(crop.x <= .59 && crop.y <= .22 && crop.x + crop.width >= .895 && crop.y + crop.height >= .787, 'Original crop must retain diagram labels');
  await page.setViewportSize({ width: 320, height: 844 }); assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.screenshot({ path: '.runtime/screenshots/learning-math-live.png', fullPage: true });
  const knowledge = page.locator('.knowledge-panel details').first(); await knowledge.locator('summary').click(); await knowledge.getByRole('button', { name: '追问这个知识点' }).click();
  const reply = await complete(() => page.getByRole('button', { name: '发送同题追问' }).click(), 'knowledge');
  assert.equal(reply.context?.kind, 'knowledge'); assert.equal(reply.context.sourceRunId, math.id); assert.equal(await page.locator('.question-conversation').count(), 1); assert.equal(await page.locator('.answer-card').count(), 2);
  }
  if (!process.argv.includes('--math-only')) {
  await upload('<div style="margin:50px">经济学课程题（自编）：<br>某商品需求曲线P=14-Q，供给曲线P=2+2Q。<br>Q的单位为件，P的单位为元/件，Q≥0。<br>求市场均衡数量和价格、消费者剩余与生产者剩余。<br>请画供需图，标出均衡点与两类剩余区域。</div>', '解答这道经济学课程题，请数值验算并画出供需和剩余区域，说明知识点。');
  const economic = await complete(() => page.getByRole('button', { name: '开始解题' }).click(), 'economics'); const ec = economic.outcome.candidate;
  assert.match(clean(ec.answer), /Q.{0,15}4/); assert.match(clean(ec.answer), /P.{0,15}10/); assert.match(clean(ec.answer), /消费者剩余.{0,30}8/); assert.match(clean(ec.answer), /生产者剩余.{0,30}16/);
  assert.equal(14 - 4, 2 + 2 * 4); assert.equal((14 - 10) * 4 / 2, 8); assert.equal((10 - 2) * 4 / 2, 16);
  assert(ec.knowledgeDetails?.length >= 2); assert(ec.figures?.some(figure => figure.elements.filter(item => item.kind === 'polygon').length >= 2));
  assert(ec.figures?.every(figure => figure.xLabel && figure.yLabel));
  const areas = ec.figures.flatMap(figure => figure.elements.filter(item => item.kind === 'polygon').map(item => Math.abs(item.points.reduce((sum, [x, y], i) => { const next = item.points[(i + 1) % item.points.length]; return sum + x * next[1] - next[0] * y; }, 0)) / 2));
  assert(areas.includes(8) && areas.includes(16), 'Actual rendered surplus polygons must have areas 8 and 16');
  assert(ec.figures.some(figure => figure.elements.some(item => item.kind === 'point' && item.at[0] === 4 && item.at[1] === 10)), 'Equilibrium point must be (4,10)');
  await page.setViewportSize({ width: 320, height: 844 }); assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.screenshot({ path: '.runtime/screenshots/learning-economics-live.png', fullPage: true });
  if (process.argv.includes('--economics-only')) {
    const knowledge = page.locator('.knowledge-panel details').first(); await knowledge.locator('summary').click(); await knowledge.getByRole('button', { name: '追问这个知识点' }).click();
    const reply = await complete(() => page.getByRole('button', { name: '发送同题追问' }).click(), 'economic-knowledge');
    assert.equal(reply.context?.kind, 'knowledge'); assert.equal(reply.context.sourceRunId, economic.id); assert.equal(await page.locator('.question-conversation').count(), 1); assert.equal(await page.locator('.answer-card').count(), 2);
  }
  }
  assert.deepEqual(errors, []); report.passed = true;
} catch (error) { report.failure = error instanceof Error ? error.message.slice(0, 240) : 'LEARNING_LIVE_FAILED'; process.exitCode = 1; }
finally {
  report.fixturesDeleted = [];
  for (const id of sessions) report.fixturesDeleted.push((await context.request.delete(`${origin}/api/v1/sessions/${id}`, { headers: { origin } })).ok());
  await browser.close(); report.finishedAt = new Date().toISOString();
  const data = JSON.stringify(report, null, 2) + '\n'; await writeFile(`.runtime/learning-live-${report.startedAt.replace(/[:.]/g, '-')}.json`, data, { mode: 0o600 }); await writeFile('.runtime/learning-live.json', data, { mode: 0o600 }); console.log(data);
}
