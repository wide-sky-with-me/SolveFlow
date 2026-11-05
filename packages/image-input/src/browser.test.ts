import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { browserImage } from './browser.js';
import { hasHeifHeader, IMAGE_INPUT_ACCEPT } from './formats.js';
const header = new Uint8Array([0,0,0,24,102,116,121,112,104,101,105,99,0,0,0,0,109,105,102,49,104,101,105,99]);
const file = () => new File([header], 'camera.HEIC', { type: '' });
const limits = { maxBytes: 10 * 1024 * 1024, maxPixels: 20_000_000 };
class TestWorker {
  static all: TestWorker[] = [];
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: ((event: { preventDefault(): void }) => void) | null = null;
  terminate = vi.fn(); postMessage = vi.fn();
  constructor() { TestWorker.all.push(this); }
}
beforeEach(() => { TestWorker.all = []; vi.stubGlobal('Worker', TestWorker); });
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
const waitForWorkers = async (count: number) => { await vi.waitFor(() => expect(TestWorker.all).toHaveLength(count)); };
it('accepts HEIC/HEIF extensions and detects the container even when MIME is empty', () => {
  expect(IMAGE_INPUT_ACCEPT).toContain('.heic'); expect(IMAGE_INPUT_ACCEPT).toContain('.heif');
  expect(hasHeifHeader(header)).toBe(true);
  expect(hasHeifHeader(new Uint8Array([255,216,255]))).toBe(false);
  const fake = header.slice(); fake[4] = 0; expect(hasHeifHeader(fake)).toBe(false);
  const avif = header.slice(); avif.set([97,118,105,102],8); avif.set([109,105,102,49],16); avif.fill(0,20); expect(hasHeifHeader(avif)).toBe(false);
});
it('preserves JPEG/PNG/WebP bytes for the existing normalization path', async () => {
  const png = new Blob(['png-data'], { type: 'image/png' });
  expect(await browserImage(png, limits)).toBe(png); expect(TestWorker.all).toHaveLength(0);
});
it('rejects empty, oversize, bad limits and broken declared HEIC before allocating workers', async () => {
  await expect(browserImage(new Blob(), limits)).rejects.toThrow('图片为空');
  await expect(browserImage(file(), { ...limits, maxBytes: 1 })).rejects.toThrow('大小限制');
  await expect(browserImage(file(), { ...limits, maxPixels: Infinity })).rejects.toThrow('限制无效');
  await expect(browserImage(new Blob(['broken'], { type: 'image/heic' }), limits)).rejects.toThrow('损坏');
  expect(TestWorker.all).toHaveLength(0);
});
it('aborts running and queued jobs and frees decoder heaps', async () => {
  const controllers = [new AbortController(), new AbortController(), new AbortController()];
  const results = controllers.map(c => browserImage(file(), { ...limits, signal: c.signal }).catch(e => e));
  await waitForWorkers(1);
  controllers.forEach(c => c.abort());
  for (const result of results) expect(await result).toMatchObject({ name: 'AbortError' });
  for (const worker of TestWorker.all) expect(worker.terminate).toHaveBeenCalledOnce();
  expect(TestWorker.all).toHaveLength(1);
});
it('terminates a hung decoder on timeout and allows the next import', async () => {
  vi.useFakeTimers();
  const pending = browserImage(file(), limits).catch(e => e);
  await vi.advanceTimersByTimeAsync(1); expect(TestWorker.all).toHaveLength(1);
  await vi.advanceTimersByTimeAsync(30_000);
  expect(await pending).toMatchObject({ message: expect.stringContaining('超时') });
  expect(TestWorker.all[0]!.terminate).toHaveBeenCalledOnce();
});
it('rejects invalid worker replies and releases resources', async () => {
  const result = browserImage(file(), limits).catch(e => e); await waitForWorkers(1);
  TestWorker.all[0]!.onmessage?.({ data: { width: 900000, height: 900000, data: new Uint8ClampedArray(4) } });
  expect(await result).toMatchObject({ message: '图片解码失败。' });
  expect(TestWorker.all[0]!.terminate).toHaveBeenCalledOnce();
});
it('keeps pixel-limit errors actionable', async () => {
  const result = browserImage(file(), limits).catch(e => e); await waitForWorkers(1);
  TestWorker.all[0]!.onmessage?.({ data: { error: 'pixels' } });
  expect(await result).toMatchObject({ message: expect.stringContaining('分辨率过高') });
  expect(TestWorker.all[0]!.terminate).toHaveBeenCalledOnce();
});
it('closes a transferred bitmap when cancelled between decoding and foreground encoding', async () => {
  class Bitmap { width = 480; height = 320; close = vi.fn(); }
  vi.stubGlobal('ImageBitmap', Bitmap);
  const controller = new AbortController(), bitmap = new Bitmap();
  const result = browserImage(file(), { ...limits, signal: controller.signal }).catch(error => error);
  await waitForWorkers(1); TestWorker.all[0]!.onmessage?.({ data: { bitmap } }); controller.abort();
  expect(await result).toMatchObject({ name: 'AbortError' }); expect(bitmap.close).toHaveBeenCalledOnce();
});
