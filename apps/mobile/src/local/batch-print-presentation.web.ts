// Decision: .agents/notes/implemented/storage/2026-10-15-printable-variant-boundary.md
import type { BatchPrintProblem, BatchPrintQuestion, BatchPrintCopy, LocalRecord, PrintLayoutQuestion, PreparedPrintLayout } from '@solveflow/contracts/local';
import { printImageKey, recordPrintImages, type PrintImages } from '../dom/batch-print-document';
import { prepareOriginalPrintRegion, preparePrintImage, detectPrintAdjustment, originalPrintAdjustment } from './print-image';

export type PrintAsset = PreparedPrintLayout['assets'][number];
export type { PreparedPrintLayout } from '@solveflow/contracts/local';
export type PrintLayouts = Record<string, PreparedPrintLayout>;
export type BatchPdfContent = 'answers' | 'questions' | 'reading';
export type ReviewPrintSource = { key: string; image: string; label: string; region?: boolean };
const unextractedProblemText = '题目尚待提取';
export function fallbackPrintLayout(question: BatchPrintProblem, record: LocalRecord): PreparedPrintLayout {
  return { problem: question.problem ?? { text: unextractedProblemText, subject: record.session.subject, uncertainties: ['请从原图提取完整题目'] }, warnings: [], assets: recordPrintImages(record).map((source, index) => ({ key: printImageKey(record.session.id, source.id), sourceId: source.id, alt: index ? `补图 ${index}` : '原题图', role: 'source' })) };
}
export function requireCleanPrintLayouts(questions: BatchPrintProblem[], layouts: PrintLayouts, images: PrintImages) {
  for (const question of questions) {
    const layout = layouts[question.key];
    if (!layout || layout.assets.some(asset => asset.role === 'source') || layout.warnings.length || layout.problem.uncertainties.length || layout.problem.optionsComplete === false) throw new Error(`第${question.ordinal}题尚待整理，请提取完整文字并裁切必要图示后导出。`);
    if (layout.assets.some(asset => !images[asset.key])) throw new Error(`第${question.ordinal}题缺少必要图示，请重新整理。`);
  }
}
export function requirePaperPrintLayouts(questions: BatchPrintProblem[], layouts: PrintLayouts, images: PrintImages) {
  requireSavedPrintLayouts(questions, layouts, images);
}
export function requireSavedPrintLayouts(questions: BatchPrintProblem[], layouts: PrintLayouts, images: PrintImages) {
  for (const question of questions) {
    const layout = layouts[question.key];
    if (!layout || !layout.problem.text.trim() || layout.assets.some(asset => !images[asset.key])) throw new Error(`第${question.ordinal}题保存的内容或图源不完整，请查看原记录。`);
    // Preparation can extract real text without adding an answer to the saved record.
    if (!question.problem && !layout.assets.length && layout.problem.text.trim() === unextractedProblemText) throw new Error(`第${question.ordinal}题没有可导出的题干或原图。`);
  }
}

export function printableVariantQuestions(questions: BatchPrintQuestion[], layouts: PrintLayouts): BatchPrintQuestion[] {
  return questions.map(question => {
    const layout = layouts[question.key];
    if (!layout || !question.validOptions.length) return question;
    const options = layout.problem.options ?? [];
    const labels = options.map(option => option.label);
    // Print eligibility is transient metadata; the saved candidate remains a valid immutable record.
    const mapped = labels.length > 0 && !question.candidate?.selectedOptions?.some(label => !labels.includes(label));
    const complete = mapped ? layout.problem.optionsComplete ?? question.candidate?.problem.optionsComplete : false;
    return { ...question, printOptions: labels, ...(complete === undefined ? {} : { printOptionsComplete: complete }) };
  });
}
export function requirePrintableCopies(copies: BatchPrintCopy[], layouts: PrintLayouts) {
  for (const copy of copies) for (const answer of copy.answers) {
    if (!answer.changed || !answer.selectedOptions) continue;
    const problem = layouts[answer.key]?.problem;
    if (!problem || problem.optionsComplete === false || answer.selectedOptions.some(label => !problem.options?.some(option => option.label === label))) throw new Error(`第${answer.ordinal}题整理后的选项与作答设置不一致，请核对后重新导出。`);
  }
}

export async function preparePrintLayout(proposal: PrintLayoutQuestion, question: BatchPrintProblem, record: LocalRecord, images: PrintImages, signal: AbortSignal) {
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
    const sourceAdjustment = await detectPrintAdjustment(original, signal);
    const sourceRotation = sourceAdjustment.rotation || source.rotation;
    for (const region of source.regions) {
      const key = `${question.key}/${source.id}/${region.id}`;
      const prepared = await prepareOriginalPrintRegion(original, region, sourceRotation, signal);
      nextImages[key] = prepared.image; adjustments[key] = prepared.adjustment;
      sources.push({ key, image: prepared.original, label: `第 ${question.ordinal} 题 · ${region.optionLabel ? `选项 ${region.optionLabel}` : '题干图'} · ${region.alt}`, region: true });
      assets.push({ key, sourceId: source.id, alt: region.alt, role: region.role, ...(region.optionLabel ? { optionLabel: region.optionLabel } : {}) });
    }
  }
  return { layout: { problem: proposal.problem, assets, warnings: proposal.warnings } satisfies PreparedPrintLayout, images: nextImages, sources, adjustments };
}
