import { File, Paths } from 'expo-file-system';
import { defaultDatabaseDirectory, deleteDatabaseAsync, openDatabaseAsync, type SQLiteDatabase } from 'expo-sqlite';
import { createSQLiteDocuments } from '../src/local/documents-sqlite';
import { LocalEngine, LocalRepository } from '@solveflow/client';
import { randomUUID } from 'expo-crypto';
import { SolveOutcomeSchema, type SolveOutcome } from '@solveflow/contracts/agent';

// Synthetic 2×2 JPEG. No student image, credential or model is used by this app.
export const jpeg = 'data:image/jpeg;base64,/9j/2wBDAAYEBQYFBAYGBQYHBwYIChAKCgkJChQODwwQFxQYGBcUFhYaHSUfGhsjHBYWICwgIyYnKSopGR8tMC0oMCUoKSj/2wBDAQcHBwoIChMKChMoGhYaKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCj/wAARCAACAAIDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAj/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFAEBAAAAAAAAAAAAAAAAAAAAAP/EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAMAwEAAhEDEQA/AKpAB//Z';
export const signal = { aborted: false };
export function assert(value: unknown, reason: string): asserts value { if (!value) throw new Error(reason); }
export function status(action: string, phase: string, evidence: object = {}) {
  new File(Paths.document, 'probe-status.json').write(JSON.stringify({ action, phase, ...evidence }));
}
export function remember(name: string, value: object) { new File(Paths.document, `${name}.json`).write(JSON.stringify(value)); }
export function recalled(name: string): unknown { return JSON.parse(new File(Paths.document, `${name}.json`).textSync()); }
export async function hold(action: string, evidence: object) {
  status(action, 'kill-ready', evidence);
  await new Promise<void>((_, reject) => setTimeout(() => reject(new Error('Host did not stop the test process within 120 seconds')), 120_000));
}
export function answer(text = '**2**'): SolveOutcome {
  return SolveOutcomeSchema.parse({ schemaVersion: 1, status: 'completed', verified: false, verificationStatus: 'not_requested', warning: null, verification: null,
    candidate: { schemaVersion: 1, kind: 'answer', problem: { text: '1+1', subject: 'math', uncertainties: [] }, answer: text, steps: [], knowledgePoints: [], citationIds: [], clarificationQuestions: [] } });
}
export async function open(name: string, fresh = true) {
  const directory = defaultDatabaseDirectory.startsWith('file:') ? defaultDatabaseDirectory : `file://${defaultDatabaseDirectory}`;
  if (fresh && new File(directory, `${name}.db`).exists) await deleteDatabaseAsync(`${name}.db`);
  const db = await openDatabaseAsync(`${name}.db`);
  const documents = await createSQLiteDocuments(db);
  const repository = new LocalRepository(documents);
  return { db, documents, repository, engine: new LocalEngine(repository, randomUUID) };
}
export async function integrity(db: SQLiteDatabase) {
  const result = await db.getFirstAsync<{ integrity_check: string }>('PRAGMA integrity_check');
  assert(result?.integrity_check === 'ok', 'SQLite integrity check failed');
}
/** Test-only interception: every SQL statement still executes in Expo's real SQLite transaction. */
export function instrument(db: SQLiteDatabase) {
  const original = db.withExclusiveTransactionAsync.bind(db);
  const control = { maxPages: 0, nativeFull: false, beforeCommit: null as (() => Promise<void>) | null, afterCommit: null as (() => Promise<void>) | null };
  db.withExclusiveTransactionAsync = async task => {
    await original(async tx => {
      if (control.maxPages) await tx.execAsync(`PRAGMA max_page_count = ${control.maxPages}`);
      try { await task(tx); }
      catch (cause) {
        if (cause instanceof Error && /database or disk is full|SQLITE_FULL|code 13/i.test(cause.message)) control.nativeFull = true;
        throw cause;
      }
      await control.beforeCommit?.();
    });
    await control.afterCommit?.();
  };
  return control;
}
export async function pageCount(db: SQLiteDatabase) {
  const row = await db.getFirstAsync<{ page_count: number }>('PRAGMA page_count');
  assert(row, 'No page count'); return row.page_count;
}
