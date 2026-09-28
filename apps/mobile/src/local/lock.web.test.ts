import { afterEach, beforeEach, expect, it, vi } from 'vitest';
beforeEach(() => { vi.resetModules(); });
afterEach(() => { vi.unstubAllGlobals(); });
it('reuses this document\'s acquired lock when runtime initialization is retried', async () => {
  const request = vi.fn((_name: string, _options: unknown, callback: (lock: object | null) => Promise<void>) => callback(request.mock.calls.length === 1 ? {} : null));
  vi.stubGlobal('navigator', { locks: { request } });
  const { lockLocalApp } = await import('./lock.web');
  await lockLocalApp(); await expect(lockLocalApp()).resolves.toBeUndefined(); expect(request).toHaveBeenCalledOnce();
});
it('retries an unavailable lock without weakening cross-tab exclusion', async () => {
  const request = vi.fn((_name: string, _options: unknown, callback: (lock: object | null) => Promise<void>) => callback(request.mock.calls.length === 1 ? null : {}));
  vi.stubGlobal('navigator', { locks: { request } });
  const { lockLocalApp } = await import('./lock.web');
  await expect(lockLocalApp()).rejects.toThrow('其他标签页'); await expect(lockLocalApp()).resolves.toBeUndefined();
  expect(request).toHaveBeenCalledTimes(2); expect(request.mock.calls.every(call => JSON.stringify(call[1]) === '{"ifAvailable":true}')).toBe(true);
});
