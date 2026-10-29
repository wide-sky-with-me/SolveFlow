import { randomUUID } from 'node:crypto';
import { expect, it } from 'vitest';
import { LocalBatchQueue, LocalEngine, LocalRepository } from '@solveflow/client/local';
import { resumeBatchTasks } from './batch-task-actions';

async function fixture() {
  const values = new Map<string, string>();
  const repository = new LocalRepository({ async get(key) { return values.get(key) ?? null; }, async put(key, value) { values.set(key, value); }, async remove(key) { values.delete(key); }, async keys() { return [...values.keys()]; } });
  const engine = new LocalEngine(repository, randomUUID), batch = new LocalBatchQueue(engine);
  const a = { id: randomUUID(), title: 'A', createdAt: new Date().toISOString(), exam: 'act' as const }, b = { ...a, id: randomUUID(), title: 'B' };
  const second = await engine.create('data:image/jpeg;base64,AQID', 30, 20, 'act', { ...a, position: 2 });
  const first = await engine.create('data:image/jpeg;base64,AQID', 30, 20, 'act', { ...a, position: 1 });
  await engine.create('data:image/jpeg;base64,AQID', 30, 20, 'act', { ...b, position: 1 });
  const read = repository.readMetadata.bind(repository); let release = () => {}, reading = false;
  repository.readMetadata = async id => { if (id === first.session.id) { reading = true; await new Promise<void>(resolve => { release = resolve; }); } return read(id); };
  const enqueued: string[] = [];
  const runtime = { repository, batch, async enqueueBatch(id: string) { enqueued.push(id); } };
  return { runtime, a, b, first, second, enqueued, reading: () => reading, release: () => release() };
}

it('stopping a batch also cancels a continuation still reading metadata, without later admission', async () => {
  const data = await fixture(); const pending = resumeBatchTasks(data.runtime, data.a.id);
  try {
    await expect.poll(data.reading).toBe(true); await data.runtime.batch.stop(data.a.id);
    data.release(); expect(await pending).toEqual([]); expect(data.enqueued).toEqual([]);
  } finally { data.release(); await pending; }
});

it('stopping another batch preserves explicit continuation order and excludes its records', async () => {
  const data = await fixture(); const pending = resumeBatchTasks(data.runtime, data.a.id);
  try {
    await expect.poll(data.reading).toBe(true); await data.runtime.batch.stop(data.b.id);
    data.release(); expect(await pending).toEqual([]); expect(data.enqueued).toEqual([data.first.session.id, data.second.session.id]);
  } finally { data.release(); await pending; }
});
