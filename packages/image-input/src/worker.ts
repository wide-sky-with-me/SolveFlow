export {};
import { imagePreviewSize, MAX_SOURCE_IMAGE_BYTES, MAX_SOURCE_IMAGE_PIXELS } from './formats.js';
interface HeifImage {
  get_width(): number; get_height(): number; is_primary(): boolean; free(): void;
  display(image: ImageData, done: (result: ImageData | null) => void): void;
}
interface HeifModule {
  HeifDecoder: new () => { decoder: number | null; decode(bytes: Uint8Array): HeifImage[] };
  heif_context_free(context: number): void;
}
declare function importScripts(...urls: string[]): void;
declare function libheif(options: { print: () => void; printErr: () => void }): Promise<HeifModule>;
onmessage = (event: MessageEvent<unknown>) => { void convert(event.data); };
async function convert(value: unknown) {
  let result: { error: string } | { width: number; height: number; blob: Blob } | { bitmap: ImageBitmap } = { error: 'decode' };
  let decoder: InstanceType<HeifModule['HeifDecoder']> | undefined, module: HeifModule | undefined, bitmap: ImageBitmap | undefined;
  let images: HeifImage[] = [];
  try {
    if (typeof value !== 'object' || value === null || !('buffer' in value) || !(value.buffer instanceof ArrayBuffer) || value.buffer.byteLength > MAX_SOURCE_IMAGE_BYTES || !('maxPixels' in value) || typeof value.maxPixels !== 'number' || !Number.isSafeInteger(value.maxPixels) || value.maxPixels < 1 || value.maxPixels > MAX_SOURCE_IMAGE_PIXELS || !('heif' in value) || typeof value.heif !== 'boolean') throw new Error();
    if (value.heif) {
      importScripts('/heic-codec-1-23-5.js');
      module = await libheif({ print: () => {}, printErr: () => {} }); decoder = new module.HeifDecoder(); images = decoder.decode(new Uint8Array(value.buffer));
      const image = images.find(item => item.is_primary()) ?? (images.length === 1 ? images[0] : undefined); if (!image) throw new Error();
      const width = image.get_width(), height = image.get_height();
      let target; try { target = imagePreviewSize(width, height); } catch { postMessage({ error: 'pixels' }); return; }
      if (target.width * target.height > value.maxPixels) { postMessage({ error: 'pixels' }); return; }
      // Safari can use its native HEIC decoder. Other browsers fall back to libheif.
      try { bitmap = await createImageBitmap(new Blob([value.buffer], { type: 'image/heic' }), { resizeWidth: target.width, resizeHeight: target.height }); } catch { /* Use the local HEVC decoder. */ }
      if (!bitmap) {
        const decoded = await new Promise<ImageData>((resolve, reject) => image.display(new ImageData(width, height), data => data ? resolve(data) : reject(new Error())));
        bitmap = await createImageBitmap(decoded, { resizeWidth: target.width, resizeHeight: target.height });
      }
    } else {
      const width = 'resizeWidth' in value && typeof value.resizeWidth === 'number' && Number.isInteger(value.resizeWidth) && value.resizeWidth > 0 && value.resizeWidth <= 4096 ? value.resizeWidth : undefined;
      bitmap = await createImageBitmap(new Blob([value.buffer]), { imageOrientation: 'from-image', ...(width ? { resizeWidth: width } : {}) });
    }
    let target; try { target = imagePreviewSize(bitmap.width, bitmap.height); } catch { postMessage({ error: 'pixels' }); return; }
    if (!value.heif && 'sourceSize' in value && value.sourceSize && typeof value.sourceSize === 'object' && 'width' in value.sourceSize && 'height' in value.sourceSize && typeof value.sourceSize.width === 'number' && typeof value.sourceSize.height === 'number') {
      const sourceWidth = value.sourceSize.width, sourceHeight = value.sourceSize.height;
      const rotated = Math.abs(bitmap.width / bitmap.height - sourceHeight / sourceWidth) < Math.abs(bitmap.width / bitmap.height - sourceWidth / sourceHeight);
      target = imagePreviewSize(rotated ? sourceHeight : sourceWidth, rotated ? sourceWidth : sourceHeight);
    }
    if (target.width * target.height > value.maxPixels) { postMessage({ error: 'pixels' }); return; }
    if (typeof OffscreenCanvas === 'undefined') {
      result = { bitmap }; postMessage(result, { transfer: [bitmap] }); bitmap = undefined; return;
    }
    const canvas = new OffscreenCanvas(target.width, target.height);
    try {
      const context = canvas.getContext('2d'); if (!context) throw new Error();
      context.fillStyle = '#fff'; context.fillRect(0, 0, canvas.width, canvas.height); context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      let blob: Blob | undefined;
      for (const quality of [.95, .88, .8]) { blob = await canvas.convertToBlob({ type: 'image/jpeg', quality }); if (blob.size <= 8 * 1024 * 1024) break; }
      if (!blob || blob.size > 8 * 1024 * 1024) throw new Error();
      result = { width: canvas.width, height: canvas.height, blob };
    } finally { canvas.width = 0; canvas.height = 0; }
  } catch { result = { error: 'decode' }; }
  finally { bitmap?.close(); for (const image of images) image.free(); if (decoder?.decoder && module) module.heif_context_free(decoder.decoder); }
  postMessage(result);
}
