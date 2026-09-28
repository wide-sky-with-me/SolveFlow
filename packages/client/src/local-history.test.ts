import { randomUUID } from 'node:crypto';
import { expect, it } from 'vitest';
import { LocalEngine } from './local-engine.js';
import { LocalRepository, type LocalDocuments } from './local-repository.js';
import { makeSafeAgentError } from '@solveflow/contracts/agent';
function setup() {
  const values = new Map<string, string>(); const reads: string[] = [];
  const documents: LocalDocuments = { async get(key) { reads.push(key); return values.get(key) ?? null; }, async put(key, value) { values.set(key, value); }, async remove(key) { values.delete(key); }, async keys() { return [...values.keys()]; } };
  const repository = new LocalRepository(documents); return { values, reads, documents, repository, engine: new LocalEngine(repository, randomUUID) };
}
it('migrates old records once and lists summaries after restart without reading photos or answers', async () => {
  const { values, reads, documents, engine } = setup();
  const record = await engine.create('data:image/jpeg;base64,' + 'AAAA'.repeat(300000), 1000, 1000);
  values.delete(`summary.${record.session.id}`);
  let repository = new LocalRepository(documents);
  expect(await repository.listHistory()).toMatchObject([{ id: record.session.id, text: '已保存的题目', pending: false }]);
  expect(values.has(`summary.${record.session.id}`)).toBe(true);
  reads.length = 0; repository = new LocalRepository(documents);
  await repository.listHistory(); await repository.recoverInterrupted();
  expect(reads.some(key => key.startsWith('record.'))).toBe(false);
  expect(values.get(`summary.${record.session.id}`)!.length).toBeLessThan(1000);
});
it('rebuilds missing, corrupt and mismatched summary caches from the source and never shows orphan summaries', async () => {
  const { values, repository, engine } = setup(); const record = await engine.create('data:image/jpeg;base64,AQID', 30, 20);
  for (const raw of ['bad json', JSON.stringify({ schemaVersion: 1, id: randomUUID(), subject: 'math', createdAt: record.session.createdAt, text: 'wrong', pending: false })]) {
    values.set(`summary.${record.session.id}`, raw);
    expect((await repository.listHistory())[0]?.id).toBe(record.session.id);
  }
  values.delete(`record.${record.session.id}`); expect(await repository.listHistory()).toEqual([]);
});
it('refreshes summaries on solver writes while keeping favorites independent and recovery accurate', async () => {
  const { repository, engine } = setup(); const record = await engine.create('data:image/jpeg;base64,AQID', 30, 20);
  record.session.runs.push({ schemaVersion: 1, id: randomUUID(), sessionId: record.session.id, status: 'solving', createdAt: record.session.createdAt, message: '', seq: 0, outcome: null });
  await repository.save(record); await repository.setFavorite(record.session.id, true);
  expect((await repository.listHistory())[0]).toMatchObject({ pending: true, favorite: true });
  await repository.recoverInterrupted(); expect((await repository.listHistory())[0]).toMatchObject({ pending: false, favorite: true });
  expect((await repository.read(record.session.id)).session.runs[0]?.status).toBe('failed');
});
it('clears all question data including orphan diagnostics without reading images or removing settings', async () => {
  const { values, reads, repository, engine } = setup(); const record = await engine.create('data:image/jpeg;base64,AQID', 30, 20);
  await repository.setFavorite(record.session.id, true);
  values.set(`diagnostic.${randomUUID()}`, 'orphan'); values.set('settings', 'keep'); values.set('unrelated', 'keep'); reads.length = 0;
  await engine.removeAll(); expect(await repository.listHistory()).toEqual([]);
  expect(reads.some(key => key.startsWith('record.'))).toBe(false);
  expect([...values.entries()]).toEqual([['settings', 'keep'], ['unrelated', 'keep']]);
});
it('clearing waits for in-flight preparation, cancels late results and blocks new work until deletion ends', async () => {
  const { engine, repository } = setup(); const record = await engine.create('data:image/jpeg;base64,AQID', 30, 20);
  let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
  const starting = engine.start(record.session.id, '', undefined, async (input, signal) => { await gate; expect(signal.aborted).toBe(true); return { schemaVersion: 1, status: 'failed', verified: false, error: makeSafeAgentError('MODEL_UNAVAILABLE', input.identity.runId) }; });
  const deleting = engine.removeAll(); await starting;
  await expect(engine.create('data:image/jpeg;base64,AQID', 30, 20)).rejects.toThrow('删除');
  await expect(engine.start(record.session.id, '', undefined, async () => { throw new Error('must not run'); })).rejects.toThrow('删除');
  release(); await deleting; expect(engine.actives).toEqual([]); expect(await repository.listHistory()).toEqual([]);
});
it('a failed nontransactional save invalidates the summary and rebuilds it from the preserved record', async () => {
  const { repository, engine, documents } = setup(); const record = await engine.create('data:image/jpeg;base64,AQID', 30, 20);
  const put = documents.put; documents.put = async (key, value) => { if (key.startsWith('record.')) throw new Error('disk full'); await put(key, value); };
  record.session.subject = 'english'; await expect(repository.save(record)).rejects.toThrow('disk full');
  expect((await repository.listHistory())[0]?.subject).toBe('general');
});
it('production batch failure keeps records intact and releases the engine deletion guard for retry', async () => {
  const { values, documents, repository, engine } = setup(); const record = await engine.create('data:image/jpeg;base64,AQID', 30, 20);
  const snapshot = [...values.entries()]; let calls = 0;
  documents.batch = async () => { calls++; throw new Error('transaction aborted'); };
  await expect(engine.removeAll()).rejects.toThrow('transaction aborted'); expect(calls).toBe(1); expect([...values.entries()]).toEqual(snapshot);
  documents.batch = async changes => { for (const { key, value } of changes) { if (value === null) values.delete(key); else values.set(key, value); } };
  await engine.removeAll(); await expect(repository.read(record.session.id)).rejects.toThrow('已删除');
});
it('clearing cancels all three auxiliary requests and drains diagnostics before removing their source', async () => {
  const { repository, engine, values } = setup(); const record = await engine.create('data:image/jpeg;base64,AQID', 30, 20);
  const outcome = { schemaVersion: 1 as const, status: 'completed' as const, verified: false, verificationStatus: 'not_requested' as const, verification: null, warning: null, candidate: { schemaVersion: 1 as const, kind: 'answer' as const, problem: { text: 'x+1=3', subject: 'math', uncertainties: [] }, answer: 'x=2', steps: [], knowledgePoints: [], citationIds: [], clarificationQuestions: [] } };
  await engine.start(record.session.id, '', undefined, async () => outcome); await engine.waitForIdle(); const sourceRunId = (await repository.read(record.session.id)).session.runs[0]!.id;
  const releases: Array<() => void> = [];
  for (const kind of ['explanation', 'knowledge-list', 'verification'] as const) await engine.start(record.session.id, '', { kind, sourceRunId }, async (_input, signal) => { await new Promise<void>(resolve => releases.push(resolve)); expect(signal.aborted).toBe(true); return outcome; });
  expect(engine.actives).toHaveLength(3); const deleting = engine.removeAll();
  await new Promise(resolve => setTimeout(resolve, 0)); releases.forEach(release => release()); await deleting;
  expect(engine.actives).toEqual([]); expect([...values.keys()]).toEqual([]);
});
it('rejects an invalid single-question ID without interpreting it as clear-all', async () => {
  const { repository, engine } = setup(); const record = await engine.create('data:image/jpeg;base64,AQID', 30, 20);
  await expect(engine.remove('')).rejects.toThrow(); expect((await repository.read(record.session.id)).session.id).toBe(record.session.id);
});

it('lists many saved questions through one bulk metadata read and still rebuilds corrupt summaries', async () => {
  const { values, reads, documents, repository, engine } = setup();
  const records: Awaited<ReturnType<LocalEngine['create']>>[] = [];
  for (let i = 0; i < 20; i++) records.push(await engine.create('data:image/jpeg;base64,AQID', 30, 20));
  await repository.setFavorite(records[3]!.session.id, true);
  const requests: string[][] = [];
  documents.getMany = async keys => { requests.push([...keys]); return keys.map(key => values.get(key) ?? null); };
  reads.length = 0;
  const result = await repository.listHistory();
  expect(result).toHaveLength(20); expect(result.find(row => row.id === records[3]!.session.id)?.favorite).toBe(true);
  expect(requests).toHaveLength(1); expect(requests[0]).toHaveLength(40); expect(reads).toEqual([]);
  values.set(`summary.${records[0]!.session.id}`, 'corrupt');
  expect(await repository.listHistory()).toHaveLength(20);
  expect(reads).toEqual([`record.${records[0]!.session.id}`]);
  documents.getMany = async () => { throw new Error('read failed'); };
  await expect(repository.listHistory()).rejects.toThrow('read failed');
  documents.getMany = async () => [];
  await expect(repository.listHistory()).rejects.toThrow('本地批量读取失败');
});
