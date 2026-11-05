// Decision: .agents/notes/implemented/rendering/2026-11-05-main-camera-input.md
import { hasHeifHeader, rasterSize, rasterOrientation, imagePreviewSize, MAX_SOURCE_IMAGE_PIXELS } from './formats.js';
export { IMAGE_INPUT_ACCEPT } from './formats.js';
const workerPath = '/heic-worker-1-23-5.js';
const timeoutMs = 30_000;
const maxPending = 16;
const jobs: (() => void)[] = [];
let running = 0;
function drain() { while (running < 1 && jobs.length) jobs.shift()?.(); }
type Limits = { maxBytes: number; maxPixels: number; signal?: AbortSignal };
function dimensions(width: unknown, height: unknown, maxPixels: number): width is number {
  return typeof width === 'number' && typeof height === 'number' && Number.isSafeInteger(width) && Number.isSafeInteger(height) && width > 0 && height > 0 && width * height <= maxPixels;
}
/** HEIC stays on the device. Each decoder has a hard deadline and a disposable worker heap. */
export async function browserImage(blob: Blob, limits: Limits): Promise<Blob> {
  if (!blob.size || blob.size > limits.maxBytes) throw new Error('图片为空或超过大小限制。');
  if (!Number.isSafeInteger(limits.maxPixels) || limits.maxPixels < 1 || limits.maxPixels > 64_000_000) throw new Error('图片尺寸限制无效。');
  limits.signal?.throwIfAborted();
  const header = new Uint8Array(await blob.slice(0, 1024 * 1024).arrayBuffer());
  const heif = hasHeifHeader(header);
  const size = rasterSize(header);
  if (size) imagePreviewSize(size.width, size.height);
  if (!heif && (!size || size.width * size.height <= limits.maxPixels) && blob.size <= 10 * 1024 * 1024) {
    if (/^image\/hei[cf](?:-sequence)?$/i.test(blob.type)) throw new Error('HEIC 图片损坏或格式不受支持，请重新选择。');
    return blob;
  }
  const swapped = rasterOrientation(header) >= 5;
  const preview = size ? imagePreviewSize(swapped ? size.height : size.width, swapped ? size.width : size.height) : null;
  const pixels = await decode(blob, limits, heif, preview?.width, size);
  if (pixels instanceof Blob) { limits.signal?.throwIfAborted(); return pixels; }
  let allocatedCanvas: HTMLCanvasElement | undefined;
  try {
    limits.signal?.throwIfAborted();
    const canvas = document.createElement('canvas'); allocatedCanvas = canvas;
    const rotated = size && Math.abs(pixels.width / pixels.height - size.height / size.width) < Math.abs(pixels.width / pixels.height - size.width / size.height);
    const target = size ? imagePreviewSize(rotated ? size.height : size.width, rotated ? size.width : size.height) : imagePreviewSize(pixels.width, pixels.height);
    canvas.width = target.width; canvas.height = target.height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('当前浏览器无法处理图片。');
    context.fillStyle = '#fff'; context.fillRect(0, 0, canvas.width, canvas.height); context.drawImage(pixels, 0, 0, canvas.width, canvas.height);
    let result: Blob | undefined;
    for (const quality of [.95, .88, .8]) { result = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error('图片转换失败。')), 'image/jpeg', quality)); if (result.size <= 8 * 1024 * 1024) break; }
    if (!result || result.size > 8 * 1024 * 1024) throw new Error('图片处理后仍过大，请裁切后重试。');
    limits.signal?.throwIfAborted();
    return result;
  } finally { pixels.close(); if (allocatedCanvas) { allocatedCanvas.width = 0; allocatedCanvas.height = 0; } }
}
function decode(blob: Blob, limits: Limits, heif: boolean, resizeWidth: number | undefined, sourceSize: { width: number; height: number } | null): Promise<ImageBitmap | Blob> {
  if (jobs.length + running >= maxPending) return Promise.reject(new Error('正在处理较多图片，请稍后重试。'));
  return new Promise((resolve, reject) => {
    let worker: Worker | undefined, settled = false, started = false;
    const finish = (error?: Error, value?: ImageBitmap | Blob) => {
      if (settled) return;
      settled = true; clearTimeout(timer); limits.signal?.removeEventListener('abort', abort);
      worker?.terminate();
      const index = jobs.indexOf(start); if (index >= 0) jobs.splice(index, 1);
      if (started) running--;
      if (error) reject(error); else if (value) resolve(value);
      drain();
    };
    const abort = () => finish(new DOMException('图片处理已取消。', 'AbortError'));
    const timer = setTimeout(() => finish(new Error('图片处理超时，请重试或改用截图。')), timeoutMs);
    const start = () => {
      if (settled) return;
      started = true; running++;
      void blob.arrayBuffer().then(buffer => {
        if (settled) return;
        worker = new Worker(workerPath);
        worker.onerror = event => { event.preventDefault(); finish(new Error('图片解码失败，请重试或改用截图。')); };
        worker.onmessage = (event: MessageEvent<unknown>) => {
          try {
            const value = event.data;
            if (typeof value !== 'object' || value === null) throw new Error();
            if ('error' in value) { finish(new Error(value.error === 'pixels' ? '图片分辨率过高，请先缩小。' : '图片损坏或格式不受支持，请重新选择。')); return; }
            if ('blob' in value && value.blob instanceof Blob && value.blob.type === 'image/jpeg' && value.blob.size > 0 && 'width' in value && 'height' in value && dimensions(value.width, value.height, limits.maxPixels)) { finish(undefined, value.blob); return; }
            if (!('bitmap' in value) || !(value.bitmap instanceof ImageBitmap) || !dimensions(value.bitmap.width, value.bitmap.height, MAX_SOURCE_IMAGE_PIXELS)) throw new Error();
            finish(undefined, value.bitmap);
          } catch { finish(new Error('图片解码失败。')); }
        };
        worker.postMessage({ buffer, maxPixels: limits.maxPixels, heif, resizeWidth, sourceSize }, [buffer]);
      }).catch(() => finish(new Error('图片读取失败。')));
    };
    limits.signal?.addEventListener('abort', abort, { once: true });
    if (limits.signal?.aborted) { abort(); return; }
    jobs.push(start); drain();
  });
}
