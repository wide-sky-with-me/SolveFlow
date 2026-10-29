import { MAX_PRINT_ROTATION, PrintImageAdjustmentSchema, PrintLayoutRegionSchema, type PrintImageAdjustment } from '@solveflow/contracts/local';
import { originalIllustrationBounds, type ProblemStatement } from '@solveflow/contracts/agent';
import { sharpenPrintPixels } from './print-image-sharpen';
import { normalizePrintPaperPixels } from './print-image-paper';
import { estimatePrintRotation } from './print-image-deskew';
import { warpPrintPerspective } from './print-image-perspective';

export const originalPrintAdjustment: PrintImageAdjustment = { rotation: 0, crop: { left: 0, top: 0, right: 1, bottom: 1 }, enhance: false };
type Bounds = { left: number; top: number; right: number; bottom: number; count: number };
function documentField(data: ImageData, valid?: Uint8Array): Uint8Array {
  const { width: w, height: h } = data; const available = new Uint8Array(w * h); const field = new Uint8Array(w * h); let biggest: number[] = [];
  for (let index = 0; index < available.length; index++) { const p = index * 4; const r = data.data[p] ?? 0; const g = data.data[p + 1] ?? 0; const b = data.data[p + 2] ?? 0; if ((!valid || valid[index]) && (r + g + b) / 3 > 75 && Math.max(r, g, b) - Math.min(r, g, b) < 65) available[index] = 1; }
  const stack: number[] = [];
  for (let i = 0; i < available.length; i++) if (available[i]) {
    const component: number[] = []; available[i] = 0; stack.push(i);
    while (stack.length) { const p = stack.pop(); if (p === undefined) break; component.push(p); const x = p % w;
      for (const next of [p - 1, p + 1, p - w, p + w]) if (next >= 0 && next < available.length && Math.abs(next % w - x) <= 1 && available[next]) { available[next] = 0; stack.push(next); }
    }
    if (component.length > biggest.length) biggest = component;
  }
  for (const point of biggest) field[point] = 1;
  return field;
}
/** Small connected ink components supply text points for estimating line rotation. */
function textInkPoints(data: ImageData): [number, number][] {
  const { width: w, height: h } = data; const gray = new Float32Array(w * h); const mask = new Uint8Array(w * h);
  const field = documentField(data); const paperIntegral = new Uint32Array((w + 1) * (h + 1));
  for (let y = 0; y < h; y++) { let sum = 0; for (let x = 0; x < w; x++) { sum += field[y * w + x] ?? 0; paperIntegral[(y + 1) * (w + 1) + x + 1] = (paperIntegral[y * (w + 1) + x + 1] ?? 0) + sum; } }
  const integral = new Float64Array((w + 1) * (h + 1));
  for (let y = 0; y < h; y++) { let sum = 0; for (let x = 0; x < w; x++) { const p = (y * w + x) * 4; const v = ((data.data[p] ?? 0) + (data.data[p + 1] ?? 0) + (data.data[p + 2] ?? 0)) / 3; gray[y * w + x] = v; sum += v; integral[(y + 1) * (w + 1) + x + 1] = (integral[y * (w + 1) + x + 1] ?? 0) + sum; } }
  for (let y = 12; y < h - 12; y++) for (let x = 12; x < w - 12; x++) {
    const index = y * w + x; const p = index * 4; const r = data.data[p] ?? 0; const g = data.data[p + 1] ?? 0; const b = data.data[p + 2] ?? 0;
    const mean = ((integral[(y + 12) * (w + 1) + x + 12] ?? 0) - (integral[(y - 12) * (w + 1) + x + 12] ?? 0) - (integral[(y + 12) * (w + 1) + x - 12] ?? 0) + (integral[(y - 12) * (w + 1) + x - 12] ?? 0)) / 576;
    const paper = ((paperIntegral[(y + 7) * (w + 1) + x + 7] ?? 0) - (paperIntegral[(y - 7) * (w + 1) + x + 7] ?? 0) - (paperIntegral[(y + 7) * (w + 1) + x - 7] ?? 0) + (paperIntegral[(y - 7) * (w + 1) + x - 7] ?? 0)) / 196;
    if (paper > .78 && mean > 85 && Math.max(r, g, b) - Math.min(r, g, b) < 65 && mean - (gray[index] ?? 0) > 27) mask[index] = 1;
  }
  const ink = mask.slice(); const components: Bounds[] = []; const stack: number[] = [];
  for (let i = 0; i < mask.length; i++) if (mask[i]) {
    mask[i] = 0; stack.push(i); const bound: Bounds = { left: w, top: h, right: 0, bottom: 0, count: 0 };
    while (stack.length) { const p = stack.pop(); if (p === undefined) break; const x = p % w; const y = Math.floor(p / w); bound.left = Math.min(bound.left, x); bound.right = Math.max(bound.right, x); bound.top = Math.min(bound.top, y); bound.bottom = Math.max(bound.bottom, y); bound.count++;
      for (const next of [p - 1, p + 1, p - w, p + w]) if (next >= 0 && next < mask.length && Math.abs(next % w - x) <= 1 && mask[next]) { mask[next] = 0; stack.push(next); }
    }
    const area = (bound.right - bound.left + 1) * (bound.bottom - bound.top + 1);
    if (bound.count >= 3 && !(bound.right - bound.left > w * .85) && !(bound.bottom - bound.top > h * .85) && !(area > w * h * .018 && bound.count / area > .25)) components.push(bound);
  }
  const points: [number, number][] = []; let glyphs = 0;
  // Crops have no fixed text margin; relevant labels can sit on any side of the diagram.
  for (const component of components) if (component.right - component.left <= w * .06 && component.bottom - component.top <= h * .06 && component.left > w * .015 && component.top > h * .015 && component.bottom < h * .985 && component.right < w * .985) {
    glyphs++;
    for (let y = component.top; y <= component.bottom; y++) for (let x = component.left; x <= component.right; x++) if (ink[y * w + x]) points.push([x, y]);
  }
  return glyphs >= 12 ? points : [];
}
function canvas(width: number, height: number) { const result = document.createElement('canvas'); result.width = width; result.height = height; const context = result.getContext('2d', { willReadFrequently: true }); if (!context) throw new Error('浏览器不支持图像整理。'); return { canvas: result, context }; }
async function loadImage(uri: string, signal: AbortSignal) {
  if (!/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(uri) || uri.length > 6 * 1024 * 1024) throw new Error('导出题图无效。');
  const image = new Image();
  await new Promise<void>((resolve, reject) => {
    const finish = (error?: Error) => { clearTimeout(timer); signal.removeEventListener('abort', aborted); image.onload = image.onerror = null; if (error) reject(error); else resolve(); };
    const aborted = () => { image.src = ''; finish(new Error('导出已取消。')); };
    const timer = setTimeout(() => finish(new Error('题图读取超时。')), 15000);
    image.onload = () => finish(); image.onerror = () => finish(new Error('题图无法读取。'));
    if (signal.aborted) { aborted(); return; }
    signal.addEventListener('abort', aborted, { once: true }); image.src = uri;
  });
  if (signal.aborted) throw new Error('导出已取消。');
  if (image.width * image.height > 16_000_000) throw new Error('题图尺寸超过整理上限。');
  return image;
}
function rotated(image: HTMLImageElement | HTMLCanvasElement, angle: number, maxSize: number) {
  const radians = angle * Math.PI / 180; const scale = Math.min(1, maxSize / Math.max(image.width, image.height));
  const w = image.width * scale; const h = image.height * scale;
  const result = canvas(Math.ceil(Math.abs(w * Math.cos(radians)) + Math.abs(h * Math.sin(radians))), Math.ceil(Math.abs(h * Math.cos(radians)) + Math.abs(w * Math.sin(radians))));
  result.context.fillStyle = '#fff'; result.context.fillRect(0, 0, result.canvas.width, result.canvas.height); result.context.translate(result.canvas.width / 2, result.canvas.height / 2); result.context.rotate(radians); result.context.drawImage(image, -w / 2, -h / 2, w, h); result.context.resetTransform(); return result;
}
function screenLineRotation(data: ImageData): { rotation: number; x: number; y: number } | null {
  const mask = new Uint8Array(data.width * data.height); const stack: number[] = []; let biggest: number[] = [];
  for (let y = 0; y < data.height * .65; y++) for (let x = 0; x < data.width; x++) { const p = (y * data.width + x) * 4; const r = data.data[p] ?? 0; const g = data.data[p + 1] ?? 0; const b = data.data[p + 2] ?? 0; if (b - r > 18 && b - g > 8 && b > 75) mask[y * data.width + x] = 1; }
  for (let i = 0; i < mask.length; i++) if (mask[i]) {
    const component: number[] = []; stack.push(i); mask[i] = 0;
    while (stack.length) { const p = stack.pop(); if (p === undefined) break; component.push(p); const x = p % data.width;
      for (const next of [p - 1, p + 1, p - data.width, p + data.width]) if (next >= 0 && next < mask.length && Math.abs(next % data.width - x) <= 1 && mask[next]) { mask[next] = 0; stack.push(next); }
    }
    if (component.length > biggest.length) biggest = component;
  }
  if (biggest.length < data.width * data.height * .012) return null;
  const bottom = new Int32Array(data.width).fill(-1); const counts = new Uint32Array(data.width);
  for (const point of biggest) { const x = point % data.width; bottom[x] = Math.max(bottom[x] ?? -1, Math.floor(point / data.width)); counts[x] = (counts[x] ?? 0) + 1; }
  const points: [number, number][] = [];
  for (let x = 0; x < data.width; x += 3) if ((counts[x] ?? 0) >= 3 && (bottom[x] ?? 0) > 3) points.push([x, bottom[x] ?? 0]);
  if (points.length < data.width * .15) return null;
  const meanX = points.reduce((sum, point) => sum + point[0], 0) / points.length; const meanY = points.reduce((sum, point) => sum + point[1], 0) / points.length;
  const varianceX = points.reduce((sum, point) => sum + (point[0] - meanX) ** 2, 0);
  const slope = points.reduce((sum, point) => sum + (point[0] - meanX) * (point[1] - meanY), 0) / Math.max(1, varianceX);
  const error = points.reduce((sum, point) => sum + (point[1] - meanY - slope * (point[0] - meanX)) ** 2, 0) / points.length;
  const angle = -Math.atan(slope) * 180 / Math.PI;
  return Math.sqrt(error) < 2.5 && Math.abs(angle) < MAX_PRINT_ROTATION ? { rotation: Math.round(angle * 4) / 4, x: meanX, y: meanY } : null;
}
/** Trim only a confirmed screen's surrounding photograph, retaining a generous paper margin. */
function screenCrop(data: ImageData, originalWidth: number, originalHeight: number, rotation: number, anchor: { x: number; y: number }): PrintImageAdjustment['crop'] {
  const { width, height } = data; const radians = rotation * Math.PI / 180, cos = Math.cos(radians), sin = Math.sin(radians);
  const valid = new Uint8Array(width * height); let validCount = 0;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const dx = x - width / 2, dy = y - height / 2;
    const sx = dx * cos + dy * sin + originalWidth / 2;
    const sy = -dx * sin + dy * cos + originalHeight / 2;
    if (sx >= 0 && sy >= 0 && sx < originalWidth && sy < originalHeight) { valid[y * width + x] = 1; validCount++; }
  }
  const field = documentField(data, valid); let left = width, top = height, right = 0, bottom = 0, count = 0;
  const anchorX = (anchor.x - originalWidth / 2) * cos - (anchor.y - originalHeight / 2) * sin + width / 2;
  const anchorY = (anchor.x - originalWidth / 2) * sin + (anchor.y - originalHeight / 2) * cos + height / 2;
  let attached = 0;
  for (const dy of [12, 24]) for (const dx of [-15, 0, 15]) {
    const x = Math.round(anchorX + dx), y = Math.round(anchorY + dy);
    if (x >= 0 && y >= 0 && x < width && y < height && field[y * width + x]) attached++;
  }
  // A larger neutral wall is not the screen's paper. Weak attachment keeps the full photo.
  if (attached < 3) return originalPrintAdjustment.crop;
  for (let index = 0; index < field.length; index++) if (field[index]) { const x = index % width, y = Math.floor(index / width); count++; left = Math.min(left, x); top = Math.min(top, y); right = Math.max(right, x + 1); bottom = Math.max(bottom, y + 1); }
  if (count < validCount * .3 || right - left < originalWidth * .45 || bottom - top < originalHeight * .3) return originalPrintAdjustment.crop;
  const margin = Math.max(12, Math.ceil(Math.max(width, height) * .03));
  return { left: Math.max(0, left - margin) / width, top: Math.max(0, top - margin) / height, right: Math.min(width, right + margin) / width, bottom: Math.min(height, bottom + margin) / height };
}
export async function detectPrintAdjustment(uri: string, signal: AbortSignal): Promise<PrintImageAdjustment> {
  const image = await loadImage(uri, signal); const sample = rotated(image, 0, 600);
  try {
    const data = sample.context.getImageData(0, 0, sample.canvas.width, sample.canvas.height);
    const screen = screenLineRotation(data);
    const rotation = screen?.rotation ?? await estimatePrintRotation(textInkPoints(data), data.width, data.height, signal);
    signal.throwIfAborted();
    let crop = originalPrintAdjustment.crop;
    if (screen !== null) {
      const turned = rotated(sample.canvas, rotation, 900);
      try { crop = screenCrop(turned.context.getImageData(0, 0, turned.canvas.width, turned.canvas.height), sample.canvas.width, sample.canvas.height, rotation, screen); }
      finally { turned.canvas.width = 0; }
    }
    return PrintImageAdjustmentSchema.parse({ rotation, crop, enhance: true });
  } finally { sample.canvas.width = 0; }
}
// Decision: .agents/notes/implemented/storage/2026-10-15-explicit-print-enhancement.md
/** Correct the unrotated paper before padding; source and manual geometry remain unchanged. */
export async function preparePrintImage(uri: string, value: PrintImageAdjustment, signal: AbortSignal): Promise<string> {
  const parsed = PrintImageAdjustmentSchema.safeParse(value);
  if (!parsed.success) throw new Error('请检查旋转角度和裁切范围，裁切后的宽高须至少保留 5%。');
  const adjustment = parsed.data; const image = await loadImage(uri, signal);
  let original: ReturnType<typeof rotated> | undefined; let projected: ReturnType<typeof canvas> | undefined; let turned: ReturnType<typeof rotated> | undefined; let result: ReturnType<typeof canvas> | undefined;
  try {
    if (adjustment.enhance || adjustment.perspective) original = rotated(image, 0, 2048);
    if (adjustment.enhance && original) {
      const data = original.context.getImageData(0, 0, original.canvas.width, original.canvas.height);
      await normalizePrintPaperPixels(data.data, data.width, data.height, signal); original.context.putImageData(data, 0, 0);
    }
    if (adjustment.perspective && original) {
      const source = original.context.getImageData(0, 0, original.canvas.width, original.canvas.height);
      const warped = await warpPrintPerspective(source.data, source.width, source.height, adjustment.perspective, signal);
      projected = canvas(warped.width, warped.height);
      projected.context.putImageData(new ImageData(warped.data, warped.width, warped.height), 0, 0);
    }
    turned = rotated(projected?.canvas ?? original?.canvas ?? image, adjustment.rotation, 2048); const crop = adjustment.crop;
    const x = Math.floor(crop.left * turned.canvas.width); const y = Math.floor(crop.top * turned.canvas.height);
    result = canvas(Math.ceil((crop.right - crop.left) * turned.canvas.width), Math.ceil((crop.bottom - crop.top) * turned.canvas.height));
    result.context.drawImage(turned.canvas, x, y, result.canvas.width, result.canvas.height, 0, 0, result.canvas.width, result.canvas.height);
    if (adjustment.enhance) {
      const data = result.context.getImageData(0, 0, result.canvas.width, result.canvas.height);
      await sharpenPrintPixels(data.data, data.width, data.height, signal); result.context.putImageData(data, 0, 0);
    }
    signal.throwIfAborted(); return result.canvas.toDataURL('image/jpeg', .94);
  } finally { for (const layer of [original, projected, turned, result]) if (layer) layer.canvas.width = 0; }
}

/** Region coordinates belong to the unrotated source: crop first, then straighten the crop. */
export async function prepareOriginalPrintRegion(uri: string, region: NonNullable<ProblemStatement['illustrations']>[number], rotation: number, signal: AbortSignal) {
  const checked = PrintLayoutRegionSchema.parse({ id: region.id, alt: region.alt, x: region.x, y: region.y, width: region.width, height: region.height, role: 'question' });
  const crop = originalIllustrationBounds(checked); const image = await loadImage(uri, signal);
  const source = rotated(image, 0, 2048); const piece = canvas(Math.max(1, Math.ceil(crop.width * source.canvas.width)), Math.max(1, Math.ceil(crop.height * source.canvas.height)));
  let original: string;
  try {
    piece.context.drawImage(source.canvas, crop.x * source.canvas.width, crop.y * source.canvas.height, crop.width * source.canvas.width, crop.height * source.canvas.height, 0, 0, piece.canvas.width, piece.canvas.height);
    original = piece.canvas.toDataURL('image/jpeg', .98);
  } finally { source.canvas.width = 0; piece.canvas.width = 0; }
  const detected = await detectPrintAdjustment(original, signal);
  const adjustment = { ...detected, rotation: detected.rotation || rotation };
  return { original, image: await preparePrintImage(original, adjustment, signal), adjustment };
}
