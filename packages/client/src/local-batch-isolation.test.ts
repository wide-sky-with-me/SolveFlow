import { randomUUID } from 'node:crypto';
import { expect, it } from 'vitest';
import { MAX_PENDING_VERIFICATIONS, MAX_QUEUED_BATCH_PHOTOS, type LocalRecord } from '@solveflow/contracts/local';
import type { SolveOutcome } from '@solveflow/contracts/agent';
import { LocalEngine, type DeviceSolve } from './local-engine.js';
import { LocalRepository } from './local-repository.js';
import { LocalBatchQueue } from './local-batch.js';

function setup(solver = 2) {
  const values = new Map<string, string>();
  const repository = new LocalRepository({ async get(key) { return values.get(key) ?? null; }, async put(key, value) { values.set(key, value); }, async remove(key) { values.delete(key); }, async keys() { return [...values.keys()]; } });
  const engine = new LocalEngine(repository, randomUUID); engine.configureConcurrency({ solver, verifier: 1 });
  const queue = new LocalBatchQueue(engine);
  const batches = Array.from({ length: 3 }, (_, index) => ({ id: randomUUID(), title: `batch ${index + 1}`, createdAt: new Date().toISOString(), exam: 'sat' as const }));
  const create = (batch: number, position: number) => engine.create('data:image/jpeg;base64,AQID', 30, 20, 'sat', { ...batches[batch]!, position });
  return { repository, engine, queue, batches, create };
}
function answer(): SolveOutcome { return { schemaVersion: 1, status: 'completed', verified: true, warning: null, verification: { schemaVersion: 1, verdict: 'pass', checked: ['transcription'], issues: [] }, candidate: { schemaVersion: 1, kind: 'answer', problem: { text: 'x+1=3', subject: 'math', uncertainties: [] }, answer: '2', steps: [], knowledgePoints: [], citationIds: [], clarificationQuestions: [] } }; }

it('a start failure stops its own batch while another batch still dispatches and keeps the scoped error', async () => {
  const { queue, engine, batches, create, repository } = setup(1);
  const a1 = await create(0, 1), a2 = await create(0, 2), b1 = await create(1, 1);
  const start = engine.start.bind(engine); let release = () => {}; let failing = false; const calls: string[] = [];
  engine.start = async (...args) => {
    if (args[0] === a1.session.id) { failing = true; await new Promise<void>(resolve => { release = resolve; }); throw new Error('SYNTHETIC_START_FAILURE'); }
    return start(...args);
  };
  const execute: DeviceSolve = async input => { calls.push(input.identity.sessionId); return answer(); };
  try {
    await queue.enqueue(a1.session.id, execute); await expect.poll(() => failing).toBe(true);
    await queue.enqueue(a2.session.id, execute); await queue.enqueue(b1.session.id, execute); release();
    await queue.waitForIdle();
    expect(calls).toEqual([b1.session.id]);
    expect((await repository.read(a2.session.id)).session.runs).toHaveLength(0);
    expect((await repository.read(b1.session.id)).session.runs.at(-1)?.status).toBe('completed');
    expect(queue.messageFor(batches[0]!.id)).toContain('未能启动');
    expect(queue.messageFor(batches[1]!.id)).toBeNull();
    expect(queue.getSnapshot().errors[batches[0]!.id]).toContain('未能启动');
  } finally { release(); await queue.stop(); }
});

it('stopping one batch does not reject or pause a different batch while cancellation settles', async () => {
  const { queue, batches, create, repository } = setup(2);
  const a = await create(0, 1), b = await create(1, 1); let release = () => {}; let started = false;
  let stopping: Promise<void> | undefined;
  try {
    await queue.enqueue(a.session.id, async () => { started = true; await new Promise<void>(resolve => { release = resolve; }); return answer(); });
    await expect.poll(() => started).toBe(true);
    stopping = queue.stop(batches[0]!.id);
    await expect(queue.enqueue(b.session.id, async () => answer())).resolves.toBeUndefined();
    await expect.poll(async () => (await repository.read(b.session.id)).session.runs.at(-1)?.status).toBe('completed');
    expect(queue.isBusy(batches[0]!.id)).toBe(true);
    expect(queue.isBusy(batches[1]!.id)).toBe(false);
    release(); await stopping; await queue.waitForIdle();
    expect((await repository.read(a.session.id)).session.runs.at(-1)?.status).toBe('cancelled');
    expect(queue.getSnapshot().tasks).toEqual([]);
  } finally { release(); await stopping; await queue.stop(); }
});

it('publishes stable phase snapshots without assigning another batch a busy state', async () => {
  const { queue, batches, create } = setup(1); const a1 = await create(0, 1), a2 = await create(0, 2);
  let release = () => {}; let started = false;
  expect(queue.getSnapshot()).toBe(queue.getSnapshot()); expect(queue.isBusy(batches[1]!.id)).toBe(false);
  try {
    await queue.enqueue(a1.session.id, async () => { started = true; await new Promise<void>(resolve => { release = resolve; }); return answer(); });
    await expect.poll(() => started).toBe(true); await queue.enqueue(a2.session.id, async () => answer());
    const snapshot = queue.getSnapshot();
    expect(snapshot.tasks.filter(row => row.batchId === batches[0]!.id).map(row => row.phase).sort()).toEqual(['solving', 'waiting']);
    expect(queue.getSnapshot()).toBe(snapshot); expect(queue.isBusy(batches[1]!.id)).toBe(false);
    release(); await queue.waitForIdle(); expect(queue.getSnapshot().tasks).toHaveLength(0);
  } finally { release(); await queue.stop(); }
});

it('queues multiple batches above one batch size while respecting the accepted verification bound', async () => {
  const { queue, engine, create } = setup(8); const records: LocalRecord[] = [];
  for (let index = 0; index < 120; index++) records.push(await create(Math.floor(index / 60), index % 60 + 1));
  expect(MAX_QUEUED_BATCH_PHOTOS).toBeGreaterThan(records.length);
  let release = () => {}; const gate = new Promise<void>(resolve => { release = resolve; }); let solves = 0;
  const execute: DeviceSolve = async (_input, _signal, _event, _diagnostic, lifecycle) => {
    const value = answer(); if (value.status !== 'completed' || !lifecycle) throw new Error('LIFECYCLE_MISSING');
    solves++; await lifecycle.candidate(value.candidate); const done = await lifecycle.verification();
    try { await gate; return value; } finally { await done(); }
  };
  try {
    for (const record of records) await queue.enqueue(record.session.id, execute);
    await expect.poll(() => solves).toBe(MAX_PENDING_VERIFICATIONS);
    expect(engine.actives.length).toBeLessThanOrEqual(MAX_PENDING_VERIFICATIONS);
    expect(queue.getSnapshot().tasks.filter(row => row.phase === 'waiting')).toHaveLength(20);
    release(); await queue.waitForIdle(); expect(solves).toBe(records.length);
  } finally { release(); await queue.stop(); }
}, 20000);
