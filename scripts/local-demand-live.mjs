import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { loadEnvFile } from 'node:process';
import { chromium } from '@playwright/test';
import { solveOnDevice } from '../packages/agent/dist/pi/mobile.js';
import { loadConfig, getModelConnections } from '../packages/config/dist/index.js';
import { LocalSettingsSchema } from '../packages/contracts/dist/local.js';
if (!process.argv.includes('--live')) throw new Error('EXPLICIT_LIVE_REQUIRED');
loadEnvFile('.env');
const connections = getModelConnections(loadConfig(process.env));
const profile = ({ route }) => ({ provider: route.provider, baseURL: route.baseURL, model: route.model, api: route.api, contextWindow: route.contextWindow, maxTokens: route.requestMaxTokens, maxTokensField: route.compat.maxTokensField });
const settings = LocalSettingsSchema.parse({ schemaVersion: 1, solver: profile(connections.solver), verifier: profile(connections.verifier) });
const keys = { solver: connections.solver.apiKey, verifier: connections.verifier.apiKey };
const directory = `.runtime/demand-live-${new Date().toISOString().replace(/[:.]/g, '-')}`;
await mkdir(directory, { recursive: true, mode: 0o700 });
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome' });
let image;
try {
  const page = await browser.newPage({ viewport: { width: 1000, height: 650 } });
  await page.setContent('<body style="margin:45px;font:32px sans-serif;line-height:2.4;background:white;color:black">自编数学课程题<br>1. 求解 x²+2=6。<br>2. 求 x² 在区间 [−1,1] 上的定积分。<br>3. 画出 y=x² 在 [0,2] 内的函数图像。</body>');
  image = await page.screenshot({ type: 'jpeg', quality: 90 }); await writeFile(`${directory}/question.jpg`, image);
} finally { await browser.close(); }
const sessionId = randomUUID(); const sourceRunId = randomUUID();
const base = { schemaVersion: 1, role: 'solver', verificationMode: 'manual', identity: { ownerId: 'local-device', sessionId, runId: sourceRunId }, message: '答第二题', image: { bytes: new Uint8Array(image), mimeType: 'image/jpeg' }, evidence: [] };
const report = { schemaVersion: 1, source: 'Self-authored JPEG, analytic truth integral[-1,1] x² dx = 2/3', path: 'actual solveOnDevice Pi: brief, requested details, explicit verification; not a physical-device request', runs: [] };
for (const answerMode of ['brief', 'detailed', 'verification']) {
  const previous = report.runs.at(-1); if (answerMode === 'detailed' && !previous?.passed) break;
  const input = answerMode === 'verification' ? { ...base, verificationTarget: report.runs[0].outcome.candidate, identity: { ...base.identity, runId: randomUUID() } } : answerMode === 'brief' ? { ...base, answerMode } : { ...base, answerMode, identity: { ...base.identity, runId: randomUUID() }, message: '请讲解这道题的详细步骤。', focus: { kind: 'explanation', sourceRunId, verified: false, content: `只讲解原图第2题。此前题干：${previous.outcome.candidate.problem.text}；此前答案须重新核对：${previous.outcome.candidate.answer}` } };
  const diagnostics = []; const started = performance.now();
  const outcome = await solveOnDevice(input, settings, keys, globalThis.fetch, new AbortController().signal, () => {}, entry => diagnostics.push(entry));
  const row = { mode: answerMode, elapsedMs: Math.round(performance.now() - started), outcome, diagnostics, passed: false }; report.runs.push(row);
  try {
    assert.equal(outcome.status, 'completed'); assert.equal(outcome.verified, answerMode === 'verification'); if (answerMode !== 'verification') assert.equal(outcome.verificationStatus, 'not_requested');
    assert.match(outcome.candidate.answer.replace(/[\\{}\s$]/g, ''), /(?:frac23|2\/3)/);
    if (answerMode === 'brief') { assert.equal(outcome.candidate.steps.length, 0); assert.equal(outcome.candidate.knowledgeDetails?.length ?? 0, 0); assert.equal(outcome.candidate.figures?.length ?? 0, 0); }
    else if (answerMode === 'detailed') assert(outcome.candidate.steps.length > 0);
    if (answerMode === 'brief') assert.match(outcome.candidate.answer, /\*\*[^*]+\*\*/);
    row.passed = true;
  } catch (error) { row.failure = error instanceof assert.AssertionError ? `ASSERTION:${error.operator}` : error.name; process.exitCode = 1; }
  await writeFile(`${directory}/report.json`, JSON.stringify(report, null, 2), { mode: 0o600 });
  console.log(JSON.stringify({ mode: row.mode, elapsedMs: row.elapsedMs, status: outcome.status, verified: outcome.verified, passed: row.passed }));
}
console.log(JSON.stringify({ report: `${directory}/report.json` }));
