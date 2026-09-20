import { randomUUID } from 'node:crypto';
import { expect, it } from 'vitest';
import { LocalEngine } from './local-engine.js';
import { LocalRepository, type LocalDocuments } from './local-repository.js';
import { makeSafeAgentError, type SolveOutcome } from '@solveflow/contracts/agent';
function setup() { const values = new Map<string, string>(); const documents: LocalDocuments = { async get(key) { return values.get(key) ?? null; }, async put(key, value) { values.set(key, value); }, async remove(key) { values.delete(key); }, async keys() { return [...values.keys()]; } }; const repository = new LocalRepository(documents); return { repository, values, engine: new LocalEngine(repository, randomUUID) }; }
const failure = (id: string): SolveOutcome => ({ schemaVersion: 1, status: 'failed', verified: false, error: makeSafeAgentError('MODEL_UNAVAILABLE', id) });
it('persists a local photo and terminal run without a server', async () => {
  const { repository, engine } = setup(); const record = await engine.create('data:image/jpeg;base64,AQID', 30, 20);
  await engine.start(record.session.id, '题目', undefined, async input => failure(input.identity.runId)); await engine.waitForIdle();
  const saved = await repository.read(record.session.id); expect(saved.image).toBe(record.image); expect(saved.session.runs[0]?.status).toBe('failed');
  await engine.remove(record.session.id); expect(await repository.list()).toEqual([]);
});
it('blocks double submission and gives cancellation precedence over a late result', async () => {
  const { repository, engine } = setup(); const record = await engine.create('data:image/jpeg;base64,AQID', 30, 20);
  let finish: (() => void) | undefined;
  const waiting = new Promise<void>(resolve => { finish = resolve; }); let dispatches = 0;
  await engine.start(record.session.id, '', undefined, async input => { dispatches++; await waiting; return failure(input.identity.runId); });
  await expect(engine.start(record.session.id, '', undefined, async input => failure(input.identity.runId))).rejects.toThrow();
  const cancelled = engine.cancel(); finish?.(); await cancelled;
  expect(dispatches).toBe(1); expect((await repository.read(record.session.id)).session.runs[0]?.status).toBe('cancelled');
});
it('marks process interruption failed on reopen, never replays a paid request', async () => {
  const { repository, engine } = setup(); const record = await engine.create('data:image/jpeg;base64,AQID', 30, 20);
  record.session.runs.push({ schemaVersion: 1, id: randomUUID(), sessionId: record.session.id, createdAt: new Date().toISOString(), status: 'solving', message: '', outcome: null, seq: 0 }); await repository.save(record);
  await repository.recoverInterrupted(); expect((await repository.read(record.session.id)).session.runs[0]).toMatchObject({ status: 'failed', outcome: { error: { code: 'WORKER_LOST' } } });
});
it('does not call a model if saving the queued task fails', async () => {
  const { repository, engine } = setup(); const record = await engine.create('data:image/jpeg;base64,AQID', 30, 20);
  repository.save = async () => { throw new Error('disk full'); }; let calls = 0;
  await expect(engine.start(record.session.id, '', undefined, async input => { calls++; return failure(input.identity.runId); })).rejects.toThrow('disk full'); expect(calls).toBe(0);
});
it('keeps favorites across stale solver writes, restart and cancellation, and removes metadata with the record', async () => {
  const { repository, engine, values } = setup(); const record = await engine.create('data:image/jpeg;base64,AQID', 30, 20);
  expect((await repository.list())[0]?.favorite).toBe(false);
  let release = () => {}; const gate = new Promise<void>(resolve => { release = resolve; });
  await engine.start(record.session.id, '', undefined, async input => { await gate; return failure(input.identity.runId); });
  await repository.setFavorite(record.session.id, true);
  release(); await engine.waitForIdle();
  expect((await repository.list())[0]?.favorite).toBe(true);
  await repository.save(record); // Older copies of a question cannot overwrite bookmarks.
  expect((await repository.list())[0]?.favorite).toBe(true);
  await repository.setFavorite(record.session.id, false);
  expect((await repository.list())[0]?.favorite).toBe(false);
  await repository.setFavorite(record.session.id, true);
  await engine.remove(record.session.id);
  expect(await repository.list()).toEqual([]);
  expect(values.has(`favorite.${record.session.id}`)).toBe(false);
  await expect(repository.setFavorite(record.session.id, true)).rejects.toThrow();
});
it('appends a fresh regeneration run with the same photo and keeps old answers after failure or cancellation', async () => {
  const { repository, engine } = setup(); const record = await engine.create('data:image/jpeg;base64,AQID', 30, 20);
  const completed: SolveOutcome = { schemaVersion: 1, status: 'completed', verified: true, warning: null, verification: { schemaVersion: 1, verdict: 'pass', checked: ['transcription'], issues: [] }, candidate: { schemaVersion: 1, kind: 'answer', problem: { text: 'x+1=3', subject: 'math', uncertainties: [] }, answer: 'x=2', steps: [{ id: 's1', title: '移项', explanation: '两边减1' }], knowledgePoints: [], citationIds: [], clarificationQuestions: [] } };
  await engine.start(record.session.id, '原题', undefined, async () => completed); await engine.waitForIdle();
  const original = (await repository.read(record.session.id)).session.runs[0]!;
  let calls = 0;
  const context = { kind: 'regenerate' as const, sourceRunId: original.id };
  await engine.start(record.session.id, '重新完整解答', context, async input => { calls++; expect([...input.image.bytes]).toEqual([1, 2, 3]); expect(input.focus?.content).toContain('重新完整解答本题'); return failure(input.identity.runId); });
  await engine.waitForIdle();
  const saved = await repository.read(record.session.id);
  expect(saved.session.runs).toHaveLength(2); expect(saved.session.runs[0]).toEqual(original);
  expect(saved.session.runs[1]).toMatchObject({ status: 'failed', context }); expect(calls).toBe(1);
  await expect(engine.start(record.session.id, '', { kind: 'regenerate', sourceRunId: randomUUID() }, async () => { calls++; return completed; })).rejects.toThrow('INVALID_SAVED_CONTEXT');
  expect(calls).toBe(1);
  let release = () => {}; const gate = new Promise<void>(resolve => { release = resolve; });
  await engine.start(record.session.id, '重新完整解答', context, async () => { await gate; return completed; });
  const cancelling = engine.cancel(); release(); await cancelling;
  const cancelled = await repository.read(record.session.id); expect(cancelled.session.runs[0]).toEqual(original); expect(cancelled.session.runs.at(-1)?.status).toBe('cancelled');
});

it('starts background protection before dispatch and releases it after persistence, with diagnostics removed alongside the question', async () => {
  const { repository, values } = setup(); const order: string[] = [];
  const engine = new LocalEngine(repository, randomUUID, { async start() { order.push('start'); }, async stop() { order.push('stop'); expect([...values.values()].some(value => value.includes('MODEL_UNAVAILABLE'))).toBe(true); } });
  const record = await engine.create('data:image/jpeg;base64,AQID', 30, 20);
  const run = await engine.start(record.session.id, '', undefined, async (input, _signal, _event, diagnostic) => { order.push('model'); diagnostic({ schemaVersion: 1, runId: input.identity.runId, role: 'solver', event: 'response', attempt: 1, elapsedMs: 1, httpStatus: 503 }); return failure(input.identity.runId); });
  await engine.waitForIdle(); expect(order).toEqual(['start', 'model', 'stop']);
  expect(await repository.diagnostics(run.id)).toContainEqual(expect.objectContaining({ httpStatus: 503 }));
  await engine.remove(record.session.id); expect(await repository.diagnostics(run.id)).toEqual([]);
});
it('native deadline persists timeout rather than user cancellation, and background startup failure makes no model call', async () => {
  const { repository } = setup(); let calls = 0; let release = () => {};
  const engine = new LocalEngine(repository, randomUUID, { async start() {}, async stop() {} });
  const record = await engine.create('data:image/jpeg;base64,AQID', 30, 20);
  await engine.start(record.session.id, '', undefined, async input => { calls++; await new Promise<void>(resolve => { release = resolve; }); return failure(input.identity.runId); });
  await new Promise(resolve => setTimeout(resolve, 0));
  const cancel = engine.cancel('deadline'); release(); await cancel;
  expect((await repository.read(record.session.id)).session.runs.at(-1)?.outcome).toMatchObject({ status: 'failed', error: { code: 'RUN_TIMEOUT' } });
  const failed = new LocalEngine(repository, randomUUID, { async start() { throw new Error('not allowed'); }, async stop() {} });
  await failed.start(record.session.id, '', undefined, async input => { calls++; return failure(input.identity.runId); }); await failed.waitForIdle(); expect(calls).toBe(1);
});

it('requests brief answers first and resolves a separate explanation against the saved question', async () => {
  const { repository, engine } = setup(); const record = await engine.create('data:image/jpeg;base64,AQID', 30, 20);
  const answer: SolveOutcome = { schemaVersion: 1, status: 'completed', verified: true, warning: null, verification: { schemaVersion: 1, verdict: 'pass', checked: ['transcription', 'arithmetic'], issues: [] }, candidate: { schemaVersion: 1, kind: 'answer', problem: { text: 'x+1=3', subject: 'math', uncertainties: [] }, answer: 'x=2', steps: [], knowledgePoints: ['等式性质'], citationIds: [], clarificationQuestions: [] } };
  await engine.start(record.session.id, '求解', undefined, async input => { expect(input.answerMode).toBe('brief'); return answer; }); await engine.waitForIdle();
  const source = (await repository.read(record.session.id)).session.runs[0]!;
  await engine.start(record.session.id, '查看详细步骤', { kind: 'explanation', sourceRunId: source.id }, async input => {
    expect(input.answerMode).toBe('detailed'); expect(input.focus?.kind).toBe('explanation'); expect(input.focus?.content).toContain('x+1=3');
    return { ...answer, candidate: { ...answer.candidate, steps: [{ id: 's1', title: '两边减1', explanation: 'x=3-1=2' }] } };
  }); await engine.waitForIdle();
  expect((await repository.read(record.session.id)).session.runs[0]).toEqual(source);
  let dispatched = false;
  await expect(engine.start(record.session.id, '查看详细步骤', { kind: 'explanation', sourceRunId: source.id }, async () => { dispatched = true; return answer; })).rejects.toThrow('EXPLANATION_ALREADY_SAVED');
  expect(dispatched).toBe(false);
});

it('manual verification uses the saved candidate and caches its result without overwriting the answer', async () => {
  const { engine, repository } = setup(); const record = await engine.create('data:image/jpeg;base64,AQID', 30, 20);
  const original: SolveOutcome = { schemaVersion: 1, status: 'completed', verified: false, verificationStatus: 'not_requested', verification: null, warning: null, candidate: { schemaVersion: 1, kind: 'answer', problem: { text: 'x+1=3', subject: 'math', uncertainties: [] }, answer: '**x=2**', steps: [], knowledgePoints: [], citationIds: [], clarificationQuestions: [] } };
  await engine.start(record.session.id, '求解', undefined, async input => { expect(input.verificationMode).toBe('manual'); return original; }); await engine.waitForIdle();
  const source = (await repository.read(record.session.id)).session.runs[0]!;
  const context = { kind: 'verification' as const, sourceRunId: source.id };
  await engine.start(record.session.id, '校验', context, async input => { expect(input.verificationTarget).toEqual(original.candidate); return { schemaVersion: 1, status: 'completed', candidate: original.candidate, verified: true, warning: null, verification: { schemaVersion: 1, verdict: 'pass', checked: ['transcription', 'arithmetic'], issues: [] } }; }); await engine.waitForIdle();
  const saved = await repository.read(record.session.id); expect(saved.session.runs[0]).toEqual(source); expect(saved.session.runs[1]?.outcome?.verified).toBe(true);
  await expect(engine.start(record.session.id, '校验', context, async () => original)).rejects.toThrow('VERIFICATION_ALREADY_SAVED');
});

it('runs on-demand steps and knowledge beside each other while the conversation slot stays exclusive', async () => {
  const { repository, engine } = setup(); const record = await engine.create('data:image/jpeg;base64,AQID', 30, 20);
  const answer: SolveOutcome = { schemaVersion: 1, status: 'completed', verified: false, verificationStatus: 'not_requested', verification: null, warning: null, candidate: { schemaVersion: 1, kind: 'answer', problem: { text: 'x+1=3', subject: 'math', uncertainties: [] }, answer: '**x=2**', steps: [], knowledgePoints: [], citationIds: [], clarificationQuestions: [] } };
  await engine.start(record.session.id, '求解', undefined, async () => answer); await engine.waitForIdle();
  const source = (await repository.read(record.session.id)).session.runs[0]!;
  const gates: Array<() => void> = []; const started: string[] = [];
  const hold = () => new Promise<void>(resolve => { gates.push(resolve); });
  const steps = engine.start(record.session.id, '查看详细步骤', { kind: 'explanation', sourceRunId: source.id }, async () => { started.push('explanation'); await hold(); return { ...answer, candidate: { ...answer.candidate, steps: [{ id: 's1', title: '两边减1', explanation: 'x=2' }] } }; });
  const knowledge = engine.start(record.session.id, '查看知识点', { kind: 'knowledge-list', sourceRunId: source.id }, async input => { started.push('knowledge-list'); expect(input.answerMode).toBe('detailed'); expect(input.focus?.kind).toBe('knowledge-list'); await hold(); return { ...answer, candidate: { ...answer.candidate, knowledgePoints: ['等式性质'], knowledgeDetails: [{ name: '等式性质', explanation: '两边同减同一个数仍相等', application: '两边减1' }] } }; });
  await expect.poll(() => started.length, { timeout: 3000 }).toBe(2);
  expect(engine.actives).toHaveLength(2);
  await expect(engine.start(record.session.id, '查看知识点', { kind: 'knowledge-list', sourceRunId: source.id }, async () => answer)).rejects.toThrow('该按需请求正在进行中。');
  await expect(engine.start(record.session.id, '继续追问', undefined, async () => answer)).rejects.toThrow('本题已有进行中的任务。');
  for (const release of gates) release();
  await Promise.all([steps, knowledge]); await engine.waitForIdle();
  const saved = await repository.read(record.session.id);
  expect(saved.session.runs.map(run => run.status)).toEqual(['completed', 'completed', 'completed']);
  expect(saved.session.runs[0]).toEqual(source);
  expect(saved.session.runs[2]?.outcome).toMatchObject({ status: 'completed', candidate: { knowledgePoints: ['等式性质'] } });
  expect(engine.actives).toEqual([]);
});
