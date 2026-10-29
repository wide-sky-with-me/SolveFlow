import type { SolverInput } from '@solveflow/contracts/agent';
import { detectPrintAdjustment, preparePrintImage } from './print-image';

/** Derived views aid small text; the original remains the first, authoritative image. */
export async function prepareActTranscriptionViews(input: SolverInput, signal: AbortSignal): Promise<SolverInput['image'][]> {
  signal.throwIfAborted();
  if (input.image.mimeType !== 'image/jpeg' || input.image.bytes.length > 4 * 1024 * 1024) return [];
  let encoded = '';
  for (let offset = 0; offset < input.image.bytes.length; offset += 8192) encoded += String.fromCharCode(...input.image.bytes.subarray(offset, offset + 8192));
  const adjustment = await detectPrintAdjustment('data:image/jpeg;base64,' + btoa(encoded), signal);
  const upright = await preparePrintImage('data:image/jpeg;base64,' + btoa(encoded), { ...adjustment, enhance: false }, signal);
  const image = new Image(); const canvas = document.createElement('canvas');
  try {
    await new Promise<void>((resolve, reject) => {
      const finish = (error?: Error) => { clearTimeout(timer); signal.removeEventListener('abort', abort); image.onload = image.onerror = null; error ? reject(error) : resolve(); };
      const abort = () => { image.src = ''; finish(new Error('CANCELLED')); };
      const timer = setTimeout(() => finish(new Error('ACT辅助题图加载超时。')), 10000);
      image.onload = () => finish(); image.onerror = () => finish(new Error('ACT辅助题图读取失败。'));
      signal.addEventListener('abort', abort, { once: true }); image.src = upright; if (signal.aborted) abort();
    });
    const views: SolverInput['image'][] = [];
    for (const left of [0, .35]) {
      signal.throwIfAborted();
      const width = Math.max(1, Math.ceil(image.naturalWidth * .65)); const scale = Math.min(2, 2048 / Math.max(width, image.naturalHeight));
      canvas.width = Math.max(1, Math.round(width * scale)); canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
      const context = canvas.getContext('2d'); if (!context) throw new Error('ACT辅助题图画布不可用。');
      context.drawImage(image, image.naturalWidth * left, 0, width, image.naturalHeight, 0, 0, canvas.width, canvas.height);
      const data = canvas.toDataURL('image/jpeg', .96); const binary = atob(data.slice(data.indexOf(',') + 1));
      views.push({ mimeType: 'image/jpeg', bytes: Uint8Array.from(binary, value => value.charCodeAt(0)) });
      await new Promise<void>(resolve => setTimeout(resolve, 0));
    }
    signal.throwIfAborted(); return views;
  } finally { image.onload = image.onerror = null; image.src = ''; canvas.width = 0; canvas.height = 0; }
}
