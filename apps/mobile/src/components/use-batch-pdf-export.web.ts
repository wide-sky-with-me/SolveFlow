import { useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { collectBatchPrint } from '@solveflow/client/local';
import { clientError, questionsForBatchPrint } from '@solveflow/client/presentation';
import { MAX_BATCH_PRINT_BYTES, MAX_BATCH_PRINT_LAYOUT_SOURCES, type BatchPrintSnapshot, type BatchPrintQuestion, type PrintImageAdjustment } from '@solveflow/contracts/local';
import type { Runtime } from '../runtime';
import { printImageKey, recordPrintImages, type PrintImages } from '../dom/batch-print-document';
import { fallbackPrintLayout, preparePrintLayout, type PrintAsset, type PrintLayouts, type ReviewPrintSource } from '../local/batch-print-presentation.web';
import { detectPrintAdjustment, originalPrintAdjustment, preparePrintImage } from '../local/print-image';
import { parseBatchPrintLayout, type BatchPrintLayoutInput } from '@solveflow/contracts/local';
import { cachePrintLayout, printLayoutCacheKey, readPrintLayoutCache, writePrintLayoutCache, type CachedPrintLayout } from '../local/batch-print-cache.web';

export function useBatchPdfExport(runtime: Runtime, batchId: string) {
  const [snapshot, setSnapshot] = useState<BatchPrintSnapshot | null>(null); const [sources, setSources] = useState<ReviewPrintSource[]>([]);
  const [questions, setQuestions] = useState<BatchPrintQuestion[]>([]); const [layouts, setLayouts] = useState<PrintLayouts>({});
  const [images, setImages] = useState<PrintImages>({}); const adjustments = useRef<Record<string, PrintImageAdjustment>>({});
  const [selected, setSelected] = useState(0); const [draft, setDraft] = useState<PrintImageAdjustment>(originalPrintAdjustment);
  const [busy, setBusy] = useState(true); const [progress, setProgress] = useState('正在读取本批题目…'); const [error, setError] = useState(''); const [variantError, setVariantError] = useState(''); const [message, setMessage] = useState('');
  const [ready, setReady] = useState(false); const [readingReady, setReadingReady] = useState(false); const manual = useRef(new Set<string>());
  const completed = useRef(new Map<string, CachedPrintLayout>()); const cacheNotice = useRef(''); const working = useRef(false);
  const controller = useRef<AbortController | null>(null); const alive = useRef(true); const cleanupPrint = useRef<(() => void) | null>(null);
  function checkSize(value: PrintImages) { if (Object.values(value).reduce((sum, image) => sum + image.length, 0) > MAX_BATCH_PRINT_BYTES) throw new Error('整理后的题图超过128MiB，请拆分批次。'); }
  useEffect(() => {
    alive.current = true; const operation = new AbortController(); controller.current = operation;
    void (async () => {
      const value = await collectBatchPrint(runtime.repository, batchId, operation.signal, (done, total) => { if (alive.current) setProgress(`读取题目 ${done} / ${total}`); });
      const original = value.records.flatMap((record, index) => recordPrintImages(record, 'history').map((image, number) => ({ key: printImageKey(record.session.id, image.id), image: image.image, label: `第 ${index + 1} 张${number ? ` · 补图 ${number}` : ''}` })));
      // Opening the dialog reads source bytes without decoding, deskewing or calling a model.
      const processed: PrintImages = Object.fromEntries(original.map(source => [source.key, source.image]));
      const preparedAdjustments: Record<string, PrintImageAdjustment> = {};
      if (!alive.current || operation.signal.aborted) return;
      let printedQuestions: BatchPrintQuestion[] = [];
      try { printedQuestions = questionsForBatchPrint(value); } catch (cause) { setVariantError(clientError(cause)); }
      const defaults: PrintLayouts = {};
      for (const question of printedQuestions) { const record = value.records.find(item => item.session.id === question.recordId); if (record) defaults[question.key] = fallbackPrintLayout(question, record); }
      adjustments.current = preparedAdjustments; setSnapshot(value); setSources(original); setQuestions(printedQuestions); setLayouts(defaults); setImages(processed); setDraft(original[0] ? preparedAdjustments[original[0].key] ?? originalPrintAdjustment : originalPrintAdjustment); setProgress('');
    })().catch(cause => { if (alive.current) setError(clientError(cause)); }).finally(() => { if (alive.current) setBusy(false); });
    return () => { alive.current = false; operation.abort(); controller.current?.abort(); cleanupPrint.current?.(); };
  }, [runtime, batchId]);
  async function work(action: (signal: AbortSignal) => Promise<void>) {
    if (busy || working.current) return; working.current = true; setBusy(true); setError(''); setMessage(''); const operation = new AbortController(); controller.current = operation;
    try { await action(operation.signal); } catch (cause) { if (alive.current) setError(clientError(cause)); }
    finally { working.current = false; if (alive.current) { setBusy(false); setProgress(''); } }
  }
  function choose(index: number) { setSelected(index); const source = sources[index]; setDraft(source ? adjustments.current[source.key] ?? originalPrintAdjustment : originalPrintAdjustment); setError(''); }
  async function adjust(automatic = false, original = false) {
    const source = sources[selected]; if (!source) return;
    await work(async signal => {
      const value = original ? originalPrintAdjustment : automatic ? await detectPrintAdjustment(source.image, signal) : draft;
      const image = original ? source.image : await preparePrintImage(source.image, value, signal); const next = { ...images, [source.key]: image }; checkSize(next);
      if (alive.current && !signal.aborted) { adjustments.current[source.key] = value; setDraft(value); setImages(next); }
    });
  }
  async function prepare(signal: AbortSignal, force = false) {
    if (!snapshot || !questions.length || ready && !force) return;
    let nextImages = { ...images }; const nextLayouts = { ...layouts }; const nextSources = sources.filter(source => !source.region); const nextAdjustments = { ...adjustments.current };
    let kept = 0; let cachedCount = 0; let analyzed = 0; let cacheWarning = '';
    for (const [index, record] of snapshot.records.entries()) {
      if (signal.aborted) throw new Error('导出已取消。');
      const ownQuestions = questions.filter(question => question.recordId === record.session.id);
      if (!ownQuestions.length || !force && ownQuestions.every(question => manual.current.has(question.key))) continue;
      const originals = recordPrintImages(record);
      if (originals.length > MAX_BATCH_PRINT_LAYOUT_SOURCES) { kept += ownQuestions.length; continue; }
      if (alive.current) setProgress(`整理第 ${index + 1} / ${snapshot.records.length} 张题图`);
      const input: BatchPrintLayoutInput = { questions: ownQuestions.map(question => ({ key: question.key, problem: question.candidate.problem })), sources: originals };
      const key = await printLayoutCacheKey(input);
      let cached = force ? null : completed.current.get(key) ?? null;
      if (!force && !cached) { try { cached = await readPrintLayoutCache(key, signal); } catch (cause) { if (signal.aborted) throw cause; cacheWarning = '缓存不可用，本次整理仍可导出。'; } }
      if (!cached && !runtime.settings) { kept += ownQuestions.length; continue; }
      if (alive.current) setProgress(`${cached ? '复用已整理题目' : 'Agent 提取题目与必要图示'} ${index + 1} / ${snapshot.records.length}`);
      const proposal = parseBatchPrintLayout(cached?.proposal ?? await runtime.analyzePrintLayout(input, signal), input);
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
      if (alive.current && !signal.aborted) flushSync(() => { adjustments.current = nextAdjustments; setImages({ ...nextImages }); setLayouts({ ...nextLayouts }); setSources([...nextSources]); });
    }
    if (alive.current && !signal.aborted) flushSync(() => {
      adjustments.current = nextAdjustments; cacheNotice.current = cacheWarning; setImages(nextImages); setLayouts(nextLayouts); setSources(nextSources); setReady(true);
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
  async function analyze() { await work(signal => prepare(signal, true)); }
  function setQuestionMode(key: string, textOnly: boolean) {
    const question = questions.find(item => item.key === key); const record = snapshot?.records.find(item => item.session.id === question?.recordId); if (!question || !record || busy) return;
    manual.current.add(key);
    setLayouts(current => ({ ...current, [key]: textOnly ? { problem: current[key]?.problem ?? question.candidate.problem, assets: [], warnings: [] } : fallbackPrintLayout(question, record) }));
  }
  function useCurrentIllustration(key: string, optionLabel?: string) {
    const question = questions.find(item => item.key === key); const source = sources[selected]; if (!question || !source || busy) return;
    if (!source.key.startsWith(`${question.recordId}/`)) { setError('请先选择本题的原图、补图或提取裁片。'); return; }
    manual.current.add(key);
    setLayouts(current => ({ ...current, [key]: { problem: current[key]?.problem ?? question.candidate.problem, warnings: [], assets: [{ key: source.key, sourceId: source.key.split('/').at(-1) ?? '', alt: optionLabel ? `选项 ${optionLabel} 图` : '题干图', role: optionLabel ? 'option' : 'question', ...(optionLabel ? { optionLabel } : {}) }] } }));
  }
  return { snapshot, sources, questions, layouts, images, selected, draft, setDraft, busy, progress, setProgress, error, setError, variantError, message, setMessage, controller, alive, cleanupPrint, cacheNotice, ready, readingReady, prepare, prepareReading, choose, adjust, analyze, work, setQuestionMode, useCurrentIllustration };
}
export type BatchPdfExportData = ReturnType<typeof useBatchPdfExport>;
