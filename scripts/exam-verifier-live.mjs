import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { loadEnvFile } from 'node:process';
import { solveOnDevice } from '../packages/agent/dist/pi/mobile.js';
import { loadConfig, getModelConnections } from '../packages/config/dist/index.js';
import { LocalSettingsSchema } from '../packages/contracts/dist/local.js';
import { SolveOutcomeSchema } from '../packages/contracts/dist/agent.js';
if (!process.argv.includes('--live')) throw new Error('EXPLICIT_LIVE_REQUIRED');
const directory = process.argv.find(arg => arg.startsWith('--directory='))?.slice('--directory='.length);
if (!directory?.startsWith('.runtime/exam-skills-') || directory.includes('..')) throw new Error('SELF_AUTHORED_EXAM_DIRECTORY_REQUIRED');
loadEnvFile('.env');
const connection = getModelConnections(loadConfig(process.env));
const profile = ({ route }) => ({ provider: route.provider, baseURL: route.baseURL, model: route.model, api: route.api, contextWindow: route.contextWindow, maxTokens: route.requestMaxTokens, maxTokensField: route.compat.maxTokensField });
const settings = LocalSettingsSchema.parse({ schemaVersion: 1, solver: profile(connection.solver), verifier: profile(connection.verifier) });
const keys = { solver: connection.solver.apiKey, verifier: connection.verifier.apiKey };
const saved = SolveOutcomeSchema.parse(JSON.parse(await readFile(`${directory}/ap-calculus-outcome.json`, 'utf8')));
if (saved.status !== 'completed') throw new Error('COMPLETED_AP_CANDIDATE_REQUIRED');
const image = new Uint8Array(await readFile(`${directory}/ap-calculus-question.jpg`));
const report = [];
for (const kind of ['complete', 'missing-justification']) {
  const candidate = { ...saved.candidate, ...(kind === 'missing-justification' ? { answer: '**Yes, such a c exists.**' } : {}) };
  const input = { schemaVersion: 1, role: 'solver', verificationMode: 'manual', answerMode: 'brief', verificationTarget: candidate,
    identity: { ownerId: 'local-exam-verifier', sessionId: randomUUID(), runId: randomUUID() }, message: '请校验这道AP Calculus AB题的答案是否满足题面要求。', image: { bytes: image, mimeType: 'image/jpeg' }, evidence: [] };
  const started = performance.now(); const diagnostics = [];
  const outcome = await solveOnDevice(input, settings, keys, fetch, new AbortController().signal, () => {}, item => diagnostics.push(item));
  const row = { kind, elapsedMs: Math.round(performance.now() - started), outcome, diagnostics, passed: false }; report.push(row);
  try { assert.equal(outcome.status, 'completed'); assert.equal(outcome.verification?.verdict, kind === 'complete' ? 'pass' : 'fail'); assert(diagnostics.filter(item => item.event === 'request').every(item => item.role === 'verifier')); row.passed = true; }
  catch (error) { row.failure = error instanceof assert.AssertionError ? `ASSERTION:${error.operator}` : error.name; process.exitCode = 1; }
  console.log(JSON.stringify({ kind, elapsedMs: row.elapsedMs, verdict: outcome.status === 'completed' ? outcome.verification?.verdict : outcome.status, passed: row.passed }));
  await writeFile(`${directory}/verifier-report.json`, JSON.stringify(report, null, 2), { mode: 0o600 });
}
