import { expect, it, vi } from 'vitest';
import type { SolverInput, Verification } from '@solveflow/contracts/agent';
import { imageReviewRegions, prepareImageReview } from './image-review.js';

const input: SolverInput = { schemaVersion: 1, role: 'solver', identity: { ownerId: 'local', sessionId: 'session', runId: 'run' }, message: '', evidence: [], image: { mimeType: 'image/jpeg', bytes: Uint8Array.of(1) }, materials: [{ id: '00000000-0000-4000-8000-000000000002', image: { mimeType: 'image/jpeg', bytes: Uint8Array.of(2) } }] };
const region = { imageIndex: 1, x: .2, y: .3, width: .4, height: .1 };
const issue: Verification['issues'][number] = { code: 'TRANSCRIPTION', message: 'Table cell is different.', imageRegion: region };
it('selects at most two valid visual regions, keeps context and ignores duplicate, missing-source or logical locations', () => {
  const issues: Verification['issues'] = [{ ...issue, code: 'LOGIC' }, { ...issue, imageRegion: { ...region, imageIndex: 2 } }, issue, issue, { ...issue, imageRegion: { ...region, imageIndex: 0, x: 0, y: 0 } }, { ...issue, imageRegion: { ...region, x: .1 } }];
  const result = imageReviewRegions(input, issues);
  expect(result).toHaveLength(2); expect(result[0]?.imageIndex).toBe(1); expect(result[0]?.x).toBeLessThan(region.x); expect(result[0]?.width).toBeGreaterThan(region.width);
  expect(result[1]).toMatchObject({ imageIndex: 0, x: 0, y: 0 });
});
it('does not exceed the existing combined image-byte allowance or mismatch coordinates and output images', async () => {
  const full = { ...input, image: { ...input.image, bytes: new Uint8Array(4 * 1024 * 1024) }, materials: [{ ...input.materials![0]!, image: { ...input.image, bytes: new Uint8Array(4 * 1024 * 1024) } }] };
  expect(await prepareImageReview(full, [region], async () => [{ ...input.image }], new AbortController().signal)).toEqual({ views: [], regions: [] });
  await expect(prepareImageReview(input, [region, { ...region, imageIndex: 0 }], async () => [input.image], new AbortController().signal)).rejects.toThrow('IMAGE_REVIEW_REGION_MISMATCH');
});
it('stops stalled preparation at ten seconds, forwards cancellation and releases its timer', async () => {
  vi.useFakeTimers();
  try {
    let aborted = false;
    const pending = prepareImageReview(input, [region], async (_input, _regions, signal) => new Promise((_resolve, reject) => { signal.addEventListener('abort', () => { aborted = true; reject(new Error('CANCELLED')); }, { once: true }); }), new AbortController().signal);
    const failed = expect(pending).rejects.toThrow(); await vi.advanceTimersByTimeAsync(10_000); await failed;
    expect(aborted).toBe(true); expect(vi.getTimerCount()).toBe(0);
    const controller = new AbortController(); controller.abort(); const prepare = vi.fn();
    await expect(prepareImageReview(input, [region], prepare, controller.signal)).rejects.toThrow(); expect(prepare).not.toHaveBeenCalled();
  } finally { vi.useRealTimers(); }
});
