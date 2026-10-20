import { randomUUID } from 'node:crypto';
import { expect, it } from 'vitest';
import { LocalEngine } from './local-engine.js';
import { LocalRepository, type LocalDocuments } from './local-repository.js';
import { collectBatchPrint } from './batch-print.js';

async function setup() {
  const values = new Map<string, string>();
  const documents: LocalDocuments = { get: async key => values.get(key) ?? null, keys: async () => [...values.keys()], put: async (key, value) => { values.set(key, value); }, remove: async key => { values.delete(key); }, batch: async changes => { for (const change of changes) if (change.value === null) values.delete(change.key); else values.set(change.key, change.value); } };
  const repository = new LocalRepository(documents); const engine = new LocalEngine(repository, randomUUID);
  const batch = { id: randomUUID(), title: 'Synthetic PDF batch', createdAt: new Date().toISOString(), exam: 'general' as const };
  const second = await engine.create('data:image/jpeg;base64,AQID', 30, 20, 'general', { ...batch, position: 2 });
  const first = await engine.create('data:image/jpeg;base64,BAUG', 30, 20, 'general', { ...batch, position: 1 });
  const other = await engine.create('data:image/jpeg;base64,BwgJ', 30, 20, 'general', { ...batch, id: randomUUID(), position: 1 });
  values.set('settings', 'synthetic-private-settings'); values.set('diagnostic.unrelated', 'synthetic-private-diagnostics');
  await repository.listHistory();
  return { values, repository, batch, first, second, other };
}
it('exports one batch in position order, preserving original bytes and excluding other batches, settings and diagnostics', async () => {
  const { values, repository, batch, first, second, other } = await setup(); const before = [...values];
  const result = await collectBatchPrint(repository, batch.id, new AbortController().signal, () => {});
  expect(result.records.map(record => record.session.id)).toEqual([first.session.id, second.session.id]);
  expect(result.records.map(record => record.image)).toEqual([first.image, second.image]);
  const serialized = JSON.stringify(result); expect(serialized).not.toContain(other.session.id); expect(serialized).not.toContain('synthetic-private');
  expect([...values]).toEqual(before);
});
it('cancels between records without writing partial export data or deleting originals', async () => {
  const { values, repository, batch } = await setup(); const before = [...values]; const controller = new AbortController();
  await expect(collectBatchPrint(repository, batch.id, controller.signal, () => controller.abort())).rejects.toThrow('取消');
  expect([...values]).toEqual(before);
});
it('rejects missing, corrupt and changing batches instead of silently omitting questions', async () => {
  const { repository, values, batch, first } = await setup();
  await expect(collectBatchPrint(repository, randomUUID(), new AbortController().signal, () => {})).rejects.toThrow('为空');
  values.set(`image.${first.session.id}`, 'broken');
  await expect(collectBatchPrint(repository, batch.id, new AbortController().signal, () => {})).rejects.toThrow('无法读取');
  values.set(`image.${first.session.id}`, JSON.stringify({ schemaVersion: 1, image: first.image }));
  await expect(collectBatchPrint(repository, batch.id, new AbortController().signal, (done) => { if (done === 1) { values.delete(`record.${first.session.id}`); } })).rejects.toThrow('变化');
});
it('does not silently omit a batch member whose damaged metadata vanished from the history index', async () => {
  const { repository, values, batch, first } = await setup();
  values.set(`record.${first.session.id}`, 'broken'); values.delete(`summary.${first.session.id}`);
  const before = [...values];
  await expect(collectBatchPrint(repository, batch.id, new AbortController().signal, () => {})).rejects.toThrow('无法读取');
  expect([...values]).toEqual(before);
});
it('rejects a task that starts after its record has already been copied', async () => {
  const { repository, values, batch, first } = await setup();
  const record = await repository.read(first.session.id);
  record.session.runs.push({ schemaVersion: 1, id: randomUUID(), sessionId: first.session.id, createdAt: new Date().toISOString(), seq: 1, status: 'queued', message: '', outcome: null });
  await expect(collectBatchPrint(repository, batch.id, new AbortController().signal, done => {
    if (done !== 1) return;
    values.set(`record.${first.session.id}`, JSON.stringify(record)); values.delete(`summary.${first.session.id}`);
  })).rejects.toThrow('正在处理');
  expect(values.has(`image.${first.session.id}`)).toBe(true);
});
