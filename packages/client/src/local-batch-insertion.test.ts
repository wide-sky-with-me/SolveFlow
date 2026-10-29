import { randomUUID } from 'node:crypto';
import { expect, it } from 'vitest';
import { LocalEngine } from './local-engine.js';
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
it('requires a transaction and leaves source data untouched when one is unavailable', async () => {
  const f = await setup(); const original = [...f.values]; delete f.documents.batch;
  await expect(f.engine.create('data:image/jpeg;base64,BAUG', 30, 20, 'act', { ...f.batch, position: 4 }, { beforeId: f.records[0]!.session.id })).rejects.toThrow('事务'); expect([...f.values]).toEqual(original);
});
it('retains inline legacy source bytes when shifting an older record', async () => {
  const f = await setup(); const legacy = f.records[1]!; f.values.set(`record.${legacy.session.id}`, JSON.stringify(legacy)); f.values.delete(`image.${legacy.session.id}`);
  await f.engine.create('data:image/jpeg;base64,BAUG', 30, 20, 'act', { ...f.batch, position: 4 }, { beforeId: legacy.session.id });
  expect(await f.repository.read(legacy.session.id)).toMatchObject({ image: legacy.image, batch: { position: 3 } }); expect(f.values.has(`image.${legacy.session.id}`)).toBe(false);
});
