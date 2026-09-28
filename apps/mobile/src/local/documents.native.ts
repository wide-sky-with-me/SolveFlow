import { openDatabaseAsync } from 'expo-sqlite';
import type { LocalDocuments } from '@solveflow/client';
import { MAX_LOCAL_RECORDS } from '@solveflow/contracts/local';
let opening: Promise<LocalDocuments> | null = null;
export function openDocuments(): Promise<LocalDocuments> {
  opening ??= (async (): Promise<LocalDocuments> => {
    const database = await openDatabaseAsync('solveflow-local.db');
    try {
      const version = await database.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
      if (!version || ![0, 1].includes(version.user_version)) throw new Error('本地数据库来自更高版本，请更新应用后打开。');
      await database.execAsync('PRAGMA journal_mode = WAL; PRAGMA secure_delete = ON; CREATE TABLE IF NOT EXISTS documents (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL); PRAGMA user_version = 1;');
      return {
        async get(key: string) { return (await database.getFirstAsync<{ value: string }>('SELECT value FROM documents WHERE key = ?', key))?.value ?? null; },
        async getMany(keys) {
          if (keys.length > MAX_LOCAL_RECORDS * 2) throw new Error('读取条目数量超限。');
          const values = new Map<string, string>();
          for (let offset = 0; offset < keys.length; offset += 256) {
            const chunk = keys.slice(offset, offset + 256);
            const rows = await database.getAllAsync<{ key: string; value: string }>(`SELECT key, value FROM documents WHERE key IN (${chunk.map(() => '?').join(',')})`, ...chunk);
            for (const row of rows) values.set(row.key, row.value);
          }
          return keys.map(key => values.get(key) ?? null);
        },
        async put(key: string, value: string) { await database.runAsync('INSERT INTO documents(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', key, value); },
        async remove(key: string) { await database.runAsync('DELETE FROM documents WHERE key = ?', key); },
        async keys() { return (await database.getAllAsync<{ key: string }>('SELECT key FROM documents')).map(row => row.key); },
        async batch(changes) { await database.withExclusiveTransactionAsync(async transaction => {
          await transaction.execAsync('PRAGMA secure_delete = ON;');
          for (const { key, value } of changes) {
            if (value === null) await transaction.runAsync('DELETE FROM documents WHERE key = ?', key);
            else await transaction.runAsync('INSERT INTO documents(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', key, value);
          }
        }); },
      };
    } catch (cause) {
      // Initialization never transfers ownership of a failed connection.
      await database.closeAsync().catch(() => {});
      throw cause;
    }
  })().catch((cause: unknown) => { opening = null; throw cause; });
  return opening;
}
