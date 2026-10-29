import { afterEach, expect, it, vi } from 'vitest';
import type { Photo } from './platform.types';
const mock = vi.hoisted(() => ({ transform: vi.fn<(photo: Photo) => Promise<Photo>>(), release: vi.fn<(photo: Photo) => void>() }));
vi.mock('./platform', () => ({ transformPhoto: mock.transform, releasePhoto: mock.release }));
import { prepareBatchPhotos } from './batch-photo-preparation';
afterEach(() => { vi.clearAllMocks(); });
function fixture(count = 3) {
  const raw = Array.from({ length: count }, (_, index): Photo => ({ uri: `raw-${index}`, width: 4032, height: 3024 }));
  const ready = raw.map((_, index): Photo => ({ uri: `normalized-${index}`, width: 2048, height: 1536, normalized: true }));
  const pending = new Map<string, { resolve: (photo: Photo) => void; reject: (cause: unknown) => void }>();
  mock.transform.mockImplementation((photo: Photo) => new Promise<Photo>((resolve, reject) => pending.set(photo.uri, { resolve, reject })));
  const buffer = prepareBatchPhotos(raw);
  return { buffer, raw, ready, resolve(index: number) { const value = pending.get(raw[index]!.uri); if (!value) throw new Error('NOT_PREPARING'); value.resolve(ready[index]!); }, reject(index: number) { pending.get(raw[index]!.uri)?.reject(new Error('NORMALIZE_FAILED')); } };
}
it('normalizes at most two ahead, keeps requested order, and transfers release ownership to the saver', async () => {
  const f = fixture(); expect(mock.transform).not.toHaveBeenCalled();
  const acquire = f.buffer.get(0); await Promise.resolve(); expect(mock.transform).toHaveBeenCalledTimes(2);
  let accepted = false; const first = acquire().then(photo => { accepted = true; return photo; });
  f.resolve(1); await Promise.resolve(); expect(accepted).toBe(false); expect(() => f.buffer.get(2)).toThrow('请先完成');
  f.resolve(0); await expect(first).resolves.toBe(f.ready[0]); await f.buffer.discard(0);
  expect(mock.release).not.toHaveBeenCalled();
  const next = f.buffer.get(1); await Promise.resolve(); expect(mock.transform).toHaveBeenCalledTimes(3);
  await expect(next()).resolves.toBe(f.ready[1]); await f.buffer.discard(1);
  const closing = f.buffer.dispose(); f.resolve(2); await closing;
  expect(mock.release.mock.calls).toEqual([[f.ready[2]]]);
});
it('releases unclaimed late results exactly once and waits before raw inputs can be deleted', async () => {
  const f = fixture(); f.buffer.get(0); await Promise.resolve();
  let done = false; const closing = f.buffer.dispose().then(() => { done = true; });
  expect(f.buffer.dispose()).toBeInstanceOf(Promise); f.resolve(1); await Promise.resolve(); expect(done).toBe(false);
  f.resolve(0); await closing; await f.buffer.dispose();
  expect(mock.release.mock.calls.map(([photo]) => photo.uri).sort()).toEqual(['normalized-0', 'normalized-1']);
  expect(mock.transform).toHaveBeenCalledTimes(2); expect(() => f.buffer.get(1)).toThrow('已关闭');
});
it('observes a speculative failure without affecting the current save or starting another admission', async () => {
  const f = fixture(2), first = f.buffer.get(0); await Promise.resolve(); f.reject(1); f.resolve(0);
  await expect(first()).resolves.toBe(f.ready[0]); await f.buffer.discard(0);
  await expect(f.buffer.get(1)()).rejects.toThrow('NORMALIZE_FAILED'); await f.buffer.dispose();
  expect(mock.release).not.toHaveBeenCalled();
});
it('disposes prepared images even when the caller rejects admission before claiming them', async () => {
  const f = fixture(2); f.buffer.get(0); await Promise.resolve(); f.resolve(0); f.resolve(1);
  await f.buffer.dispose(); expect(mock.release).toHaveBeenCalledTimes(2);
});
it('attempts every cleanup and retains a classified failure when a release throws', async () => {
  const f = fixture(2); f.buffer.get(0); await Promise.resolve(); f.resolve(0); f.resolve(1);
  mock.release.mockImplementationOnce(() => { throw new Error('RELEASE_FAILED'); });
  await expect(f.buffer.dispose()).rejects.toThrow('资源释放失败'); expect(mock.release).toHaveBeenCalledTimes(2);
});
