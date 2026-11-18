import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PhotoDisplayCache } from './photo-display-cache-core.js';

const sampleDataUri = (seed: number) => `data:image/jpeg;base64,${Buffer.from([seed, seed + 1, seed + 2, seed + 3]).toString('base64')}`;

describe('PhotoDisplayCache', () => {
  beforeEach(() => {
    let index = 0;
    vi.spyOn(URL, 'createObjectURL').mockImplementation(() => `blob:photo-${++index}`);
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('reuses blob URLs across warm and acquire calls and protects pinned viewers from eviction', () => {
    const cache = new PhotoDisplayCache(2, 1024);
    const first = sampleDataUri(1);
    const second = sampleDataUri(2);
    const third = sampleDataUri(3);

    const warmed = cache.warm(first);
    expect(warmed).toBe('blob:photo-1');
    const pinned = cache.acquire(first);
    expect(pinned.url).toBe('blob:photo-1');
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);

    const unpinned = cache.acquire(second);
    expect(unpinned.url).toBe('blob:photo-2');
    unpinned.release();

    const latest = cache.acquire(third);
    expect(latest.url).toBe('blob:photo-3');
    expect(cache.has(first)).toBe(true);
    expect(cache.has(second)).toBe(false);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:photo-2');

    pinned.release();
    latest.release();
    cache.clear();
  });
});
