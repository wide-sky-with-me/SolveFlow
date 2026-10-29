// Decision: .agents/notes/implemented/storage/2026-10-25-direct-pdf-resource-reuse.md
import type { jsPDF } from 'jspdf';
import { ExportTaskFailure } from '@solveflow/client/local';
import { boundedPdfResource } from './download-batch-pdfs.web';

export const DIRECT_WIDTH = 760;
export const DIRECT_HEIGHT = Math.round(DIRECT_WIDTH * 297 / 210);
export const DIRECT_MARGIN = 40;
export const DIRECT_BOTTOM = DIRECT_HEIGHT - 60;
export const DIRECT_LINE = 24;
const FONT = 'Arial,"Microsoft YaHei","Noto Sans CJK SC",sans-serif';
const TEXT_CACHE_BYTES = 2 * 1024 * 1024;
const IMAGE_CACHE_BYTES = 32 * 1024 * 1024;
const GLYPH_CACHE_BYTES = 8 * 1024 * 1024;
interface Asset { data: Uint8Array<ArrayBuffer>; format: 'JPEG' | 'PNG'; alias: string; width: number; height: number }

/** Standard PDF fonts are safe here only for printable ASCII; all other glyphs stay browser-rendered. */
export function directNativeText(text: string) { return /^[\x20-\x7e]*$/.test(text); }

class AssetCache {
  private values = new Map<string, Asset>(); private bytes = 0;
  constructor(private readonly limit: number) {}
  get(key: string) { const value = this.values.get(key); if (value) { this.values.delete(key); this.values.set(key, value); } return value; }
  set(key: string, value: Asset) {
    if (value.data.byteLength > this.limit) return;
    while (this.bytes + value.data.byteLength > this.limit || this.values.size >= 2048) {
      const first = this.values.entries().next().value; if (!first) break;
      this.values.delete(first[0]); this.bytes -= first[1].data.byteLength;
    }
    this.values.set(key, value); this.bytes += value.data.byteLength;
  }
  clear() { this.values.clear(); this.bytes = 0; }
}

async function loadImage(uri: string, signal: AbortSignal): Promise<HTMLImageElement> {
  signal.throwIfAborted();
  if (!/^data:image\/(jpeg|png|webp);base64,/i.test(uri)) throw new ExportTaskFailure('快速导出只支持本地题图。');
  const image = new Image(); const release = () => { image.onload = null; image.onerror = null; image.src = ''; };
  return boundedPdfResource(new Promise<HTMLImageElement>((resolve, reject) => {
    image.onload = () => { image.onload = null; image.onerror = null; if (!image.naturalWidth || !image.naturalHeight) { release(); reject(new ExportTaskFailure('题图无法读取。')); } else resolve(image); };
    image.onerror = () => { release(); reject(new ExportTaskFailure('题图无法读取。')); }; image.src = uri;
  }), signal, release);
}

async function encode(canvas: HTMLCanvasElement, type: 'image/jpeg' | 'image/png', signal: AbortSignal, deadline?: number) {
  const blob = await boundedPdfResource(new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value?.type === type && value.size ? resolve(value) : reject(new ExportTaskFailure('快速导出图像编码失败。')), type, .94)), signal, () => undefined, deadline);
  signal.throwIfAborted(); return new Uint8Array(await boundedPdfResource(blob.arrayBuffer(), signal, () => undefined, deadline));
}

/** Job-local encoded assets and line layouts are bounded; decoded source pixels never remain cached. */
export function directPdfResources(metrics: jsPDF, wrap: (text: string, measure: (text: string) => number, width: number) => string[]) {
  const canvas = document.createElement('canvas'); const context = canvas.getContext('2d');
  if (!context) throw new ExportTaskFailure('无法创建快速导出画布。');
  const images = new AssetCache(IMAGE_CACHE_BYTES), glyphs = new AssetCache(GLYPH_CACHE_BYTES);
  const sizes = new Map<string, { width: number; height: number }>();
  const lines = new Map<string, { lines: string[]; bytes: number }>(); let lineBytes = 0; let sequence = 0;
  const measure = (text: string, heading = false, native = directNativeText(text)) => {
    const size = heading ? 21 : 17;
    if (native) { metrics.setFont('helvetica', heading ? 'bold' : 'normal'); metrics.setFontSize(size); return metrics.getTextWidth(text); }
    context.font = `${heading ? 'bold 21' : '17'}px ${FONT}`; return context.measureText(text).width;
  };
  return {
    measure,
    lines(text: string, heading: boolean, width: number) {
      const key = `${heading ? 'h' : 'p'}:${width}:${text}`; const cached = lines.get(key);
      if (cached) { lines.delete(key); lines.set(key, cached); return cached.lines; }
      const native = directNativeText(text); const result = wrap(text, value => measure(value, heading, native), width);
      const bytes = 2 * (key.length + result.reduce((sum, line) => sum + line.length, 0));
      if (bytes <= TEXT_CACHE_BYTES) {
        while (lineBytes + bytes > TEXT_CACHE_BYTES || lines.size >= 2048) { const first = lines.entries().next().value; if (!first) break; lines.delete(first[0]); lineBytes -= first[1].bytes; }
        lines.set(key, { lines: result, bytes }); lineBytes += bytes;
      }
      return result;
    },
    async image(uri: string, signal: AbortSignal, deadline?: number): Promise<Asset> {
      const cached = images.get(uri); if (cached) return cached;
      const image = await loadImage(uri, signal);
      try {
        signal.throwIfAborted();
        const scale = Math.min((DIRECT_WIDTH - 2 * DIRECT_MARGIN) / image.naturalWidth, (DIRECT_BOTTOM - DIRECT_MARGIN - DIRECT_LINE) / image.naturalHeight, 1);
        const width = image.naturalWidth * scale, height = image.naturalHeight * scale; sizes.set(uri, { width, height });
        let data: Uint8Array<ArrayBuffer>;
        if (uri.startsWith('data:image/jpeg;base64,') && image.naturalWidth <= Math.ceil(width * 2) && image.naturalHeight <= Math.ceil(height * 2)) {
          data = Uint8Array.from(atob(uri.slice(uri.indexOf(',') + 1)), character => character.charCodeAt(0));
        } else {
          canvas.width = Math.min(image.naturalWidth, Math.ceil(width * 2)); canvas.height = Math.min(image.naturalHeight, Math.ceil(height * 2));
          context.fillStyle = '#fff'; context.fillRect(0, 0, canvas.width, canvas.height); context.drawImage(image, 0, 0, canvas.width, canvas.height);
          data = await encode(canvas, 'image/jpeg', signal, deadline);
        }
        signal.throwIfAborted(); const asset: Asset = { data, format: 'JPEG', alias: `source-${++sequence}`, width, height }; images.set(uri, asset); return asset;
      } finally { image.src = ''; canvas.width = 0; canvas.height = 0; }
    },
    async size(uri: string, signal: AbortSignal) { const cached = sizes.get(uri); if (cached) return cached; const asset = await this.image(uri, signal); return { width: asset.width, height: asset.height }; },
    async text(text: string, heading: boolean, incorrect: boolean, signal: AbortSignal, deadline: number): Promise<Asset> {
      const key = `${heading ? 'h' : 'p'}:${incorrect ? 'r' : 'b'}:${text}`; const cached = glyphs.get(key); if (cached) return cached;
      const width = Math.ceil(measure(text, heading, false)) + 6; const height = DIRECT_LINE + 8;
      canvas.width = Math.max(1, width * 2); canvas.height = height * 2;
      try {
        context.setTransform(2, 0, 0, 2, 0, 0); context.font = `${heading ? 'bold 21' : '17'}px ${FONT}`; context.textBaseline = 'top';
        context.fillStyle = incorrect ? '#ba2337' : '#17202b'; context.fillText(text, 3, 2);
        const data = await encode(canvas, 'image/png', signal, deadline); signal.throwIfAborted();
        const asset: Asset = { data, format: 'PNG', alias: `glyph-${++sequence}`, width, height }; glyphs.set(key, asset); return asset;
      } finally { canvas.width = 0; canvas.height = 0; }
    },
    dispose() { images.clear(); glyphs.clear(); sizes.clear(); lines.clear(); canvas.width = 0; canvas.height = 0; },
  };
}
