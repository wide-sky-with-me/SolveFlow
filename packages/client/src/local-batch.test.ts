import { randomUUID } from 'node:crypto';
import { expect, it } from 'vitest';
import type { SolveOutcome } from '@solveflow/contracts/agent';
import { LocalBatchSchema, type LocalConcurrency, type LocalRecord } from '@solveflow/contracts/local';
import { LocalEngine, type DeviceSolve } from './local-engine.js';
import { LocalBatchQueue } from './local-batch.js';
import { LocalRepository } from './local-repository.js';
function setup(concurrency: LocalConcurrency = { solver: 3, verifier: 1 }) {
  const values = new Map<string, string>();
  const repository = new LocalRepository({ async get(key) { return values.get(key) ?? null; }, async put(key, value) { values.set(key, value); }, async remove(key) { values.delete(key); }, async keys() { return [...values.keys()]; } });
  const engine = new LocalEngine(repository, randomUUID); engine.configureConcurrency(concurrency); const queue = new LocalBatchQueue(engine);
  const batch = { id: randomUUID(), title: 'SAT practice', createdAt: new Date().toISOString(), exam: 'sat' as const };
  const create = (position: number) => engine.create('data:image/jpeg;base64,AQID', 30, 20, 'sat', { ...batch, position });
  return { repository, engine, queue, batch, create };
}
function answer(number: string): SolveOutcome { return { schemaVersion: 1, status: 'completed', verified: true, warning: null, verification: { schemaVersion: 1, verdict: 'pass', checked: ['transcription'], issues: [] }, candidate: { schemaVersion: 1, kind: 'answer', problem: { text: `question ${number}`, sourceNumber: number, subject: 'math', uncertainties: [] }, answer: number, steps: [], knowledgePoints: [], citationIds: [], clarificationQuestions: [] } }; }
it('retries a failed batch request with its context while another answer awaits verification, without duplicate dispatch', async () => {
  const { create, queue, engine, repository } = setup({ solver: 1, verifier: 1 });
  const first = await create(1); const other = await create(2);
  const initial = await engine.start(first.session.id, '', undefined, async () => answer('1')); await engine.waitForRun(initial.id);
  const context = { kind: 'regenerate' as const, sourceRunId: initial.id, useBackup: true as const };
  const failed = await engine.start(first.session.id, '使用指定备用重新解答', context, async () => ({ schemaVersion: 1, status: 'failed', verified: false, error: { code: 'MODEL_TIMEOUT', message: 'fixture timeout', retryable: true, traceId: randomUUID() } }));
  await engine.waitForRun(failed.id);
  let checking = false; let release = () => {}; let retries = 0;
  await queue.enqueue(other.session.id, async (input, _signal, _event, _diagnostic, lifecycle) => {
    const outcome = answer('2'); if (outcome.status !== 'completed' || !lifecycle) throw new Error('missing lifecycle');
    await lifecycle.candidate(outcome.candidate); const done = await lifecycle.verification();
    try { checking = true; await new Promise<void>(resolve => { release = resolve; }); return outcome; } finally { await done(); }
  });
  try {
    await expect.poll(() => checking).toBe(true);
    const retry: DeviceSolve = async input => { retries++; expect(input.useBackup).toBe(true); expect(input.message).toBe('使用指定备用重新解答'); return answer('1'); };
    await Promise.all([queue.enqueue(first.session.id, retry, true), queue.enqueue(first.session.id, retry, true)]);
    await expect.poll(async () => (await repository.read(first.session.id)).session.runs.at(-1)?.status).toBe('completed');
    expect(retries).toBe(1); expect(queue.busy).toBe(true); expect(engine.actives.some(run => run.sessionId === other.session.id)).toBe(true);
    expect((await repository.read(first.session.id)).session.runs.at(-1)?.context).toEqual(context);
  } finally { release(); await queue.waitForIdle(); }
});
it('queues a failed retry behind occupied solver slots and rejects retrying a stale failure after success', async () => {
  const { create, queue, engine, repository } = setup({ solver: 1, verifier: 1 });
  const first = await create(1); const other = await create(2);
  const failure = await engine.start(first.session.id, '', undefined, async () => ({ schemaVersion: 1, status: 'failed', verified: false, error: { code: 'MODEL_TIMEOUT', message: 'fixture', retryable: true, traceId: randomUUID() } }));
  await engine.waitForRun(failure.id);
  let solving = false; let release = () => {}; let retries = 0;
  await queue.enqueue(other.session.id, async () => { solving = true; await new Promise<void>(resolve => { release = resolve; }); return answer('2'); });
  try {
    await expect.poll(() => solving).toBe(true);
    await Promise.all(Array.from({ length: 3 }, () => queue.enqueue(first.session.id, async () => { retries++; return answer('1'); }, true, undefined, failure.id)));
    expect(queue.ids.filter(id => id === first.session.id)).toHaveLength(1); expect(retries).toBe(0);
    expect((await repository.read(first.session.id)).session.runs).toHaveLength(1);
    release(); await queue.waitForIdle(); expect(retries).toBe(1);
    await expect(queue.enqueue(first.session.id, async () => { retries++; return answer('1'); }, true, undefined, failure.id)).rejects.toThrow('已有作答');
    expect(retries).toBe(1);
  } finally { release(); await queue.waitForIdle(); }
});
it('limits five photos to three concurrent automatic solves, keeps capture order and never dispatches duplicate IDs', async () => {
  const { create, queue, repository } = setup(); const records: LocalRecord[] = [];
  for (let i = 1; i <= 5; i++) records.push(await create(i));
  const gates = new Map<string, () => void>(); let running = 0; let maximum = 0; let calls = 0;
  const execute: DeviceSolve = async input => { calls++; running++; maximum = Math.max(maximum, running); expect(input.verificationMode).toBe('automatic'); expect(input.exam).toBe('sat'); await new Promise<void>(resolve => gates.set(input.identity.sessionId, resolve)); running--; return answer(input.identity.sessionId === records[0]!.session.id ? '19' : '7'); };
  await Promise.all([...records, records[0]!].map(record => queue.enqueue(record.session.id, execute)));
  await expect.poll(() => gates.size).toBe(3); expect(calls).toBe(3);
  gates.get(records[2]!.session.id)!(); await expect.poll(() => gates.size).toBe(4);
  gates.get(records[1]!.session.id)!(); await expect.poll(() => gates.size).toBe(5);
  for (const release of gates.values()) release(); await queue.waitForIdle();
  expect(maximum).toBe(3); expect(calls).toBe(5);
  const summaries = (await repository.listHistory()).sort((a, b) => a.batch!.position - b.batch!.position);
  expect(summaries.map(row => row.id)).toEqual(records.map(row => row.session.id)); expect(summaries[0]!.text).toContain('原题号 19');
  await expect(queue.enqueue(records[0]!.session.id, execute, true)).rejects.toThrow('已有作答');
});
it('cancels one active photo independently, stops queued photos, and requires explicit restart after recovery', async () => {
  const { create, queue, engine, repository } = setup(); const records: LocalRecord[] = [];
  for (let i = 1; i <= 5; i++) records.push(await create(i));
  const signals: AbortSignal[] = [];
  const execute: DeviceSolve = async (_input, signal) => { signals.push(signal); await new Promise<void>(resolve => signal.addEventListener('abort', () => resolve(), { once: true })); return answer('19'); };
  for (const record of records) await queue.enqueue(record.session.id, execute);
  await expect.poll(() => signals.length).toBe(3);
  await engine.cancelRun(engine.actives[0]!.id); await expect.poll(() => signals.length).toBe(4);
  expect(signals[1]!.aborted).toBe(false); expect(signals[2]!.aborted).toBe(false);
  await queue.stop(); expect(signals).toHaveLength(4); expect(queue.busy).toBe(false);
  expect((await repository.read(records[4]!.session.id)).session.runs).toHaveLength(0);
  expect((await repository.read(records[0]!.session.id)).session.runs[0]!.status).toBe('cancelled');
  await repository.recoverInterrupted(); const reopened = new LocalBatchQueue(new LocalEngine(repository, randomUUID)); await reopened.waitForIdle(); expect(signals).toHaveLength(4);
  await expect(reopened.enqueue(records[0]!.session.id, async () => answer('19'))).rejects.toThrow('已有作答');
  await reopened.enqueue(records[0]!.session.id, async () => answer('19'), true); await reopened.waitForIdle();
  expect((await repository.read(records[0]!.session.id)).session.runs.at(-1)!.status).toBe('completed');
});
it('serializes single submissions and rejects invalid or duplicate capture positions', async () => {
  const { engine, create, batch } = setup(); await create(1); await expect(create(1)).rejects.toThrow();
  expect(LocalBatchSchema.safeParse({ ...batch, position: 101 }).success).toBe(false);
  const records = await Promise.all([engine.create('data:image/jpeg;base64,AQID', 30, 20), engine.create('data:image/jpeg;base64,AQID', 30, 20)]);
  let release = () => {}; const gate = new Promise<void>(resolve => { release = resolve; });
  const results = await Promise.allSettled(records.map(record => engine.start(record.session.id, '', undefined, async () => { await gate; return answer('1'); })));
  expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1); release(); await engine.waitForIdle();
});
it('stop waits for an accepted start preparation and cancels it before any late answer can survive deletion', async () => {
  const { create, queue, engine, repository } = setup(); const record = await create(1);
  const save = repository.save.bind(repository); let entered = false; let release = () => {};
  const gate = new Promise<void>(resolve => { release = resolve; });
  repository.save = async value => { if (value.session.runs.some(run => run.status === 'queued')) { entered = true; await gate; } await save(value); };
  let calls = 0;
  await queue.enqueue(record.session.id, async (_input, signal) => { calls++; if (!signal.aborted) await new Promise<void>(resolve => signal.addEventListener('abort', () => resolve(), { once: true })); return answer('19'); });
  await expect.poll(() => entered).toBe(true); const stopping = queue.stop();
  release(); await stopping; expect(calls).toBeLessThanOrEqual(1); expect(queue.busy).toBe(false);
  expect((await repository.read(record.session.id)).session.runs.at(-1)!.status).toBe('cancelled');
  await engine.removeAll(); expect(await repository.listHistory()).toEqual([]);
});

it('renames a running batch without copying photos, survives stale saves and exports the new title', async () => {
  const { repository, engine, create, batch, queue } = setup(); const first = await create(1); const second = await create(2);
  let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
  await queue.enqueue(first.session.id, async () => { await gate; return answer('19'); });
  await expect.poll(() => engine.actives.length).toBe(1);
  await repository.renameBatch(batch.id, '  SAT 英语复习  ');
  await repository.save(second); // A pre-rename snapshot must not restore the old title.
  const third = await create(3); // An open camera can still hold the old identity.
  release(); await queue.waitForIdle();
  for (const id of [first.session.id, second.session.id, third.session.id]) expect((await repository.read(id)).batch?.title).toBe('SAT 英语复习');
  expect((await repository.listHistory()).every(row => row.batch?.title === 'SAT 英语复习')).toBe(true);
  const exported = []; for await (const line of repository.exportHistory({ aborted: false })) exported.push(line);
  expect(exported.filter(line => line.kind === 'question').every(line => line.record.batch?.title === 'SAT 英语复习')).toBe(true);
  await expect(repository.renameBatch(batch.id, ' ')).rejects.toThrow();
  await expect(repository.renameBatch(batch.id, 'x'.repeat(101))).rejects.toThrow();
  await engine.remove(first.session.id); expect((await repository.read(second.session.id)).batch?.title).toBe('SAT 英语复习');
});
it('allocates unique local date-hour sequence names concurrently and across repository reopening', async () => {
  const values = new Map<string, string>(); const store = { async get(key: string) { return values.get(key) ?? null; }, async put(key: string, value: string) { values.set(key, value); }, async remove(key: string) { values.delete(key); }, async keys() { return [...values.keys()]; } };
  const repository = new LocalRepository(store); const date = new Date(2026, 8, 21, 14, 1);
  expect(await Promise.all([repository.nextBatchTitle(date), repository.nextBatchTitle(date)])).toEqual(['2026-09-21 14时 · 01', '2026-09-21 14时 · 02']);
  const reopened = new LocalRepository(store); expect(await reopened.nextBatchTitle(date)).toBe('2026-09-21 14时 · 03');
  expect(await reopened.nextBatchTitle(new Date(2026, 8, 21, 15, 0))).toBe('2026-09-21 15时 · 01');
  expect(values.size).toBe(1);
});

it('publishes and persists answers before a separate bounded verification queue, so later solves continue', async () => {
  const { create, queue, engine, repository } = setup();
  const records = await Promise.all(Array.from({ length: 6 }, (_, i) => create(i + 1)));
  const verifyReleases: (() => void)[] = []; let solved = 0; let verifying = 0; let maxVerifying = 0;
  const execute: DeviceSolve = async (input, signal, _event, _diagnostic, lifecycle) => {
    const outcome = answer(input.identity.sessionId);
    if (outcome.status !== 'completed' || !lifecycle) throw new Error('missing lifecycle');
    solved++; await lifecycle.candidate(outcome.candidate);
    const release = await lifecycle.verification();
    try {
      verifying++; maxVerifying = Math.max(maxVerifying, verifying);
      await new Promise<void>(resolve => { verifyReleases.push(resolve); signal.addEventListener('abort', () => resolve(), { once: true }); });
      return outcome;
    } finally { verifying--; await release(); }
  };
  for (const record of records) await queue.enqueue(record.session.id, execute);
  await expect.poll(() => solved).toBe(6);
  expect(verifyReleases).toHaveLength(1);
  const first = (await repository.read(records[0]!.session.id)).session.runs[0]!;
  expect(first).toMatchObject({ status: 'verifying', outcome: { status: 'completed', verified: false, verificationStatus: 'pending' } });
  expect(first.outcome?.status === 'completed' && first.outcome.candidate.answer).toBe(records[0]!.session.id);
  expect(engine.actives).toHaveLength(6);
  for (let i = 0; i < 6; i++) { await expect.poll(() => verifyReleases.length).toBe(i + 1); verifyReleases[i]!(); }
  await queue.waitForIdle(); expect(maxVerifying).toBe(1); expect(engine.actives).toEqual([]);
  expect((await repository.read(records[5]!.session.id)).session.runs[0]?.outcome).toMatchObject({ verified: true });
});
it('cancels verification waiters without dispatch or late answers and does not replay after restart', async () => {
  const { create, queue, engine, repository } = setup();
  const records = await Promise.all([create(1), create(2), create(3)]); let checks = 0;
  const execute: DeviceSolve = async (input, signal, _event, _diagnostic, lifecycle) => {
    const outcome = answer(input.identity.sessionId);
    if (outcome.status !== 'completed' || !lifecycle) throw new Error('missing lifecycle');
    await lifecycle.candidate(outcome.candidate);
    const release = await lifecycle.verification();
    try { checks++; await new Promise<void>(resolve => signal.addEventListener('abort', () => resolve(), { once: true })); return outcome; }
    finally { await release(); }
  };
  for (const row of records) await queue.enqueue(row.session.id, execute);
  await expect.poll(() => engine.actives.filter(run => run.outcome?.status === 'completed').length).toBe(3);
  await queue.stop(); expect(checks).toBe(1); expect(engine.actives).toEqual([]);
  for (const row of records) expect((await repository.read(row.session.id)).session.runs[0]?.status).toBe('cancelled');
  await repository.recoverInterrupted(); expect(checks).toBe(1);
});

it.each([52, 100])('solves the whole %i-photo batch while verification is blocked and releases both queues on stop', async count => {
  const { create, queue, engine } = setup();
  const records = await Promise.all(Array.from({ length: count }, (_, index) => create(index + 1)));
  let solved = 0; let checks = 0;
  const execute: DeviceSolve = async (input, signal, _event, _diagnostic, lifecycle) => {
    const outcome = answer(input.identity.sessionId);
    if (outcome.status !== 'completed' || !lifecycle) throw new Error('missing lifecycle');
    solved++; await lifecycle.candidate(outcome.candidate);
    const release = await lifecycle.verification();
    try { checks++; await new Promise<void>(resolve => signal.addEventListener('abort', () => resolve(), { once: true })); return outcome; }
    finally { await release(); }
  };
  for (const row of records) await queue.enqueue(row.session.id, execute);
  await expect.poll(() => solved).toBe(count);
  expect(engine.actives).toHaveLength(count); expect(engine.batchSolvingIds).toHaveLength(0); expect(checks).toBe(1);
  if (count === 100) {
    const extra = await engine.create('data:image/jpeg;base64,AQID', 30, 20, 'sat', { id: randomUUID(), title: 'Another batch', createdAt: new Date().toISOString(), exam: 'sat', position: 1 });
    await expect(queue.enqueue(extra.session.id, execute)).rejects.toThrow('批量队列已满');
    await expect(engine.start(extra.session.id, '', undefined, execute)).rejects.toThrow('批量队列已满');
    expect((await engine.repository.read(extra.session.id)).session.runs).toHaveLength(0);
  }
  await queue.stop(); expect(solved).toBe(count); expect(engine.actives).toEqual([]); expect(queue.busy).toBe(false);
});

it('releases verification admission when a platform diagnostic hook fails', async () => {
  const values = new Map<string, string>();
  const repository = new LocalRepository({ async get(key) { return values.get(key) ?? null; }, async put(key, value) { values.set(key, value); }, async remove(key) { values.delete(key); }, async keys() { return [...values.keys()]; } });
  let rejected = false; let checks = 0;
  const engine = new LocalEngine(repository, randomUUID, { async start() {}, async stop() {}, diagnostic(entry) { if (entry.event === 'queue' && !rejected) { rejected = true; throw new Error('platform diagnostic unavailable'); } } });
  const queue = new LocalBatchQueue(engine); const batch = { id: randomUUID(), title: 'Admission cleanup', createdAt: new Date().toISOString(), exam: 'sat' as const };
  const first = await engine.create('data:image/jpeg;base64,AQID', 30, 20, 'sat', { ...batch, position: 1 });
  const second = await engine.create('data:image/jpeg;base64,AQID', 30, 20, 'sat', { ...batch, position: 2 });
  const execute: DeviceSolve = async (input, _signal, _event, _diagnostic, lifecycle) => {
    const outcome = answer('2'); if (outcome.status !== 'completed' || !lifecycle) throw new Error('missing lifecycle');
    await lifecycle.candidate(outcome.candidate); const release = await lifecycle.verification();
    try { checks++; return outcome; } finally { await release(); }
  };
  try {
    await queue.enqueue(first.session.id, execute); await queue.enqueue(second.session.id, execute);
    await expect.poll(async () => (await repository.read(second.session.id)).session.runs.at(-1)?.status).toBe('completed');
    await queue.waitForIdle(); expect(checks).toBe(1); expect(engine.actives).toEqual([]);
  } finally { await queue.stop(); }
});

it.each([{ solver: 5, verifier: 3 }, { solver: 2, verifier: 4 }, { solver: 8, verifier: 8 }, { solver: 32, verifier: 32 }])('honors independent $solver/$verifier limits and rejects changing active queues', async limits => {
  const { create, queue, engine } = setup(limits);
  const records = await Promise.all(Array.from({ length: Math.max(limits.solver, limits.verifier) + 4 }, (_, i) => create(i + 1)));
  const solveReleases: (() => void)[] = []; const checkReleases: (() => void)[] = [];
  let solving = 0; let checking = 0; let maxSolving = 0; let maxChecking = 0;
  const execute: DeviceSolve = async (input, signal, _event, _diagnostic, lifecycle) => {
    const outcome = answer(input.identity.sessionId);
    if (outcome.status !== 'completed' || !lifecycle) throw new Error('missing lifecycle');
    solving++; maxSolving = Math.max(maxSolving, solving);
    await new Promise<void>(resolve => { solveReleases.push(resolve); signal.addEventListener('abort', () => resolve(), { once: true }); });
    solving--; await lifecycle.candidate(outcome.candidate);
    const release = await lifecycle.verification();
    try {
      checking++; maxChecking = Math.max(maxChecking, checking);
      await new Promise<void>(resolve => { checkReleases.push(resolve); signal.addEventListener('abort', () => resolve(), { once: true }); });
      return outcome;
    } finally { checking--; await release(); }
  };
  try {
    for (const record of records) await queue.enqueue(record.session.id, execute);
    await expect.poll(() => solveReleases.length).toBe(limits.solver);
    expect(() => engine.configureConcurrency({ solver: 1, verifier: 1 })).toThrow('并发设置');
    for (let i = 0; i < records.length; i++) { await expect.poll(() => solveReleases.length).toBeGreaterThan(i); solveReleases[i]!(); }
    await expect.poll(() => checkReleases.length).toBe(limits.verifier);
    await expect.poll(() => engine.batchSolvingIds.length).toBe(0);
    expect(maxSolving).toBe(limits.solver); expect(maxChecking).toBe(limits.verifier);
    // Cancel both active verifiers and waiting verifications; no replay is needed.
    await queue.stop(); expect(engine.actives).toEqual([]); expect(queue.busy).toBe(false);
    engine.configureConcurrency({ solver: 1, verifier: 1 }); expect(engine.concurrency).toEqual({ solver: 1, verifier: 1 });
  } finally { await queue.stop(); }
});
