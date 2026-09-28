import { beforeEach, expect, it, vi } from 'vitest';
import { LocalEngine, LocalRepository } from '@solveflow/client';
import { exportHistory } from './export-history.native';
const mock = vi.hoisted(() => {
  const file = { write: vi.fn(), open: vi.fn(() => { throw new Error('unsafe long-lived SAF handle'); }), delete: vi.fn() };
  const directory = { createFile: vi.fn(() => file) };
  return { file, directory, pick: vi.fn(async () => directory) };
});
vi.mock('expo-file-system', () => ({ Directory: { pickDirectoryAsync: mock.pick } }));
const repository = new LocalRepository({ async get() { return null; }, async keys() { return []; }, async put() { throw new Error('unexpected write'); }, async remove() { throw new Error('unexpected removal'); } });
beforeEach(() => { vi.clearAllMocks(); mock.file.write.mockReset(); mock.file.delete.mockReset(); mock.pick.mockResolvedValue(mock.directory); });
it('uses scoped append writes and never opens a long-lived SAF handle', async () => {
  const progress = vi.fn(); const name = await exportHistory(repository, new AbortController().signal, progress);
  expect(name).toMatch(/^solveflow-history-.*\.ndjson$/); expect(mock.file.open).not.toHaveBeenCalled();
  expect(mock.file.write.mock.calls.every(call => call[1]?.append === true)).toBe(true);
  const content = mock.file.write.mock.calls.map(call => new TextDecoder().decode(call[0])).join('');
  expect(content).toContain('"kind":"header"'); expect(content).toContain('"kind":"complete"');
  expect(mock.file.delete).not.toHaveBeenCalled();
});
it('removes only the newly created partial export after a write failure', async () => {
  mock.file.write.mockImplementation(() => { throw new Error('disk full'); });
  await expect(exportHistory(repository, new AbortController().signal, vi.fn())).rejects.toThrow('导出失败');
  expect(mock.file.delete).toHaveBeenCalledTimes(1);
});
it('reports partial-file cleanup failure without exposing the native exception', async () => {
  mock.file.write.mockImplementation(() => { throw new Error('disk full'); }); mock.file.delete.mockImplementation(() => { throw new Error('PRIVATE_NATIVE_ERROR'); });
  await expect(exportHistory(repository, new AbortController().signal, vi.fn())).rejects.toThrow('不完整文件'); expect(mock.file.delete).toHaveBeenCalledTimes(1);
});
it('cancelling the system directory picker creates no file', async () => {
  mock.pick.mockRejectedValue(Object.assign(new Error('cancelled'), { code: 'ERR_PICKER_CANCELLED' }));
  expect(await exportHistory(repository, new AbortController().signal, vi.fn())).toBeNull(); expect(mock.directory.createFile).not.toHaveBeenCalled();
});
it('cancelling during a write removes the partial file without writing completion', async () => {
  const controller = new AbortController(); mock.file.write.mockImplementation(() => controller.abort());
  expect(await exportHistory(repository, controller.signal, vi.fn())).toBeNull();
  expect(mock.file.delete).toHaveBeenCalledTimes(1);
  expect(mock.file.write.mock.calls.map(call => new TextDecoder().decode(call[0])).join('')).not.toContain('"kind":"complete"');
});
it('writes a large photo in bounded native chunks without changing its bytes', async () => {
  const values = new Map<string, string>();
  const source = new LocalRepository({ async get(key) { return values.get(key) ?? null; }, async keys() { return [...values.keys()]; }, async put(key, value) { values.set(key, value); }, async remove(key) { values.delete(key); } });
  const engine = new LocalEngine(source, () => crypto.randomUUID());
  const original = `data:image/jpeg;base64,${'AQID'.repeat(400_000)}`;
  await engine.create(original, 1000, 1000);
  mock.file.write.mockImplementation((bytes: Uint8Array) => { if (bytes.byteLength > 65_536) throw new Error('native write limit'); });
  await exportHistory(source, new AbortController().signal, vi.fn());
  const output = mock.file.write.mock.calls.map(call => new TextDecoder().decode(call[0])).join('');
  const rows = output.trim().split('\n').map(line => JSON.parse(line));
  expect(rows[1].record.image).toBe(original); expect(rows[2].kind).toBe('complete');
  expect(mock.file.delete).not.toHaveBeenCalled();
});
