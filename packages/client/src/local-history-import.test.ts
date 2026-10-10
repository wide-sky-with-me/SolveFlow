import { randomUUID } from 'node:crypto';
import { expect, it, vi } from 'vitest';
import { LocalEngine } from './local-engine.js';
import { LocalRepository, type LocalDocumentChange } from './local-repository.js';
import { planHistoryExport, writeHistoryExport } from './local-history-export.js';
import { readHistoryArchive } from './local-history-import.js';
import { makeSafeAgentError } from '@solveflow/contracts/agent';
function setup() {
  const values = new Map<string, string>(); let fail: ((changes: LocalDocumentChange[]) => boolean) | null = null;
  const repository = new LocalRepository({ async get(key) { return values.get(key) ?? null; }, async keys() { return [...values.keys()]; }, async put(key, value) { values.set(key, value); }, async remove(key) { values.delete(key); }, async batch(changes) {
    if (fail?.(changes)) throw new Error('disk full');
    for (const { key, value } of changes) if (value === null) values.delete(key); else values.set(key, value);
  } });
  return { values, repository, engine: new LocalEngine(repository, randomUUID), fail: (callback: typeof fail) => { fail = callback; } };
}
const jpeg = 'data:image/jpeg;base64,/9j/2wBDAAYEBQYFBAYGBQYHBwYIChAKCgkJChQODwwQFxQYGBcUFhYaHSUfGhsjHBYWICwgIyYnKSopGR8tMC0oMCUoKSj/2wBDAQcHBwoIChMKChMoGhYaKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCj/wAARCAACAAIDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAj/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFAEBAAAAAAAAAAAAAAAAAAAAAP/EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAMAwEAAhEDEQA/AKpAB//Z';
const signal = { aborted: false };
function source(text: string) { const bytes = new TextEncoder().encode(text); return async function* () { for (let i = 0; i < bytes.length; i += 7) yield bytes.slice(i, i + 7); }; }
async function archive(repository: LocalRepository) { let text = ''; await writeHistoryExport(repository, async line => { text += line; }, signal); return text; }
async function fixture() {
  const from = setup(); const record = await from.engine.create(jpeg, 2, 2); const runId = randomUUID();
  record.session.runs.push({ schemaVersion: 1, id: runId, sessionId: record.session.id, status: 'solving', message: '恢复中文题目', createdAt: record.session.createdAt, seq: 1, outcome: null });
  await from.repository.save(record); await from.repository.setFavorite(record.session.id, true);
  await from.repository.saveDiagnostics(runId, [{ schemaVersion: 1, runId, role: 'runtime', event: 'lifecycle', attempt: 0, elapsedMs: 1, reason: 'started' }]);
  return { from, record, runId, text: await archive(from.repository) };
}
it('imports historical safe error text while rejecting arbitrary provider text before writing anything', async () => {
  const from = setup(); const record = await from.engine.create(jpeg, 2, 2);
  const error = makeSafeAgentError('MODEL_UNAVAILABLE', 'legacy-trace');
  record.session.runs.push({ schemaVersion: 1, id: randomUUID(), sessionId: record.session.id, status: 'failed', message: '', createdAt: record.session.createdAt, seq: 1, outcome: { schemaVersion: 1, status: 'failed', error, verified: false } });
  await from.repository.save(record);
  const text = (await archive(from.repository)).replace(error.message, '指定模型暂不可用，请检查服务端配置。');
  const to = setup();
  await expect(to.repository.importHistory(source(text.replace('指定模型暂不可用，请检查服务端配置。', 'PRIVATE_ERROR')), signal)).rejects.toThrow('备份格式无效');
  expect([...to.values]).toEqual([]);
  expect(await to.repository.importHistory(source(text), signal)).toEqual({ restored: 1, skipped: 0 });
  expect((await to.repository.read(record.session.id)).session.runs[0]?.outcome).toMatchObject({ error });
});
it('splits a large library into independently restorable bounded volumes without changing photos', async () => {
  const from = setup(); const records = [];
  for (let i = 0; i < 5; i++) records.push(await from.engine.create(jpeg, 2, 2));
  const plan = await planHistoryExport(from.repository, signal, undefined, 2600);
  expect(plan.parts.length).toBeGreaterThan(1); expect(plan.skipped).toEqual([]);
  expect(plan.parts.flatMap(part => part.ids).sort()).toEqual(records.map(record => record.session.id).sort());
  const to = setup();
  for (const part of [...plan.parts].reverse()) {
    let text = ''; await writeHistoryExport(from.repository, async line => { text += line; }, signal, undefined, part.ids, 2600);
    expect(new TextEncoder().encode(text).byteLength).toBeLessThanOrEqual(2600);
    expect(await to.repository.importHistory(source(text), signal)).toEqual({ restored: part.ids.length, skipped: 0 });
    expect(await to.repository.importHistory(source(text), signal)).toEqual({ restored: 0, skipped: part.ids.length });
  }
  for (const record of records) expect((await to.repository.read(record.session.id)).image).toBe(jpeg);
});
it('plans healthy-only backup explicitly while preserving corrupt records and never ignores I/O failures', async () => {
  const from = setup(); const healthy = await from.engine.create(jpeg, 2, 2); const bad = await from.engine.create(jpeg, 2, 2);
  from.values.set(`image.${bad.session.id}`, 'broken');
  const plan = await planHistoryExport(from.repository, signal);
  expect(plan.parts.flatMap(part => part.ids)).toEqual([healthy.session.id]); expect(plan.skipped).toEqual([bad.session.id]);
  expect(from.values.get(`image.${bad.session.id}`)).toBe('broken');
  from.repository.exportQuestion = async () => { throw new Error('storage unavailable'); };
  await expect(planHistoryExport(from.repository, signal)).rejects.toThrow('storage unavailable');
});
it('counts malformed record keys as excluded and never reports an empty complete backup for them', async () => {
  const from = setup(); from.values.set('record.invalid-id', '{broken');
  expect(await planHistoryExport(from.repository, signal)).toEqual({ parts: [], skipped: ['record.invalid-id'] });
  await expect(archive(from.repository)).rejects.toThrow();
  expect(from.values.get('record.invalid-id')).toBe('{broken');
});
it('repairs only an explicitly selected damaged question after validating the whole backup', async () => {
  const { from, record, text } = await fixture(); const healthy = await from.engine.create(jpeg, 2, 2);
  const healthyBefore = from.values.get(`record.${healthy.session.id}`);
  from.values.set(`image.${record.session.id}`, 'broken'); const before = [...from.values];
  await expect(from.repository.restoreQuestion(source(text.slice(0, text.lastIndexOf('{'))), record.session.id, signal)).rejects.toThrow();
  expect([...from.values]).toEqual(before);
  from.fail(() => true); await expect(from.repository.restoreQuestion(source(text), record.session.id, signal)).rejects.toThrow(); expect([...from.values]).toEqual(before);
  from.fail(null); expect(await from.repository.restoreQuestion(source(text), record.session.id, signal)).toEqual({ restored: 1, skipped: 0 });
  expect((await from.repository.read(record.session.id)).image).toBe(jpeg);
  expect((await from.repository.read(record.session.id)).session.runs[0]?.status).toBe('failed');
  expect(from.values.get(`record.${healthy.session.id}`)).toBe(healthyBefore);
  await expect(from.repository.restoreQuestion(source(text), record.session.id, signal)).rejects.toThrow('正常');
});
it('round trips photos, favorites, diagnostics and UTF-8; interrupts pending work without executing it', async () => {
  const { record, runId, text } = await fixture(); const to = setup(); to.values.set('settings', 'PRIVATE');
  expect(await to.repository.importHistory(source(text), signal)).toEqual({ restored: 1, skipped: 0 });
  const saved = await to.repository.read(record.session.id);
  expect(saved.image).toBe(record.image); expect(saved.session.runs[0]).toMatchObject({ message: '恢复中文题目', status: 'failed', outcome: { error: { code: 'WORKER_LOST' } } });
  expect(await to.repository.listHistory()).toMatchObject([{ favorite: true, pending: false }]);
  expect(await to.repository.diagnostics(runId)).toMatchObject([{ reason: 'started' }]); expect(to.values.get('settings')).toBe('PRIVATE');
  const before = [...to.values]; expect(await to.repository.importHistory(source(text), signal)).toEqual({ restored: 0, skipped: 1 }); expect([...to.values]).toEqual(before);
});
it('restores unbookmarked questions without invalid favorite documents and can export them again', async () => {
  const from = setup(); const record = await from.engine.create(jpeg, 2, 2, 'tmua');
  const to = setup();
  expect(await to.repository.importHistory(source(await archive(from.repository)), signal)).toEqual({ restored: 1, skipped: 0 });
  expect(await to.repository.listHistory()).toMatchObject([{ id: record.session.id, favorite: false }]);
  expect(await to.repository.list()).toMatchObject([{ id: record.session.id, favorite: false }]);
  expect(to.values.has(`favorite.${record.session.id}`)).toBe(false);
  const restored = await to.repository.read(record.session.id); expect(restored.exam).toBe('tmua');
  const again = setup();
  expect(await again.repository.importHistory(source(await archive(to.repository)), signal)).toEqual({ restored: 1, skipped: 0 });
  expect(await again.repository.listHistory()).toMatchObject([{ favorite: false }]);
});
it('validates the entire file before any writes, including the completion marker and diagnostic ownership', async () => {
  const { text } = await fixture();
  for (const invalid of [text.slice(0, text.lastIndexOf('{')), text.replace('"count":1', '"count":2'), text.replace('"kind":"complete"', '"kind":"header"'), `${text}{}\n`, text.replace('"reason":"started"', '"reason":"unknown"')]) {
    const to = setup(); await expect(to.repository.importHistory(source(invalid), signal)).rejects.toThrow(); expect(to.values.size).toBe(0);
  }
});
it('rolls back only newly restored records on cancellation and transaction failure', async () => {
  const { from, text } = await fixture(); await from.engine.create(jpeg, 2, 2); const two = await archive(from.repository);
  for (const mode of ['cancel', 'failure']) {
    const to = setup(); await to.engine.create('data:image/jpeg;base64,AQID', 40, 40); const before = [...to.values]; const controller = new AbortController(); let writes = 0;
    if (mode === 'failure') to.fail(changes => changes.some(row => row.key.startsWith('record.') && row.value !== null) && ++writes === 2);
    await expect(to.repository.importHistory(source(mode === 'cancel' ? text : two), controller.signal, progress => { if (mode === 'cancel' && progress.phase === 'restoring') controller.abort(); })).rejects.toThrow();
    expect([...to.values]).toEqual(before);
  }
});
it('rejects duplicate records, cross-question run IDs and bad references', async () => {
  const { text, record } = await fixture(); const rows = text.trim().split('\n').map(line => JSON.parse(line));
  for (const change of ['duplicate', 'session', 'source']) {
    const changed = structuredClone(rows);
    if (change === 'duplicate') { changed[0].count = 2; changed[2].count = 2; changed.splice(2, 0, changed[1]); }
    if (change === 'session') changed[1].record.session.runs[0].sessionId = randomUUID();
    if (change === 'source') changed[1].record.session.runs[0].context = { kind: 'reply', sourceRunId: randomUUID() };
    const to = setup(); await expect(to.repository.importHistory(source(changed.map(row => JSON.stringify(row)).join('\n')), signal)).rejects.toThrow(); expect(to.values.size).toBe(0);
  }
  expect(record.session.runs.length).toBe(1);
});
it('preserves existing records and rejects orphan diagnostic collisions', async () => {
  const { text, runId } = await fixture(); const to = setup(); to.values.set(`diagnostic.${runId}`, 'EXISTING');
  await expect(to.repository.importHistory(source(text), signal)).rejects.toThrow('冲突'); expect([...to.values]).toEqual([[`diagnostic.${runId}`, 'EXISTING']]);
});
it('imports unrelated questions while retaining damaged and malformed existing records byte for byte', async () => {
  const { from, record } = await fixture();
  const added = await from.engine.create(jpeg, 2, 2);
  const to = setup();
  to.values.set(`record.${record.session.id}`, '{broken');
  to.values.set(`image.${record.session.id}`, 'original damaged image');
  to.values.set('record.invalid-id', 'original malformed key');
  expect(await to.repository.importHistory(source(await archive(from.repository)), signal)).toEqual({ restored: 1, skipped: 1 });
  expect((await to.repository.read(added.session.id)).image).toBe(jpeg);
  expect(to.values.get(`record.${record.session.id}`)).toBe('{broken');
  expect(to.values.get(`image.${record.session.id}`)).toBe('original damaged image');
  expect(to.values.get('record.invalid-id')).toBe('original malformed key');
  expect(to.repository.issues).toEqual(expect.arrayContaining([
    expect.objectContaining({ key: `record.${record.session.id}` }),
    expect.objectContaining({ key: 'record.invalid-id' }),
  ]));
});
it('reserves orphan diagnostic IDs even when imported runs have no diagnostics', async () => {
  const { text, runId } = await fixture();
  const rows = text.trim().split('\n').map(line => JSON.parse(line));
  rows[1].diagnostics = [];
  const to = setup(); const damaged = await to.engine.create(jpeg, 2, 2);
  to.values.set(`record.${damaged.session.id}`, '{broken');
  to.values.set(`diagnostic.${runId}`, 'original diagnostic');
  const before = new Map(to.values);
  await expect(to.repository.importHistory(source(rows.map(row => JSON.stringify(row)).join('\n')), signal)).rejects.toThrow('冲突');
  expect(to.values).toEqual(before);
});
it('retains known batch positions of damaged records and rejects conflicting imports', async () => {
  const from = setup(); const now = new Date().toISOString();
  const record = await from.engine.create(jpeg, 2, 2, 'general', { id: randomUUID(), title: '原批次', createdAt: now, exam: 'general', position: 1 });
  const to = setup(); const damaged = await to.engine.create(jpeg, 2, 2, 'general', record.batch);
  to.values.set(`record.${damaged.session.id}`, '{broken');
  const before = new Map(to.values);
  await expect(to.repository.importHistory(source(await archive(from.repository)), signal)).rejects.toThrow('批量序号');
  expect(to.values).toEqual(before);
});
it('does not confuse unavailable storage with damaged records during import', async () => {
  const { text } = await fixture(); const to = setup();
  await to.engine.create(jpeg, 2, 2);
  const unavailable = new LocalRepository({
    async keys() { return [...to.values.keys()]; },
    async get() { throw new Error('storage unavailable'); },
    async put() { throw new Error('unexpected write'); }, async remove() { throw new Error('unexpected delete'); },
    async batch() { throw new Error('unexpected transaction'); },
  });
  await expect(unavailable.importHistory(source(text), signal)).rejects.toThrow('storage unavailable');
});
it('checks valid run ownership even when its optional batch title is damaged', async () => {
  const { record, text, runId } = await fixture(); const to = setup();
  const batch = { id: randomUUID(), title: '原批次', createdAt: record.session.createdAt, exam: 'general' as const, position: 1 };
  const existing = await to.engine.create(jpeg, 2, 2, 'general', batch);
  existing.session.runs = record.session.runs.map(run => ({ ...run, sessionId: existing.session.id }));
  await to.repository.save(existing);
  to.values.set(`batch-title.${batch.id}`, '{broken');
  const before = new Map(to.values);
  await expect(to.repository.importHistory(source(text), signal)).rejects.toThrow('解答编号');
  expect(to.values).toEqual(before); expect(existing.session.runs[0]?.id).toBe(runId);
});
it('rejects malformed UTF-8 and excessive input chunks without writing', async () => {
  const to = setup();
  await expect(to.repository.importHistory(async function* () { yield Uint8Array.of(255); }, signal)).rejects.toThrow();
  await expect(to.repository.importHistory(async function* () { yield new Uint8Array(65_537); }, signal)).rejects.toThrow('容量');
  expect(to.values.size).toBe(0);
});
it('rejects a truncated second pass and rolls back its writes', async () => {
  const { text } = await fixture(); const to = setup(); let pass = 0;
  const reopen = () => source(++pass === 1 ? text : text.slice(0, text.lastIndexOf('{')))();
  await expect(to.repository.importHistory(reopen, signal)).rejects.toThrow(); expect(to.values.size).toBe(0);
});
it('accepts CRLF and empty archives, but rejects absent headers', async () => {
  const from = setup(); const text = await archive(from.repository); const to = setup();
  expect(await to.repository.importHistory(source(text.replaceAll('\n', '\r\n')), signal)).toEqual({ restored: 0, skipped: 0 });
  await expect(async () => { for await (const _ of readHistoryArchive(source('{}'), signal)) { /* consume */ } }).rejects.toThrow();
});

it('rejects JPEG byte-count and pixel-dimension mismatches before any restore', async () => {
  const { text } = await fixture();
  for (const kind of ['width', 'bytes', 'header']) {
    const rows = text.trim().split('\n').map(line => JSON.parse(line));
    if (kind === 'width') rows[1].record.session.upload.width = 2048;
    if (kind === 'bytes') rows[1].record.session.upload.bytes++;
    if (kind === 'header') rows[1].record.image = rows[1].record.image.replace('/9j/', 'AQID');
    const to = setup(); await expect(to.repository.importHistory(source(rows.map(row => JSON.stringify(row)).join('\n')), signal)).rejects.toThrow(); expect(to.values.size).toBe(0);
  }
});

it('keeps supplementary images out of metadata and round-trips them with run snapshots', async () => {
  const from = setup(); const record = await from.engine.create(jpeg, 2, 2);
  const originalImage = from.values.get(`image.${record.session.id}`);
  const added = await from.engine.addMaterial(record.session.id, jpeg, 2, 2);
  const material = added.materials![0]!;
  expect(from.values.get(`image.${record.session.id}`)).toBe(originalImage);
  expect(from.values.get(`record.${record.session.id}`)).not.toContain('base64');
  const materialKey = `material.${record.session.id}.${material.id}`;
  const originalMaterial = from.values.get(materialKey);
  const candidate = { schemaVersion: 1 as const, kind: 'answer' as const, problem: { text: 'x+1=3', subject: 'math', uncertainties: [] }, answer: '2', steps: [], knowledgePoints: [], citationIds: [], clarificationQuestions: [] };
  const outcome = { schemaVersion: 1 as const, status: 'completed' as const, candidate, verified: false, verificationStatus: 'not_requested' as const, warning: null, verification: null };
  const first = await from.engine.start(record.session.id, 'solve', undefined, async input => {
    expect(input.materials?.map(item => item.id)).toEqual([material.id]);
    return outcome;
  });
  await from.engine.waitForIdle();
  await from.engine.addMaterial(record.session.id, jpeg, 2, 2);
  await from.engine.start(record.session.id, 'verify old answer', { kind: 'verification', sourceRunId: first.id }, async input => {
    expect(input.materials?.map(item => item.id)).toEqual([material.id]);
    expect(input.verificationTarget).toEqual(candidate);
    return outcome;
  });
  await from.engine.waitForIdle();
  expect(from.values.get(materialKey)).toBe(originalMaterial);
  const target = setup();
  await target.repository.importHistory(source(await archive(from.repository)), signal);
  expect(await target.repository.read(record.session.id)).toEqual(await from.repository.read(record.session.id));
  await target.engine.remove(record.session.id);
  expect([...target.values.keys()].some(key => key.startsWith('material.'))).toBe(false);
});
it('rejects failed material transactions, missing evidence, and exceeding the photo cap', async () => {
  const from = setup(); const record = await from.engine.create(jpeg, 2, 2);
  const original = new Map(from.values);
  from.fail(changes => changes.some(change => change.key.startsWith('material.')));
  await expect(from.engine.addMaterial(record.session.id, jpeg, 2, 2)).rejects.toThrow('disk full');
  expect(from.values).toEqual(original);
  from.fail(null);
  for (let i = 0; i < 7; i++) await from.engine.addMaterial(record.session.id, jpeg, 2, 2);
  const complete = new Map(from.values);
  await expect(from.engine.addMaterial(record.session.id, jpeg, 2, 2)).rejects.toThrow();
  expect(from.values).toEqual(complete);
  const key = [...from.values.keys()].find(key => key.startsWith('material.'))!;
  const backup = await archive(from.repository);
  from.values.delete(key);
  await expect(from.repository.read(record.session.id)).rejects.toThrow('原数据已保留');
  await from.repository.restoreQuestion(source(backup), record.session.id, signal);
  expect((await from.repository.read(record.session.id)).materials).toHaveLength(7);
});
it('does not serialize saved material pixels again when saving answer metadata', async () => {
  const from = setup(); const record = await from.engine.create(jpeg, 2, 2);
  const added = await from.engine.addMaterial(record.session.id, jpeg, 2, 2);
  const spy = vi.spyOn(JSON, 'stringify');
  try {
    await from.repository.save(added);
    const isPhoto = (value: unknown) => typeof value === 'object' && value !== null && 'image' in value && value.image === jpeg;
    expect(spy.mock.calls.filter(([value]) => isPhoto(value))).toHaveLength(0);
  } finally { spy.mockRestore(); }
});
