import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { loadEnvFile } from 'node:process';
import { chromium } from '@playwright/test';
import { solveOnDevice } from '../packages/agent/dist/pi/mobile.js';
import { loadConfig, getModelConnections } from '../packages/config/dist/index.js';
import { LocalSettingsSchema, LocalRecordSchema } from '../packages/contracts/dist/local.js';
import { webServer } from './web-server.mjs';

// Explicit paid acceptance only. Never import .env into the application bundle.
if (!process.argv.includes('--live')) throw new Error('EXPLICIT_LIVE_REQUIRED');
loadEnvFile('.env');
const connections = getModelConnections(loadConfig(process.env));
function profile({ route }) { return { provider: route.provider, baseURL: route.baseURL, model: route.model, api: route.api, contextWindow: route.contextWindow, maxTokens: route.requestMaxTokens, maxTokensField: route.compat.maxTokensField }; }
const settings = LocalSettingsSchema.parse({ schemaVersion: 1, solver: profile(connections.solver), verifier: profile(connections.verifier) });
const keys = { solver: connections.solver.apiKey, verifier: connections.verifier.apiKey };
const plain = value => value.replace(/[\\{}\s$]/g, '');
const cases = [
  { subject: 'math', text: '数学课程题（自编）\n已知 y=x²，定义域为 0≤x≤2。\n求它与直线 y=1 的交点，以及曲线与横轴在该区间围成的面积。\n画图说明，标明交点和面积所对应区域。', truth: { intersection: [1, 1], area: '8/3' }, figure: true, check(c) { assert.match(plain(c.answer), /(?:frac83|8\/3)/); assert(c.figures.some(f => f.elements.some(e => e.kind === 'point' && e.at[0] === 1 && e.at[1] === 1))); } },
  { subject: 'physics', text: '物理课程题（自编）\n质量2 kg的物体沿水平直线运动，初速度为0。\n正向拉力10 N、反向滑动摩擦力2 N均恒定，持续3 s。\n求加速度、3 s末速度和这3 s内的位移，并画速度—时间图。', truth: { acceleration: 4, velocity: 12, displacement: 18 }, figure: true, check(c) { const a = plain(c.answer); for (const n of [4, 12, 18]) assert.match(a, new RegExp(`(?<![\\d.])${n}(?![\\d.])`)); assert(c.figures.some(f => f.elements.some(e => e.kind === 'polynomial' && e.coefficients[0] === 0 && e.coefficients[1] === 4 || e.kind === 'segment' && e.to[0] === 3 && e.to[1] === 12 || e.kind === 'polyline' && e.points.some(p => p[0] === 3 && p[1] === 12)))); } },
  { subject: 'chemistry', text: '化学课程题（自编，纸面计量）\n10 g纯碳酸钙CaCO₃与足量稀盐酸完全反应。\n已知M(CaCO₃)=100 g/mol，M(CO₂)=44 g/mol。\n写出配平的化学方程式，求生成CO₂的质量。', truth: { massGrams: 4.4 }, check(c) { assert.match(plain(c.answer), /4\.4/); const all = plain(JSON.stringify(c)); for (const species of ['CaCO_3', 'HCl', 'CaCl_2', 'CO_2']) assert(all.includes(species) || all.includes(species.replaceAll('_', ''))); assert(!JSON.stringify(c).includes('\\ce{')); } },
  { subject: 'biology', text: '生物课程题（自编）\n某单基因性状符合孟德尔分离规律，A对a完全显性。\n两个亲本均为Aa，无致死、无选择差异。\n求子代隐性表型的概率；在显性子代中杂合子的概率是多少？\n用配子组合表说明，解释两个概率的样本空间。', truth: { recessive: '1/4', heterozygousGivenDominant: '2/3' }, check(c) { const a = plain(c.answer); assert.match(a, /(?:frac14|1\/4|25%|0\.25)/); assert.match(a, /(?:frac23|2\/3|66\.6|0\.66)/); assert.match(JSON.stringify(c), /AA/); assert.match(JSON.stringify(c), /aa/); } },
  { subject: 'economics', text: '经济学课程题（自编）\n某商品需求P=10-Q，供给P=2+Q，P单位元/件，Q单位件。\n只讨论价格和数量非负的范围。\n求市场均衡数量、价格、消费者剩余与生产者剩余。\n画供需图，标明均衡点与两种剩余区域。', truth: { quantity: 4, price: 6, consumerSurplus: 8, producerSurplus: 8 }, figure: true, check(c) { const a = plain(c.answer); for (const n of [4, 6, 8]) assert.match(a, new RegExp(`(?<![\\d.])${n}(?![\\d.])`)); assert(c.figures.some(f => f.elements.some(e => e.kind === 'point' && e.at[0] === 4 && e.at[1] === 6))); assert(c.figures.flatMap(f => f.elements).filter(e => e.kind === 'polygon').length >= 2); } },
];
const directory = `.runtime/local-course-${new Date().toISOString().replace(/[:.]/g, '-')}`;
await mkdir(directory, { recursive: true, mode: 0o700 });
const server = webServer('apps/mobile/dist'); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ executablePath: process.env.SOLVEFLOW_TEST_CHROME ?? '/usr/bin/google-chrome' });
const report = { schemaVersion: 1, source: 'Self-authored course questions; analytic ground truths, no third-party images', path: 'Local Pi core + independent verifier over real configured HTTP, then stored-result RN Web rendering', runs: [], passed: false };
try {
  for (const fixture of cases.filter(item => !process.argv.some(arg => arg.startsWith('--subject=')) || process.argv.includes(`--subject=${item.subject}`))) {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const page = await context.newPage(); const errors = []; page.on('pageerror', error => errors.push(error.name));
    const row = { subject: fixture.subject, truth: fixture.truth, passed: false, tools: [] }; report.runs.push(row);
    try {
      const source = await context.newPage(); await source.setViewportSize({ width: 1000, height: 500 });
      await source.setContent('<html lang="zh"><body style="margin:32px;background:white;color:black;font:27px/1.9 sans-serif;white-space:pre-line"></body></html>');
      await source.locator('body').evaluate((node, text) => { node.textContent = text; }, fixture.text);
      const image = await source.screenshot({ type: 'jpeg' }); await source.close();
      const sessionId = randomUUID(), runId = randomUUID(), uploadId = randomUUID(); const now = new Date().toISOString();
      const diagnostics = []; const seen = new Set(); const started = Date.now();
      const outcome = await solveOnDevice({ schemaVersion: 1, role: 'solver', identity: { ownerId: 'local-acceptance', sessionId, runId }, message: '解答图片中的课程题，使用对应学科的方法；有图的要求请完整画出。', image: { bytes: image, mimeType: 'image/jpeg' }, evidence: [] }, settings, keys, async (url, init) => {
        const body = JSON.parse(String(init?.body));
        for (const message of body.messages ?? []) for (const call of message.tool_calls ?? []) if (!seen.has(call.id)) { seen.add(call.id); row.tools.push({ name: call.function.name, ...(call.function.name === 'read' ? { path: JSON.parse(call.function.arguments).path } : {}) }); }
        return fetch(url, init);
      }, new AbortController().signal, () => {}, entry => diagnostics.push(entry));
      Object.assign(row, { elapsedMs: Date.now() - started, status: outcome.status, verified: outcome.verified, diagnostics });
      await writeFile(`${directory}/${fixture.subject}-outcome.json`, JSON.stringify(outcome, null, 2), { mode: 0o600 });
      assert.equal(outcome.status, 'completed'); assert.equal(outcome.verified, true);
      const candidate = outcome.candidate; assert.equal(candidate.problem.subject, fixture.subject); assert(candidate.knowledgeDetails.length >= 2); assert(candidate.steps.length >= 2);
      assert(row.tools.some(tool => tool.name === 'read' && tool.path.includes(`/${fixture.subject}/`))); assert(row.tools.some(tool => tool.name === 'calculate'));
      if (fixture.figure) assert(candidate.figures?.length); fixture.check(candidate);
      const record = LocalRecordSchema.parse({ schemaVersion: 1, image: `data:image/jpeg;base64,${image.toString('base64')}`, session: { schemaVersion: 1, id: sessionId, subject: fixture.subject, createdAt: now, upload: { schemaVersion: 1, id: uploadId, mimeType: 'image/jpeg', bytes: image.length, width: 1000, height: 500, expiresAt: '9999-12-31T00:00:00.000Z', previewUrl: `/api/v1/uploads/${uploadId}/image` }, runs: [{ schemaVersion: 1, id: runId, sessionId, status: outcome.status, outcome, message: '', createdAt: now, seq: 1 }] } });
      await page.goto(origin); await page.getByRole('button', { name: '拍照', exact: true }).waitFor();
      await page.evaluate(async record => { const db = await new Promise((resolve, reject) => { const r = indexedDB.open('solveflow-local', 1); r.onsuccess = () => resolve(r.result); r.onerror = reject; }); await new Promise((resolve, reject) => { const tx = db.transaction('documents', 'readwrite'); tx.objectStore('documents').put(JSON.stringify(record), `record.${record.session.id}`); tx.oncomplete = resolve; tx.onerror = reject; }); db.close(); }, record);
      await page.goto(`${origin}/?session=${sessionId}`); await page.locator('.final-answer').waitFor(); await page.getByTestId('launch-screen').waitFor({ state: 'hidden' });
      await page.locator('.step-details > summary').click();
      assert.equal(await page.locator('.katex-error').count(), 0); assert.deepEqual(errors, []);
      if (fixture.figure) { assert.equal(await page.locator('.final-answer .answer-figure').count(), candidate.figures.length); assert.equal(await page.locator('.step-details .answer-figure').count(), candidate.figures.length); }
      for (const scheme of ['light', 'dark']) { await page.emulateMedia({ colorScheme: scheme }); await page.setViewportSize({ width: 320, height: 844 }); assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)); const box = await page.locator('.final-answer').boundingBox(); await page.setViewportSize({ width: 320, height: Math.min(8000, Math.ceil((box?.height ?? 844) + 200)) }); await page.locator('.final-answer').screenshot({ path: `${directory}/${fixture.subject}-${scheme}.png` }); }
      row.passed = true;
    } catch (error) { row.failure = error instanceof assert.AssertionError ? `ASSERTION:${error.operator}` : error?.name ?? 'ACCEPTANCE_FAILED'; }
    finally { await context.close(); await writeFile(`${directory}/report.json`, JSON.stringify(report, null, 2), { mode: 0o600 }); console.log(JSON.stringify({ subject: row.subject, status: row.status, verified: row.verified, passed: row.passed, elapsedMs: row.elapsedMs, failure: row.failure })); }
  }
  report.passed = report.runs.length > 0 && report.runs.every(row => row.passed); if (!report.passed) process.exitCode = 1;
} finally { await browser.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await writeFile(`${directory}/report.json`, JSON.stringify(report, null, 2), { mode: 0o600 }); console.log(JSON.stringify({ report: `${directory}/report.json`, passed: report.passed })); }
