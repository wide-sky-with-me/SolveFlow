import { beforeEach, expect, it, vi } from 'vitest';
import { File } from 'expo-file-system';
import { LocalRepository } from '@solveflow/client';
import { readNativeHistoryFile } from './import-history.native';

const mock = vi.hoisted(() => ({
  copied: false, directoryExists: false, release: () => {},
  copy: vi.fn<() => Promise<void>>(), open: vi.fn(), close: vi.fn(), cleanup: vi.fn(),
}));
vi.mock('expo-file-system', () => ({
  Paths: { cache: 'file:///cache' },
  FileMode: { ReadOnly: 'r' },
  Directory: class {
    get exists() { return mock.directoryExists; }
    create() { mock.directoryExists = true; }
    delete() { mock.directoryExists = false; mock.cleanup(); }
  },
  File: class {
    size = 1024;
    copy() { return mock.copy(); }
    open(mode: string) {
      mock.open(mode);
      if (!mock.copied) throw new Error('Copy is still pending');
      let read = false;
      return {
        readBytes() {
          if (read) return new Uint8Array();
          read = true;
          return new TextEncoder().encode('{"schemaVersion":1,"kind":"header","format":"solveflow-history","count":0,"createdAt":"2026-10-03T00:00:00.000Z"}\n{"schemaVersion":1,"kind":"complete","count":0}\n');
        },
        close: mock.close,
      };
    }
  },
}));
const repository = new LocalRepository({
  async get() { return null; }, async keys() { return []; },
  async put() { throw new Error('Unexpected write'); }, async remove() { throw new Error('Unexpected removal'); },
  async batch() { throw new Error('Unexpected batch'); },
});
beforeEach(() => {
  vi.clearAllMocks(); mock.copied = false; mock.directoryExists = false;
  mock.copy.mockImplementation(async () => {
    await new Promise<void>(resolve => { mock.release = resolve; });
    mock.copied = true;
  });
});
it('waits for the private copy before opening either validation or restore stream', async () => {
  const result = readNativeHistoryFile(repository, new File('content://fixture'), new AbortController().signal, vi.fn());
  // Observe immediately so the pre-fix rejection cannot become an unhandled Promise.
  const settled = result.then(value => ({ value }), error => ({ error }));
  await new Promise<void>(resolve => setTimeout(resolve, 0));
  expect(mock.open).not.toHaveBeenCalled();
  expect(mock.cleanup).not.toHaveBeenCalled();
  mock.release();
  expect(await settled).toEqual({ value: { restored: 0, skipped: 0 } });
  expect(mock.close).toHaveBeenCalledTimes(2);
  expect(mock.open.mock.calls.every(([mode]) => mode === 'r')).toBe(true);
  expect(mock.cleanup).toHaveBeenCalledTimes(1);
});
it('propagates asynchronous copy failure before opening or changing repository data', async () => {
  mock.copy.mockRejectedValue(new Error('Storage unavailable'));
  await expect(readNativeHistoryFile(repository, new File('content://fixture'), new AbortController().signal, vi.fn())).rejects.toThrow('Storage unavailable');
  expect(mock.open).not.toHaveBeenCalled();
  expect(mock.cleanup).toHaveBeenCalledTimes(1);
});
it('waits for a cancelled copy to finish before removing cache and never starts reading', async () => {
  const abort = new AbortController();
  const result = readNativeHistoryFile(repository, new File('content://fixture'), abort.signal, vi.fn());
  const settled = result.catch(error => error);
  abort.abort();
  await new Promise<void>(resolve => setTimeout(resolve, 0));
  expect(mock.cleanup).not.toHaveBeenCalled();
  mock.release();
  expect(await settled).toBeInstanceOf(Error);
  expect(mock.open).not.toHaveBeenCalled();
  expect(mock.cleanup).toHaveBeenCalledTimes(1);
});
