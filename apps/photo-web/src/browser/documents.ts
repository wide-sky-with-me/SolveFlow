import { LocalDataError, type LocalDocuments } from '@solveflow/client/local';
import { MAX_LOCAL_RECORDS } from '@solveflow/contracts/local';

export async function openPhotoDocuments(accountId: string): Promise<{ documents: LocalDocuments; close: () => void }> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    let abandoned = false;
    const request = indexedDB.open('solveflow-photo-' + accountId, 1);
    request.onupgradeneeded = () => request.result.createObjectStore('documents');
    request.onsuccess = () => { if (abandoned) request.result.close(); else { request.result.onversionchange = () => request.result.close(); resolve(request.result); } };
    request.onerror = () => { abandoned = true; reject(new Error('无法打开本地历史，请检查浏览器存储权限。')); };
    request.onblocked = () => { abandoned = true; reject(new Error('请关闭其他拍题页面后重试。')); };
  });
  function run<T>(mode: IDBTransactionMode, work: (store: IDBObjectStore, value: (v: T) => void) => void): Promise<T> {
    return new Promise((resolve, reject) => {
      let tx: IDBTransaction;
      try { tx = db.transaction('documents', mode); } catch { reject(new Error('本地存储不可用，请重新打开页面。')); return; }
      let value: T;
      tx.oncomplete = () => resolve(value); tx.onabort = () => reject(new Error('本地保存失败，请检查可用空间。'));
      try { work(tx.objectStore('documents'), v => { value = v; }); }
      catch { try { tx.abort(); } catch { reject(new Error('本地保存失败。')); } }
    });
  }
  const checked = (key: string, value: unknown) => { if (value === undefined) return null; if (typeof value !== 'string') throw new LocalDataError(key); return value; };
  const documents: LocalDocuments = {
    async get(key) { return checked(key, await run<unknown>('readonly', (store, set) => { const r = store.get(key); r.onsuccess = () => set(r.result); })); },
    async getMany(keys) {
      if (keys.length > MAX_LOCAL_RECORDS * 2) throw new Error('读取记录过多。');
      const values = await run<unknown[]>('readonly', (store, set) => {
        const values: unknown[] = []; set(values);
        keys.forEach((key, i) => { const r = store.get(key); r.onsuccess = () => { values[i] = r.result; }; });
      }); return values.map((v, i) => checked(keys[i]!, v));
    },
    async keys() { return run<string[]>('readonly', (store, set) => { const r = store.getAllKeys(); r.onsuccess = () => set(r.result.map(String)); }); },
    async put(key, value) { await run<void>('readwrite', store => { store.put(value, key); }); },
    async remove(key) { await run<void>('readwrite', store => { store.delete(key); }); },
    async batch(changes) { await run<void>('readwrite', store => { for (const { key, value } of changes) { if (value === null) store.delete(key); else store.put(value, key); } }); },
  };
  return { documents, close: () => db.close() };
}
