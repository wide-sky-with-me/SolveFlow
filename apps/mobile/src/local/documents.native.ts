import { openDatabaseAsync } from 'expo-sqlite';
import type { LocalDocuments } from '@solveflow/client';
let opening: Promise<LocalDocuments> | null = null;
export function openDocuments(): Promise<LocalDocuments> {
  opening ??= (async () => {
    const database = await openDatabaseAsync('solveflow-local.db');
    const version = await database.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
    if (!version || ![0, 1].includes(version.user_version)) { await database.closeAsync(); throw new Error('本地数据库来自更高版本，请更新应用后打开。'); }
    await database.execAsync('PRAGMA journal_mode = WAL; PRAGMA secure_delete = ON; CREATE TABLE IF NOT EXISTS documents (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL); PRAGMA user_version = 1;');
    return {
      async get(key: string) { return (await database.getFirstAsync<{ value: string }>('SELECT value FROM documents WHERE key = ?', key))?.value ?? null; },
      async put(key: string, value: string) { await database.runAsync('INSERT INTO documents(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', key, value); },
      async remove(key: string) { await database.runAsync('DELETE FROM documents WHERE key = ?', key); },
      async keys() { return (await database.getAllAsync<{ key: string }>('SELECT key FROM documents')).map(row => row.key); },
    };
  })();
  return opening;
}
