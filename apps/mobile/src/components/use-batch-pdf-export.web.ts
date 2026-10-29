import { useEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { collectBatchPrint } from '@solveflow/client/local';
import { clientError, questionsForBatchPrint, questionsForBatchQuestionPrint, orderBatchPrintSnapshot, orderBatchPrintItems } from '@solveflow/client/presentation';
import { MAX_BATCH_PRINT_BYTES, MAX_BATCH_PRINT_LAYOUT_SOURCES, type BatchPrintSnapshot, type BatchPrintQuestion, type BatchPrintProblem, type PrintImageAdjustment } from '@solveflow/contracts/local';
import type { Runtime } from '../runtime';
import { printImageKey, recordPrintImages, type PrintImages } from '../dom/batch-print-document';
import { fallbackPrintLayout, preparePrintLayout, requireCleanPrintLayouts, requireSavedPrintLayouts, requirePaperPrintLayouts, type PrintAsset, type PrintLayouts, type ReviewPrintSource } from '../local/batch-print-presentation.web';
import { prepareBatchExport, type PreparedExportContent, type ExportLayout } from '../local/prepare-batch-export.web';
import { prepareExportImages } from '../local/prepare-export-images.web';
import { detectPrintAdjustment, originalPrintAdjustment, preparePrintImage } from '../local/print-image';
import { parseBatchPrintLayout, type BatchPrintLayoutInput } from '@solveflow/contracts/local';
import { cachePrintLayout, printLayoutCacheKey, readPrintLayoutCache, writePrintLayoutCache, type CachedPrintLayout } from '../local/batch-print-cache.web';
import { restorePaperBatch, preparePaperBatch, savePaperRecord, withinPaperBudget, straightenablePaperSources, straightenPaperBatch, enhanceablePaperSources, enhancePaperBatch, type PaperPreparationState } from '../local/prepare-paper-batch.web';

export function useBatchPdfExport(runtime: Runtime, batchId: string) {
  const [originalSnapshot, setSnapshot] = useState<BatchPrintSnapshot | null>(null); const [sources, setSources] = useState<ReviewPrintSource[]>([]);
  const [originalQuestions, setQuestions] = useState<BatchPrintQuestion[]>([]); const [originalQuestionSources, setQuestionSources] = useState<BatchPrintProblem[]>([]); const [layouts, setLayouts] = useState<PrintLayouts>({});
  const [recordOrder, setRecordOrder] = useState<string[] | null>(null);
  const snapshot = useMemo(() => originalSnapshot && recordOrder ? orderBatchPrintSnapshot(originalSnapshot, recordOrder) : originalSnapshot, [originalSnapshot, recordOrder]);
  const questions = useMemo(() => snapshot && recordOrder ? orderBatchPrintItems(originalQuestions, snapshot) : originalQuestions, [snapshot, recordOrder, originalQuestions]);
  const questionSources = useMemo(() => snapshot && recordOrder ? orderBatchPrintItems(originalQuestionSources, snapshot) : originalQuestionSources, [snapshot, recordOrder, originalQuestionSources]);
  const preparedCurrent = useRef<PreparedExportContent>({ layouts: {}, images: {} });
  const [images, setImages] = useState<PrintImages>({}); const adjustments = useRef<Record<string, PrintImageAdjustment>>({});
  const [selected, setSelected] = useState(0); const [draft, setDraft] = useState<PrintImageAdjustment>(originalPrintAdjustment);
  const [imageResetToken, setImageResetToken] = useState(false);
  const [busy, setBusy] = useState(true); const [progress, setProgress] = useState('正在读取本批题目…'); const [error, setError] = useState(''); const [variantError, setVariantError] = useState(''); const [message, setMessage] = useState('');
  const [loadVersion, setLoadVersion] = useState(0); const [cacheReadFailed, setCacheReadFailed] = useState(false);
  const [ready, setReady] = useState(false); const [readingReady, setReadingReady] = useState(false); const manual = useRef(new Set<string>());
  const preparedPolicy = useRef<ExportLayout | null>(null); const preparedKeys = useRef(new Set<string>());
  const dirtyRecords = useRef(new Set<string>()); const [unsavedCount, setUnsavedCount] = useState(0);
  const completed = useRef(new Map<string, CachedPrintLayout>()); const cacheNotice = useRef(''); const working = useRef(false);
  const paperSources = useRef<ReviewPrintSource[]>([]);
  const controller = useRef<AbortController | null>(null); const alive = useRef(true); const cleanupPrint = useRef<(() => void) | null>(null);
  function checkSize(value: PrintImages) { if (Object.values(value).reduce((sum, image) => sum + image.length, 0) > MAX_BATCH_PRINT_BYTES) throw new Error('整理后的题图超过128MiB，请拆分批次。'); }
  useEffect(() => {
    alive.current = true; working.current = true; const operation = new AbortController(); controller.current = operation;
    const current = () => alive.current && controller.current === operation;
    setBusy(true); setProgress('正在读取本批题目…'); setError(''); setMessage(''); setCacheReadFailed(false);
    void (async () => {
      const value = await collectBatchPrint(runtime.repository, batchId, operation.signal, (done, total) => { if (current() && !operation.signal.aborted) setProgress(`读取题目 ${done} / ${total}`); });
      const original = value.records.flatMap((record, index) => recordPrintImages(record, 'history').map((image, number) => ({ key: printImageKey(record.session.id, image.id), image: image.image, label: `第 ${index + 1} 张${number ? ` · 补图 ${number}` : ''}` })));
      // Opening the dialog reads source bytes without decoding, deskewing or calling a model.
      const processed: PrintImages = Object.fromEntries(original.map(source => [source.key, source.image]));
      const preparedAdjustments: Record<string, PrintImageAdjustment> = {};
      if (!current() || operation.signal.aborted) return;
      let printedQuestions: BatchPrintQuestion[] = [];
      try { printedQuestions = questionsForBatchPrint(value); } catch (cause) { setVariantError(clientError(cause)); }
      const printedSources = questionsForBatchQuestionPrint(value);
      const defaults: PrintLayouts = {};
      for (const question of printedSources) { const record = value.records.find(item => item.session.id === question.recordId); if (record) defaults[question.key] = fallbackPrintLayout(question, record); }
      let restored: PaperPreparationState = { layouts: defaults, images: processed, sources: original, adjustments: preparedAdjustments };
      try { restored = await restorePaperBatch(value, printedSources, operation.signal, restored); }
      catch { operation.signal.throwIfAborted(); if (current()) { setCacheReadFailed(true); setError('已整理内容暂时读取失败，请重试读取；也可按已保存内容导出。'); } }
      if (!current() || operation.signal.aborted) return;
      preparedCurrent.current = { layouts: restored.layouts, images: restored.images }; preparedPolicy.current = 'paper'; paperSources.current = restored.sources; preparedKeys.current = new Set(restored.preparedKeys);
      adjustments.current = restored.adjustments; setRecordOrder(null); setSnapshot(value); setSources(restored.sources); setQuestions(printedQuestions); setQuestionSources(printedSources); setLayouts(restored.layouts); setImages(restored.images); setDraft(original[0] ? restored.adjustments[original[0].key] ?? originalPrintAdjustment : originalPrintAdjustment); setReady(printedSources.every(question => !restored.layouts[question.key]?.assets.some(asset => asset.role === 'source'))); setProgress('');
    })().catch(cause => {
      if (!current()) return;
      if (operation.signal.aborted) setMessage('读取已取消。'); else setError(`读取题目失败：${clientError(cause)}`);
    }).finally(() => { if (current()) { working.current = false; setBusy(false); setProgress(''); } });
    return () => { alive.current = false; operation.abort(); controller.current?.abort(); cleanupPrint.current?.(); };
  }, [runtime, batchId, loadVersion]);
  function retryLoad() {
    if (snapshot || busy || working.current) return;
    working.current = true; setLoadVersion(value => value + 1);
  }
  async function work(action: (signal: AbortSignal) => Promise<void>) {
    if (busy || working.current) return; working.current = true; setBusy(true); setError(''); setMessage(''); const operation = new AbortController(); controller.current = operation;
    try { await action(operation.signal); } catch (cause) { if (alive.current) { if (operation.signal.aborted) setMessage('导出已取消。'); else setError(clientError(cause)); } }
    finally { working.current = false; if (alive.current) { setBusy(false); setProgress(''); } }
  }
  function choose(index: number) { setSelected(index); const source = sources[index]; setDraft(source ? adjustments.current[source.key] ?? originalPrintAdjustment : originalPrintAdjustment); setError(''); }
  async function adjust(automatic = false, original = false, override?: PrintImageAdjustment, resetPerspectiveDraft = false) {
    const source = sources[selected]; if (!source) return;
    await work(async signal => {
      const value = original ? originalPrintAdjustment : automatic ? await detectPrintAdjustment(source.image, signal) : override ?? draft;
      const image = original ? source.image : await preparePrintImage(source.image, value, signal); const next = { ...images, [source.key]: image }; checkSize(next);
      if (alive.current && !signal.aborted) {
        adjustments.current[source.key] = value; preparedCurrent.current.images = next; setDraft(value); setImages(next);
        // Successful reset may keep identical geometry; failed processing must retain pending edits.
        if (automatic || original || resetPerspectiveDraft) setImageResetToken(token => !token);
      }
      const question = questionSources.find(question => preparedCurrent.current.layouts[question.key]?.assets.some(asset => asset.key === source.key));
      if (question) await persistManual(question.recordId, signal);
    });
  }
  async function correctPerspective(perspective: NonNullable<PrintImageAdjustment['perspective']>) {
    await adjust(false, false, { ...draft, rotation: 0, crop: originalPrintAdjustment.crop, perspective }, true);
  }
  async function prepare(signal: AbortSignal, force = false, policy: ExportLayout = force ? 'clean' : 'paper') {
    if (!snapshot || !questionSources.length) return;
    if (policy === 'direct') {
      const prepared = await prepareBatchExport(runtime, snapshot, questionSources, policy, signal, () => {});
      if (alive.current && !signal.aborted) flushSync(() => { preparedCurrent.current = prepared; preparedPolicy.current = policy; setLayouts(prepared.layouts); setImages(prepared.images); setReady(true); });
      return;
    }
    const reuse = ready && preparedPolicy.current === policy;
    if (!force && (policy !== 'clean' || reuse)) {
      if (!preparedCurrent.current.processedImages) setReady(false);
      const progress = (value: string) => { if (alive.current) setProgress(value); };
      let prepared: PreparedExportContent;
      try {
        prepared = reuse
          ? await prepareExportImages(snapshot, getPrepared(), signal, progress)
          : await prepareBatchExport(runtime, snapshot, questionSources, policy, signal, progress, getPrepared());
      } catch (cause) { if (alive.current) setReady(ready); throw cause; }
      if (alive.current && !signal.aborted) flushSync(() => {
        preparedCurrent.current = prepared; preparedPolicy.current = policy;
        const currentSource = sources[selected];
        const currentAdjustment = currentSource ? prepared.adjustments?.[currentSource.key] : undefined;
        if (currentSource && !adjustments.current[currentSource.key] && currentAdjustment) setDraft(currentAdjustment);
        adjustments.current = prepared.adjustments ?? adjustments.current;
        paperSources.current = prepared.sources ?? paperSources.current;
        setLayouts(prepared.layouts); setImages(prepared.images); setReady(true);
      });
      return;
    }
    let nextImages = { ...images }; const nextLayouts = { ...layouts }; const nextSources = sources.filter(source => !source.region); const nextAdjustments = { ...adjustments.current };
    let kept = 0; let cachedCount = 0; let analyzed = 0; let cacheWarning = '';
    for (const [index, record] of snapshot.records.entries()) {
      if (signal.aborted) throw new Error('导出已取消。');
      const ownQuestions = questionSources.filter(question => question.recordId === record.session.id);
      if (!ownQuestions.length || !force && ownQuestions.every(question => manual.current.has(question.key))) continue;
      const originals = recordPrintImages(record);
      if (originals.length > MAX_BATCH_PRINT_LAYOUT_SOURCES) { kept += ownQuestions.length; continue; }
      if (alive.current) setProgress(`整理第 ${index + 1} / ${snapshot.records.length} 张题图`);
      const input: BatchPrintLayoutInput = { questions: ownQuestions.map(question => ({ key: question.key, problem: question.problem })), sources: originals };
      const key = await printLayoutCacheKey(input);
      let cached = force ? null : completed.current.get(key) ?? null;
      if (!force && !cached) { try { cached = await readPrintLayoutCache(key, signal); } catch (cause) { if (signal.aborted) throw cause; cacheWarning = '缓存不可用，本次整理仍可导出。'; } }
      if (!cached && !runtime.settings) { kept += ownQuestions.length; continue; }
      if (alive.current) setProgress(`${cached ? '复用已整理题目' : 'Agent 提取题目与必要图示'} ${index + 1} / ${snapshot.records.length}`);
      const proposal = parseBatchPrintLayout(cached?.proposal ?? await runtime.analyzePrintLayout(input, signal, detail => { if (alive.current) setProgress(`整理第 ${index + 1} / ${snapshot.records.length} 张题图 · ${detail}`); }), input);
      if (cached) { cachedCount += ownQuestions.length; Object.assign(nextImages, cached.images); Object.assign(nextAdjustments, cached.adjustments); nextSources.push(...cached.sources); }
      for (const proposed of proposal.questions) {
        const question = ownQuestions.find(item => item.key === proposed.key); if (!question) throw new Error('识别结果不属于本题。');
        const previous = !force && manual.current.has(question.key) ? nextLayouts[question.key] : undefined;
        if (cached) {
          nextLayouts[question.key] = {
            problem: proposed.problem, warnings: proposed.warnings,
            assets: proposed.sources.flatMap<PrintAsset>(source => source.kind === 'text-only' ? [] : source.kind === 'retain-source' ? [{ key: printImageKey(record.session.id, source.id), sourceId: source.id, alt: '原题图 · 待核对', role: 'source' }] : source.regions.map(region => ({ key: `${question.key}/${source.id}/${region.id}`, sourceId: source.id, alt: region.alt, role: region.role, ...(region.optionLabel ? { optionLabel: region.optionLabel } : {}) }))),
          };
          if (nextLayouts[question.key]?.assets.some(asset => !nextImages[asset.key])) throw new Error('导出整理缓存缺少图示，请重新识别。');
        } else {
          const prepared = await preparePrintLayout(proposed, question, record, nextImages, signal); checkSize(prepared.images);
          nextImages = prepared.images; nextLayouts[question.key] = prepared.layout; Object.assign(nextAdjustments, prepared.adjustments); nextSources.push(...prepared.sources);
        }
        if (previous) nextLayouts[question.key] = previous;
        if (nextLayouts[question.key]?.assets.some(asset => asset.role === 'source')) kept++;
      }
      if (!cached) {
        analyzed += ownQuestions.length;
        try {
          const entry = cachePrintLayout(proposal, nextImages, nextSources.filter(source => source.key.startsWith(`${record.session.id}/`)), nextAdjustments);
          completed.current.set(key, entry); if (completed.current.size > 128) { const oldest = completed.current.keys().next().value; if (oldest) completed.current.delete(oldest); }
          await writePrintLayoutCache(key, entry, signal);
        }
        catch (cause) { if (signal.aborted) throw cause; cacheWarning = '整理结果未能缓存，下次导出需重新整理。'; }
      }

      // Commit completed records: cancellation never discards work or repeats paid calls automatically.
      if (alive.current && !signal.aborted) flushSync(() => { preparedCurrent.current = { layouts: { ...nextLayouts }, images: { ...nextImages } }; adjustments.current = nextAdjustments; paperSources.current = [...nextSources]; setImages({ ...nextImages }); setLayouts({ ...nextLayouts }); setSources([...nextSources]); });
    }
    if (alive.current && !signal.aborted) flushSync(() => {
      preparedCurrent.current = { layouts: nextLayouts, images: nextImages }; preparedPolicy.current = 'clean'; adjustments.current = nextAdjustments; cacheNotice.current = cacheWarning; setImages(nextImages); setLayouts(nextLayouts); setSources(nextSources); setReady(true);
      setMessage(`${analyzed ? `Agent 已整理 ${analyzed} 题。` : cachedCount ? `已复用 ${cachedCount} 题的整理结果。` : ''}${kept ? `${kept} 题保留原图，请核对${runtime.settings ? '识别疑点' : '或配置模型后识别'}。` : '文字题不附原图，有图题仅保留必要图示。'}${cacheWarning}`);
    });
  }
  async function prepareReading(signal: AbortSignal) {
    if (readingReady) return;
    const next = { ...images };
    for (const [index, source] of sources.filter(source => !source.region).entries()) {
      if (alive.current) setProgress(`整理原始阅读记录 ${index + 1}`);
      const value = adjustments.current[source.key] ?? await detectPrintAdjustment(source.image, signal);
      next[source.key] = await preparePrintImage(source.image, value, signal); checkSize(next); adjustments.current[source.key] = value;
    }
    if (alive.current && !signal.aborted) flushSync(() => { setImages(next); setReadingReady(true); });
  }
  function paperState(): PaperPreparationState { return { ...preparedCurrent.current, sources: paperSources.current, adjustments: adjustments.current, preparedKeys: new Set(preparedKeys.current) }; }
  function commitPaper(state: PaperPreparationState) {
    if (!alive.current) return;
    withinPaperBudget(state); preparedKeys.current = new Set(state.preparedKeys);
    const previous = sources[selected]; const retained = state.sources.findIndex(source => source.key === previous?.key);
    const original = previous ? state.sources.findIndex(source => !source.region && source.key.startsWith(`${previous.key.split('/')[0]}/`)) : -1;
    const nextSelected = retained >= 0 ? retained : original >= 0 ? original : 0;
    flushSync(() => { preparedCurrent.current = { layouts: { ...state.layouts }, images: { ...state.images } }; adjustments.current = { ...state.adjustments }; paperSources.current = [...state.sources]; setLayouts({ ...state.layouts }); setImages({ ...state.images }); setSources([...state.sources]); setSelected(nextSelected); setDraft(state.sources[nextSelected] ? state.adjustments[state.sources[nextSelected].key] ?? originalPrintAdjustment : originalPrintAdjustment); preparedPolicy.current = 'paper'; setReady(questionSources.every(question => !state.layouts[question.key]?.assets.some(asset => asset.role === 'source'))); });
    setCacheReadFailed(false);
  }
  function markSaved(recordId: string, saved: boolean) {
    if (saved) dirtyRecords.current.delete(recordId); else dirtyRecords.current.add(recordId);
    if (alive.current) setUnsavedCount(dirtyRecords.current.size);
  }
  async function persistManual(recordId: string, signal: AbortSignal) {
    const record = snapshot?.records.find(record => record.session.id === recordId); if (!record) return;
    for (const question of questionSources.filter(question => question.recordId === recordId)) preparedKeys.current.add(question.key);
    markSaved(recordId, false);
    try { await savePaperRecord(record, questionSources, paperState(), signal); markSaved(recordId, true); if (alive.current) setMessage('整理结果已保存'); }
    catch { signal.throwIfAborted(); throw new Error('整理结果尚未保存，请重试保存；已有结果无需重新识别。'); }
  }
  async function savePending() { await work(async signal => { for (const id of [...dirtyRecords.current]) await persistManual(id, signal); }); }
  async function retryPreparedRead() {
    if (!snapshot || !cacheReadFailed) return;
    await work(async signal => {
      if (dirtyRecords.current.size) throw new Error('请先重试保存整理结果，再重试读取。');
      setProgress('正在读取已保存的整理结果…');
      let restored: PaperPreparationState;
      try { restored = await restorePaperBatch(snapshot, questionSources, signal, paperState()); }
      catch { signal.throwIfAborted(); throw new Error('已整理内容暂时读取失败，请重试读取。'); }
      signal.throwIfAborted();
      if (alive.current) { commitPaper(restored); setReadingReady(false); setMessage('已重新读取整理结果，未调用模型。'); }
    });
  }
  async function enhanceFigures() {
    if (!snapshot) return;
    await work(async signal => {
      if (dirtyRecords.current.size) throw new Error('请先重试保存整理结果，再继续处理。');
      const count = await enhancePaperBatch(snapshot, questionSources, paperState(), signal, value => { if (alive.current) setProgress(value); }, state => commitPaper(state), markSaved);
      if (alive.current) setMessage(count ? `已更新 ${count} 张图示清晰化，旋转和裁切保持不变。` : '图示清晰化已是当前结果，旋转和裁切保持不变。');
    });
  }
  async function automateFigures() {
    if (!snapshot) return;
    await work(async signal => {
      requireSavedChanges();
      const prepared = await prepareExportImages(snapshot, getPrepared(), signal, value => { if (alive.current) setProgress(value); }, true);
      signal.throwIfAborted();
      const state = { ...paperState(), ...prepared, sources: paperSources.current, adjustments: prepared.adjustments ?? adjustments.current };
      commitPaper(state); preparedCurrent.current = prepared;
      for (const record of snapshot.records) if (questionSources.some(question => question.recordId === record.session.id && state.layouts[question.key]?.assets.length)) await persistManual(record.session.id, signal);
      if (alive.current) setMessage('本批图片已自动旋转、清晰化；可靠屏幕边界已裁剪，手动四角校正保留。');
    });
  }
  async function straightenFigures() {
    if (!snapshot) return;
    await work(async signal => {
      if (dirtyRecords.current.size) throw new Error('请先重试保存整理结果，再继续处理。');
      const count = await straightenPaperBatch(snapshot, questionSources, paperState(), signal, value => { if (alive.current) setProgress(value); }, state => commitPaper(state), markSaved);
      if (alive.current) setMessage(count ? `已摆正 ${count} 张图示，已有旋转和裁切保持不变。` : '未检出可靠倾角，已有旋转和裁切保持不变；可按图微调。');
    });
  }
  // Decision: .agents/notes/implemented/agent/2026-10-15-print-source-binding.md
  async function processPaper(force = false, recordId?: string, refinement?: import('@solveflow/contracts/local').PrintLayoutRefinement) {
    if (!snapshot) return;
    const records = recordId ? snapshot.records.filter(record => record.session.id === recordId) : snapshot.records;
    if (!records.length || force && !window.confirm(refinement ? '使用已配置校验模型精修当前题组，会替换图文整理结果并调用模型，原题与作答不变。继续？' : recordId ? '重新整理会替换当前题组的图文结果，并调用模型。继续？' : '重新整理会替换本批已保存的图文整理结果，并重新调用模型。继续？')) return;
    await work(async signal => {
      if (dirtyRecords.current.size) throw new Error('请先重试保存整理结果，再继续处理。');
      await preparePaperBatch(runtime, { ...snapshot, records }, questionSources.filter(question => !recordId || question.recordId === recordId), paperState(), force, signal, value => { if (alive.current) setProgress(value); }, state => commitPaper(state), markSaved, refinement);
      if (alive.current) setMessage('整理结果已保存');
    });
  }
  async function analyze() { await processPaper(true); }
  async function analyzeQuestion(key: string, refinement?: import('@solveflow/contracts/local').PrintLayoutRefinement) { const question = questionSources.find(question => question.key === key); if (question) await processPaper(true, question.recordId, refinement); }
  function confirmClose() { return !dirtyRecords.current.size || window.confirm('整理结果尚未保存。关闭会丢失未保存的调整；仍要关闭？'); }
  async function setQuestionMode(key: string, textOnly: boolean) {
    const question = questionSources.find(item => item.key === key); const record = snapshot?.records.find(item => item.session.id === question?.recordId); if (!question || !record || busy) return;
    const previous = preparedCurrent.current.layouts[key]; const problem = previous?.problem ?? question.problem;
    if (!problem) { setError('请先从原图提取题干。'); return; }
    await work(async signal => {
      manual.current.add(key); const next = { ...preparedCurrent.current.layouts, [key]: textOnly ? { problem, assets: [], warnings: (previous?.warnings ?? []).map(warning => warning.replaceAll('已保留原图', '已确认仅保留文字').replaceAll('已恢复原题文字并保留原图', '已恢复原题文字，并已确认仅保留文字')) } : fallbackPrintLayout(question, record) };
      preparedCurrent.current.layouts = next; setLayouts(next); preparedPolicy.current = null;
      await persistManual(question.recordId, signal);
    });
  }
  function selectedSourceId() {
    const source = sources[selected]; if (!source) return;
    return Object.values(preparedCurrent.current.layouts).flatMap(layout => layout.assets).find(asset => asset.key === source.key)?.sourceId ?? snapshot?.records.flatMap(record => recordPrintImages(record, 'history')).find(image => source.key.endsWith(`/${image.id}`))?.id;
  }
  async function useCurrentIllustration(key: string, optionLabel?: string) {
    const question = questionSources.find(item => item.key === key); const source = sources[selected]; if (!question || !source || busy) return;
    if (!source.key.startsWith(`${question.recordId}/`)) { setError('请先选择本题的原图、补图或提取裁片。'); return; }
    const crop = adjustments.current[source.key]?.crop;
    if (!source.region && (!crop || crop.left === 0 && crop.top === 0 && crop.right === 1 && crop.bottom === 1)) { setError('请先裁切出必要图示，再将其用于题目。'); return; }
    const previous = preparedCurrent.current.layouts[key]; const problem = previous?.problem ?? question.problem; const sourceId = selectedSourceId();
    if (!problem || !sourceId) { setError('请先从原图提取题干并确认图源。'); return; }
    const record = snapshot?.records.find(record => record.session.id === question.recordId);
    if (!record || !recordPrintImages(record).some(image => image.id === sourceId)) { setError('历史版本题图仅用于原始记录，请选择当前题图。'); return; }
    await work(async signal => {
      manual.current.add(key);
      const kept = previous?.assets.filter(asset => asset.key !== source.key && !(asset.role === 'source' && asset.sourceId === sourceId)) ?? [];
      const asset: PrintAsset = { key: source.key, sourceId, alt: optionLabel ? `选项 ${optionLabel} 图` : '题干图', role: optionLabel ? 'option' : 'question', ...(optionLabel ? { optionLabel } : {}) };
      const next = { ...preparedCurrent.current.layouts, [key]: { problem, warnings: (previous?.warnings ?? []).map(warning => warning.replaceAll('已保留原图', '已确认使用裁图').replaceAll('已恢复原题文字并保留原图', '已恢复原题文字，并已确认使用裁图')), assets: [...kept, asset] } };
      preparedCurrent.current.layouts = next; setLayouts(next); preparedPolicy.current = null;
      await persistManual(question.recordId, signal);
    });
  }
  async function excludeCurrentSource(key: string) {
    const question = questionSources.find(question => question.key === key); const source = sources[selected]; const sourceId = selectedSourceId(); if (!question || !source || !sourceId || busy) return;
    const previous = preparedCurrent.current.layouts[key]; if (!previous || !source.key.startsWith(`${question.recordId}/`)) return;
    await work(async signal => {
      const assets = previous.assets.filter(asset => source.region ? asset.key !== source.key : asset.sourceId !== sourceId);
      const next = { ...preparedCurrent.current.layouts, [key]: { ...previous, assets } }; manual.current.add(key);
      preparedCurrent.current.layouts = next; setLayouts(next); preparedPolicy.current = null; await persistManual(question.recordId, signal);
    });
  }
  // Decision: .agents/notes/implemented/storage/2026-10-15-explicit-print-enhancement.md
  function requireSavedChanges() { if (dirtyRecords.current.size) throw new Error('请先重试保存整理结果，再继续导出。'); }
  function validatePrepared(policy: ExportLayout = 'paper') { requireSavedChanges(); (policy === 'clean' ? requireCleanPrintLayouts : policy === 'paper' ? requirePaperPrintLayouts : requireSavedPrintLayouts)(questionSources, preparedCurrent.current.layouts, preparedCurrent.current.images); }
  function getPrepared(): PreparedExportContent { requireSavedChanges(); return { ...preparedCurrent.current, sources: paperSources.current, adjustments: adjustments.current }; }
  const reviewQuestionIndices = questionSources.flatMap((question, index) => preparedKeys.current.has(question.key) && layouts[question.key]?.assets.some(asset => asset.role === 'source') ? [index] : []);
  const pendingQuestions = questionSources.filter(question => !layouts[question.key] || layouts[question.key]?.assets.some(asset => asset.role === 'source')).length;
  const contentReviewIndices = questionSources.flatMap((question, index) => preparedKeys.current.has(question.key) && layouts[question.key]?.problem.optionsComplete === false ? [index] : []);
  const canRefine = !!runtime.settings?.verifier;
  const hasStraightenableFigures = straightenablePaperSources(paperState()).length > 0;
  const hasEnhanceableFigures = enhanceablePaperSources(paperState()).length > 0;
  return { snapshot, originalSnapshot, originalQuestions, recordOrder, setRecordOrder, sources, questions, questionSources, layouts, images, selected, draft, setDraft, imageResetToken, busy, progress, setProgress, error, setError, variantError, message, setMessage, controller, alive, cleanupPrint, cacheNotice, retryLoad, cacheReadFailed, retryPreparedRead, ready, preparedLayout: preparedPolicy.current, readingReady, prepare, prepareReading, validatePrepared, getPrepared, choose, adjust, correctPerspective, analyze, analyzeQuestion, processPaper, canRefine, hasStraightenableFigures, straightenFigures, hasEnhanceableFigures, enhanceFigures, automateFigures, pendingQuestions, reviewQuestionIndices, contentReviewIndices, unsavedCount, savePending, confirmClose, work, setQuestionMode, useCurrentIllustration, excludeCurrentSource };
}
export type BatchPdfExportData = ReturnType<typeof useBatchPdfExport>;
