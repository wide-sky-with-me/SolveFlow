import { randomUUID } from 'node:crypto';
import { expect, it } from 'vitest';
import { LocalEngine } from './local-engine.js';
import { LocalRepository, type LocalDocuments, type LocalDocumentChange } from './local-repository.js';
import { makeSafeAgentError } from '@solveflow/contracts/agent';

async function setup() {
  const values = new Map<string, string>(); let rejectCommit = false;
  const transactions: LocalDocumentChange[][] = [];
  const documents: LocalDocuments = {
    async get(key) { return values.get(key) ?? null; }, async keys() { return [...values.keys()]; },
    async put(key, value) { values.set(key, value); }, async remove(key) { values.delete(key); },
    async batch(changes) { if (rejectCommit) throw new Error('Synthetic transaction failure'); transactions.push([...changes]); for (const { key, value } of changes) if (value === null) values.delete(key); else values.set(key, value); },
  };
  const repository = new LocalRepository(documents); const engine = new LocalEngine(repository, randomUUID);
  const batch = { id: randomUUID(), title: 'Synthetic batch', createdAt: new Date().toISOString(), exam: 'general' as const };
  const records = await Promise.all([1, 2, 3].map(position => engine.create('data:image/jpeg;base64,AQID', 30, 20, 'general', { ...batch, position })));
  const single = await engine.create('data:image/jpeg;base64,AQID', 30, 20);
  const other = await engine.create('data:image/jpeg;base64,AQID', 30, 20, 'general', { ...batch, id: randomUUID(), position: 1 });
  const ids = records.map(record => record.session.id);
  return { repository, engine, values, batch, records, ids, single, other, transactions, fail: () => { rejectCommit = true; } };
}
it('atomically reorders retained photos and removes only omitted records, preserving answers, image bytes and other scopes', async () => {
  const { repository, engine, values, batch, records, ids, single, other, transactions } = await setup();
  const run = await engine.start(ids[1]!, '', undefined, async input => ({ schemaVersion: 1, status: 'failed', verified: false, error: makeSafeAgentError('MODEL_UNAVAILABLE', input.identity.runId) })); await engine.waitForIdle();
  await repository.setFavorite(ids[1]!, true);
  values.set(`diagnostic.${run.id}`, '[]');
  const retained = await repository.read(ids[2]!); const untouched = [values.get(`record.${single.session.id}`), values.get(`record.${other.session.id}`)]; const originalImage = values.get(`image.${ids[2]}`);
  await engine.editBatch({ batchId: batch.id, expectedIds: ids, orderedIds: [ids[2]!, ids[0]!] });
  expect((await repository.read(ids[2]!)).session).toEqual(retained.session);
  expect((await repository.read(ids[2]!)).batch?.position).toBe(1); expect((await repository.read(ids[0]!)).batch?.position).toBe(2);
  expect(values.get(`image.${ids[2]}`)).toBe(originalImage);
  expect(transactions.at(-1)?.some(change => change.key === `image.${ids[2]}`)).toBe(false);
  for (const prefix of ['record', 'image', 'summary', 'favorite']) expect(values.has(`${prefix}.${ids[1]}`)).toBe(false);
  expect(values.has(`diagnostic.${run.id}`)).toBe(false);
  expect([values.get(`record.${single.session.id}`), values.get(`record.${other.session.id}`)]).toEqual(untouched);
  expect(await repository.listHistory()).toHaveLength(4);
  expect(records).toHaveLength(3);
});
it('preserves all storage and cached ordering on a failed edit transaction', async () => {
  const { repository, values, batch, ids, fail } = await setup(); await repository.listHistory(); const before = [...values]; fail();
  await expect(repository.editBatch({ batchId: batch.id, expectedIds: ids, orderedIds: [ids[2]!] })).rejects.toThrow('Synthetic transaction failure');
  expect([...values]).toEqual(before); expect((await repository.listHistory()).filter(row => row.batch?.id === batch.id).map(row => row.batch?.position).sort()).toEqual([1, 2, 3]);
});
it('rejects foreign, duplicate and stale selections without changing storage, and an empty removal never clears history', async () => {
  const { repository, engine, values, batch, ids, single } = await setup(); const before = [...values];
  await expect(engine.editBatch({ batchId: batch.id, expectedIds: [...ids, single.session.id], orderedIds: ids })).rejects.toThrow('其他题目');
  await expect(repository.editBatch({ batchId: batch.id, expectedIds: ids, orderedIds: [ids[0]!, ids[0]!] })).rejects.toThrow();
  await expect(repository.editBatch({ batchId: batch.id, expectedIds: ids.slice(1), orderedIds: ids.slice(1) })).rejects.toThrow('批次图片已变化');
  await engine.removeMany([]); expect([...values]).toEqual(before);
});
it('deletes a scoped batch after cancellation and ignores its late model result while keeping another batch active', async () => {
  const { repository, engine, values, ids, other } = await setup(); let release = () => {}; const held = new Promise<void>(resolve => { release = resolve; });
  let releaseRemoved = () => {}; const removedHeld = new Promise<void>(resolve => { releaseRemoved = resolve; });
  const execute: Parameters<LocalEngine['start']>[3] = async input => { await (input.identity.sessionId === ids[0] ? removedHeld : held); return { schemaVersion: 1, status: 'failed', verified: false, error: makeSafeAgentError('MODEL_UNAVAILABLE', input.identity.runId) }; };
  const removedRun = await engine.start(ids[0]!, '', undefined, execute); const otherRun = await engine.start(other.session.id, '', undefined, execute);
  try {
    const deleting = engine.removeMany(ids);
    releaseRemoved(); await deleting;
    expect(engine.actives.map(run => run.id)).toEqual([otherRun.id]); expect(values.has(`record.${ids[0]}`)).toBe(false);
    release(); await engine.waitForIdle(); await Promise.resolve();
    expect(values.has(`record.${ids[0]}`)).toBe(false); expect(await repository.diagnostics(removedRun.id)).toEqual([]);
    expect((await repository.read(other.session.id)).session.runs.at(-1)?.status).toBe('failed');
  } finally { releaseRemoved(); release(); await engine.waitForIdle(); }
});
it('keeps legacy inline images readable when batch order changes and can remove all of one batch', async () => {
  const { repository, values, batch, ids, records, single, other } = await setup();
  values.set(`record.${ids[0]}`, JSON.stringify(records[0])); values.delete(`image.${ids[0]}`);
  await repository.editBatch({ batchId: batch.id, expectedIds: ids, orderedIds: [ids[2]!, ids[0]!, ids[1]!] });
  expect((await repository.read(ids[0]!)).image).toBe(records[0]!.image);
  expect(JSON.parse(values.get(`record.${ids[0]}`)!).schemaVersion).toBe(1);
  await repository.editBatch({ batchId: batch.id, expectedIds: ids, orderedIds: [] });
  expect((await repository.listHistory()).map(row => row.id).sort()).toEqual([single.session.id, other.session.id].sort());
});
