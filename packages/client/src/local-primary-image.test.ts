import { randomUUID } from 'node:crypto';
import { expect, it } from 'vitest';
import { LocalEngine } from './local-engine.js';
import { LocalDataError, LocalRepository } from './local-repository.js';

async function setup() {
  const values = new Map<string, string>(); const reads: string[] = [];
  const documents = { async get(key: string) { reads.push(key); return values.get(key) ?? null; }, async keys() { return [...values.keys()]; }, async put(key: string, value: string) { values.set(key, value); }, async remove(key: string) { values.delete(key); } };
  const repository = new LocalRepository(documents); const engine = new LocalEngine(repository, randomUUID);
  const record = await engine.create('data:image/jpeg;base64,AQID', 30, 20);
  reads.length = 0;
  return { values, reads, documents, repository, record };
}
it('reads only the original image and its metadata, independently of broken supplements', async () => {
  const f = await setup(); const key = `record.${f.record.session.id}`;
  const metadata: unknown = JSON.parse(f.values.get(key)!);
  if (!metadata || typeof metadata !== 'object') throw new Error('FIXTURE');
  f.values.set(key, JSON.stringify({ ...metadata, materials: [{ id: randomUUID(), width: 30, height: 20, bytes: 3 }] }));
  const before = [...f.values];
  expect(await f.repository.readPrimaryImage(f.record.session.id)).toEqual({ image: f.record.image, width: 30, height: 20 });
  expect(f.reads).toEqual([key, `image.${f.record.session.id}`]); expect([...f.values]).toEqual(before);
});
it('reads legacy inline originals without loading separated photo or material documents', async () => {
  const f = await setup(); f.values.set(`record.${f.record.session.id}`, JSON.stringify(f.record));
  expect(await f.repository.readPrimaryImage(f.record.session.id)).toEqual({ image: f.record.image, width: 30, height: 20 });
  expect(f.reads).toEqual([`record.${f.record.session.id}`]);
});
it.each(['missing', 'corrupt'] as const)('reports a %s original without rewriting it or silently using supplements', async state => {
  const f = await setup(); const key = `image.${f.record.session.id}`;
  if (state === 'missing') f.values.delete(key); else f.values.set(key, '{broken');
  const before = [...f.values];
  await expect(f.repository.readPrimaryImage(f.record.session.id)).rejects.toBeInstanceOf(LocalDataError);
  expect([...f.values]).toEqual(before); expect(f.repository.issues.some(issue => issue.key === key)).toBe(true);
});
it('propagates original image I/O failure without classifying it as data damage', async () => {
  const f = await setup(); const get = f.documents.get;
  f.documents.get = async key => { if (key.startsWith('image.')) throw new Error('SYNTHETIC_IO'); return get(key); };
  await expect(f.repository.readPrimaryImage(f.record.session.id)).rejects.toThrow('SYNTHETIC_IO'); expect(f.repository.issues).toEqual([]);
});
