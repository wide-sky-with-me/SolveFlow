import { openDatabaseAsync } from 'expo-sqlite';
import type { LocalDocuments } from '@solveflow/client/local';
import { createSQLiteDocuments } from './documents-sqlite';
let opening: Promise<LocalDocuments> | null = null;
export function openDocuments(): Promise<LocalDocuments> {
  opening ??= (async (): Promise<LocalDocuments> => {
    const database = await openDatabaseAsync('solveflow-local.db');
    try {
      return await createSQLiteDocuments(database);
    } catch (cause) {
      // Initialization never transfers ownership of a failed connection.
      await database.closeAsync().catch(() => {});
      throw cause;
    }
  })().catch((cause: unknown) => { opening = null; throw cause; });
  return opening;
}
