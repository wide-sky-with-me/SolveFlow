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
const thinkingControl = process.argv.find(arg => arg.startsWith('--thinking-control='))?.split('=')[1];
function profile({ route }) { return { provider: route.provider, baseURL: route.baseURL, model: route.model, api: route.api, contextWindow: route.contextWindow, maxTokens: route.requestMaxTokens, maxTokensField: route.compat.maxTokensField, ...(thinkingControl ? { thinkingControl } : {}) }; }
const settings = LocalSettingsSchema.parse({ schemaVersion: 1, solver: profile(connections.solver), verifier: profile(connections.verifier) });
const keys = { solver: connections.solver.apiKey, verifier: connections.verifier.apiKey };
const plain = value => value.replace(/[\\{}\s$]/g, '');
const cases = [
  { subject: 'math', exam: 'sat', id: 'sat-scatter', text: 'Self-authored SAT Math practice\nThe scatterplot and its line of best fit are shown below.\nAt x=32, which choice is closest to the y-value predicted by the line of best fit?\nA. 0.4   B. 1.5   C. 2.4   D. 3.3', diagram: true, truth: { option: 'C', predicted: 2.4 }, check(c) { assert.deepEqual(c.selectedOptions, ['C']); assert.equal(c.problem.options?.length, 4); assert(c.problem.illustrations?.length); } },
  { subject: 'math', exam: 'sat', id: 'sat-spr', text: 'Self-authored SAT Math practice — Student-produced response\nIf 3x = 7, what is the value of x?\nGive one valid entry for the response box, using an exact fraction if possible.', truth: { entry: '7/3' }, check(c) { assert.match(plain(c.answer), /(?:[dt]?frac73|7\/3)/); assert.match(c.answer, /\*\*[^*]+\*\*/); } },
  { subject: 'english', exam: 'sat', id: 'sat-transition', noCalculation: true, text: 'Self-authored SAT Reading and Writing practice\nThe team expected the drought to reduce seed production. The plants produced more seeds than in the previous wet year.\nWhich transition best links the contrasting second sentence to the first?\nA. Consequently, B. However, C. Similarly, D. For example,', truth: { option: 'B', text: 'However' }, check(c) { assert.deepEqual(c.selectedOptions, ['B']); assert.match(c.problem.options?.find(option => option.label === 'B')?.text ?? '', /However/i);  assert.match(c.answer, /转折|对比|相反|contrast/i); } },
  { subject: 'biology', allowedSubjects: ['biology', 'general'], exam: 'act', id: 'act-data', text: 'Self-authored ACT Science practice\nAt constant light and temperature, a culture is tested with three nutrient concentrations.\nNutrient (mg/L): 0, 5, 10. Growth (mm/day): 4, 8, 12.\nAssume the trend is linear BETWEEN measured points. What growth rate is predicted at 7.5 mg/L?\nF. 6 mm/day  G. 8 mm/day  H. 10 mm/day  J. 14 mm/day', truth: { option: 'H', rate: 10 }, check(c) { assert.deepEqual(c.selectedOptions, ['H']); assert.match(plain(c.answer), /(?<![\d.])10(?![\d.])/); } },
  { subject: 'english', exam: 'act', id: 'act-english', text: 'Self-authored ACT English practice\nThe list of proposed changes [are] on the desk.\nChoose the replacement for the bracketed word that conforms to Standard English.\nA. NO CHANGE  B. is  C. were  D. have been', truth: { option: 'B', text: 'is' }, check(c) { assert.deepEqual(c.selectedOptions, ['B']); assert.match(c.problem.options?.find(option => option.label === 'B')?.text ?? '', /\bis\b/);  assert.match(c.answer, /list|主语|单数|singular/i); } },
  { subject: 'math', exam: 'ap', id: 'ap-calculus', text: 'Self-authored AP Calculus AB FRQ practice — no calculator\nLet f(x)=x³+x−1. Is there a number c in (0,1) such that f(c)=0?\nJustify your answer using the hypotheses and evidence needed for the relevant theorem.', truth: { exists: true, endpoints: [-1, 1], theorem: 'IVT' }, check(c) { const a = plain(c.answer); assert.match(a, /连续|continuous/i); assert.match(a, /(?:介值|零点定理|中间值|intermediate|IVT)/i); assert.match(a, /f\(0\)=[^，。；\n]*-1(?:<0)?/); assert.match(a, /f\(1\)=[^，。；\n]*=1(?:>0)?|f\(1\)=1/); assert.match(a, /存在|yes|exists/i); } },
  { subject: 'math', exam: 'ap', id: 'ap-statistics', text: 'Self-authored AP Statistics FRQ practice\nA researcher observes 200 students without assigning any treatments. The sample correlation between weekly exercise and exam score is r=0.80.\nCan the researcher conclude that increasing exercise CAUSES higher scores? Explain with reference to the study design.', truth: { causation: false, design: 'observational, no random assignment' }, check(c) { assert.match(c.answer, /不能|不可以|无法|\bno\b|cannot/i); assert.match(c.answer, /观察|观测|observational/i); assert.match(c.answer, /混杂|随机分配|confound|random.*assign/i); } },
  { subject: 'biology', exam: 'ap', id: 'ap-biology', text: 'Self-authored AP Biology FRQ practice\nEqual numbers of living cells receive the same glucose concentration. Control cells take up 80 units of glucose per minute. Cells treated with a transporter inhibitor take up 20 units per minute. All other conditions are held constant.\n(a) Calculate the percent decrease in glucose uptake; show the calculation.\n(b) Explain why using the same number of living cells in both groups is necessary.', truth: { decreasePercent: 75, control: 'cell count' }, check(c) { assert.match(plain(c.answer), /75/); assert.match(c.answer, /80/); assert.match(c.answer, /20/); assert.match(c.answer, /细胞|cell/i); assert.match(c.answer, /数量|数目|number|count/i); assert.equal(c.questions, undefined); } },
  { subject: 'economics', exam: 'ap', id: 'ap-micro', text: 'Self-authored AP Microeconomics FRQ practice\nIn one market, initial demand is P=10−Q and supply is P=2+Q. Demand then changes to P=14−Q; supply stays fixed. P and Q are nonnegative.\n(a) Find the initial and new equilibrium quantities and prices.\n(b) Draw one clearly labeled graph with both demand curves and the unchanged supply curve, marking both equilibria.', truth: { initial: [4, 6], final: [6, 8] }, figure: true, check(c) { assert.equal(c.figures.length, 1); for (const point of [[4,6],[6,8]]) assert(c.figures.some(f => f.elements.some(e => e.kind === 'point' && e.at[0] === point[0] && e.at[1] === point[1]))); assert.equal(c.questions, undefined); } },
];
const directory = `.runtime/exam-skills-${new Date().toISOString().replace(/[:.]/g, '-')}`;
await mkdir(directory, { recursive: true, mode: 0o700 });
const server = webServer('apps/mobile/dist'); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ executablePath: process.env.SOLVEFLOW_TEST_CHROME ?? '/usr/bin/google-chrome' });
const report = { schemaVersion: 1, source: 'Self-authored course questions; analytic ground truths, no third-party images', path: 'Local Pi core with manual verification and brief mode over real configured HTTP, analytic assertions, then stored-result RN Web rendering', runs: [], passed: false };
try {
  for (const fixture of cases.filter(item => !process.argv.some(arg => arg.startsWith('--case=')) || process.argv.includes(`--case=${item.id}`))) {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const page = await context.newPage(); const errors = []; page.on('pageerror', error => errors.push(error.name));
    const row = { id: fixture.id, exam: fixture.exam, subject: fixture.subject, truth: fixture.truth, passed: false, tools: [] }; report.runs.push(row);
    try {
      const source = await context.newPage(); await source.setViewportSize({ width: 1000, height: 500 });
      await source.setContent('<html lang="zh"><body style="margin:32px;background:white;color:black;font:27px/1.9 sans-serif;white-space:pre-line"></body></html>');
      await source.locator('body').evaluate((node, text) => { node.textContent = text; }, fixture.text);
      if (fixture.diagram) await source.locator('body').evaluate(node => {
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); svg.setAttribute('width', '600'); svg.setAttribute('height', '410'); svg.setAttribute('viewBox', '0 0 600 410');
        const shape = (tag, attrs, text) => { const el = document.createElementNS(svg.namespaceURI, tag); for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, String(value)); if (text) el.textContent = text; svg.appendChild(el); };
        const X = x => 70+(x-24)*40, Y = y => 350-y*25;
        for (let x=24;x<=36;x+=2) { shape('line',{x1:X(x),x2:X(x),y1:50,y2:350,stroke:'#ddd'}); shape('text',{x:X(x),y:379,'text-anchor':'middle','font-size':20},String(x)); }
        for (let y=0;y<=12;y+=2) { shape('line',{x1:70,x2:550,y1:Y(y),y2:Y(y),stroke:'#ddd'}); shape('text',{x:53,y:Y(y)+7,'text-anchor':'end','font-size':20},String(y)); }
        shape('path',{d:'M70 50V350H550',fill:'none',stroke:'black','stroke-width':2});
        for (const [x,y] of [[24,10],[25,8.2],[26,8.5],[27,7],[28,5.7],[29,4.8],[30,4.6],[31,3.6],[32,2.1],[33,1.8],[34,.4]]) shape('circle',{cx:X(x),cy:Y(y),r:4,fill:'black'});
        shape('line',{x1:X(24),y1:Y(9.6),x2:X(34.6666667),y2:Y(0),stroke:'black','stroke-width':3});
        shape('text',{x:571,y:357,'font-size':22},'x'); shape('text',{x:63,y:30,'font-size':22},'y'); node.appendChild(svg);
      });
      const imageHeight = await source.evaluate(() => Math.max(500, document.documentElement.scrollHeight)); await source.setViewportSize({ width: 1000, height: imageHeight });
      const image = await source.screenshot({ type: 'jpeg' }); await writeFile(`${directory}/${fixture.id}-question.jpg`, image, { mode: 0o600 }); await source.close();
      const sessionId = randomUUID(), runId = randomUUID(), uploadId = randomUUID(); const now = new Date().toISOString();
      const diagnostics = []; const seen = new Set(); const started = Date.now();
      const outcome = await solveOnDevice({ schemaVersion: 1, role: 'solver', verificationMode: 'manual', answerMode: 'brief', identity: { ownerId: 'local-acceptance', sessionId, runId }, message: '解答这道自编考试练习题。答案简洁，保留题目明确要求的依据和各小问，核心结果加粗。', image: { bytes: image, mimeType: 'image/jpeg' }, evidence: [] }, settings, keys, async (url, init) => {
        const body = JSON.parse(String(init?.body));
        for (const message of body.messages ?? []) for (const call of message.tool_calls ?? []) if (!seen.has(call.id)) { seen.add(call.id); row.tools.push({ name: call.function.name, ...(call.function.name === 'read' ? { path: JSON.parse(call.function.arguments).path } : {}) }); }
        return fetch(url, init);
      }, new AbortController().signal, () => {}, entry => diagnostics.push(entry));
      Object.assign(row, { elapsedMs: Date.now() - started, status: outcome.status, verified: outcome.verified, diagnostics });
      await writeFile(`${directory}/${fixture.id}-outcome.json`, JSON.stringify(outcome, null, 2), { mode: 0o600 });
      assert.equal(outcome.status, 'completed'); assert.equal(outcome.verified, false); assert.equal(outcome.verificationStatus, 'not_requested');
      const candidate = outcome.candidate; assert((fixture.allowedSubjects ?? [fixture.subject]).includes(candidate.problem.subject)); assert.equal(candidate.steps.length, 0); assert.equal(candidate.knowledgeDetails?.length ?? 0, 0);
      assert(row.tools.some(tool => tool.name === 'read' && tool.path === '/skills/exams/SKILL.md')); assert(row.tools.some(tool => tool.name === 'read' && tool.path === `/skills/exams/references/${fixture.exam}.md`));
      if (fixture.noCalculation) assert(!row.tools.some(tool => tool.name === 'calculate'));
      if (fixture.figure) assert(candidate.figures?.length); fixture.check(candidate);
      const record = LocalRecordSchema.parse({ schemaVersion: 1, image: `data:image/jpeg;base64,${image.toString('base64')}`, session: { schemaVersion: 1, id: sessionId, subject: fixture.subject, createdAt: now, upload: { schemaVersion: 1, id: uploadId, mimeType: 'image/jpeg', bytes: image.length, width: 1000, height: imageHeight, expiresAt: '9999-12-31T00:00:00.000Z', previewUrl: `/api/v1/uploads/${uploadId}/image` }, runs: [{ schemaVersion: 1, id: runId, sessionId, status: outcome.status, outcome, message: '', createdAt: now, seq: 1 }] } });
      await page.goto(origin); await page.getByRole('button', { name: '拍照', exact: true }).waitFor();
      await page.evaluate(async record => { const db = await new Promise((resolve, reject) => { const r = indexedDB.open('solveflow-local', 1); r.onsuccess = () => resolve(r.result); r.onerror = reject; }); await new Promise((resolve, reject) => { const tx = db.transaction('documents', 'readwrite'); tx.objectStore('documents').put(JSON.stringify(record), `record.${record.session.id}`); tx.oncomplete = resolve; tx.onerror = reject; }); db.close(); }, record);
      await page.goto(`${origin}/?session=${sessionId}`); await page.locator('.final-answer').waitFor(); await page.getByTestId('launch-screen').waitFor({ state: 'hidden' });
      await page.locator('.step-details > summary').waitFor();
      assert.equal(await page.locator('.katex-error').count(), 0); assert.deepEqual(errors, []);
      if (fixture.figure) { assert.equal(await page.locator('.final-answer .answer-figure').count(), candidate.figures.length); assert.equal(await page.locator('.teaching-steps').count(), 0); }
      for (const scheme of ['light', 'dark']) { await page.emulateMedia({ colorScheme: scheme }); await page.setViewportSize({ width: 320, height: 844 }); assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)); const box = await page.locator('.final-answer').boundingBox(); await page.setViewportSize({ width: 320, height: Math.min(8000, Math.ceil((box?.height ?? 844) + 200)) }); await page.locator('.final-answer').screenshot({ path: `${directory}/${fixture.id}-${scheme}.png` }); }
      row.passed = true;
    } catch (error) { row.failure = error instanceof assert.AssertionError ? `ASSERTION:${error.operator}:${String(error.message).slice(0,160)}` : error?.name ?? 'ACCEPTANCE_FAILED'; }
    finally { await context.close(); await writeFile(`${directory}/report.json`, JSON.stringify(report, null, 2), { mode: 0o600 }); console.log(JSON.stringify({ id: row.id, subject: row.subject, status: row.status, verified: row.verified, passed: row.passed, elapsedMs: row.elapsedMs, failure: row.failure })); }
  }
  report.passed = report.runs.length > 0 && report.runs.every(row => row.passed); if (!report.passed) process.exitCode = 1;
} finally { await browser.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await writeFile(`${directory}/report.json`, JSON.stringify(report, null, 2), { mode: 0o600 }); console.log(JSON.stringify({ report: `${directory}/report.json`, passed: report.passed })); }
