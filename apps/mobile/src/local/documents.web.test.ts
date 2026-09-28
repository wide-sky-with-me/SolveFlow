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
