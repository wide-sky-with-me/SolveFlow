import { PrintImageAdjustmentSchema, PrintLayoutRegionSchema, type PrintImageAdjustment } from '@solveflow/contracts/local';
import { originalIllustrationBounds, type ProblemStatement } from '@solveflow/contracts/agent';

export const originalPrintAdjustment: PrintImageAdjustment = { rotation: 0, crop: { left: 0, top: 0, right: 1, bottom: 1 }, enhance: false };
type Bounds = { left: number; top: number; right: number; bottom: number; count: number };
function documentField(data: ImageData): Uint8Array {
  const { width: w, height: h } = data; const available = new Uint8Array(w * h); const field = new Uint8Array(w * h); let biggest: number[] = [];
  for (let index = 0; index < available.length; index++) { const p = index * 4; const r = data.data[p] ?? 0; const g = data.data[p + 1] ?? 0; const b = data.data[p + 2] ?? 0; if ((r + g + b) / 3 > 75 && Math.max(r, g, b) - Math.min(r, g, b) < 22) available[index] = 1; }
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
  const points: [number, number][] = [];
  for (const component of components) if (component.right - component.left <= w * .06 && component.bottom - component.top <= h * .06 && component.top > h * .08 && component.bottom < h * .85 && component.right < w * .75) {
    for (let y = component.top; y <= component.bottom; y++) for (let x = component.left; x <= component.right; x++) if (ink[y * w + x]) points.push([x, y]);
  }
  return points;
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
function rotated(image: HTMLImageElement, angle: number, maxSize: number) {
  const radians = angle * Math.PI / 180; const scale = Math.min(1, maxSize / Math.max(image.width, image.height));
  const w = image.width * scale; const h = image.height * scale;
  const result = canvas(Math.ceil(Math.abs(w * Math.cos(radians)) + Math.abs(h * Math.sin(radians))), Math.ceil(Math.abs(h * Math.cos(radians)) + Math.abs(w * Math.sin(radians))));
  result.context.fillStyle = '#fff'; result.context.fillRect(0, 0, result.canvas.width, result.canvas.height); result.context.translate(result.canvas.width / 2, result.canvas.height / 2); result.context.rotate(radians); result.context.drawImage(image, -w / 2, -h / 2, w, h); result.context.resetTransform(); return result;
}
function screenLineRotation(data: ImageData): number | null {
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
  return Math.sqrt(error) < 2.5 && Math.abs(angle) <= 12 ? Math.round(angle * 4) / 4 : null;
}
export async function detectPrintAdjustment(uri: string, signal: AbortSignal): Promise<PrintImageAdjustment> {
  const image = await loadImage(uri, signal); const sample = rotated(image, 0, 600); const data = sample.context.getImageData(0, 0, sample.canvas.width, sample.canvas.height); const points = textInkPoints(data);
  let rotation = 0; let best = 0;
  if (points.length > 30) for (let angle = -12; angle <= 12; angle += .25) {
    const radians = angle * Math.PI / 180; const bins = new Uint32Array(sample.canvas.height + sample.canvas.width);
    for (const [x, y] of points) { const row = Math.round(y * Math.cos(radians) + x * Math.sin(radians)) + Math.ceil(sample.canvas.width / 2); if (row >= 0 && row < bins.length) bins[row] = (bins[row] ?? 0) + 1; }
    const score = bins.reduce((sum, count) => sum + count * count, 0); if (score > best) { best = score; rotation = angle; }
  }
  rotation = screenLineRotation(data) ?? rotation;
  sample.canvas.width = 0;
  // A text detector cannot prove that faint diagrams or last choices lie inside its bounds.
  // Keep the complete rotated source until the user explicitly accepts a crop in preview.
  return PrintImageAdjustmentSchema.parse({ rotation, crop: originalPrintAdjustment.crop, enhance: true });
}
/** Geometry and gentle illumination correction only; the source record is never changed. */
export async function preparePrintImage(uri: string, value: PrintImageAdjustment, signal: AbortSignal): Promise<string> {
  const parsed = PrintImageAdjustmentSchema.safeParse(value);
  if (!parsed.success) throw new Error('请检查旋转角度和裁切范围，裁切后的宽高须至少保留 5%。');
  const adjustment = parsed.data; const image = await loadImage(uri, signal);
  const turned = rotated(image, adjustment.rotation, 2048); const crop = adjustment.crop;
  const x = Math.floor(crop.left * turned.canvas.width); const y = Math.floor(crop.top * turned.canvas.height);
  const result = canvas(Math.ceil((crop.right - crop.left) * turned.canvas.width), Math.ceil((crop.bottom - crop.top) * turned.canvas.height));
  result.context.drawImage(turned.canvas, x, y, result.canvas.width, result.canvas.height, 0, 0, result.canvas.width, result.canvas.height);
  if (adjustment.enhance) {
    const data = result.context.getImageData(0, 0, result.canvas.width, result.canvas.height); const size = 64;
    const columns = Math.ceil(data.width / size); const rows = Math.ceil(data.height / size); const background = new Float32Array(columns * rows * 3);
    for (let top = 0; top < data.height; top += size) for (let left = 0; left < data.width; left += size) {
      const bottom = Math.min(data.height, top + size); const right = Math.min(data.width, left + size);
      for (let channel = 0; channel < 3; channel++) { const samples: number[] = [];
        for (let yy = top; yy < bottom; yy += 4) for (let xx = left; xx < right; xx += 4) samples.push(data.data[(yy * data.width + xx) * 4 + channel] ?? 0);
        samples.sort((a, b) => a - b); background[(Math.floor(top / size) * columns + Math.floor(left / size)) * 3 + channel] = Math.max(90, samples[Math.floor(samples.length * .9)] ?? 255);
      }
    }
    for (let yy = 0; yy < data.height; yy++) for (let xx = 0; xx < data.width; xx++) {
      const gx = Math.max(0, Math.min(columns - 1, xx / size - .5)); const gy = Math.max(0, Math.min(rows - 1, yy / size - .5)); const x0 = Math.floor(gx); const y0 = Math.floor(gy); const x1 = Math.min(columns - 1, x0 + 1); const y1 = Math.min(rows - 1, y0 + 1); const fx = gx - x0; const fy = gy - y0;
      const p = (yy * data.width + xx) * 4;
      for (let c = 0; c < 3; c++) { const a = (background[(y0 * columns + x0) * 3 + c] ?? 255) * (1 - fx) + (background[(y0 * columns + x1) * 3 + c] ?? 255) * fx; const b = (background[(y1 * columns + x0) * 3 + c] ?? 255) * (1 - fx) + (background[(y1 * columns + x1) * 3 + c] ?? 255) * fx; data.data[p + c] = Math.min(255, (data.data[p + c] ?? 0) * 255 / (a * (1 - fy) + b * fy)); }
    }
    result.context.putImageData(data, 0, 0);
  }
  if (signal.aborted) throw new Error('导出已取消。');
  const output = result.canvas.toDataURL('image/jpeg', .94); turned.canvas.width = 0; result.canvas.width = 0; return output;
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
  const adjustment = { ...originalPrintAdjustment, rotation, enhance: true };
  return { original, image: await preparePrintImage(original, adjustment, signal), adjustment };
}
