// Decision: .agents/notes/implemented/storage/2026-10-14-persistent-paper-preparation.md
import { MAX_BATCH_PRINT_BYTES, MAX_BATCH_PRINT_LAYOUT_SOURCES, parsePreparedPrintRecord, parseBatchPrintLayout, type PreparedPrintRecord, type BatchPrintSnapshot, type BatchPrintProblem, type BatchPrintLayoutInput, type PrintImageAdjustment } from '@solveflow/contracts/local';
import { printImageKey, recordPrintImages, type PrintImages } from '../dom/batch-print-document';
import { preparePrintLayout, type PrintLayouts, type ReviewPrintSource } from './batch-print-presentation.web';
import { preparedPrintCacheKey, readPreparedPrintCache, writePreparedPrintCache, printLayoutCacheKey, readPrintLayoutCache } from './batch-print-cache.web';
import type { Runtime } from '../runtime';
import { detectPrintAdjustment, preparePrintImage } from './print-image';

export interface PaperPreparationState { layouts: PrintLayouts; images: PrintImages; sources: ReviewPrintSource[]; adjustments: Record<string, PrintImageAdjustment>; preparedKeys?: Set<string> }
export function paperRecordInput(record: BatchPrintSnapshot['records'][number], questions: BatchPrintProblem[]): BatchPrintLayoutInput {
  return { purpose: 'reference', questions: questions.filter(question => question.recordId === record.session.id).map(question => ({ key: question.key, problem: question.problem })), sources: recordPrintImages(record) };
}
export function withinPaperBudget(state: PaperPreparationState) {
  const images = new Set([...Object.values(state.images), ...state.sources.filter(source => source.region).map(source => source.image)]);
  if (Array.from(images).reduce((bytes, image) => bytes + image.length, 0) > MAX_BATCH_PRINT_BYTES) throw new Error('整理图片超过128MiB，请拆分批次。');
}
export function packedPaperRecord(input: BatchPrintLayoutInput, state: PaperPreparationState): PreparedPrintRecord {
  const layouts: PrintLayouts = {};
  for (const question of input.questions) { const layout = state.layouts[question.key]; if (!layout) throw new Error('整理记录缺少题目。'); layouts[question.key] = layout; }
  const keys = new Set(Object.values(layouts).flatMap(layout => layout.assets.map(asset => asset.key)));
  return parsePreparedPrintRecord({ schemaVersion: 1, layouts, images: Object.fromEntries(Object.entries(state.images).filter(([key]) => keys.has(key))), sources: state.sources.filter(source => source.region && keys.has(source.key)).map(source => ({ key: source.key, image: source.image, label: source.label, region: true })), adjustments: Object.fromEntries(Object.entries(state.adjustments).filter(([key]) => keys.has(key))) }, input);
}
// Decision: .agents/notes/implemented/agent/2026-10-15-print-source-binding.md
function pruneRetiredRegions(state: PaperPreparationState) {
  const active = new Set(Object.values(state.layouts).flatMap(layout => layout.assets.map(asset => asset.key)));
  state.sources = state.sources.filter(source => {
    if (!source.region || active.has(source.key)) return true;
    delete state.images[source.key]; delete state.adjustments[source.key]; return false;
  });
}
function mergeRecord(state: PaperPreparationState, cached: PreparedPrintRecord) {
  Object.assign(state.layouts, cached.layouts); Object.assign(state.images, cached.images); Object.assign(state.adjustments, cached.adjustments);
  const sources = new Map(state.sources.map(source => [source.key, source])); for (const source of cached.sources) sources.set(source.key, source); state.sources = [...sources.values()]; pruneRetiredRegions(state); withinPaperBudget(state);
}
export async function restorePaperBatch(snapshot: BatchPrintSnapshot, questions: BatchPrintProblem[], signal: AbortSignal, seed: PaperPreparationState): Promise<PaperPreparationState> {
  const state = { layouts: { ...seed.layouts }, images: { ...seed.images }, sources: [...seed.sources], adjustments: { ...seed.adjustments }, preparedKeys: new Set(seed.preparedKeys) };
  for (const record of snapshot.records) {
    signal.throwIfAborted(); const input = paperRecordInput(record, questions);
    if (!input.questions.length || input.sources.length > MAX_BATCH_PRINT_LAYOUT_SOURCES || input.questions.every(question => state.layouts[question.key] && !state.layouts[question.key]?.assets.some(asset => asset.role === 'source'))) continue;
    const cached = await readPreparedPrintCache(await preparedPrintCacheKey(input), signal);
    if (cached) { mergeRecord(state, parsePreparedPrintRecord(cached, input)); for (const question of input.questions) state.preparedKeys.add(question.key); }
  }
  signal.throwIfAborted(); withinPaperBudget(state); return state;
}
export async function savePaperRecord(record: BatchPrintSnapshot['records'][number], questions: BatchPrintProblem[], state: PaperPreparationState, signal: AbortSignal) {
  signal.throwIfAborted(); const input = paperRecordInput(record, questions); const value = packedPaperRecord(input, state);
  await writePreparedPrintCache(await preparedPrintCacheKey(input), value, signal);
}
/** Only this explicitly requested operation may dispatch new extraction requests. Export/reload only read. */
export async function preparePaperBatch(runtime: Runtime, snapshot: BatchPrintSnapshot, questions: BatchPrintProblem[], seed: PaperPreparationState, force: boolean, signal: AbortSignal, progress: (value: string) => void, commit: (state: PaperPreparationState, recordId: string) => void, settled: (recordId: string, saved: boolean) => void, refinement?: import('@solveflow/contracts/local').PrintLayoutRefinement): Promise<void> {
  if (refinement && (!force || snapshot.records.length !== 1)) throw new Error('精修只处理明确选中的当前题组。');
  const state = force ? { layouts: { ...seed.layouts }, images: { ...seed.images }, sources: [...seed.sources], adjustments: { ...seed.adjustments }, preparedKeys: new Set(seed.preparedKeys) } : await restorePaperBatch(snapshot, questions, signal, seed);
  for (const [index, record] of snapshot.records.entries()) {
    signal.throwIfAborted(); const input = paperRecordInput(record, questions);
    if (!input.questions.length) continue;
    const pending = force ? input.questions : input.questions.filter(question => !state.layouts[question.key] || state.layouts[question.key]?.assets.some(asset => asset.role === 'source'));
    if (!pending.length) { commit(state, record.session.id); continue; }
    if (input.sources.length > MAX_BATCH_PRINT_LAYOUT_SOURCES) throw new Error('题图来源过多，请手动整理图示。');
    progress(`整理题目与图示 ${index + 1} / ${snapshot.records.length}`);
    const legacyInput = { questions: input.questions, sources: input.sources };
    const legacy = force ? null : await readPrintLayoutCache(await printLayoutCacheKey(legacyInput), signal);
    const request = { ...input, questions: pending };
    const proposal = legacy ? parseBatchPrintLayout(legacy.proposal, legacyInput) : parseBatchPrintLayout(await runtime.analyzePrintLayout(request, signal, detail => progress(`整理题目与图示 ${index + 1} / ${snapshot.records.length} · ${detail}`), refinement), request);
    for (const proposed of proposal.questions) {
      if (!pending.some(question => question.key === proposed.key)) continue;
      const question = questions.find(question => question.key === proposed.key); if (!question) throw new Error('整理结果不属于本批题目。');
      const prepared = await preparePrintLayout(proposed, question, record, state.images, signal);
      state.images = prepared.images; state.layouts[question.key] = prepared.layout; Object.assign(state.adjustments, prepared.adjustments); (state.preparedKeys ??= new Set()).add(question.key);
      const sources = new Map(state.sources.map(source => [source.key, source])); for (const source of prepared.sources) sources.set(source.key, source); state.sources = [...sources.values()]; pruneRetiredRegions(state);
    }
    withinPaperBudget(state); signal.throwIfAborted(); commit(state, record.session.id); settled(record.session.id, false);
    try { await savePaperRecord(record, questions, state, signal); settled(record.session.id, true); }
    catch { signal.throwIfAborted(); throw new Error('整理结果尚未保存，请重试保存；已有结果无需重新识别。'); }
  }
}

// Decision: .agents/notes/implemented/storage/2026-10-15-explicit-print-deskew.md
export function straightenablePaperSources(state: PaperPreparationState): ReviewPrintSource[] {
  const active = new Set(Object.values(state.layouts).flatMap(layout => layout.assets.map(asset => asset.key)));
  return state.sources.filter(source => {
    const adjustment = state.adjustments[source.key]; const crop = adjustment?.crop;
    return source.region && active.has(source.key) && adjustment?.enhance && !adjustment.perspective && adjustment.rotation === 0 && crop?.left === 0 && crop.top === 0 && crop.right === 1 && crop.bottom === 1;
  });
}
/** Explicit local-only upgrade of existing crops; opening/exporting still only reads saved pixels. */
export async function straightenPaperBatch(snapshot: BatchPrintSnapshot, questions: BatchPrintProblem[], seed: PaperPreparationState, signal: AbortSignal, progress: (value: string) => void, commit: (state: PaperPreparationState, recordId: string) => void, settled: (recordId: string, saved: boolean) => void): Promise<number> {
  const state = { ...seed, images: { ...seed.images }, adjustments: { ...seed.adjustments } };
  const targets = straightenablePaperSources(state); const sourceAngles = new Map<string, number>(); let inspected = 0; let rotated = 0;
  for (const record of snapshot.records) {
    signal.throwIfAborted(); let changed = false;
    const assets = new Map(questions.filter(question => question.recordId === record.session.id).flatMap(question => state.layouts[question.key]?.assets ?? []).map(asset => [asset.key, asset]));
    for (const source of targets.filter(source => assets.has(source.key))) {
      progress(`摆正图示 ${++inspected} / ${targets.length}`);
      let adjustment = await detectPrintAdjustment(source.image, signal); signal.throwIfAborted();
      if (adjustment.rotation === 0) {
        const asset = assets.get(source.key); const original = asset ? state.sources.find(item => !item.region && item.key === printImageKey(record.session.id, asset.sourceId)) : undefined;
        if (original) {
          let rotation = sourceAngles.get(original.key);
          if (rotation === undefined) { rotation = (await detectPrintAdjustment(original.image, signal)).rotation; signal.throwIfAborted(); sourceAngles.set(original.key, rotation); }
          adjustment = { ...adjustment, rotation };
        }
      }
      if (adjustment.rotation === 0) continue;
      const image = await preparePrintImage(source.image, adjustment, signal); signal.throwIfAborted();
      state.images[source.key] = image; state.adjustments[source.key] = adjustment; withinPaperBudget(state); changed = true; rotated++;
    }
    if (!changed) continue;
    signal.throwIfAborted(); commit(state, record.session.id); settled(record.session.id, false);
    try { await savePaperRecord(record, questions, state, signal); settled(record.session.id, true); }
    catch { signal.throwIfAborted(); throw new Error('摆正结果尚未保存，请重试保存；已有结果无需重新加工。'); }
  }
  signal.throwIfAborted(); return rotated;
}

// Decision: .agents/notes/implemented/storage/2026-10-15-explicit-print-enhancement.md
export function enhanceablePaperSources(state: PaperPreparationState): ReviewPrintSource[] {
  const active = new Set(Object.values(state.layouts).flatMap(layout => layout.assets.map(asset => asset.key)));
  return state.sources.filter(source => source.region && active.has(source.key) && state.adjustments[source.key]?.enhance && !!state.images[source.key]);
}
/** Explicitly refresh saved enhancement from raw crops, retaining every manual geometry decision. */
export async function enhancePaperBatch(snapshot: BatchPrintSnapshot, questions: BatchPrintProblem[], seed: PaperPreparationState, signal: AbortSignal, progress: (value: string) => void, commit: (state: PaperPreparationState, recordId: string) => void, settled: (recordId: string, saved: boolean) => void): Promise<number> {
  const state = { ...seed, images: { ...seed.images } }; const targets = enhanceablePaperSources(state); let inspected = 0; let changedCount = 0;
  for (const record of snapshot.records) {
    signal.throwIfAborted(); let changed = false;
    const active = new Set(questions.filter(question => question.recordId === record.session.id).flatMap(question => state.layouts[question.key]?.assets.map(asset => asset.key) ?? []));
    for (const source of targets.filter(source => active.has(source.key))) {
      const adjustment = state.adjustments[source.key]; if (!adjustment) continue;
      progress(`清晰化图示 ${++inspected} / ${targets.length}`);
      const image = await preparePrintImage(source.image, adjustment, signal); signal.throwIfAborted();
      if (image === state.images[source.key]) continue;
      state.images[source.key] = image; withinPaperBudget(state); changed = true; changedCount++;
    }
    if (!changed) continue;
    signal.throwIfAborted(); commit(state, record.session.id); settled(record.session.id, false);
    try { await savePaperRecord(record, questions, state, signal); settled(record.session.id, true); }
    catch { signal.throwIfAborted(); throw new Error('清晰化结果尚未保存，请重试保存；已有结果无需重新加工。'); }
  }
  signal.throwIfAborted(); return changedCount;
}
