// Decision: .agents/notes/implemented/storage/2026-10-14-background-pdf-exports.md
import { MAX_BATCH_PRINT_LAYOUT_SOURCES, MAX_BATCH_PRINT_BYTES, parseBatchPrintLayout, type BatchPrintSnapshot, type BatchPrintProblem, type BatchPrintLayoutInput, type PrintLayoutQuestion, type PrintImageAdjustmentSchema } from '@solveflow/contracts/local';
import { isAuxiliaryContext } from '@solveflow/contracts/http';
import { questionConversations } from '@solveflow/client/learning';
import type { z } from 'zod';
import { recordPrintImages, printImageKey, type PrintImages } from '../dom/batch-print-document';
import { fallbackPrintLayout, preparePrintLayout, type PrintAsset, type PrintLayouts, type ReviewPrintSource } from './batch-print-presentation.web';
import { printLayoutCacheKey, readPrintLayoutCache, cachePrintLayout, writePrintLayoutCache, type CachedPrintLayout } from './batch-print-cache.web';
import { prepareOriginalPrintRegion } from './print-image';
import type { Runtime } from '../runtime';
import { restorePaperBatch } from './prepare-paper-batch.web';
import { requirePaperPrintLayouts } from './batch-print-presentation.web';

export type ExportLayout = 'saved' | 'clean' | 'paper';
export interface PreparedExportContent { layouts: PrintLayouts; images: PrintImages }
function withinImageBudget(images: PrintImages) {
  if (Object.values(images).reduce((bytes, image) => bytes + image.length, 0) > MAX_BATCH_PRINT_BYTES) throw new Error('导出图片超过128MiB，请拆分批次。');
}
function restoredLayout(proposed: PrintLayoutQuestion, question: BatchPrintProblem, record: BatchPrintSnapshot['records'][number], images: PrintImages) {
  const layout = fallbackPrintLayout(question, record);
  layout.problem = proposed.problem; layout.warnings = proposed.warnings;
  layout.assets = proposed.sources.flatMap<PrintAsset>(source => source.kind === 'text-only' ? [] : source.kind === 'retain-source' ? [{ key: printImageKey(record.session.id, source.id), sourceId: source.id, role: 'source', alt: '保存的原题图' }] : source.regions.map(region => ({ key: `${question.key}/${source.id}/${region.id}`, sourceId: source.id, role: region.role, ...(region.optionLabel ? { optionLabel: region.optionLabel } : {}), alt: region.alt })));
  if (layout.assets.some(asset => !images[asset.key])) throw new Error('缓存图示不完整。');
  return layout;
}

/** A cache miss is not permission to call a model. Whole sources remain explicit in saved mode. */
export async function prepareBatchExport(runtime: Runtime, snapshot: BatchPrintSnapshot, questions: BatchPrintProblem[], policy: ExportLayout, signal: AbortSignal, progress: (value: string) => void, seed?: PreparedExportContent): Promise<PreparedExportContent> {
  signal.throwIfAborted();
  const images: PrintImages = { ...seed?.images }; const layouts: PrintLayouts = {};
  let cacheAvailable = true;
  for (const record of snapshot.records) for (const source of recordPrintImages(record, 'history')) images[printImageKey(record.session.id, source.id)] ??= source.image;
  withinImageBudget(images);
  if (policy === 'paper') {
    for (const record of snapshot.records) for (const question of questions.filter(question => question.recordId === record.session.id)) layouts[question.key] = seed?.layouts[question.key] ?? fallbackPrintLayout(question, record);
    const restored = await restorePaperBatch(snapshot, questions, signal, { layouts, images, sources: [], adjustments: {} });
    requirePaperPrintLayouts(questions, restored.layouts, restored.images);
    return { layouts: restored.layouts, images: restored.images };
  }
  for (const [index, record] of snapshot.records.entries()) {
    signal.throwIfAborted(); progress(`整理题目 ${index + 1} / ${snapshot.records.length}`);
    const own = questions.filter(question => question.recordId === record.session.id);
    if (!own.length) continue;
    const input: BatchPrintLayoutInput = { questions: own.map(question => ({ key: question.key, problem: question.problem })), sources: recordPrintImages(record) };
    for (const question of own) layouts[question.key] = seed?.layouts[question.key] ?? fallbackPrintLayout(question, record);
    if (!own.some(question => layouts[question.key]?.assets.some(asset => asset.role === 'source'))) continue;
    let key: string | null = null; let cached: CachedPrintLayout | null = null;
    if (cacheAvailable && input.sources.length <= MAX_BATCH_PRINT_LAYOUT_SOURCES) {
      try { key = await printLayoutCacheKey(input); cached = await readPrintLayoutCache(key, signal); }
      catch { signal.throwIfAborted(); cacheAvailable = false; }
    }
    if (cached) {
      try {
        const proposal = parseBatchPrintLayout(cached.proposal, input);
        const nextImages = { ...images, ...cached.images }; const nextLayouts: PrintLayouts = {};
        for (const proposed of proposal.questions) {
          const question = own.find(item => item.key === proposed.key); if (!question) throw new Error('整理结果不属于本批题目。');
          nextLayouts[question.key] = restoredLayout(proposed, question, record, nextImages);
        }
        withinImageBudget(nextImages); Object.assign(images, nextImages); Object.assign(layouts, nextLayouts);
        continue;
      } catch { signal.throwIfAborted(); /* An invalid derived cache never invalidates saved records. */ }
    }
    if (policy === 'clean') {
      if (input.sources.length > MAX_BATCH_PRINT_LAYOUT_SOURCES) throw new Error('题图来源过多，请手动整理图示。');
      const proposal = parseBatchPrintLayout(await runtime.analyzePrintLayout(input, signal), input);
      const sources: ReviewPrintSource[] = []; const adjustments: Record<string, z.infer<typeof PrintImageAdjustmentSchema>> = {};
      for (const proposed of proposal.questions) {
        const question = own.find(item => item.key === proposed.key); if (!question) throw new Error('整理结果不属于本批题目。');
        if (seed?.layouts[question.key] && !seed.layouts[question.key]?.assets.some(asset => asset.role === 'source')) continue;
        const prepared = await preparePrintLayout(proposed, question, record, images, signal);
        Object.assign(images, prepared.images); Object.assign(adjustments, prepared.adjustments); sources.push(...prepared.sources); layouts[question.key] = prepared.layout;
      }
      withinImageBudget(images);
      if (key) try { await writePrintLayoutCache(key, cachePrintLayout(proposal, images, sources, adjustments), signal); } catch { signal.throwIfAborted(); }
      continue;
    }
    // Coordinates refer to the selected saved run's primary image, not always the original upload.
    const threads = questionConversations(record.session.runs);
    for (const question of own) {
      if (seed?.layouts[question.key] && !seed.layouts[question.key]?.assets.some(asset => asset.role === 'source')) continue;
      const regions = question.problem?.illustrations; const layout = layouts[question.key];
      if (!regions?.length || !layout) continue;
      const thread = threads.find(item => `${record.session.id}/${item.key}` === question.key);
      const run = thread?.runs.findLast(item => !isAuxiliaryContext(item.context?.kind) && (item.outcome?.status === 'completed' || item.outcome?.status === 'needs_clarification'));
      if (!run) continue;
      const sourceId = run.imageIds?.[0] ?? record.session.upload.id;
      const image = images[printImageKey(record.session.id, sourceId)]; if (!image) continue;
      try {
        const assets = []; const nextImages: PrintImages = {};
        for (const region of regions) {
          const prepared = await prepareOriginalPrintRegion(image, region, 0, signal);
          const key = `${question.key}/saved/${region.id}`; nextImages[key] = prepared.image;
          assets.push({ key, sourceId, role: 'question' as const, alt: region.alt });
        }
        withinImageBudget({ ...images, ...nextImages }); Object.assign(images, nextImages);
        layout.assets = [...assets, ...layout.assets.filter(asset => asset.sourceId !== sourceId)];
      } catch { signal.throwIfAborted(); /* Preserve the selected source when crop decoding fails. */ }
    }
    withinImageBudget(images);
  }
  signal.throwIfAborted(); withinImageBudget(images); return { layouts, images };
}
