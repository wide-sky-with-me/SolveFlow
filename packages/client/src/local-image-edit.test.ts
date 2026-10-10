import { randomUUID } from 'node:crypto';
import { expect, it, vi } from 'vitest';
import { LocalEngine } from './local-engine.js';
import { LocalRepository, type LocalDocumentChange } from './local-repository.js';
import { LocalRecordSchema, type LocalImageEdit } from '@solveflow/contracts/local';
import { type SolveOutcome, type SolverInput } from '@solveflow/contracts/agent';
import { prepareLocalRunRequest } from './local-run-request.js';
import { writeHistoryExport } from './local-history-export.js';

const jpeg = 'data:image/jpeg;base64,/9j/2wBDAAYEBQYFBAYGBQYHBwYIChAKCgkJChQODwwQFxQYGBcUFhYaHSUfGhsjHBYWICwgIyYnKSopGR8tMC0oMCUoKSj/2wBDAQcHBwoIChMKChMoGhYaKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCj/wAARCAACAAIDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAj/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFAEBAAAAAAAAAAAAAAAAAAAAAP/EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAMAwEAAhEDEQA/AKpAB//Z';
const answer: SolveOutcome = { schemaVersion: 1, status: 'completed', verified: false, verificationStatus: 'not_requested', warning: null, verification: null, candidate: { schemaVersion: 1, kind: 'answer', problem: { text: 'x+1=3', subject: 'math', uncertainties: [] }, answer: 'x=2', steps: [], knowledgePoints: [], citationIds: [], clarificationQuestions: [] } };
const material = () => ({ id: randomUUID(), image: jpeg, bytes: atob(jpeg.split(',')[1]!).length, width: 2, height: 2 });
function setup() {
  const values = new Map<string, string>(); let fail = false;
  const repository = new LocalRepository({ async get(key) { return values.get(key) ?? null; }, async keys() { return [...values.keys()]; }, async put(key, value) { values.set(key, value); }, async remove(key) { values.delete(key); }, async batch(changes: LocalDocumentChange[]) {
    if (fail) throw new Error('disk full');
    for (const { key, value } of changes) if (value === null) values.delete(key); else values.set(key, value);
  } });
  return { values, repository, engine: new LocalEngine(repository, randomUUID), fail: (value: boolean) => { fail = value; } };
}
it('correction replaces active images while old and new auxiliary requests keep their own evidence', async () => {
  const { engine, repository } = setup(); const record = await engine.create('data:image/jpeg;base64,AQID', 30, 20);
  const withMaterial = await engine.addMaterial(record.session.id, jpeg, 2, 2); const oldMaterial = withMaterial.materials![0]!;
  const original = await engine.start(record.session.id, '', undefined, async () => answer); await engine.waitForIdle();
  const added = material(); const execute = vi.fn(async (_input: SolverInput) => answer);
  const context = { kind: 'correction' as const, sourceRunId: original.id, text: 'x+2=4' };
  const corrected = await engine.start(record.session.id, '', context, execute, { imageIds: [added.id], additions: [added] }); await engine.waitForIdle();
  const saved = await repository.read(record.session.id);
  expect(saved.activeImageIds).toEqual([added.id]); expect(saved.materials?.map(item => item.id)).toEqual([oldMaterial.id, added.id]);
  expect(saved.session.runs[0]?.imageIds).toEqual([record.session.upload.id, oldMaterial.id]); expect(corrected.imageIds).toEqual([added.id]);
  expect(execute.mock.calls[0]?.[0].materials).toBeUndefined();
  expect(execute.mock.calls[0]?.[0].image.bytes.byteLength).toBe(added.bytes);
  const oldCheck = prepareLocalRunRequest(saved, '', { kind: 'verification', sourceRunId: original.id });
  const newCheck = prepareLocalRunRequest(saved, '', { kind: 'verification', sourceRunId: corrected.id });
  expect([...oldCheck.image.bytes]).toEqual([1, 2, 3]); expect(oldCheck.materials?.map(item => item.id)).toEqual([oldMaterial.id]);
  expect(newCheck.image.bytes).toEqual(Uint8Array.from(atob(jpeg.split(',')[1]!), character => character.charCodeAt(0))); expect(newCheck.materials).toBeUndefined();
  expect(prepareLocalRunRequest(saved, '', undefined).imageIds).toEqual([added.id]);
  const appended = await engine.addMaterial(record.session.id, jpeg, 2, 2);
  expect(appended.activeImageIds).toEqual([added.id, appended.materials!.at(-1)!.id]);
});
it('a failed correction transaction saves neither images nor a run and does not dispatch', async () => {
  const { engine, repository, values, fail } = setup(); const record = await engine.create(jpeg, 2, 2);
  const source = await engine.start(record.session.id, '', undefined, async () => answer); await engine.waitForIdle();
  const before = new Map(values); const added = material(); const execute = vi.fn(async () => answer);
  const edit = { imageIds: [added.id], additions: [added] }; const context = { kind: 'correction' as const, sourceRunId: source.id, text: 'x+2=4' };
  fail(true); await expect(engine.start(record.session.id, '', context, execute, edit)).rejects.toThrow('disk full');
  expect(values).toEqual(before); expect(engine.actives).toEqual([]); expect(execute).not.toHaveBeenCalled();
  fail(false); await engine.start(record.session.id, '', context, execute, edit); await engine.waitForIdle();
  expect(execute).toHaveBeenCalledTimes(1); expect((await repository.read(record.session.id)).materials).toHaveLength(1);
});
it('removing an active image makes room for a replacement while archived evidence stays bounded and immutable', async () => {
  const { engine, repository } = setup(); const record = await engine.create(jpeg, 2, 2);
  for (let index = 0; index < 7; index++) await engine.addMaterial(record.session.id, jpeg, 2, 2);
  const source = await engine.start(record.session.id, '', undefined, async () => answer); await engine.waitForIdle();
  const before = await repository.read(record.session.id); const added = material();
  const ids = [record.session.upload.id, ...before.materials!.slice(1).map(item => item.id), added.id];
  await engine.start(record.session.id, '', { kind: 'correction', sourceRunId: source.id, text: 'x+2=4' }, async input => {
    expect(input.materials?.map(item => item.id)).toEqual(ids.slice(1)); return answer;
  }, { imageIds: ids, additions: [added] }); await engine.waitForIdle();
  const saved = await repository.read(record.session.id);
  expect(saved.materials).toHaveLength(8); expect(saved.materials?.slice(0, 7)).toEqual(before.materials);
  expect(saved.activeImageIds).toHaveLength(8);
  await expect(engine.addMaterial(record.session.id, jpeg, 2, 2)).rejects.toThrow('最多使用8张');
});
it('invalid image edits fail before writes or calls, including empty, duplicate, foreign and malformed additions', async () => {
  const { engine, values } = setup(); const record = await engine.create(jpeg, 2, 2);
  const source = await engine.start(record.session.id, '', undefined, async () => answer); await engine.waitForIdle();
  const before = new Map(values); const execute = vi.fn(async () => answer); const added = material();
  const edits: LocalImageEdit[] = [
    { imageIds: [], additions: [] }, { imageIds: [record.session.upload.id, record.session.upload.id], additions: [] },
    { imageIds: [randomUUID()], additions: [] }, { imageIds: [added.id], additions: [{ ...added, width: 3 }] },
    { imageIds: [record.session.upload.id], additions: [added] },
  ];
  for (const edit of edits) await expect(engine.start(record.session.id, '', { kind: 'correction', sourceRunId: source.id, text: 'x+2=4' }, execute, edit)).rejects.toThrow();
  expect(values).toEqual(before); expect(execute).not.toHaveBeenCalled();
  expect(LocalRecordSchema.safeParse({ ...record, activeImageIds: [randomUUID()] }).success).toBe(false);
});
it('removed evidence remains in backups and legacy runs still use original plus their saved materials', async () => {
  const from = setup(); const record = await from.engine.create(jpeg, 2, 2);
  const old = await from.engine.addMaterial(record.session.id, jpeg, 2, 2);
  const source = await from.engine.start(record.session.id, '', undefined, async () => answer); await from.engine.waitForIdle();
  const legacy = await from.repository.read(record.session.id); delete legacy.session.runs[0]!.imageIds; await from.repository.save(legacy);
  await from.engine.start(record.session.id, '', { kind: 'correction', sourceRunId: source.id, text: 'x+2=4' }, async () => answer, { imageIds: [old.materials![0]!.id], additions: [] }); await from.engine.waitForIdle();
  const saved = await from.repository.read(record.session.id);
  expect(prepareLocalRunRequest(saved, '', { kind: 'verification', sourceRunId: source.id }).imageIds).toEqual([record.session.upload.id, old.materials![0]!.id]);
  let archive = '';
  await writeHistoryExport(from.repository, async chunk => { archive += chunk; }, { aborted: false });
  const target = setup(); const bytes = new TextEncoder().encode(archive);
  await target.repository.importHistory(async function* () { yield bytes; }, { aborted: false });
  expect(await target.repository.read(record.session.id)).toEqual(saved);
});
