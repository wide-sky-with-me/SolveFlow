import { randomUUID } from 'node:crypto';
import { expect, it } from 'vitest';
import { LocalEngine } from './local-engine.js';
import { LocalDataError, LocalRepository } from './local-repository.js';

it('batches primary question views and batch run overviews without reading supplement blobs', async () => {
  const values = new Map<string, string>();
  const getManyCalls: string[][] = [];
  const getCalls: string[] = [];
  const repository = new LocalRepository({
    async get(key) { getCalls.push(key); return values.get(key) ?? null; },
    async getMany(keys) { getManyCalls.push([...keys]); return keys.map(key => values.get(key) ?? null); },
    async put(key, value) { values.set(key, value); },
    async remove(key) { values.delete(key); },
    async keys() { return [...values.keys()]; },
    async batch(changes) { for (const c of changes) if (c.value === null) values.delete(c.key); else values.set(c.key, c.value); },
  });
  const engine = new LocalEngine(repository, randomUUID);
  const record = await engine.create('data:image/jpeg;base64,AQID', 100, 80, 'general');
  const id = record.session.id;
  await repository.save({ ...record, materials: [{ id: randomUUID(), image: 'data:image/jpeg;base64,BAUG', bytes: 3, width: 50, height: 40 }] });

  getManyCalls.length = 0;
  getCalls.length = 0;
  const view = await repository.readQuestionView(id);
  expect(view.image).toBe('data:image/jpeg;base64,AQID');
  expect(view.metadata.materials).toHaveLength(1);
  expect(getManyCalls).toEqual([[`record.${id}`, `image.${id}`]]);
  expect(getCalls).toEqual([]);

  getManyCalls.length = 0;
  const runsMap = await repository.readBatchRuns([id]);
  expect(runsMap.get(id)).toEqual([]);
  expect(getManyCalls).toEqual([[`record.${id}`]]);
  expect(getCalls).toEqual([]);

  values.set(`image.${id}`, '{broken');
  await expect(repository.read(id)).rejects.toBeInstanceOf(LocalDataError);
});
