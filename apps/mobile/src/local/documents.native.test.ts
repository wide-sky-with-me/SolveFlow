import { beforeEach, expect, it, vi } from 'vitest';
const mock = vi.hoisted(() => ({ open: vi.fn() }));
vi.mock('expo-sqlite', () => ({ openDatabaseAsync: mock.open }));
beforeEach(() => { vi.resetModules(); mock.open.mockReset(); });
function database() { return { getFirstAsync: vi.fn(async () => ({ user_version: 1 })), execAsync: vi.fn(async () => {}), closeAsync: vi.fn(async () => {}) }; }
it('retries a failed SQLite open and shares the next in-flight initialization', async () => {
  const db = database(); mock.open.mockRejectedValueOnce(new Error('temporary storage error')).mockResolvedValueOnce(db);
  const { openDocuments } = await import('./documents.native');
  await expect(openDocuments()).rejects.toThrow('temporary storage error');
  const first = openDocuments(); const second = openDocuments();
  expect(first).toBe(second); await expect(first).resolves.toBeDefined(); expect(mock.open).toHaveBeenCalledTimes(2);
});
it('closes SQLite when setup fails, then allows a clean retry', async () => {
  const failed = database(); failed.execAsync.mockRejectedValueOnce(new Error('disk full'));
  const ready = database(); mock.open.mockResolvedValueOnce(failed).mockResolvedValueOnce(ready);
  const { openDocuments } = await import('./documents.native');
  await expect(openDocuments()).rejects.toThrow('disk full'); expect(failed.closeAsync).toHaveBeenCalledOnce();
  await expect(openDocuments()).resolves.toBeDefined(); expect(ready.closeAsync).not.toHaveBeenCalled();
});
it('preserves the initialization error when closing also fails', async () => {
  const failed = database(); failed.execAsync.mockRejectedValueOnce(new Error('initial failure')); failed.closeAsync.mockRejectedValueOnce(new Error('cleanup failure'));
  mock.open.mockResolvedValueOnce(failed);
  const { openDocuments } = await import('./documents.native');
  await expect(openDocuments()).rejects.toThrow('initial failure');
});

it('batches parameterized metadata reads with bounded queries and preserves missing/duplicate key order', async () => {
  const keys = Array.from({ length: 600 }, (_, i) => `summary.${i}`);
  keys[1] = "summary.' OR 1=1 --"; keys[2] = keys[0]!;
  const getAllAsync = vi.fn(async (_sql: string, ...requested: string[]) => [...new Set(requested)].filter(key => key !== 'summary.5').reverse().map(key => ({ key, value: `value:${key}` })));
  mock.open.mockResolvedValue({ ...database(), getAllAsync });
  const { openDocuments } = await import('./documents.native'); const store = await openDocuments();
  expect(store.getMany).toBeDefined();
  expect(await store.getMany!(keys)).toEqual(keys.map(key => key === 'summary.5' ? null : `value:${key}`));
  expect(getAllAsync).toHaveBeenCalledTimes(3);
  for (const [sql, ...args] of getAllAsync.mock.calls) { expect(args.length).toBeLessThanOrEqual(256); expect(sql).not.toContain('OR 1=1'); expect(sql.match(/\?/g)).toHaveLength(args.length); }
  expect(await store.getMany!([])).toEqual([]); expect(getAllAsync).toHaveBeenCalledTimes(3);
});
