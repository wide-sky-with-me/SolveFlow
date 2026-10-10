import { randomUUID } from 'node:crypto';
import { expect, it, vi } from 'vitest';
import { LocalEngine } from './local-engine.js';
import { LocalRepository, type LocalDocuments } from './local-repository.js';
import { makeSafeAgentError, type SolveOutcome } from '@solveflow/contracts/agent';
function setup() { const values = new Map<string, string>(); const documents: LocalDocuments = { async get(key) { return values.get(key) ?? null; }, async put(key, value) { values.set(key, value); }, async remove(key) { values.delete(key); }, async keys() { return [...values.keys()]; } }; const repository = new LocalRepository(documents); return { repository, values, engine: new LocalEngine(repository, randomUUID) }; }
it('keeps completed batch learning usable while other photos solve and new photos dispatch', async () => {
  const { engine, repository } = setup(); const batch = { id: randomUUID(), title: 'Synthetic batch', createdAt: new Date().toISOString(), exam: 'general' as const };
  const records = await Promise.all([1, 2, 3].map(position => engine.create('data:image/jpeg;base64,AQID', 30, 20, 'general', { ...batch, position })));
  const first = records[0]!;
  const answer: SolveOutcome = { schemaVersion: 1, status: 'completed', verified: false, verificationStatus: 'not_requested', warning: null, verification: null, candidate: { schemaVersion: 1, kind: 'answer', problem: { text: 'x+1=3', subject: 'math', uncertainties: [] }, answer: 'x=2', steps: [], knowledgePoints: [], citationIds: [], clarificationQuestions: [] } };
  await engine.start(first.session.id, '', undefined, async () => answer); await engine.waitForIdle();
  const source = (await repository.read(first.session.id)).session.runs[0]!;
  expect(source.status).toBe('completed');
  let release = () => {}; const hold = new Promise<void>(resolve => { release = resolve; });
  try {
    const second = await engine.start(records[1]!.session.id, '', undefined, async () => { await hold; return answer; });
    const steps = await engine.start(first.session.id, '步骤', { kind: 'explanation', sourceRunId: source.id }, async () => { await hold; return { ...answer, candidate: { ...answer.candidate, steps: [{ id: 's1', title: '两边减1', explanation: 'x=2' }] } }; });
    const knowledge = await engine.start(first.session.id, '知识点', { kind: 'knowledge-list', sourceRunId: source.id }, async () => { await hold; return { ...answer, candidate: { ...answer.candidate, knowledgePoints: ['等式性质'], knowledgeDetails: [{ name: '等式性质', explanation: '两边做相同运算', application: '两边减1' }] } }; });
    const third = await engine.start(records[2]!.session.id, '', undefined, async () => { await hold; return answer; });
    expect(engine.actives.map(run => run.id)).toEqual(expect.arrayContaining([second.id, steps.id, knowledge.id, third.id]));
    await expect(engine.start(first.session.id, '重复步骤', { kind: 'explanation', sourceRunId: source.id }, async () => answer)).rejects.toThrow('正在进行中');
    const cancelled = engine.cancelRun(steps.id); release(); await cancelled; await engine.waitForIdle();
    const saved = await repository.read(first.session.id);
    expect(saved.session.runs[0]).toEqual(source);
    expect(saved.session.runs.find(run => run.id === steps.id)?.status).toBe('cancelled');
    expect(saved.session.runs.find(run => run.id === knowledge.id)?.status).toBe('completed');
    expect((await repository.read(records[2]!.session.id)).session.runs[0]?.status).toBe('completed');
  } finally { release(); await engine.waitForIdle(); }
});
const failure = (id: string): SolveOutcome => ({ schemaVersion: 1, status: 'failed', verified: false, error: makeSafeAgentError('MODEL_UNAVAILABLE', id) });
it('does not create learning content against a candidate that can still be revised', async () => {
  const { engine, repository } = setup(); const record = await engine.create('data:image/jpeg;base64,AQID', 30, 20); const sourceId = randomUUID();
  record.session.runs.push({ schemaVersion: 1, id: sourceId, sessionId: record.session.id, createdAt: record.session.createdAt, status: 'verifying', message: '', seq: 1, outcome: { schemaVersion: 1, status: 'completed', verified: false, verificationStatus: 'pending', verification: null, warning: null, candidate: { schemaVersion: 1, kind: 'answer', problem: { text: 'x+1=3', subject: 'math', uncertainties: [] }, answer: 'x=2', steps: [], knowledgePoints: [], citationIds: [], clarificationQuestions: [] } } });
  await repository.save(record); const before = await repository.read(record.session.id); let calls = 0;
  for (const kind of ['explanation', 'knowledge-list'] as const) await expect(engine.start(record.session.id, '', { kind, sourceRunId: sourceId }, async input => { calls++; return failure(input.identity.runId); })).rejects.toThrow('等待本题校验或修正完成');
  expect(calls).toBe(0); expect(engine.actives).toEqual([]); expect(await repository.read(record.session.id)).toEqual(before);
});
it('keeps a durable answer when verification is interrupted without replaying models', async () => {
  const { repository, engine } = setup(); const record = await engine.create('data:image/jpeg;base64,AQID', 30, 20);
  record.session.runs.push({ schemaVersion: 1, id: randomUUID(), sessionId: record.session.id, createdAt: new Date().toISOString(), status: 'verifying', message: '', seq: 2,
    outcome: { schemaVersion: 1, status: 'completed', verified: false, verification: null, warning: null, verificationStatus: 'pending', candidate: { schemaVersion: 1, kind: 'answer', problem: { text: 'x+1=3', subject: 'math', uncertainties: [] }, answer: 'x=2', steps: [], knowledgePoints: [], citationIds: [], clarificationQuestions: [] } } });
  await repository.save(record); await repository.recoverInterrupted();
  const result = (await repository.read(record.session.id)).session.runs[0]!;
  expect(result).toMatchObject({ status: 'completed', outcome: { status: 'completed', candidate: { answer: 'x=2' }, verified: false, warning: 'WORKER_LOST' } });
  expect(engine.actives).toEqual([]);
});
it('persists a manually controlled stopwatch separately and removes it with its question', async () => {
  const { repository, engine, values } = setup(); const record = await engine.create('data:image/jpeg;base64,AQID', 30, 20);
  const scope = `${randomUUID()}:single`;
  expect(await repository.readStudyTimer(record.session.id, scope)).toEqual({ schemaVersion: 1, elapsedMs: 0, startedAt: null });
  await repository.saveStudyTimer(record.session.id, scope, { schemaVersion: 1, elapsedMs: 12345, startedAt: null });
  expect(await new LocalRepository({ async get(key) { return values.get(key) ?? null; }, async put() {}, async remove() {}, async keys() { return [...values.keys()]; } }).readStudyTimer(record.session.id, scope)).toMatchObject({ elapsedMs: 12345 });
  expect((await repository.read(record.session.id)).session.runs).toEqual([]);
  await engine.remove(record.session.id); expect([...values.keys()].some(key => key.startsWith('study-time.'))).toBe(false);
});
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

it.each(['explanation', 'knowledge-list', 'verification'] as const)(
  'rejects a missing saved source for %s before writing or reserving a slot',
  async kind => {
    const { repository, engine } = setup();
    const record = await engine.create('data:image/jpeg;base64,AQID', 30, 20);
    const save = vi.spyOn(repository, 'save');
    const execute = vi.fn(async () => failure(randomUUID()));

    await expect(engine.start(record.session.id, '', {
      kind,
      sourceRunId: randomUUID(),
    }, execute)).rejects.toThrow('INVALID_SAVED_CONTEXT');

    expect(save).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
    expect(engine.actives).toEqual([]);
    expect((await repository.read(record.session.id)).session.runs).toEqual([]);
  },
);
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
it('persists the exam with each photo and carries it through a reopened question and history export', async () => {
  const { repository, engine, values } = setup();
  const sat = await engine.create('data:image/jpeg;base64,AQID', 30, 20, 'sat');
  const ap = await engine.create('data:image/jpeg;base64,AQID', 30, 20, 'ap');
  const old = await engine.create('data:image/jpeg;base64,AQID', 30, 20);
  const { exam: _exam, ...legacy } = old; values.set(`record.${old.session.id}`, JSON.stringify(legacy));
  const reopened = new LocalEngine(repository, randomUUID);
  for (const [id, expected] of [[sat.session.id, 'sat'], [ap.session.id, 'ap'], [old.session.id, 'general']] as const) {
    await reopened.start(id, '', undefined, async input => { expect(input.exam).toBe(expected); return failure(input.identity.runId); }); await reopened.waitForIdle();
  }
  expect((await repository.read(sat.session.id)).exam).toBe('sat');
  const exported = []; for await (const line of repository.exportHistory(new AbortController().signal)) exported.push(line);
  expect(exported).toContainEqual(expect.objectContaining({ kind: 'question', record: expect.objectContaining({ exam: 'sat' }) }));
});

it.each([
  ['diagnostics', 'user'], ['record-read', 'user'], ['diagnostics', 'deadline'], ['record-read', 'deadline'],
] as const)('%s persistence preserves a concurrent %s cancellation', async (window, reason) => {
  const { engine, repository } = setup(); const record = await engine.create('data:image/jpeg;base64,AQID', 30, 20);
  let entered = false; let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  if (window === 'diagnostics') {
    const save = repository.saveDiagnostics.bind(repository);
    repository.saveDiagnostics = async (id, entries) => {
      if (entries.some(entry => entry.reason === 'failed')) { entered = true; await gate; }
      await save(id, entries);
    };
  } else {
    const read = repository.read.bind(repository); let reads = 0;
    repository.read = async id => { const record = await read(id); if (++reads === 2) { entered = true; await gate; } return record; };
  }
  const run = await engine.start(record.session.id, '', undefined, async input => failure(input.identity.runId));
  await expect.poll(() => entered).toBe(true);
  const cancelling = engine.cancelRun(run.id, reason); release(); await cancelling;
  expect((await repository.read(record.session.id)).session.runs[0]).toMatchObject({ status: reason === 'deadline' ? 'failed' : 'cancelled', outcome: { error: { code: reason === 'deadline' ? 'RUN_TIMEOUT' : 'CANCELLED' } } });
  expect(await repository.diagnostics(run.id)).toContainEqual(expect.objectContaining({ reason: reason === 'deadline' ? 'deadline' : 'cancelled' }));
  expect(engine.actives).toEqual([]);
});

it('rejects malformed saved image data before queuing a run or occupying the conversation slot', async () => {
  const { engine, repository } = setup();
  const damaged = await engine.create('data:image/jpeg;base64,AQID=', 30, 20);
  let calls = 0;
  await expect(engine.start(damaged.session.id, '', undefined, async input => { calls++; return failure(input.identity.runId); })).rejects.toThrow();
  expect(calls).toBe(0); expect(engine.actives).toEqual([]);
  expect((await repository.read(damaged.session.id)).session.runs).toEqual([]);
  const valid = await engine.create('data:image/jpeg;base64,AQID', 30, 20);
  await engine.start(valid.session.id, '', undefined, async input => failure(input.identity.runId)); await engine.waitForIdle();
});

it.each(['user', 'deadline'] as const)('corrects an in-flight terminal write once and preserves the first %s cancellation', async reason => {
  const { engine, repository } = setup(); const record = await engine.create('data:image/jpeg;base64,AQID', 30, 20);
  const save = repository.save.bind(repository); const releases: Array<() => void> = []; let terminalWrites = 0;
  repository.save = async value => {
    if (value.session.runs.at(-1)?.outcome) { terminalWrites++; await new Promise<void>(resolve => releases.push(resolve)); }
    await save(value);
  };
  const statuses: string[] = []; engine.subscribe(run => statuses.push(run.status));
  const answer: SolveOutcome = { schemaVersion: 1, status: 'completed', verified: false, verificationStatus: 'not_requested', verification: null, warning: null, candidate: { schemaVersion: 1, kind: 'answer', problem: { text: 'x+1=3', subject: 'math', uncertainties: [] }, answer: 'x=2', steps: [], knowledgePoints: [], citationIds: [], clarificationQuestions: [] } };
  const run = await engine.start(record.session.id, '', undefined, async () => answer);
  await expect.poll(() => terminalWrites).toBe(1);
  expect(engine.actives[0]?.status).toBe('queued'); // Batch stop must still recognize it as cancellable.
  const cancelling = engine.cancelRun(run.id, reason); releases[0]!();
  await expect.poll(() => terminalWrites).toBe(2);
  const duplicate = engine.cancel(reason === 'user' ? 'deadline' : 'user'); releases[1]!();
  await Promise.all([cancelling, duplicate]);
  const saved = await repository.read(record.session.id);
  expect(saved.session.runs[0]).toMatchObject({ status: reason === 'deadline' ? 'failed' : 'cancelled', outcome: { error: { code: reason === 'deadline' ? 'RUN_TIMEOUT' : 'CANCELLED' } } });
  expect(saved.session.subject).toBe('general'); expect(terminalWrites).toBe(2);
  expect(statuses).not.toContain('completed'); expect(engine.actives).toEqual([]);
});

it('preserves submission order and independent outcomes when the device clock moves backwards before a follow-up', async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  try {
    vi.setSystemTime(new Date('2026-09-22T01:00:10.000Z'));
    const { engine, repository } = setup(); const record = await engine.create('data:image/jpeg;base64,AQID', 30, 20);
    const answer: SolveOutcome = { schemaVersion: 1, status: 'completed', verified: false, verificationStatus: 'not_requested', verification: null, warning: null, candidate: { schemaVersion: 1, kind: 'answer', problem: { text: 'x+1=3', subject: 'math', uncertainties: [] }, answer: 'x=2', steps: [], knowledgePoints: [], citationIds: [], clarificationQuestions: [] } };
    const first = await engine.start(record.session.id, '', undefined, async () => answer); await engine.waitForIdle();
    vi.setSystemTime(new Date('2026-09-22T01:00:08.000Z'));
    const events: Array<{ id: string; status: string; outcome: SolveOutcome | null }> = [];
    engine.subscribe(run => events.push({ id: run.id, status: run.status, outcome: run.outcome }));
    const followUp = await engine.start(record.session.id, '解释这个结论', { kind: 'reply', sourceRunId: first.id }, async (input, signal, emit) => {
      emit({ schemaVersion: 1, type: 'run.status', runId: input.identity.runId, status: 'solving' });
      await new Promise<void>(resolve => { if (signal.aborted) resolve(); else signal.addEventListener('abort', () => resolve(), { once: true }); });
      return answer;
    });
    expect(followUp.createdAt < first.createdAt).toBe(true);
    const pending = (await repository.read(record.session.id)).session.runs;
    expect(pending.map(run => run.id)).toEqual([first.id, followUp.id]);
    expect(pending[0]?.outcome).toEqual(answer); expect(pending[1]?.outcome).toBeNull();
    expect(engine.actives).toMatchObject([{ id: followUp.id, status: 'solving', outcome: null }]);
    expect(events).toEqual([{ id: followUp.id, status: 'queued', outcome: null }, { id: followUp.id, status: 'solving', outcome: null }]);
    await engine.cancelRun(followUp.id);
    const saved = (await repository.read(record.session.id)).session.runs;
    expect(saved.map(run => run.id)).toEqual([first.id, followUp.id]);
    expect(saved[0]?.outcome).toEqual(answer); expect(saved[1]?.outcome?.status).toBe('cancelled');
  } finally { vi.useRealTimers(); }
});

it('counts conversation and auxiliary attempts separately while bounding both', async () => {
  const { repository, engine } = setup(); const record = await engine.create('data:image/jpeg;base64,AQID', 30, 20);
  const root = randomUUID();
  record.session.runs = Array.from({ length: 10 }, (_, i) => ({ schemaVersion: 1, id: i ? randomUUID() : root, sessionId: record.session.id, status: 'failed', createdAt: record.session.createdAt, message: '', seq: 1, outcome: failure(root), ...(i ? { context: { kind: 'explanation' as const, sourceRunId: root } } : {}) }));
  await repository.save(record);
  await expect(engine.start(record.session.id, '继续追问', undefined, async input => failure(input.identity.runId))).resolves.toBeDefined();
  await engine.waitForIdle();
  expect((await repository.read(record.session.id)).session.runs).toHaveLength(11);
});

it.each(['conversation', 'auxiliary'] as const)('enforces the separate %s cap before issuing a model request', async kind => {
  const { repository, engine } = setup(); const record = await engine.create('data:image/jpeg;base64,AQID', 30, 20); const root = randomUUID();
  const count = kind === 'conversation' ? 10 : 31;
  record.session.runs = Array.from({ length: count }, (_, i) => ({ schemaVersion: 1, id: i ? randomUUID() : root, sessionId: record.session.id, status: 'failed', createdAt: record.session.createdAt, message: '', seq: 1, outcome: failure(root), ...(kind === 'auxiliary' && i ? { context: { kind: 'explanation' as const, sourceRunId: root } } : {}) }));
  await repository.save(record); const execute = vi.fn(async () => failure(root));
  await expect(engine.start(record.session.id, '', kind === 'auxiliary' ? { kind: 'explanation', sourceRunId: root } : undefined, execute)).rejects.toThrow(kind === 'conversation' ? '10轮' : '30次');
  expect(execute).not.toHaveBeenCalled(); expect((await repository.read(record.session.id)).session.runs).toHaveLength(count);
});

it.each(['esat', 'tmua', 'tara'] as const)('preserves %s for batch snapshots, reopened requests and exported records', async exam => {
  const { repository, engine } = setup();
  const batch = { id: randomUUID(), title: '考试快照回归', exam, position: 1, createdAt: new Date().toISOString() };
  const saved = await engine.create('data:image/jpeg;base64,AQID', 30, 20, exam, batch);
  const reopened = new LocalEngine(repository, randomUUID);
  await reopened.start(saved.session.id, '', undefined, async input => { expect(input.exam).toBe(exam); expect(input.verificationMode).toBe('automatic'); return failure(input.identity.runId); });
  await reopened.waitForIdle();
  expect(await repository.read(saved.session.id)).toMatchObject({ exam, batch: { exam } });
  const rows = []; for await (const row of repository.exportHistory({ aborted: false })) rows.push(row);
  expect(rows).toContainEqual(expect.objectContaining({ kind: 'question', record: expect.objectContaining({ exam, batch: expect.objectContaining({ exam }) }) }));
});

const reviewCandidate = { schemaVersion: 1 as const, kind: 'answer' as const, problem: { text: 'x+1=3', subject: 'math' as const, uncertainties: [] }, answer: 'x=3', steps: [], knowledgePoints: [], citationIds: [], clarificationQuestions: [] };
const reviewFailure: SolveOutcome = { schemaVersion: 1, status: 'completed', candidate: reviewCandidate, verified: false, warning: null, verification: { schemaVersion: 1, verdict: 'fail', checked: ['transcription', 'arithmetic'], issues: [{ code: 'ARITHMETIC', message: 'The value does not satisfy the equation.' }] } };
async function reviewSource() {
  const state = setup(); const record = await state.engine.create('data:image/jpeg;base64,AQID', 30, 20);
  const source = await state.engine.start(record.session.id, '', undefined, async () => ({ ...reviewFailure, verification: null, verificationStatus: 'not_requested' }));
  await state.engine.waitForIdle(); return { ...state, record, source };
}
it('automatically takes over a failed manual check once in a new version, without marking the old answer correct', async () => {
  const { engine, repository, record, source } = await reviewSource(); let calls = 0;
  await engine.startVerification(record.session.id, '', { kind: 'verification', sourceRunId: source.id }, async input => {
    calls++;
    if (input.verificationTarget) return reviewFailure;
    expect(input.useBackup).toBe(true); expect(input.focus?.kind).toBe('regenerate');
    expect([...input.image.bytes]).toEqual([1, 2, 3]);
    // A second failed check is terminal and cannot trigger another automatic run.
    return { ...reviewFailure, candidate: { ...reviewCandidate, answer: 'x=2' } };
  });
  await vi.waitFor(async () => expect((await repository.readMetadata(record.session.id)).session.runs).toHaveLength(3));
  await engine.waitForIdle(); const saved = (await repository.readMetadata(record.session.id)).session.runs;
  expect(calls).toBe(2); expect(saved[0]?.outcome).toMatchObject({ candidate: { answer: 'x=3' }, verified: false });
  expect(saved[1]?.outcome).toMatchObject({ candidate: { answer: 'x=3' }, verification: { verdict: 'fail' } });
  expect(saved[2]?.outcome).toMatchObject({ candidate: { answer: 'x=2' }, verified: false });
});
it.each(['pass', 'unknown'] as const)('does not start a backup for a manual %s review', async verdict => {
  const { engine, repository, record, source } = await reviewSource(); let calls = 0;
  await engine.startVerification(record.session.id, '', { kind: 'verification', sourceRunId: source.id }, async () => {
    calls++; return { ...reviewFailure, verified: verdict === 'pass', verification: { schemaVersion: 1, verdict, checked: ['transcription', 'arithmetic'], issues: verdict === 'pass' ? [] : [{ code: 'INSUFFICIENT_EVIDENCE', message: 'Not enough evidence.' }] } };
  });
  await engine.waitForIdle(); await new Promise(resolve => setTimeout(resolve, 0));
  expect(calls).toBe(1); expect((await repository.readMetadata(record.session.id)).session.runs).toHaveLength(2);
});
it.each(['cancel', 'delete', 'settings'] as const)('suppresses pending manual takeover after %s even if a late check says FAIL', async action => {
  const { engine, repository, record, source } = await reviewSource(); let calls = 0; let release = () => {};
  const gate = new Promise<void>(resolve => { release = resolve; });
  await engine.startVerification(record.session.id, '', { kind: 'verification', sourceRunId: source.id }, async () => { calls++; await gate; return reviewFailure; });
  await vi.waitFor(() => expect(calls).toBe(1));
  const ending = action === 'delete' ? engine.remove(record.session.id) : action === 'cancel' ? engine.cancel() : Promise.resolve(engine.invalidatePendingCorrections());
  release(); await ending; await engine.waitForIdle(); await new Promise(resolve => setTimeout(resolve, 0));
  expect(calls).toBe(1);
  if (action === 'delete') expect(await repository.list()).toEqual([]);
  else expect((await repository.readMetadata(record.session.id)).session.runs).toHaveLength(2);
});
it('never starts the manual correction when the failed review could not be saved', async () => {
  const { engine, repository, record, source } = await reviewSource(); let calls = 0; const errors: string[] = [];
  engine.onError(message => errors.push(message));
  const save = repository.save.bind(repository); let writes = 0;
  vi.spyOn(repository, 'save').mockImplementation(async value => { if (++writes === 2) throw new Error('synthetic disk full'); await save(value); });
  await engine.startVerification(record.session.id, '', { kind: 'verification', sourceRunId: source.id }, async () => { calls++; return reviewFailure; });
  await engine.waitForIdle(); await new Promise(resolve => setTimeout(resolve, 0));
  expect(calls).toBe(1); expect(engine.storageBlocked).toBe(true); expect(errors.some(message => message.includes('备用自动解答未能启动'))).toBe(true);
  await engine.retryPendingSaves(); await new Promise(resolve => setTimeout(resolve, 0));
  expect(calls).toBe(1); expect((await repository.readMetadata(record.session.id)).session.runs).toHaveLength(2);
});
it('takes over the selected question even when another question on the same photo has a newer answer', async () => {
  const { engine, repository, record, source } = await reviewSource();
  const saved = await repository.read(record.session.id);
  saved.session.runs[0]!.outcome = { ...reviewFailure, candidate: { ...reviewCandidate, questions: [1, 2].map(number => ({ number, problem: reviewCandidate.problem, answer: 'x=3', stepIds: [], figureIds: [] })) } };
  await repository.save(saved);
  await engine.start(record.session.id, 'Question two', { kind: 'question', sourceRunId: source.id, number: 2 }, async () => reviewFailure); await engine.waitForIdle();
  let calls = 0;
  await engine.startVerification(record.session.id, '', { kind: 'verification', sourceRunId: source.id, number: 1 }, async input => {
    calls++; if (!input.verificationTarget) { expect(input.focus?.content).toContain('只重新完整解答第1题'); expect(input.useBackup).toBe(true); }
    return reviewFailure;
  });
  await vi.waitFor(() => expect(calls).toBe(2)); await engine.waitForIdle();
  const corrected = (await repository.readMetadata(record.session.id)).session.runs.at(-1);
  expect(corrected?.context).toMatchObject({ kind: 'regenerate', number: 1 });
  expect(corrected?.outcome).toMatchObject({ status: 'completed', verification: { verdict: 'fail' } });
});
it('captures takeover permission before admission so revocation during the queued write still wins', async () => {
  const { engine, repository, record, source } = await reviewSource(); let calls = 0; let writing = false; let release = () => {};
  const gate = new Promise<void>(resolve => { release = resolve; }); const save = repository.save.bind(repository);
  vi.spyOn(repository, 'save').mockImplementationOnce(async value => { writing = true; await gate; await save(value); });
  const accepted = engine.startVerification(record.session.id, '', { kind: 'verification', sourceRunId: source.id }, async () => { calls++; return reviewFailure; });
  await vi.waitFor(() => expect(writing).toBe(true)); engine.invalidatePendingCorrections(); release(); await accepted;
  await engine.waitForIdle(); await new Promise(resolve => setTimeout(resolve, 0));
  expect(calls).toBe(1); expect((await repository.readMetadata(record.session.id)).session.runs).toHaveLength(2);
});
it('persists one overall stopwatch without a question and keeps it across clearing question history', async () => {
  const { repository, engine, values } = setup();
  expect(await repository.readOverallStudyTimer()).toEqual({ schemaVersion: 1, elapsedMs: 0, startedAt: null });
  await repository.saveOverallStudyTimer({ schemaVersion: 1, elapsedMs: 12345, startedAt: null });
  const record = await engine.create('data:image/jpeg;base64,AQID', 30, 20);
  await repository.saveStudyTimer(record.session.id, `${record.session.id}:single`, { schemaVersion: 1, elapsedMs: 9000, startedAt: null });
  await engine.removeAll();
  expect(await repository.readOverallStudyTimer()).toMatchObject({ elapsedMs: 12345 });
  const reopened = new LocalRepository({ async get(key) { return values.get(key) ?? null; }, async put(key, value) { values.set(key, value); }, async remove(key) { values.delete(key); }, async keys() { return [...values.keys()]; } });
  expect(await reopened.readOverallStudyTimer()).toMatchObject({ elapsedMs: 12345 });
  await reopened.saveOverallStudyTimer({ schemaVersion: 1, elapsedMs: 0, startedAt: null });
  expect(await repository.readOverallStudyTimer()).toMatchObject({ elapsedMs: 0 });
});
it('preserves a damaged overall stopwatch until an explicit reset', async () => {
  const { repository, values } = setup(); values.set('study-time.overall', '{damaged');
  await expect(repository.readOverallStudyTimer()).rejects.toThrow('部分本地记录无法读取');
  expect(values.get('study-time.overall')).toBe('{damaged');
  await repository.saveOverallStudyTimer({ schemaVersion: 1, elapsedMs: 0, startedAt: null });
  expect(await repository.readOverallStudyTimer()).toMatchObject({ elapsedMs: 0 });
});
