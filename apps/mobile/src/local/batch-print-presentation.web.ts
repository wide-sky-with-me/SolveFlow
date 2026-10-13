import type { BatchPrintQuestion, LocalRecord, PrintLayoutQuestion } from '@solveflow/contracts/local';
import type { ProblemStatement } from '@solveflow/contracts/agent';
import { printImageKey, recordPrintImages, type PrintImages } from '../dom/batch-print-document';
import { prepareOriginalPrintRegion, preparePrintImage, originalPrintAdjustment } from './print-image';

export type PrintAsset = { key: string; sourceId: string; alt: string; role: 'question' | 'option' | 'source'; optionLabel?: string };
export type PreparedPrintLayout = { problem: ProblemStatement; assets: PrintAsset[]; warnings: string[] };
export type PrintLayouts = Record<string, PreparedPrintLayout>;
export type BatchPdfContent = 'answers' | 'questions' | 'reading';
export type ReviewPrintSource = { key: string; image: string; label: string; region?: boolean };
export function fallbackPrintLayout(question: BatchPrintQuestion, record: LocalRecord): PreparedPrintLayout {
  return { problem: question.candidate.problem, warnings: [], assets: recordPrintImages(record).map((source, index) => ({ key: printImageKey(record.session.id, source.id), sourceId: source.id, alt: index ? `补图 ${index}` : '原题图', role: 'source' })) };
}
export async function preparePrintLayout(proposal: PrintLayoutQuestion, question: BatchPrintQuestion, record: LocalRecord, images: PrintImages, signal: AbortSignal) {
  const originals = new Map(recordPrintImages(record).map(source => [source.id, source.image]));
  const nextImages: PrintImages = { ...images }; const assets: PrintAsset[] = []; const sources: ReviewPrintSource[] = [];
  const adjustments: Record<string, import('@solveflow/contracts/local').PrintImageAdjustment> = {};
  for (const source of proposal.sources) {
    if (signal.aborted) throw new Error('导出识别已取消。');
    const original = originals.get(source.id); if (!original) throw new Error('导出图示引用了未知图片。');
    if (source.kind === 'text-only') continue;
    if (source.kind === 'retain-source') {
      const key = printImageKey(record.session.id, source.id); const adjustment = { ...originalPrintAdjustment, rotation: source.rotation, enhance: true };
      nextImages[key] = await preparePrintImage(original, adjustment, signal); adjustments[key] = adjustment;
      assets.push({ key, sourceId: source.id, alt: '原题图 · 待核对', role: 'source' }); continue;
    }
    for (const region of source.regions) {
      const key = `${question.key}/${source.id}/${region.id}`;
      const prepared = await prepareOriginalPrintRegion(original, region, source.rotation, signal);
      nextImages[key] = prepared.image; adjustments[key] = prepared.adjustment;
      sources.push({ key, image: prepared.original, label: `第 ${question.ordinal} 题 · ${region.optionLabel ? `选项 ${region.optionLabel}` : '题干图'} · ${region.alt}`, region: true });
      assets.push({ key, sourceId: source.id, alt: region.alt, role: region.role, ...(region.optionLabel ? { optionLabel: region.optionLabel } : {}) });
    }
  }
  return { layout: { problem: proposal.problem, assets, warnings: proposal.warnings } satisfies PreparedPrintLayout, images: nextImages, sources, adjustments };
}
