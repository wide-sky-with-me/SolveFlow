import { randomUUID } from 'node:crypto';
import { expect, it } from 'vitest';
import { LocalEngine } from './local-engine.js';
import { LocalDataError, LocalRepository, type LocalDocuments } from './local-repository.js';
import { makeSafeAgentError } from '@solveflow/contracts/agent';
import { LocalRecordSchema, StoredLocalRecordSchema } from '@solveflow/contracts/local';
function setup() {
  const values = new Map<string, string>(); const reads: string[] = [];
  const documents: LocalDocuments = { async get(key) { reads.push(key); return values.get(key) ?? null; }, async put(key, value) { values.set(key, value); }, async remove(key) { values.delete(key); }, async keys() { return [...values.keys()]; } };
  const repository = new LocalRepository(documents); return { values, reads, documents, repository, engine: new LocalEngine(repository, randomUUID) };
}

it.each([1, 2] as const)('reads historical model error text in v%s without treating the question as damaged or rewriting it', async version => {
  const { values, documents, repository, engine } = setup();
  const record = await engine.create('data:image/jpeg;base64,AQID', 30, 20);
  const error = makeSafeAgentError('MODEL_UNAVAILABLE', 'legacy-trace');
  record.session.runs.push({ schemaVersion: 1, id: randomUUID(), sessionId: record.session.id, status: 'failed', createdAt: record.session.createdAt, message: '', seq: 2, outcome: { schemaVersion: 1, status: 'failed', error, verified: false } });
  await repository.save(record);
  const legacyRecord = version === 1 ? record : StoredLocalRecordSchema.parse(JSON.parse(values.get(`record.${record.session.id}`)!));
  const raw = JSON.stringify(legacyRecord).replace(error.message, '指定模型暂不可用，请检查服务端配置。');
  expect((version === 1 ? LocalRecordSchema : StoredLocalRecordSchema).safeParse(JSON.parse(raw)).success).toBe(false);
  values.set(`record.${record.session.id}`, raw); const snapshot = [...values];
  const reopened = new LocalRepository(documents);
  expect((await reopened.read(record.session.id)).session.runs[0]?.outcome).toMatchObject({ error });
  expect((await reopened.readMetadata(record.session.id)).session.runs[0]?.outcome).toMatchObject({ error });
  expect(await reopened.listHistory()).toHaveLength(1);
  expect((await reopened.exportQuestion(record.session.id)).record.session.runs[0]?.outcome).toMatchObject({ error });
  expect(reopened.issues).toEqual([]); expect([...values]).toEqual(snapshot);
  for (const wrong of [raw.replace('指定模型暂不可用，请检查服务端配置。', 'PRIVATE_PROVIDER_ERROR'), raw.replace('"retryable":false', '"retryable":true'), raw.replace('"traceId":"legacy-trace"', '"traceId":"legacy-trace","stack":"PRIVATE_STACK"')]) {
    values.set(`record.${record.session.id}`, wrong);
    await expect(reopened.read(record.session.id)).rejects.toBeInstanceOf(LocalDataError);
    expect(values.get(`record.${record.session.id}`)).toBe(wrong);
  }
});
/** Models the Web adapter's classification while retaining the original non-string value. */
function damagedValue(documents: LocalDocuments, key: string, value: unknown) {
  const get = documents.get; const put = documents.put; const remove = documents.remove;
  let raw: unknown = value;
  documents.get = async reading => {
    if (reading !== key || raw === undefined) return get(reading);
    if (typeof raw !== 'string') throw new LocalDataError(key);
    return raw;
  };
  documents.put = async (writing, value) => { await put(writing, value); if (writing === key) raw = value; };
  documents.remove = async removing => { await remove(removing); if (removing === key) raw = undefined; };
  return () => raw;
}

it('rebuilds a non-string derived summary without rewriting the source question or reading its photo', async () => {
  const { documents, values, reads, repository, engine } = setup();
  const record = await engine.create('data:image/jpeg;base64,AQID', 30, 20);
  const source = values.get(`record.${record.session.id}`); const photo = values.get(`image.${record.session.id}`);
  const peek = damagedValue(documents, `summary.${record.session.id}`, { broken: true }); reads.length = 0;
  expect(await repository.listHistory()).toMatchObject([{ id: record.session.id }]);
  expect(peek()).toEqual(expect.any(String));
  expect(values.get(`record.${record.session.id}`)).toBe(source); expect(values.get(`image.${record.session.id}`)).toBe(photo);
  expect(reads.some(key => key.startsWith('image.'))).toBe(false); expect(repository.issues).toHaveLength(0);
});

it.each(['favorite', 'batch-title'] as const)('requires explicit repair before removing a non-string %s override', async kind => {
  const { documents, values, repository, engine } = setup();
  const record = await engine.create('data:image/jpeg;base64,AQID', 30, 20);
  const key = `${kind}.${record.session.id}`; const original = { broken: true };
  const source = [...values]; const peek = damagedValue(documents, key, original);
  if (kind === 'favorite') {
    expect(await repository.listHistory()).toEqual([]);
    expect(repository.issues).toContainEqual(expect.objectContaining({ key, repairable: true }));
  }
  expect(peek()).toBe(original); expect([...values]).toEqual(source);
  await repository.repairAuxiliary(key); expect(peek()).toBeUndefined();
  expect(await repository.listHistory()).toMatchObject([{ id: record.session.id }]); expect(repository.issues).toHaveLength(0);
  expect(values.get(`record.${record.session.id}`)).toBe(source.find(([key]) => key.startsWith('record.'))?.[1]);
});

it.each(['summary', 'favorite'] as const)('propagates %s read I/O failures and leaves storage untouched', async kind => {
  const { documents, values, repository, engine } = setup();
  const record = await engine.create('data:image/jpeg;base64,AQID', 30, 20); const snapshot = [...values];
  const key = `${kind}.${record.session.id}`; const get = documents.get;
  documents.get = async reading => { if (reading === key) throw new Error('storage unavailable'); return get(reading); };
  const operation = kind === 'summary' ? repository.listHistory() : repository.repairAuxiliary(key);
  await expect(operation).rejects.toThrow('storage unavailable');
  expect([...values]).toEqual(snapshot); expect(repository.issues).toHaveLength(0);
});
it('reads legacy false bookmarks across startup, history and export without changing the question', async () => {
  const { values, documents, engine } = setup();
  const record = await engine.create('data:image/jpeg;base64,AQID', 30, 20, 'tara');
  const rawRecord = values.get(`record.${record.session.id}`);
  values.set(`favorite.${record.session.id}`, JSON.stringify({ schemaVersion: 1, favorite: false }));
  const reopened = new LocalRepository(documents);
  await reopened.recoverInterrupted();
  expect(await reopened.listHistory()).toMatchObject([{ id: record.session.id, favorite: false }]);
  expect(await reopened.list()).toMatchObject([{ id: record.session.id, favorite: false }]);
  const exported = [];
  for await (const line of reopened.exportHistory(new AbortController().signal)) exported.push(line);
  expect(exported).toContainEqual(expect.objectContaining({ kind: 'question', favorite: false, record: expect.objectContaining({ exam: 'tara' }) }));
  expect(values.get(`record.${record.session.id}`)).toBe(rawRecord);
  await reopened.setFavorite(record.session.id, true);
  expect(await reopened.listHistory()).toMatchObject([{ favorite: true }]);
  await reopened.setFavorite(record.session.id, false);
  expect(values.has(`favorite.${record.session.id}`)).toBe(false);
});

it('isolates malformed bookmarks with a visible issue and preserves their original bytes', async () => {
  const { values, repository, engine } = setup();
  const record = await engine.create('data:image/jpeg;base64,AQID', 30, 20);
  const healthy = await engine.create('data:image/jpeg;base64,AQID', 30, 20);
  for (const value of [{ schemaVersion: 2, favorite: false }, { schemaVersion: 1, favorite: 'false' }, { schemaVersion: 1, favorite: false, extra: true }]) {
    values.set(`favorite.${record.session.id}`, JSON.stringify(value));
    await repository.recoverInterrupted();
    expect((await repository.listHistory()).map(row => row.id)).toEqual([healthy.session.id]);
    expect(repository.issues).toContainEqual(expect.objectContaining({ key: `favorite.${record.session.id}`, sessionId: record.session.id }));
    expect(values.get(`favorite.${record.session.id}`)).toBe(JSON.stringify(value));
  }
  await repository.repairAuxiliary(`favorite.${record.session.id}`);
  expect(await repository.listHistory()).toHaveLength(2); expect(repository.issues).toHaveLength(0);
});

it.each(['{invalid', ''])('isolates malformed source records (%j) without hiding healthy history or overwriting the original', async raw => {
  const { values, repository, engine } = setup(); const bad = await engine.create('data:image/jpeg;base64,AQID', 30, 20);
  const healthy = await engine.create('data:image/jpeg;base64,AQID', 30, 20);
  values.set(`record.${bad.session.id}`, raw); values.delete(`summary.${bad.session.id}`);
  await repository.recoverInterrupted();
  expect((await repository.listHistory()).map(row => row.id)).toEqual([healthy.session.id]);
  expect(values.get(`record.${bad.session.id}`)).toBe(raw);
  await expect(repository.repairAuxiliary(`record.${bad.session.id}`)).rejects.toThrow();
  await expect(engine.create('data:image/jpeg;base64,AQID', 30, 20)).resolves.toBeDefined();
});

it('does not misclassify storage I/O errors as corrupt data', async () => {
  const { documents, repository, engine } = setup(); await engine.create('data:image/jpeg;base64,AQID', 30, 20);
  documents.get = async () => { throw new Error('disk unavailable'); };
  await expect(repository.listHistory()).rejects.toThrow('disk unavailable'); expect(repository.issues).toHaveLength(0);
});

it('reports corruption discovered when opening a question even if its summary is still valid', async () => {
  const { values, repository, engine } = setup(); const record = await engine.create('data:image/jpeg;base64,AQID', 30, 20);
  await repository.listHistory(); let notices = 0;
  const unsubscribe = repository.subscribeIssues(() => { notices++; });
  values.set(`image.${record.session.id}`, '{broken');
  await expect(repository.read(record.session.id)).rejects.toThrow();
  expect(repository.issues).toContainEqual({ key: `image.${record.session.id}`, sessionId: record.session.id, repairable: false });
  await expect(repository.read(record.session.id)).rejects.toThrow(); expect(notices).toBe(1);
  unsubscribe();
});

it.each(['missing', 'invalid'] as const)('recovers interrupted metadata with a %s photo without blocking other records', async mode => {
  const { values, reads, repository, engine } = setup();
  const damaged = await engine.create('data:image/jpeg;base64,AQID', 30, 20, 'esat');
  const healthy = await engine.create('data:image/jpeg;base64,AQID', 30, 20, 'tmua');
  for (const record of [damaged, healthy]) {
    record.session.runs.push({ schemaVersion: 1, id: randomUUID(), sessionId: record.session.id, status: 'solving', createdAt: record.session.createdAt, message: '', seq: 2, outcome: null });
    await repository.save(record);
  }
  if (mode === 'missing') values.delete(`image.${damaged.session.id}`);
  else values.set(`image.${damaged.session.id}`, 'invalid image document');
  reads.length = 0;
  await repository.recoverInterrupted();
  expect(reads.some(key => key.startsWith('image.'))).toBe(false);
  expect(await repository.listHistory()).toHaveLength(2);
  for (const id of [damaged.session.id, healthy.session.id]) {
    expect((await repository.readMetadata(id)).session.runs[0]).toMatchObject({ status: 'failed', outcome: { error: { code: 'WORKER_LOST' } } });
  }
  await expect(repository.read(damaged.session.id)).rejects.toThrow();
  expect((await repository.read(healthy.session.id)).image).toBe(healthy.image);
  const snapshot = [...values]; await repository.recoverInterrupted(); expect([...values]).toEqual(snapshot);
  await engine.remove(damaged.session.id);
  expect(await repository.listHistory()).toMatchObject([{ id: healthy.session.id }]);
});
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

it('reuses a bounded summary snapshot and updates it after writes without rescanning storage', async () => {
  const { repository, engine, documents, reads } = setup();
  const record = await engine.create('data:image/jpeg;base64,AQID', 30, 20);
  await repository.listHistory({ cached: true });
  let scans = 0; const keys = documents.keys; documents.keys = async () => { scans++; return keys(); };
  reads.length = 0;
  await Promise.all(Array.from({ length: 20 }, () => repository.listHistory({ cached: true })));
  expect(scans).toBe(0); expect(reads).toEqual([]);
  record.session.subject = 'math'; await repository.save(record);
  await repository.setFavorite(record.session.id, true);
  expect(await repository.listHistory({ cached: true })).toMatchObject([{ subject: 'math', favorite: true }]);
  expect(scans).toBe(0);
  const detached = await repository.listHistory({ cached: true }); detached[0]!.subject = 'invalid';
  expect((await repository.listHistory({ cached: true }))[0]?.subject).toBe('math');
  await engine.remove(record.session.id);
  expect(await repository.listHistory({ cached: true })).toEqual([]);
});

it('stores photos separately and updates answers without rewriting immutable image bytes', async () => {
  const { repository, engine, documents, values } = setup();
  const record = await engine.create('data:image/jpeg;base64,' + 'AAAA'.repeat(100000), 1000, 1000);
  const written: { key: string; bytes: number }[] = []; const put = documents.put;
  documents.put = async (key, value) => { written.push({ key, bytes: value.length }); await put(key, value); };
  record.session.subject = 'math'; await repository.save(record);
  expect(written.some(row => row.bytes > 10000)).toBe(false);
  expect(JSON.parse(values.get(`record.${record.session.id}`)!)).not.toHaveProperty('image');
  expect((await repository.read(record.session.id)).image).toBe(record.image);
  await engine.remove(record.session.id); expect([...values.keys()]).toEqual([]);
});
it('reads legacy records and migrates them atomically on save without losing the photo', async () => {
  const { repository, engine, values } = setup(); const record = await engine.create('data:image/jpeg;base64,AQID', 30, 20);
  values.set(`record.${record.session.id}`, JSON.stringify(record));
  values.delete(`image.${record.session.id}`);
  expect((await repository.read(record.session.id)).image).toBe(record.image);
  await repository.save(record);
  expect(JSON.parse(values.get(`record.${record.session.id}`)!)).toMatchObject({ schemaVersion: 2 });
  expect((await repository.read(record.session.id)).image).toBe(record.image);
});

it('retains a legacy image and record if an atomic migration fails', async () => {
  const { values, documents, repository, engine } = setup(); const record = await engine.create('data:image/jpeg;base64,AQID', 30, 20);
  values.set(`record.${record.session.id}`, JSON.stringify(record)); values.delete(`image.${record.session.id}`); const before = [...values];
  documents.batch = async () => { throw new Error('transaction aborted'); };
  await expect(repository.save(record)).rejects.toThrow('transaction aborted');
  expect([...values]).toEqual(before); expect(await repository.read(record.session.id)).toEqual(record);
});
