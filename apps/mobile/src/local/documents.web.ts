import type { LocalDocuments } from '@solveflow/client';
let opening: Promise<LocalDocuments> | null = null;
export function openDocuments(): Promise<LocalDocuments> {
  opening ??= new Promise<LocalDocuments>((resolve, reject) => {
    let failed = false;
    const request = indexedDB.open('solveflow-local', 1);
    request.onupgradeneeded = () => { request.result.createObjectStore('documents'); };
    request.onerror = () => { failed = true; reject(new Error('无法打开本地数据库，请检查浏览器存储权限。')); };
    request.onblocked = () => { failed = true; reject(new Error('请关闭其他 SolveFlow 页面后重试。')); };
    request.onsuccess = () => {
      const db = request.result;
      // A blocked open cannot be cancelled. Its late connection has no owner.
      if (failed) { db.close(); return; }
      function transaction<T>(mode: IDBTransactionMode, operation: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
        return new Promise((accept, fail) => { const tx = db.transaction('documents', mode); const result = operation(tx.objectStore('documents')); tx.oncomplete = () => accept(result.result); tx.onabort = tx.onerror = () => fail(new Error('本地保存失败，请检查可用存储空间。')); });
      }
      resolve({ async get(key) { const value: unknown = await transaction('readonly', store => store.get(key)); if (value === undefined) return null; if (typeof value !== 'string') throw new Error('本地记录损坏。'); return value; },
        async put(key, value) { await transaction('readwrite', store => store.put(value, key)); },
        async remove(key) { await transaction('readwrite', store => store.delete(key)); },
        async keys() { return (await transaction('readonly', store => store.getAllKeys())).map(value => { if (typeof value !== 'string') throw new Error('本地索引损坏。'); return value; }); },
        async batch(changes) { await new Promise<void>((accept, fail) => {
          const tx = db.transaction('documents', 'readwrite'); const store = tx.objectStore('documents');
          tx.oncomplete = () => accept(); tx.onabort = tx.onerror = () => fail(new Error('本地保存失败，请检查可用存储空间。'));
          for (const { key, value } of changes) { if (value === null) store.delete(key); else store.put(value, key); }
        }); },
      });
    };
  }).catch((cause: unknown) => { opening = null; throw cause; });
  return opening;
}
