import { randomUUID } from 'node:crypto';
import { expect, it } from 'vitest';
import type { SolveOutcome } from '@solveflow/contracts/agent';
import { LocalBatchSchema, type LocalRecord } from '@solveflow/contracts/local';
import { LocalEngine, type DeviceSolve } from './local-engine.js';
import { LocalBatchQueue } from './local-batch.js';
import { LocalRepository } from './local-repository.js';
function setup() {
  const values = new Map<string, string>();
  const repository = new LocalRepository({ async get(key) { return values.get(key) ?? null; }, async put(key, value) { values.set(key, value); }, async remove(key) { values.delete(key); }, async keys() { return [...values.keys()]; } });
  const engine = new LocalEngine(repository, randomUUID); const queue = new LocalBatchQueue(engine);
  const batch = { id: randomUUID(), title: 'SAT practice', createdAt: new Date().toISOString(), exam: 'sat' as const };
  const create = (position: number) => engine.create('data:image/jpeg;base64,AQID', 30, 20, 'sat', { ...batch, position });
  return { repository, engine, queue, batch, create };
}
function answer(number: string): SolveOutcome { return { schemaVersion: 1, status: 'completed', verified: true, warning: null, verification: { schemaVersion: 1, verdict: 'pass', checked: ['transcription'], issues: [] }, candidate: { schemaVersion: 1, kind: 'answer', problem: { text: `question ${number}`, sourceNumber: number, subject: 'math', uncertainties: [] }, answer: number, steps: [], knowledgePoints: [], citationIds: [], clarificationQuestions: [] } }; }
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
