import { randomUUID } from 'node:crypto';
import { expect, it } from 'vitest';
import { LocalHistoryExportLineSchema } from '@solveflow/contracts/local';
import { LocalEngine } from './local-engine.js';
import { LocalRepository } from './local-repository.js';
import { writeHistoryExport } from './local-history-export.js';

function setup() {
  const values = new Map<string, string>(); const reads: string[] = [];
  const repository = new LocalRepository({ async get(key) { reads.push(key); return values.get(key) ?? null; }, async keys() { return [...values.keys()]; }, async put(key, value) { values.set(key, value); }, async remove(key) { values.delete(key); } });
  return { values, reads, repository, engine: new LocalEngine(repository, randomUUID) };
}
it('supports native AbortSignal implementations without throwIfAborted', async () => {
  const { repository } = setup(); const chunks: string[] = [];
  expect(await writeHistoryExport(repository, async text => { chunks.push(text); }, { aborted: false })).toBe(0);
  expect(chunks).toHaveLength(2);
  await expect(writeHistoryExport(repository, async () => {}, { aborted: true })).rejects.toThrow('导出已取消');
});
it('exports every saved answer, photo, bookmark and bound diagnostic, without reading settings or unrelated metadata', async () => {
  const { repository, engine, values, reads } = setup(); const record = await engine.create('data:image/jpeg;base64,AQID', 30, 20);
  const runId = randomUUID(); record.session.runs.push({ schemaVersion: 1, id: runId, sessionId: record.session.id, status: 'cancelled', outcome: null, message: '历史提问', createdAt: record.session.createdAt, seq: 0 });
  await repository.save(record); await repository.setFavorite(record.session.id, true);
  await repository.saveDiagnostics(runId, [{ schemaVersion: 1, runId, role: 'runtime', event: 'lifecycle', attempt: 0, elapsedMs: 1, reason: 'cancelled' }]);
  values.set('settings', 'PRIVATE_SETTINGS_SENTINEL'); values.set('unrelated.secret', 'SECRET_SENTINEL'); values.set(`diagnostic.${randomUUID()}`, 'UNRELATED_DIAGNOSTIC');
  reads.length = 0; const before = [...values]; const chunks: string[] = [];
  await writeHistoryExport(repository, async text => { chunks.push(text); }, new AbortController().signal);
  const rows = chunks.map(text => LocalHistoryExportLineSchema.parse(JSON.parse(text)));
  expect(rows[0]).toMatchObject({ kind: 'header', format: 'solveflow-history', count: 1 });
  expect(rows[1]).toMatchObject({ kind: 'question', record, favorite: true, diagnostics: [{ runId, entries: [{ reason: 'cancelled' }] }] });
  expect(rows[2]).toEqual({ schemaVersion: 1, kind: 'complete', count: 1 });
  expect(reads).not.toContain('settings'); expect(reads).not.toContain('unrelated.secret'); expect(chunks.join('')).not.toContain('SENTINEL'); expect([...values]).toEqual(before);
});
it('does not finish a cancelled or failed export and propagates sink errors', async () => {
  const { repository, engine } = setup(); await engine.create('data:image/jpeg;base64,AQID', 30, 20);
  const controller = new AbortController(); const chunks: string[] = [];
  await expect(writeHistoryExport(repository, async text => { chunks.push(text); controller.abort(); }, controller.signal)).rejects.toThrow();
  expect(chunks.some(text => text.includes('"kind":"complete"'))).toBe(false);
  await expect(writeHistoryExport(repository, async () => { throw new Error('disk full'); }, new AbortController().signal)).rejects.toThrow('disk full');
});
it('rejects diagnostics belonging to a different run and writes no completion marker', async () => {
  const { repository, engine, values } = setup(); const record = await engine.create('data:image/jpeg;base64,AQID', 30, 20); const id = randomUUID();
  record.session.runs.push({ schemaVersion: 1, id, sessionId: record.session.id, status: 'cancelled', outcome: null, message: '', createdAt: record.session.createdAt, seq: 0 }); await repository.save(record);
  values.set(`diagnostic.${id}`, JSON.stringify({ schemaVersion: 1, runId: randomUUID(), entries: [] }));
  const chunks: string[] = []; await expect(writeHistoryExport(repository, async text => { chunks.push(text); }, new AbortController().signal)).rejects.toThrow();
  expect(chunks.some(text => text.includes('"kind":"complete"'))).toBe(false);
});
