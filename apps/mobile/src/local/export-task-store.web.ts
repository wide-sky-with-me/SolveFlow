// Decision: .agents/notes/implemented/storage/2026-10-14-background-pdf-exports.md
import { ExportTaskFileSchema, MAX_EXPORT_ARTIFACT_BYTES, MAX_EXPORT_TASK_RECORDS, type ExportTask } from '@solveflow/contracts/local';
import type { ExportArtifact, LocalExportTaskStore } from '@solveflow/client/local';

const MAX_STORED_BYTES = 512 * 1024 * 1024;
let opening: Promise<IDBDatabase> | null = null;
function database() {
  opening ??= new Promise<IDBDatabase>((resolve, reject) => {
    let abandoned = false;
    const request = indexedDB.open('solveflow-exports', 1);
    const timer = setTimeout(() => { abandoned = true; reject(new Error('导出记录库打开超时。')); }, 10000);
    request.onupgradeneeded = () => { for (const name of ['records', 'files', 'sizes']) request.result.createObjectStore(name); };
    request.onerror = request.onblocked = () => { clearTimeout(timer); abandoned = true; reject(new Error('请检查浏览器存储权限，或关闭其它页面后重试。')); };
    request.onsuccess = () => {
      clearTimeout(timer);
      const db = request.result;
      if (abandoned) { db.close(); return; }
      db.onversionchange = () => { db.close(); opening = null; };
      resolve(db);
    };
  }).catch((error: unknown) => { opening = null; throw error; });
  return opening;
}
async function transaction<T>(stores: string[], mode: IDBTransactionMode, execute: (tx: IDBTransaction, set: (value: T) => void) => void): Promise<T> {
  const db = await database();
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction(stores, mode);
    let result: T; let failure = '导出记录保存失败，请检查可用空间。';
    const timer = setTimeout(() => { failure = '导出记录事务超时，请检查存储后重试。'; try { tx.abort(); } catch { reject(new Error(failure)); } }, 10000);
    tx.oncomplete = () => { clearTimeout(timer); resolve(result); };
    tx.onabort = tx.onerror = () => { clearTimeout(timer); reject(new Error(failure)); };
    try { execute(tx, value => { result = value; }); }
    catch { failure = '导出记录操作失败。'; tx.abort(); }
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
export function createExportTaskStore(): LocalExportTaskStore {
  return {
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
      await transaction<void>(['files', 'sizes'], 'readwrite', tx => {
        const sizes = tx.objectStore('sizes'); const request = sizes.openCursor(); let total = 0; let entries = 0;
        request.onsuccess = () => {
          const cursor = request.result;
          if (cursor) {
            const size: unknown = cursor.value;
            if (++entries > MAX_EXPORT_TASK_RECORDS || typeof size !== 'number' || !Number.isSafeInteger(size) || size <= 0 || size > MAX_EXPORT_ARTIFACT_BYTES) { tx.abort(); return; }
            if (cursor.key !== id) total += size;
            cursor.continue(); return;
          }
          if (total + file.data.byteLength > MAX_STORED_BYTES) { tx.abort(); return; }
          tx.objectStore('files').put(file, id); sizes.put(file.data.byteLength, id);
        };
      });
    },
    async readFile(id) { return readArtifact(await get('files', id)); },
    async removeFile(id) { await transaction<void>(['files', 'sizes'], 'readwrite', tx => { tx.objectStore('files').delete(id); tx.objectStore('sizes').delete(id); }); },
  };
}
