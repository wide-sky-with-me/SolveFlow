import { MAX_BATCH_PRINT_BYTES, PrintImageAdjustmentSchema, type BatchPrintSnapshot, type PrintImageAdjustment } from '@solveflow/contracts/local';
import { recordPrintImages, printImageKey } from '../dom/batch-print-document';
import type { PreparedExportContent } from './prepare-batch-export.web';
import { detectPrintAdjustment, preparePrintImage } from './print-image';

const PROCESSOR = 'export-images-1';
async function fingerprint(source: string, adjustment: PrintImageAdjustment, image: string) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify([PROCESSOR, source, adjustment, image])));
  return Array.from(new Uint8Array(bytes), value => value.toString(16).padStart(2, '0')).join('');
}

// Decision: .agents/notes/implemented/storage/2026-10-21-automatic-export-images.md
/** Local, immutable preparation shared by every copy; never infers or drops question content. */
export async function prepareExportImages(snapshot: BatchPrintSnapshot, content: PreparedExportContent, signal: AbortSignal, progress: (value: string) => void, resetGeometry = false): Promise<PreparedExportContent> {
  signal.throwIfAborted();
  const originals = new Map(snapshot.records.flatMap(record => recordPrintImages(record, 'history').map(source => [printImageKey(record.session.id, source.id), source.image] as const)));
  for (const source of content.sources ?? []) originals.set(source.key, source.image);
  const targets = [...new Set(Object.values(content.layouts).flatMap(layout => layout.assets.map(asset => asset.key)))];
  const images = { ...content.images }, adjustments = { ...content.adjustments }, processedImages = { ...content.processedImages };
  const detections = new Map<string, PrintImageAdjustment>();
  const rendered = new Map<string, Map<string, string>>();
  for (const [index, key] of targets.entries()) {
    signal.throwIfAborted(); const source = originals.get(key); if (!source) continue;
    const existing = adjustments[key];
    if (existing?.enhance === false && !resetGeometry) continue;
    progress(`自动处理图片 ${index + 1} / ${targets.length}`);
    let adjustment = existing;
    if (!existing || resetGeometry && !existing.perspective) {
      adjustment = detections.get(source) ?? await detectPrintAdjustment(source, signal);
      detections.set(source, adjustment);
    }
    adjustment = PrintImageAdjustmentSchema.parse(adjustment);
    signal.throwIfAborted(); const stamp = await fingerprint(source, adjustment, images[key] ?? ''); signal.throwIfAborted();
    if (processedImages[key] === stamp && images[key]) continue;
    const parameters = JSON.stringify(adjustment);
    let image = rendered.get(source)?.get(parameters);
    if (!image) {
      image = await preparePrintImage(source, adjustment, signal); signal.throwIfAborted();
      let versions = rendered.get(source); if (!versions) { versions = new Map(); rendered.set(source, versions); }
      versions.set(parameters, image);
    }
    const processed = await fingerprint(source, adjustment, image); signal.throwIfAborted();
    images[key] = image; adjustments[key] = adjustment; processedImages[key] = processed;
    if (Object.values(images).reduce((sum, value) => sum + value.length, 0) > MAX_BATCH_PRINT_BYTES) throw new Error('导出图片超过128MiB，请拆分批次。');
  }
  signal.throwIfAborted(); return { ...content, images, adjustments, processedImages };
}
