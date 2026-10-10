import { randomUUID } from 'node:crypto';
import { expect, it } from 'vitest';
import type { SolveOutcome } from '@solveflow/contracts/agent';
import { LocalRepository, type LocalDocuments } from './local-repository.js';
import { LocalEngine } from './local-engine.js';
import { LocalBatchQueue } from './local-batch.js';

const answer: SolveOutcome = { schemaVersion: 1, status: 'completed', verified: false, verificationStatus: 'not_requested', warning: null, verification: null, candidate: { schemaVersion: 1, kind: 'answer', problem: { text: 'x+1=3', subject: 'math', uncertainties: [] }, answer: 'x=2', steps: [], knowledgePoints: [], citationIds: [], clarificationQuestions: [] } };
function setup() {
  const values = new Map<string, string>(); let full = false;
  const documents: LocalDocuments = {
    async get(key) { return values.get(key) ?? null; }, async keys() { return [...values.keys()]; },
    async put(key, value) { values.set(key, value); }, async remove(key) { values.delete(key); },
    async batch(changes) {
      if (full && changes.some(row => row.key.startsWith('record.') && row.value && JSON.parse(row.value).session.runs.some((run: { outcome: unknown }) => run.outcome))) throw new Error('storage full');
      for (const { key, value } of changes) { if (value === null) values.delete(key); else values.set(key, value); }
    },
  };
  const repository = new LocalRepository(documents); const engine = new LocalEngine(repository, randomUUID);
  return { values, documents, repository, engine, setFull(value: boolean) { full = value; } };
}
it('retains a failed final write and retries only persistence, without another model call', async () => {
  const { engine, repository, setFull } = setup(); const record = await engine.create('data:image/jpeg;base64,AQID', 30, 20);
  let calls = 0;
  await engine.start(record.session.id, '', undefined, async () => { calls++; setFull(true); return answer; }); await engine.waitForIdle();
  expect(engine.actives).toHaveLength(0); expect(engine.unsavedRuns).toHaveLength(1);
  expect(engine.unsavedRuns[0]?.outcome).toEqual(answer);
  await expect(engine.start(record.session.id, '', undefined, async () => answer)).rejects.toThrow('保存');
  await expect(engine.retryPendingSaves()).rejects.toThrow('保存'); expect(engine.unsavedRuns).toHaveLength(1);
  setFull(false); await Promise.all([engine.retryPendingSaves(), engine.retryPendingSaves()]);
  expect(engine.unsavedRuns).toHaveLength(0); expect(calls).toBe(1);
  expect((await repository.read(record.session.id)).session.runs).toHaveLength(1);
  expect((await repository.read(record.session.id)).session.runs[0]?.outcome).toEqual(answer);
});
it('stops queued photos after storage failure and never resumes paid work when saving is retried', async () => {
  const { engine, repository, setFull } = setup(); const queue = new LocalBatchQueue(engine);
  const concurrency = engine.concurrency.solver;
  const batch = { id: randomUUID(), title: 'Test', createdAt: new Date().toISOString(), exam: 'general' as const };
  const records = []; for (let position = 1; position <= concurrency + 2; position++) records.push(await engine.create('data:image/jpeg;base64,AQID', 30, 20, 'general', { ...batch, position }));
  let release = () => {}; const gate = new Promise<void>(resolve => { release = resolve; }); let calls = 0;
  for (const record of records) await queue.enqueue(record.session.id, async () => { calls++; await gate; return answer; });
  await expect.poll(() => calls).toBe(concurrency); setFull(true); release(); await queue.waitForIdle();
  expect(calls).toBe(concurrency); expect(queue.busy).toBe(false); expect(queue.message).toContain('保存');
  expect((await repository.read(records[concurrency]!.session.id)).session.runs).toHaveLength(0);
  setFull(false); await engine.retryPendingSaves(); expect(calls).toBe(concurrency);
  await queue.enqueue(records[concurrency]!.session.id, async () => { calls++; return answer; }); await queue.waitForIdle(); expect(calls).toBe(concurrency + 1);
});
it('deleting an unsaved question discards its pending result only after deletion succeeds', async () => {
  const { engine, repository, setFull } = setup(); const record = await engine.create('data:image/jpeg;base64,AQID', 30, 20);
  await engine.start(record.session.id, '', undefined, async () => { setFull(true); return answer; }); await engine.waitForIdle();
  const remove = repository.remove.bind(repository); repository.remove = async () => { throw new Error('storage unavailable'); };
  await expect(engine.remove(record.session.id)).rejects.toThrow(); expect(engine.unsavedRuns).toHaveLength(1);
  repository.remove = remove; setFull(false); await engine.remove(record.session.id); await engine.retryPendingSaves();
  expect(engine.unsavedRuns).toHaveLength(0); expect(await repository.listHistory()).toHaveLength(0);
});
it('retries a cancellation correction after its earlier answer was committed', async () => {
  const { engine, repository } = setup(); const record = await engine.create('data:image/jpeg;base64,AQID', 30, 20);
  const save = repository.save.bind(repository); let release = () => {}; const gate = new Promise<void>(resolve => { release = resolve; }); let firstCommitted = false;
  repository.save = async value => {
    if (value.session.runs.at(-1)?.status === 'cancelled') throw new Error('storage full');
    await save(value);
    if (value.session.runs.at(-1)?.status === 'completed') { firstCommitted = true; await gate; }
  };
  await engine.start(record.session.id, '', undefined, async () => answer);
  await expect.poll(() => firstCommitted).toBe(true); const cancelled = engine.cancel(); release(); await cancelled;
  expect(engine.unsavedRuns[0]?.status).toBe('cancelled');
  repository.save = save; await engine.retryPendingSaves();
  expect((await repository.read(record.session.id)).session.runs[0]?.status).toBe('cancelled'); expect(engine.unsavedRuns).toHaveLength(0);
});
