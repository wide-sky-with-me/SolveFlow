// Decision: .agents/notes/implemented/storage/2026-10-14-background-pdf-exports.md
import { ExportTaskFileSchema, MAX_EXPORT_ARTIFACT_BYTES, MAX_EXPORT_TASK_RECORDS, MAX_EXPORT_STORED_BYTES, ExportStorageUsageSchema, type ExportStorageUsage, type ExportTask } from '@solveflow/contracts/local';
import { ExportTaskStorageError, type ExportArtifact, type LocalExportTaskStore } from '@solveflow/client/local';

const MAX_STORED_BYTES = MAX_EXPORT_STORED_BYTES;
// Large archives use the same bounded artifact budget, but need longer than metadata writes.
const FILE_WRITE_TIMEOUT_MS = 120000;
let opening: Promise<IDBDatabase> | null = null;
function storageFailure(cause: unknown): ExportTaskStorageError {
  if (cause instanceof ExportTaskStorageError) return new ExportTaskStorageError(cause.reason);
  if (cause instanceof DOMException) {
    if (cause.name === 'QuotaExceededError') return new ExportTaskStorageError('quota');
    if (cause.name === 'DataCloneError') return new ExportTaskStorageError('clone');
    if (cause.name === 'TimeoutError') return new ExportTaskStorageError('timeout');
  }
  return new ExportTaskStorageError('unavailable');
}
function database() {
  opening ??= new Promise<IDBDatabase>((resolve, reject) => {
    let abandoned = false;
    const request = indexedDB.open('solveflow-exports', 1);
    const timer = setTimeout(() => { abandoned = true; reject(new ExportTaskStorageError('timeout')); }, 10000);
    request.onupgradeneeded = () => { for (const name of ['records', 'files', 'sizes']) request.result.createObjectStore(name); };
    request.onerror = () => { clearTimeout(timer); abandoned = true; reject(storageFailure(request.error)); };
    request.onblocked = () => { clearTimeout(timer); abandoned = true; reject(new ExportTaskStorageError('unavailable')); };
    request.onsuccess = () => {
      clearTimeout(timer);
      const db = request.result;
      if (abandoned) { db.close(); return; }
      db.onversionchange = () => { db.close(); opening = null; };
      resolve(db);
    };
  }).catch((error: unknown) => { opening = null; throw storageFailure(error); });
  return opening;
}
async function transaction<T>(stores: string[], mode: IDBTransactionMode, execute: (tx: IDBTransaction, set: (value: T) => void, abort: (cause: unknown) => void) => void, timeoutMs = 10000): Promise<T> {
  const db = await database();
  return new Promise<T>((resolve, reject) => {
    let tx: IDBTransaction;
    try { tx = db.transaction(stores, mode); } catch (cause) { reject(storageFailure(cause)); return; }
    let result: T; let failure: ExportTaskStorageError | null = null;
    const abort = (cause: unknown) => { failure ??= storageFailure(cause); try { tx.abort(); } catch { clearTimeout(timer); reject(failure); } };
    const timer = setTimeout(() => abort(new ExportTaskStorageError('timeout')), timeoutMs);
    tx.oncomplete = () => { clearTimeout(timer); resolve(result); };
    tx.onerror = event => { failure ??= storageFailure(event.target instanceof IDBRequest ? event.target.error : tx.error); };
    tx.onabort = () => { clearTimeout(timer); reject(failure ?? storageFailure(tx.error)); };
    try { execute(tx, value => { result = value; }, abort); }
    catch (cause) { abort(cause); }
  });
}
async function get(store: string, id: string): Promise<unknown> {
  return transaction([store], 'readonly', (tx, set) => { const request = tx.objectStore(store).get(id); request.onsuccess = () => set(request.result); });
}
function readArtifact(value: unknown): ExportArtifact | null {
  if (value === undefined) return null;
  if (!value || typeof value !== 'object' || !('data' in value) || !(value.data instanceof Uint8Array) || !('name' in value) || !('mimeType' in value)) throw new Error('导出文件已损坏，原记录保留。');
  const metadata = ExportTaskFileSchema.parse({ name: value.name, mimeType: value.mimeType, bytes: value.data.byteLength });
  return { name: metadata.name, mimeType: metadata.mimeType, data: value.data };
}
async function browserAvailableBytes(): Promise<number | null> {
  if (typeof navigator === 'undefined' || !navigator.storage?.estimate) return null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      navigator.storage.estimate().then(value => typeof value.quota === 'number' && typeof value.usage === 'number' && Number.isFinite(value.quota) && Number.isFinite(value.usage) ? Math.min(Number.MAX_SAFE_INTEGER, Math.max(0, Math.floor(value.quota - value.usage))) : null),
      new Promise<null>(resolve => { timer = setTimeout(() => resolve(null), 2000); }),
    ]);
  } catch { return null; } // Browser estimates are advisory; the transactional cache limit remains authoritative.
  finally { clearTimeout(timer); }
}
export type WebExportTaskStore = LocalExportTaskStore & { usage(): Promise<ExportStorageUsage> };
export function createExportTaskStore(): WebExportTaskStore {
  return {
    async usage() {
      const sizes = await transaction<{ usedBytes: number; fileCount: number }>(['sizes'], 'readonly', (tx, set, abort) => {
        const request = tx.objectStore('sizes').openCursor(); let usedBytes = 0, fileCount = 0;
        request.onsuccess = () => {
          const cursor = request.result;
          if (!cursor) { set({ usedBytes, fileCount }); return; }
          const size: unknown = cursor.value;
          if (++fileCount > MAX_EXPORT_TASK_RECORDS || typeof size !== 'number' || !Number.isSafeInteger(size) || size <= 0 || size > MAX_EXPORT_ARTIFACT_BYTES || usedBytes + size > MAX_STORED_BYTES) { abort(new ExportTaskStorageError('integrity')); return; }
          usedBytes += size; cursor.continue();
        };
      });
      return ExportStorageUsageSchema.parse({ ...sizes, limitBytes: MAX_STORED_BYTES, availableBytes: MAX_STORED_BYTES - sizes.usedBytes, browserAvailableBytes: await browserAvailableBytes() });
    },
    async list() {
      return transaction<unknown[]>(['records'], 'readonly', (tx, set) => {
        const request = tx.objectStore('records').getAll(undefined, MAX_EXPORT_TASK_RECORDS + 1);
        request.onsuccess = () => set(request.result);
      });
    },
    async save(task: ExportTask) { await transaction<void>(['records'], 'readwrite', tx => { tx.objectStore('records').put(task, task.id); }); },
    async remove(id) { await transaction<void>(['records', 'files', 'sizes'], 'readwrite', tx => { for (const name of ['records', 'files', 'sizes']) tx.objectStore(name).delete(id); }); },
    async writeFile(id, file) {
      ExportTaskFileSchema.parse({ name: file.name, mimeType: file.mimeType, bytes: file.data.byteLength });
      if (file.data.byteLength > MAX_EXPORT_ARTIFACT_BYTES) throw new Error('导出文件超过存储上限。');
      // Decision: .agents/notes/implemented/storage/2026-10-24-generated-export-recovery.md
      await transaction<void>(['files', 'sizes'], 'readwrite', (tx, _set, abort) => {
        const sizes = tx.objectStore('sizes'); const request = sizes.openCursor(); let total = 0; let entries = 0;
        request.onsuccess = () => {
          const cursor = request.result;
          if (cursor) {
            const size: unknown = cursor.value;
            if (++entries > MAX_EXPORT_TASK_RECORDS || typeof size !== 'number' || !Number.isSafeInteger(size) || size <= 0 || size > MAX_EXPORT_ARTIFACT_BYTES) { abort(new ExportTaskStorageError('integrity')); return; }
            if (cursor.key !== id) total += size;
            cursor.continue(); return;
          }
          if (total + file.data.byteLength > MAX_STORED_BYTES) { abort(new ExportTaskStorageError('capacity')); return; }
          try { tx.objectStore('files').put(file, id); sizes.put(file.data.byteLength, id); }
          catch (cause) { abort(cause); }
        };
      }, FILE_WRITE_TIMEOUT_MS);
    },
    async readFile(id) { return readArtifact(await get('files', id)); },
    async removeFile(id) { await transaction<void>(['files', 'sizes'], 'readwrite', tx => { tx.objectStore('files').delete(id); tx.objectStore('sizes').delete(id); }); },
  };
}
