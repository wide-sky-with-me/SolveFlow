import { expect, it, vi } from 'vitest';
import { PhotoThumbnailCache } from './photo-thumbnail-cache';
import type { Photo } from './platform.types';
const photo = (id: string): Photo => ({ uri: id, width: 3072, height: 2304 });
const small = (source: Photo): Photo => ({ uri: `${source.uri}-small`, width: 192, height: 144 });
const gate = () => { let resolve!: (value: Photo) => void; const promise = new Promise<Photo>(done => { resolve = done; }); return { promise, resolve }; };

it('shares a thumbnail, reuses an idle preview and never releases its original', async () => {
  const render = vi.fn(async (source: Photo) => small(source)), release = vi.fn();
  const cache = new PhotoThumbnailCache(render, release), source = photo('one');
  const first = cache.acquire(source), second = cache.acquire(source);
  expect(await first.ready).toBe(await second.ready); expect(render).toHaveBeenCalledTimes(1);
  first.release(); first.release(); second.release();
  const again = cache.acquire(source); expect(await again.ready).toEqual(small(source)); expect(render).toHaveBeenCalledTimes(1);
  again.release(); cache.clear(); cache.clear(); expect(release.mock.calls).toEqual([[small(source)]]);
});
it('bounds simultaneous work and evicts idle previews before creating another asset', async () => {
  const gates = [gate(),gate(),gate()]; let index = 0;
  const render = vi.fn(() => gates[index++]!.promise), release = vi.fn();
  const cache = new PhotoThumbnailCache(render, release, 2, 2), sources = ['a','b','c'].map(photo);
  const leases = sources.map(source => cache.acquire(source));
  await vi.waitFor(() => expect(render).toHaveBeenCalledTimes(2));
  gates[0]!.resolve(small(sources[0]!)); gates[1]!.resolve(small(sources[1]!)); await leases[0]!.ready; await leases[1]!.ready;
  expect(render).toHaveBeenCalledTimes(2); leases[0]!.release();
  await vi.waitFor(() => expect(render).toHaveBeenCalledTimes(3)); expect(release).toHaveBeenCalledWith(small(sources[0]!));
  gates[2]!.resolve(small(sources[2]!)); await leases[2]!.ready; leases.forEach(lease => lease.release()); cache.clear(); expect(release).toHaveBeenCalledTimes(3);
});
it('cancels queued work and releases a result arriving after close exactly once', async () => {
  const held = gate(), render = vi.fn(() => held.promise), release = vi.fn();
  const cache = new PhotoThumbnailCache(render, release, 2, 1), a = photo('a');
  const first = cache.acquire(a), second = cache.acquire(photo('b')); await vi.waitFor(() => expect(render).toHaveBeenCalledTimes(1));
  cache.clear(); expect(await first.ready).toBeNull(); expect(await second.ready).toBeNull();
  held.resolve(small(a)); await vi.waitFor(() => expect(release).toHaveBeenCalledTimes(1));
  first.release(); second.release(); cache.clear(); expect(render).toHaveBeenCalledTimes(1); expect(release).not.toHaveBeenCalledWith(a);
});
it('does not replace a fresh lease with the late result of an abandoned lease', async () => {
  const old = gate(), fresh = gate(), release = vi.fn();
  const render = vi.fn().mockImplementationOnce(() => old.promise).mockImplementationOnce(() => fresh.promise);
  const cache = new PhotoThumbnailCache(render,release), source = photo('same');
  const abandoned = cache.acquire(source); await vi.waitFor(() => expect(render).toHaveBeenCalledTimes(1));
  cache.clear(); const next = cache.acquire(source); await vi.waitFor(() => expect(render).toHaveBeenCalledTimes(2));
  const current = small(source); fresh.resolve(current); expect(await next.ready).toBe(current);
  const late = { ...small(source), uri: 'abandoned-small' }; old.resolve(late);
  await vi.waitFor(() => expect(release).toHaveBeenCalledWith(late));
  abandoned.release(); expect(release).not.toHaveBeenCalledWith(current);
  next.release(); cache.clear(); expect(release).toHaveBeenCalledTimes(2);
});
it('releases removed or edited sources and allows a new preview after failure', async () => {
  const render = vi.fn(async (source: Photo) => small(source)), release = vi.fn();
  const cache = new PhotoThumbnailCache(render, release); const a = photo('a'), edited = photo('edited');
  const first = cache.acquire(a); await first.ready; first.release(); cache.retain(new Set([edited]));
  expect(release).toHaveBeenCalledWith(small(a));
  render.mockRejectedValueOnce(new Error('SYNTHETIC_DECODE'));
  const failed = cache.acquire(edited); expect(await failed.ready).toBeNull(); failed.release();
  const retry = cache.acquire(edited); expect(await retry.ready).toEqual(small(edited)); retry.release(); cache.clear();
  expect(release).toHaveBeenCalledTimes(2);
});
it('reports cleanup failure and still clears the remaining cached previews', async () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  try {
    const release = vi.fn().mockImplementationOnce(() => { throw new Error('SYNTHETIC_RELEASE'); });
    const cache = new PhotoThumbnailCache(async source => small(source), release);
    const a = cache.acquire(photo('a')), b = cache.acquire(photo('b')); await a.ready; await b.ready;
    cache.clear(); expect(release).toHaveBeenCalledTimes(2); expect(warn).toHaveBeenCalledWith('PHOTO_THUMBNAIL_CLEANUP_FAILED');
  } finally { warn.mockRestore(); }
});
