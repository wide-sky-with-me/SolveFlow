import { expect, it, vi } from 'vitest';
import type { Photo } from './platform.types';
import { BatchCaptureBuffer } from './batch-capture-buffer';

function deferred<T>() { let resolve!: (value: T) => void; let reject!: (cause: unknown) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
function fixture() {
  const raw = Array.from({ length: 4 }, (_, index): Photo => ({ uri: `raw-${index}`, width: 4000, height: 3000 }));
  const ready = raw.map((_, index): Photo => ({ uri: `ready-${index}`, width: 2048, height: 1536, normalized: true }));
  const preparing = raw.map(() => deferred<Photo>());
  const prepare = vi.fn((photo: Photo) => preparing[raw.indexOf(photo)]!.promise);
  const persist = vi.fn(async (photo: Photo) => photo.uri);
  const enqueue = vi.fn(async (_id: string) => {}); const saved = vi.fn((_id: string) => {}); const release = vi.fn((_photo: Photo) => {}); const failed = vi.fn((_cause: unknown, _saved: boolean) => {});
  const buffer = new BatchCaptureBuffer({ prepare, persist, enqueue, saved, release, failed, changed() {} });
  return { buffer, raw, ready, preparing, prepare, persist, enqueue, saved, release, failed };
}
it('accepts three captures while saves are blocked, preserves order and counts only durable saves', async () => {
  const f = fixture(); const gate = deferred<string>(); f.persist.mockImplementationOnce(() => gate.promise);
  expect(f.buffer.add(f.raw[0]!)).toBe(true); expect(f.buffer.add(f.raw[1]!)).toBe(true); expect(f.buffer.add(f.raw[2]!)).toBe(true); expect(f.buffer.add(f.raw[3]!)).toBe(false);
  expect(f.buffer.pending).toBe(3); expect(f.buffer.blocked).toBe(true);
  f.preparing[2]!.resolve(f.ready[2]!); f.preparing[1]!.resolve(f.ready[1]!); await Promise.resolve(); expect(f.persist).not.toHaveBeenCalled();
  f.preparing[0]!.resolve(f.ready[0]!); await expect.poll(() => f.persist.mock.calls.length).toBe(1); expect(f.saved).not.toHaveBeenCalled();
  gate.resolve('ready-0'); expect(await f.buffer.flush()).toBe(true);
  expect(f.persist.mock.calls.map(([photo]) => photo.uri)).toEqual(['ready-0', 'ready-1', 'ready-2']); expect(f.saved.mock.calls.flat()).toEqual(['ready-0', 'ready-1', 'ready-2']);
  expect(f.enqueue.mock.calls.flat()).toEqual(['ready-0', 'ready-1', 'ready-2']); expect(f.release).toHaveBeenCalledTimes(6); expect(f.buffer.pending).toBe(0);
  await f.buffer.dispose(); expect(f.release).toHaveBeenCalledTimes(6);
});
it('retains failed writes and later captures until explicit retry, without preparing or admitting duplicates', async () => {
  const f = fixture(); f.persist.mockRejectedValueOnce(new Error('STORAGE_FULL'));
  f.buffer.add(f.raw[0]!); f.buffer.add(f.raw[1]!); f.preparing[0]!.resolve(f.ready[0]!); f.preparing[1]!.resolve(f.ready[1]!);
  expect(await f.buffer.flush()).toBe(false); expect(f.buffer.pending).toBe(2); expect(f.buffer.blocked).toBe(true); expect(f.enqueue).not.toHaveBeenCalled(); expect(f.release).not.toHaveBeenCalled();
  expect(f.failed).toHaveBeenCalledWith(expect.any(Error), false);
  expect(await f.buffer.retry()).toBe(true); expect(f.prepare).toHaveBeenCalledTimes(2); expect(f.persist).toHaveBeenCalledTimes(3); expect(f.saved).toHaveBeenCalledTimes(2); expect(f.enqueue).toHaveBeenCalledTimes(2);
  await f.buffer.dispose();
});
it('does not replay admission after a durable save fails to enqueue, and resumes only later captures', async () => {
  const f = fixture(); f.enqueue.mockRejectedValueOnce(new Error('ADMISSION_FAILED'));
  f.buffer.add(f.raw[0]!); f.buffer.add(f.raw[1]!); f.preparing[0]!.resolve(f.ready[0]!); f.preparing[1]!.resolve(f.ready[1]!);
  expect(await f.buffer.flush()).toBe(false); expect(f.buffer.pending).toBe(1); expect(f.saved).toHaveBeenCalledTimes(1); expect(f.failed).toHaveBeenCalledWith(expect.any(Error), true);
  expect(await f.buffer.retry()).toBe(true); expect(f.persist).toHaveBeenCalledTimes(2); expect(f.enqueue.mock.calls.flat()).toEqual(['ready-0', 'ready-1']);
  await f.buffer.dispose();
});
it('waits for late normalization before releasing captures and never saves after closing during preparation', async () => {
  const f = fixture(); f.buffer.add(f.raw[0]!); f.buffer.add(f.raw[1]!);
  const closing = f.buffer.dispose(); expect(f.buffer.add(f.raw[2]!)).toBe(false); expect(f.release).not.toHaveBeenCalled();
  f.preparing[1]!.resolve(f.ready[1]!); f.preparing[0]!.resolve(f.ready[0]!); await closing;
  expect(f.persist).not.toHaveBeenCalled(); expect(f.enqueue).not.toHaveBeenCalled(); expect(f.release).toHaveBeenCalledTimes(4);
});
it('allows an accepted write to finish on close, but stops admission and every later save', async () => {
  const f = fixture(); const gate = deferred<string>(); f.persist.mockImplementationOnce(() => gate.promise);
  f.buffer.add(f.raw[0]!); f.buffer.add(f.raw[1]!); f.preparing[0]!.resolve(f.ready[0]!); f.preparing[1]!.resolve(f.ready[1]!);
  await expect.poll(() => f.persist.mock.calls.length).toBe(1); const closing = f.buffer.dispose(); gate.resolve('ready-0'); await closing;
  expect(f.persist).toHaveBeenCalledTimes(1); expect(f.saved).toHaveBeenCalledTimes(1); expect(f.enqueue).not.toHaveBeenCalled(); expect(f.release).toHaveBeenCalledTimes(4);
});
it('retries a failed normalization only on explicit retry, and releases retained captures after explicit discard', async () => {
  const f = fixture(); f.prepare.mockRejectedValueOnce(new Error('DECODE_FAILED'));
  f.buffer.add(f.raw[0]!); f.buffer.add(f.raw[1]!); f.preparing[1]!.resolve(f.ready[1]!);
  expect(await f.buffer.flush()).toBe(false); expect(f.persist).not.toHaveBeenCalled(); expect(f.release).not.toHaveBeenCalled();
  f.preparing[0]!.resolve(f.ready[0]!); expect(await f.buffer.retry()).toBe(true); expect(f.prepare).toHaveBeenCalledTimes(3); await f.buffer.dispose();
  const other = fixture(); other.prepare.mockRejectedValueOnce(new Error('DECODE_FAILED')); other.buffer.add(other.raw[0]!); other.buffer.add(other.raw[1]!); other.preparing[1]!.resolve(other.ready[1]!);
  await other.buffer.flush(); await other.buffer.discard(); expect(other.buffer.pending).toBe(0); expect(other.buffer.blocked).toBe(false); expect(other.release).toHaveBeenCalledTimes(3); expect(other.persist).not.toHaveBeenCalled(); await other.buffer.dispose();
});
it('cleans every owned resource even if one release fails', async () => {
  const f = fixture(); f.buffer.add(f.raw[0]!); f.buffer.add(f.raw[1]!); const closing = f.buffer.dispose(); f.release.mockImplementationOnce(() => { throw new Error('RELEASE_FAILED'); });
  f.preparing[0]!.resolve(f.ready[0]!); f.preparing[1]!.resolve(f.ready[1]!); await expect(closing).rejects.toThrow('释放'); expect(f.release).toHaveBeenCalledTimes(4);
});
