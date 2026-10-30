import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { expect, it, vi } from 'vitest';
import { LocalExportTasks } from '@solveflow/client/local';
import { createNativeExportTaskStore, type NativeExportDatabase } from './export-task-store.native';

vi.mock('expo-sqlite', () => ({ openDatabaseAsync: vi.fn() }));
function setup() {
  const db = new DatabaseSync(':memory:');
  db.exec('CREATE TABLE tasks(id TEXT PRIMARY KEY,value TEXT); CREATE TABLE files(id TEXT PRIMARY KEY,name TEXT,mime TEXT,data BLOB)');
  const queries = {
    // The same parameterized SQL is executed on SQLite; the production adapter validates its rows.
    getFirstAsync: async <T>(sql: string, ...args: (string | number | Uint8Array)[]) => (db.prepare(sql).get(...args) ?? null) as T | null,
    getAllAsync: async <T>(sql: string, ...args: (string | number | Uint8Array)[]) => db.prepare(sql).all(...args) as T[],
    runAsync: async (sql: string, ...args: (string | number | Uint8Array)[]) => db.prepare(sql).run(...args),
  };
  const database: NativeExportDatabase = { ...queries, async withExclusiveTransactionAsync(work) {
    db.exec('BEGIN'); try { await work(queries); db.exec('COMMIT'); } catch (cause) { db.exec('ROLLBACK'); throw cause; }
  } };
  const store = createNativeExportTaskStore(async () => database);
  return { db, store };
}
const metadata = { batchId: randomUUID(), title: 'Synthetic native export', mode: 'questions' as const, layout: 'direct' as const, copies: 1, questionCount: 1 };
const artifact = { name: 'synthetic.pdf', mimeType: 'application/pdf' as const, data: new TextEncoder().encode('%PDF-1.3\nsynthetic') };

it('stores actual BLOB bytes, survives manager restart, and rolls back atomic record/file deletion', async () => {
  const { store, db } = setup();
  try {
    const tasks = new LocalExportTasks({ store, uuid: randomUUID }); await tasks.initialize();
    const task = await tasks.enqueue(metadata, async () => artifact); await tasks.waitForIdle();
    expect(tasks.getSnapshot()[0]?.status).toBe('succeeded');
    const recovered = new LocalExportTasks({ store, uuid: randomUUID }); await recovered.initialize();
    expect(await recovered.readFile(task.id)).toEqual(artifact);
    expect((await store.usage()).usedBytes).toBe(artifact.data.length);
    db.exec("CREATE TRIGGER fail_delete BEFORE DELETE ON tasks BEGIN SELECT RAISE(ABORT,'synthetic failure'); END");
    await expect(recovered.remove(task.id)).rejects.toThrow();
    expect(await recovered.readFile(task.id)).toEqual(artifact);
    db.exec('DROP TRIGGER fail_delete'); await recovered.remove(task.id);
    expect(await store.list()).toEqual([]); expect((await store.usage()).usedBytes).toBe(0);
  } finally { db.close(); }
});
it('save retry writes the already-generated artifact once and never reruns the renderer', async () => {
  const { store, db } = setup();
  try {
    const tasks = new LocalExportTasks({ store, uuid: randomUUID }); await tasks.initialize();
    db.exec("CREATE TRIGGER full_disk BEFORE INSERT ON files BEGIN SELECT RAISE(ABORT,'SQLITE_FULL'); END");
    const runner = vi.fn(async () => artifact); const task = await tasks.enqueue(metadata, runner); await tasks.waitForIdle();
    expect(tasks.pendingFileIds).toContain(task.id); expect(tasks.getSnapshot()[0]?.error).toContain('存储空间不足');
    expect(await tasks.readPendingFile(task.id)).toEqual(artifact);
    db.exec('DROP TRIGGER full_disk'); await tasks.retrySave(task.id);
    expect(runner).toHaveBeenCalledTimes(1); expect((await store.usage()).usedBytes).toBe(artifact.data.length);
  } finally { db.close(); }
});
it('cancellation discards late output and restart marks unfinished records interrupted without replay', async () => {
  const { store, db } = setup();
  try {
    let done: ((value: typeof artifact) => void) | undefined;
    const tasks = new LocalExportTasks({ store, uuid: randomUUID }); await tasks.initialize();
    const task = await tasks.enqueue(metadata, () => new Promise(resolve => { done = resolve; }));
    while (!done) await new Promise(resolve => setTimeout(resolve, 0));
    await tasks.cancel(task.id); done(artifact); await tasks.waitForIdle();
    expect(await store.readFile(task.id)).toBeNull();
    const stopped = tasks.getSnapshot()[0]!;
    await store.save({ ...stopped, file: null, status: 'running', startedAt: stopped.createdAt, finishedAt: null, error: null });
    const restarted = new LocalExportTasks({ store, uuid: randomUUID }); await restarted.initialize();
    expect(restarted.getSnapshot()[0]?.status).toBe('interrupted');
  } finally { db.close(); }
});
