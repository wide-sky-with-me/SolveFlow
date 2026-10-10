import { afterEach, beforeEach, expect, it, vi } from 'vitest';
function pendingOpen() {
  return { onupgradeneeded: null as (() => void) | null, onerror: null as (() => void) | null, onblocked: null as (() => void) | null, onsuccess: null as (() => void) | null, result: { createObjectStore: vi.fn(), close: vi.fn() } };
}
beforeEach(() => { vi.resetModules(); });
afterEach(() => { vi.unstubAllGlobals(); });
it('retries after IndexedDB opening fails', async () => {
  const first = pendingOpen(); const second = pendingOpen(); const open = vi.fn().mockReturnValueOnce(first).mockReturnValueOnce(second);
  vi.stubGlobal('indexedDB', { open }); const { openDocuments } = await import('./documents.web');
  const failure = openDocuments(); first.onerror?.(); await expect(failure).rejects.toThrow('无法打开');
  const next = openDocuments(); expect(open).toHaveBeenCalledTimes(2); second.onsuccess?.(); await expect(next).resolves.toBeDefined();
});
it('closes a late successful connection after a blocked attempt without poisoning the retry', async () => {
  const first = pendingOpen(); const second = pendingOpen(); const open = vi.fn().mockReturnValueOnce(first).mockReturnValueOnce(second);
  vi.stubGlobal('indexedDB', { open }); const { openDocuments } = await import('./documents.web');
  const blocked = openDocuments(); first.onblocked?.(); await expect(blocked).rejects.toThrow('关闭其他');
  const next = openDocuments(); first.onsuccess?.(); expect(first.result.close).toHaveBeenCalledOnce();
  second.onsuccess?.(); await expect(next).resolves.toBeDefined(); expect(second.result.close).not.toHaveBeenCalled();
});
it('aborts already queued batch writes when a later request throws synchronously', async () => {
  const tx = { oncomplete: null, onabort: null, onerror: null, abort: vi.fn(), objectStore: () => ({ put: vi.fn().mockImplementationOnce(() => ({})).mockImplementationOnce(() => { throw new Error('PRIVATE_STORAGE_DETAIL'); }) }) };
  const pending = { ...pendingOpen(), result: { close: vi.fn(), transaction: () => tx } };
  vi.stubGlobal('indexedDB', { open: () => pending }); const { openDocuments } = await import('./documents.web');
  const opening = openDocuments(); pending.onsuccess?.(); const documents = await opening;
  await expect(documents.batch!([{ key: 'record.example', value: 'metadata' }, { key: 'image.example', value: 'image' }])).rejects.toThrow('本地保存失败');
  expect(tx.abort).toHaveBeenCalledOnce();
});
it('classifies a non-string saved value as keyed corruption without hiding transaction failures', async () => {
  const request = { result: { broken: true } as unknown };
  const tx = { oncomplete: null as (() => void) | null, onabort: null as (() => void) | null, onerror: null as (() => void) | null, objectStore: () => ({ get: () => request }) };
  const pending = { ...pendingOpen(), result: { close: vi.fn(), transaction: () => tx } };
  vi.stubGlobal('indexedDB', { open: () => pending }); const { openDocuments } = await import('./documents.web');
  const { LocalDataError } = await import('@solveflow/client/local');
  const opening = openDocuments(); pending.onsuccess?.(); const documents = await opening;
  const damaged = documents.get('favorite.example'); const rejection = expect(damaged).rejects.toMatchObject({ key: 'favorite.example' }); tx.oncomplete?.();
  await rejection; await expect(damaged).rejects.toBeInstanceOf(LocalDataError);
  const unavailable = documents.get('favorite.example'); const ioRejection = expect(unavailable).rejects.toThrow('本地保存失败'); tx.onabort?.(); await ioRejection;
  await expect(unavailable).rejects.not.toBeInstanceOf(LocalDataError);
});
