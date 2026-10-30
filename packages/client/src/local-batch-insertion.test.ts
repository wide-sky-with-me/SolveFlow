import { randomUUID } from 'node:crypto';
import { expect, it } from 'vitest';
import { LocalEngine, type DeviceSolve } from './local-engine.js';
import { LocalBatchQueue } from './local-batch.js';
import { LocalRepository, type LocalDocuments } from './local-repository.js';
import type { SolveOutcome } from '@solveflow/contracts/agent';

async function setup() {
  const values = new Map<string, string>(); let fail = false;
  const documents: LocalDocuments = { async get(key) { return values.get(key) ?? null; }, async keys() { return [...values.keys()]; }, async put(key, value) { values.set(key, value); }, async remove(key) { values.delete(key); }, async batch(changes) { if (fail) throw new Error('DISK_FULL'); for (const change of changes) if (change.value === null) values.delete(change.key); else values.set(change.key, change.value); } };
  const repository = new LocalRepository(documents), engine = new LocalEngine(repository, randomUUID);
  const batch = { id: randomUUID(), title: 'Insertion fixture', createdAt: new Date().toISOString(), exam: 'act' as const };
  const records = [];
  for (let position = 1; position <= 3; position++) records.push(await engine.create('data:image/jpeg;base64,AQID', 30, 20, 'act', { ...batch, position }));
  return { values, documents, repository, engine, batch, records, fail: () => { fail = true; } };
}
it('inserts successive photos before a stable recipient and shifts later positions without changing saved evidence', async () => {
  const f = await setup(); const before = f.records[1]!; const image = f.values.get(`image.${before.session.id}`);
  const first = await f.engine.create('data:image/jpeg;base64,BAUG', 30, 20, 'act', { ...f.batch, position: 4 }, { beforeId: before.session.id });
  const second = await f.engine.create('data:image/jpeg;base64,BwgJ', 30, 20, 'act', { ...f.batch, position: 5 }, { beforeId: before.session.id });
  const rows = (await f.repository.listHistory()).filter(row => row.batch?.id === f.batch.id).sort((a, b) => a.batch!.position - b.batch!.position);
  expect(rows.map(row => row.id)).toEqual([f.records[0]!.session.id, first.session.id, second.session.id, before.session.id, f.records[2]!.session.id]);
  expect(rows.map(row => row.batch?.position)).toEqual([1, 2, 3, 4, 5]); expect(first.batch?.position).toBe(2); expect(second.batch?.position).toBe(3);
  expect(f.values.get(`image.${before.session.id}`)).toBe(image); expect((await f.repository.read(before.session.id)).session).toEqual(before.session);
});
it('keeps the inserted order when a stale result later saves its old batch metadata', async () => {
  const f = await setup(); const old = f.records[1]!;
  await f.engine.create('data:image/jpeg;base64,BAUG', 30, 20, 'act', { ...f.batch, position: 4 }, { beforeId: old.session.id });
  old.session.subject = 'chemistry'; await f.repository.save(old);
  expect(await f.repository.read(old.session.id)).toMatchObject({ batch: { position: 3 }, session: { subject: 'chemistry' } });
});
it('rejects a missing insertion anchor and rolls back both insertion and renumbering on storage failure', async () => {
  const f = await setup(); const original = [...f.values];
  await expect(f.engine.create('data:image/jpeg;base64,BAUG', 30, 20, 'act', { ...f.batch, position: 4 }, { beforeId: randomUUID() })).rejects.toThrow(); expect([...f.values]).toEqual(original);
  f.fail(); await expect(f.engine.create('data:image/jpeg;base64,BAUG', 30, 20, 'act', { ...f.batch, position: 4 }, { beforeId: f.records[1]!.session.id })).rejects.toThrow('DISK_FULL'); expect([...f.values]).toEqual(original);
});
it.each(['first', 'last'] as const)('supports the %s position without losing existing members', async side => {
  const f = await setup(); const inserted = await f.engine.create('data:image/jpeg;base64,BAUG', 30, 20, 'act', { ...f.batch, position: 4 }, { beforeId: side === 'first' ? f.records[0]!.session.id : null });
  const rows = (await f.repository.listHistory()).filter(row => row.batch?.id === f.batch.id).sort((a, b) => a.batch!.position - b.batch!.position);
  expect(rows.map(row => row.id)).toEqual(side === 'first' ? [inserted.session.id, ...f.records.map(record => record.session.id)] : [...f.records.map(record => record.session.id), inserted.session.id]);
});
it('keeps a running answer attached to its original photo after insertion shifts its position', async () => {
  const f = await setup(); const recipient = f.records[1]!; let finish: ((outcome: SolveOutcome) => void) | undefined;
  const run = await f.engine.start(recipient.session.id, '', undefined, async () => new Promise<SolveOutcome>(resolve => { finish = resolve; }));
  await f.engine.create('data:image/jpeg;base64,BAUG', 30, 20, 'act', { ...f.batch, position: 4 }, { beforeId: recipient.session.id });
  if (!finish) throw new Error('RUN_NOT_STARTED');
  finish({ schemaVersion: 1, status: 'completed', verified: false, verification: null, warning: null, verificationStatus: 'not_requested', candidate: { schemaVersion: 1, kind: 'answer', problem: { text: 'x+1=3', subject: 'math', uncertainties: [] }, answer: 'x=2', steps: [], knowledgePoints: [], citationIds: [], clarificationQuestions: [] } });
  await f.engine.waitForRun(run.id);
  expect(await f.repository.read(recipient.session.id)).toMatchObject({ batch: { position: 3 }, session: { runs: [{ id: run.id, status: 'completed', outcome: { candidate: { answer: 'x=2' } } }] } });
});
it('inserts ahead of solving and verifying photos without cancelling them, replaying them or changing the dispatch order of waiting photos', async () => {
  const f = await setup(); f.engine.configureConcurrency({ solver: 1, verifier: 1 }); const queue = new LocalBatchQueue(f.engine);
  const [verifying, solving, waiting] = f.records;
  if (!verifying || !solving || !waiting) throw new Error('MISSING_FIXTURE');
  const calls: string[] = []; const signals = new Map<string, AbortSignal>(); const images = new Map<string, number[]>();
  let releaseSolve = () => {}; let releaseVerify = () => {};
  const solveGate = new Promise<void>(resolve => { releaseSolve = resolve; }); const verifyGate = new Promise<void>(resolve => { releaseVerify = resolve; });
  const execute: DeviceSolve = async (input, signal, _event, _diagnostic, lifecycle) => {
    const id = input.identity.sessionId; calls.push(id); signals.set(id, signal); images.set(id, [...input.image.bytes]);
    if (id === solving.session.id) await solveGate;
    if (!lifecycle) throw new Error('MISSING_LIFECYCLE');
    const candidate = { schemaVersion: 1 as const, kind: 'answer' as const, problem: { text: `Question ${id}`, subject: 'math' as const, uncertainties: [] }, answer: `Answer ${id}`, steps: [], knowledgePoints: [], citationIds: [], clarificationQuestions: [] };
    await lifecycle.candidate(candidate); const done = await lifecycle.verification();
    try {
      if (id === verifying.session.id) await verifyGate;
      return { schemaVersion: 1, status: 'completed', verified: true, verification: { schemaVersion: 1, verdict: 'pass', checked: ['transcription'], issues: [] }, warning: null, candidate };
    } finally { await done(); }
  };
  try {
    for (const record of f.records) await queue.enqueue(record.session.id, execute);
    await expect.poll(() => calls).toEqual([verifying.session.id, solving.session.id]);
    await expect.poll(() => f.engine.actives.find(run => run.sessionId === verifying.session.id)?.status).toBe('verifying');
    const accepted = new Map(f.engine.actives.map(run => [run.sessionId, run.id]));
    const front = await f.engine.create('data:image/jpeg;base64,BAUG', 30, 20, 'act', { ...f.batch, position: 4 }, { beforeId: verifying.session.id });
    const middle = await f.engine.create('data:image/jpeg;base64,BwgJ', 30, 20, 'act', { ...f.batch, position: 5 }, { beforeId: solving.session.id });
    await queue.enqueue(front.session.id, execute); await queue.enqueue(middle.session.id, execute);
    expect(signals.get(verifying.session.id)?.aborted).toBe(false); expect(signals.get(solving.session.id)?.aborted).toBe(false);
    expect(new Map(f.engine.actives.map(run => [run.sessionId, run.id]))).toEqual(accepted);
    expect((await f.repository.read(verifying.session.id)).batch?.position).toBe(2);
    expect((await f.repository.read(solving.session.id)).batch?.position).toBe(4);
    releaseSolve(); await expect.poll(() => calls.length).toBe(5);
    expect(calls).toEqual([...f.records.map(record => record.session.id), front.session.id, middle.session.id]);
    releaseVerify(); await queue.waitForIdle();
    const order = (await f.repository.listHistory()).sort((a, b) => a.batch!.position - b.batch!.position);
    expect(order.map(row => row.id)).toEqual([front.session.id, verifying.session.id, middle.session.id, solving.session.id, waiting.session.id]);
    expect(order.map(row => row.batch?.position)).toEqual([1, 2, 3, 4, 5]);
    for (const row of order) {
      const record = await f.repository.read(row.id);
      expect(record.session.runs).toHaveLength(1);
      expect(record.session.runs[0]).toMatchObject({ status: 'completed', imageIds: [row.id], outcome: { candidate: { answer: `Answer ${row.id}` } } });
      expect(images.get(row.id)).toEqual(row.id === front.session.id ? [4, 5, 6] : row.id === middle.session.id ? [7, 8, 9] : [1, 2, 3]);
      if (accepted.has(row.id)) expect(record.session.runs[0]?.id).toBe(accepted.get(row.id));
    }
    expect(queue.messageFor(f.batch.id)).toBeNull();
  } finally { releaseSolve(); releaseVerify(); await queue.stop(); await f.engine.waitForIdle(); }
});
it('requires a transaction and leaves source data untouched when one is unavailable', async () => {
  const f = await setup(); const original = [...f.values]; delete f.documents.batch;
  await expect(f.engine.create('data:image/jpeg;base64,BAUG', 30, 20, 'act', { ...f.batch, position: 4 }, { beforeId: f.records[0]!.session.id })).rejects.toThrow('事务'); expect([...f.values]).toEqual(original);
});
it('retains inline legacy source bytes when shifting an older record', async () => {
  const f = await setup(); const legacy = f.records[1]!; f.values.set(`record.${legacy.session.id}`, JSON.stringify(legacy)); f.values.delete(`image.${legacy.session.id}`);
  await f.engine.create('data:image/jpeg;base64,BAUG', 30, 20, 'act', { ...f.batch, position: 4 }, { beforeId: legacy.session.id });
  expect(await f.repository.read(legacy.session.id)).toMatchObject({ image: legacy.image, batch: { position: 3 } }); expect(f.values.has(`image.${legacy.session.id}`)).toBe(false);
});
