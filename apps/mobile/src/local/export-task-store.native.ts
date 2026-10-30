// Decision: .agents/notes/implemented/storage/2026-10-30-native-quick-pdf.md
import { openDatabaseAsync, type SQLiteDatabase } from 'expo-sqlite';
import { ExportTaskSchema, ExportTaskFileSchema, MAX_EXPORT_STORED_BYTES, MAX_EXPORT_TASK_RECORDS, type ExportStorageUsage } from '@solveflow/contracts/local';
import { ExportTaskStorageError, type LocalExportTaskStore } from '@solveflow/client/local';

type BindValue = string | number | Uint8Array;
interface ExportQueries {
  getFirstAsync<T>(sql: string, ...values: BindValue[]): Promise<T | null>;
  getAllAsync<T>(sql: string, ...values: BindValue[]): Promise<T[]>;
  runAsync(sql: string, ...values: BindValue[]): Promise<unknown>;
}
export interface NativeExportDatabase extends ExportQueries {
  withExclusiveTransactionAsync(work: (transaction: ExportQueries) => Promise<void>): Promise<void>;
}

let opening: Promise<SQLiteDatabase> | null = null;
function open() {
  opening ??= (async () => {
    const db = await openDatabaseAsync('solveflow-exports.db');
    try {
      const version = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
      if (!version || ![0, 1].includes(version.user_version)) throw new ExportTaskStorageError('integrity');
      await db.execAsync('PRAGMA journal_mode=WAL; PRAGMA secure_delete=ON; PRAGMA busy_timeout=10000; CREATE TABLE IF NOT EXISTS tasks(id TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL); CREATE TABLE IF NOT EXISTS files(id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL, mime TEXT NOT NULL, data BLOB NOT NULL); PRAGMA user_version=1;');
      return db;
    } catch (cause) { await db.closeAsync().catch(() => {}); throw cause; }
  })().catch((cause: unknown) => { opening = null; throw cause; });
  return opening;
}
function storageFailure(cause: unknown) {
  if (cause instanceof ExportTaskStorageError) return cause;
  return new ExportTaskStorageError(cause instanceof Error && /SQLITE_FULL|disk is full|No space left/i.test(cause.message) ? 'quota' : 'unavailable');
}
export function createNativeExportTaskStore(database: () => Promise<NativeExportDatabase> = open): LocalExportTaskStore & { usage(): Promise<ExportStorageUsage> } {
  async function checked<T>(action: (db: NativeExportDatabase) => Promise<T>): Promise<T> {
    try { return await action(await database()); } catch (cause) { throw storageFailure(cause); }
  }
  return {
    list: () => checked(async db => {
      const rows = await db.getAllAsync<{ value: string }>('SELECT value FROM tasks LIMIT ?', MAX_EXPORT_TASK_RECORDS + 1);
      return rows.map(row => ExportTaskSchema.parse(JSON.parse(row.value)));
    }),
    save: task => checked(async db => {
      const value = ExportTaskSchema.parse(task);
      await db.runAsync('INSERT INTO tasks(id,value) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value', value.id, JSON.stringify(value));
    }),
    remove: id => checked(db => db.withExclusiveTransactionAsync(async tx => {
      await tx.runAsync('DELETE FROM files WHERE id=?', id);
      await tx.runAsync('DELETE FROM tasks WHERE id=?', id);
    })),
    writeFile: (id, artifact) => checked(db => db.withExclusiveTransactionAsync(async tx => {
      const file = ExportTaskFileSchema.parse({ name: artifact.name, mimeType: artifact.mimeType, bytes: artifact.data.byteLength });
      const exists = await tx.getFirstAsync<{ id: string }>('SELECT id FROM tasks WHERE id=?', id);
      if (!exists) throw new ExportTaskStorageError('integrity');
      const usage = await tx.getFirstAsync<{ bytes: number }>('SELECT coalesce(sum(length(data)),0) AS bytes FROM files WHERE id<>?', id);
      if (!usage || !Number.isSafeInteger(usage.bytes) || usage.bytes < 0) throw new ExportTaskStorageError('integrity');
      if (usage.bytes + file.bytes > MAX_EXPORT_STORED_BYTES) throw new ExportTaskStorageError('capacity');
      await tx.runAsync('INSERT INTO files(id,name,mime,data) VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,mime=excluded.mime,data=excluded.data', id, file.name, file.mimeType, artifact.data);
    })),
    readFile: id => checked(async db => {
      const value = await db.getFirstAsync<{ name: string; mime: string; data: Uint8Array }>('SELECT name,mime,data FROM files WHERE id=?', id);
      if (!value) return null;
      if (!(value.data instanceof Uint8Array)) throw new ExportTaskStorageError('integrity');
      const meta = ExportTaskFileSchema.parse({ name: value.name, mimeType: value.mime, bytes: value.data.byteLength });
      return { name: meta.name, mimeType: meta.mimeType, data: value.data };
    }),
    removeFile: id => checked(async db => { await db.runAsync('DELETE FROM files WHERE id=?', id); }),
    usage: () => checked(async db => {
      const value = await db.getFirstAsync<{ bytes: number; count: number }>('SELECT coalesce(sum(length(data)),0) AS bytes,count(*) AS count FROM files');
      if (!value || !Number.isSafeInteger(value.bytes) || value.bytes < 0 || value.bytes > MAX_EXPORT_STORED_BYTES || value.count > MAX_EXPORT_TASK_RECORDS) throw new ExportTaskStorageError('integrity');
      return { usedBytes: value.bytes, limitBytes: MAX_EXPORT_STORED_BYTES, availableBytes: MAX_EXPORT_STORED_BYTES - value.bytes, fileCount: value.count, browserAvailableBytes: null };
    }),
  };
}
