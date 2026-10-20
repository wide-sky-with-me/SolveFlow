import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { batchPrintFilename, batchQuestionFilename, clientError, planBatchPrintCopies } from '@solveflow/client/presentation';
import { MAX_BATCH_PRINT_PAGES, type BatchPrintCopy, type BatchPrintReference } from '@solveflow/contracts/local';
import type { Runtime } from '../runtime';
import { printableVariantQuestions, requirePrintableCopies, type BatchPdfContent } from '../local/batch-print-presentation.web';
import { Button } from './ui';
import { BatchPdfDialog } from './batch-pdf-dialog.web';
import { BatchPdfPanel } from './batch-pdf-panel.web';
import { BatchPrintDocument } from '../dom/batch-print-document';
import { BatchCopyDocument } from '../dom/batch-copy-document';
import { openBatchPrint } from '../local/print-batch.web';
import { webExportTasks } from '../local/web-export-tasks';
import type { ExportLayout } from '../local/prepare-batch-export.web';
import { useBatchPdfExport } from './use-batch-pdf-export.web';
import { BatchCopySettings } from './batch-copy-settings.web';
import { editPrintCopyDraft, parsePrintCopyDrafts, type PrintCopyField, type PrintCopyState } from '../local/print-copy-drafts';
import '../dom/answer.css';
import '../../.generated/katex.css';
import '../dom/batch-print.css';

export const batchPdfAvailable = true;
function planError(cause: unknown) { return cause instanceof Error && cause.name === 'ZodError' ? '请检查份数、错题数与参照答案。' : clientError(cause); }
export function BatchPdfExport({ runtime, batchId, onClose }: { runtime: Runtime; batchId: string; onClose: () => void }) {
  const data = useBatchPdfExport(runtime, batchId);
  const manager = webExportTasks(runtime);
  const [foregroundId, setForegroundId] = useState<string | null>(null);
  const recovery = useSyncExternalStore(manager.tasks.subscribe, () => foregroundId ? manager.tasks.getSnapshot().find(task => task.id === foregroundId && task.status === 'running' && manager.tasks.pendingSaveIds.includes(task.id)) ?? null : null);
  const { snapshot, questions, questionSources, layouts, images, busy } = data;
  const [mode, setMode] = useState<BatchPdfContent>('answers');
  const [layout, setLayout] = useState<ExportLayout>('paper');
  const [copyIndex, setCopyIndex] = useState(0);
  const [questionIndex, setQuestionIndex] = useState(0);
  const [imageRole, setImageRole] = useState('question');
  const [quantities, setQuantities] = useState<PrintCopyState>({ requests: [], drafts: {} });
  const requests = quantities.requests;
  const baselineWrong = questions.filter(question => question.baselineWrong).length;
  const quantity = parsePrintCopyDrafts(quantities, questions.length, baselineWrong);
  function editQuantity(field: PrintCopyField, text: string | null) { setQuantities(current => editPrintCopyDraft(current, field, text, questions.length, baselineWrong)); }
  const [references, setReferences] = useState<BatchPrintReference[]>([]);
  const printRoot = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (questions.length) { const wrong = questions.filter(question => question.baselineWrong).length; setQuantities({ requests: [{ correct: questions.length - wrong, incorrect: wrong }], drafts: {} }); }
  }, [questions]);
  useEffect(() => { if (snapshot && !questions.length) setMode('questions'); }, [snapshot, questions.length]);
  const printableQuestions = printableVariantQuestions(questions, layouts);
  let copies: BatchPrintCopy[] = []; let error = '';
  if (questions.length && requests.length) {
    try { copies = planBatchPrintCopies(printableQuestions, requests, references); } catch (cause) { error = planError(cause); }
  }
  const copy = copies[Math.min(copyIndex, copies.length - 1)];
  const pageError = mode !== 'reading' && questionSources.length > MAX_BATCH_PRINT_PAGES ? `PDF 页数超过上限（每份 ${MAX_BATCH_PRINT_PAGES} 页），请按题目拆分后重试。` : '';
  const unavailable = data.unsavedCount > 0 || !!pageError || !snapshot || (mode === 'answers' ? !copy || !!error || !!quantity.error : mode === 'questions' && !questionSources.length) || (mode !== 'reading' && layout === 'paper' && data.pendingQuestions > 0);
  function close() { if (data.confirmClose()) onClose(); }
  function currentElement(signal: AbortSignal) {
    if (signal.aborted) throw new Error('导出已取消。');
    const element = printRoot.current?.firstElementChild;
    if (!element) throw new Error('导出预览尚未就绪。');
    return element;
  }
  async function print() {
    if (!snapshot || unavailable || recovery) return;
    await data.work(async signal => {
      if (mode === 'reading') await data.prepareReading(signal);
      else { await data.prepare(signal, false, layout); data.validatePrepared(layout); }
      const latestCopies = mode === 'answers' ? planBatchPrintCopies(printableVariantQuestions(questions, data.getPrepared().layouts), requests, references) : [];
      requirePrintableCopies(latestCopies, data.getPrepared().layouts);
      const selectedCopy = latestCopies[Math.min(copyIndex, latestCopies.length - 1)];
      const name = mode === 'questions' ? batchQuestionFilename(snapshot.batch.title, questionSources.length) : mode === 'answers' && selectedCopy ? batchPrintFilename(snapshot.batch.title, selectedCopy) : `${snapshot.batch.title}_原始记录.pdf`;
      data.cleanupPrint.current?.();
      data.cleanupPrint.current = await openBatchPrint(currentElement(signal), name, signal);
      if (data.alive.current) data.setMessage('打印窗口已打开，请选择「另存为 PDF」。');
    });
  }
  async function foregroundDownload() {
    if (!snapshot || unavailable || recovery) return;
    await data.work(async signal => {
      const task = await manager.submitCollected({ snapshot, mode, layout, copies, prepared: data.getPrepared() }, async operation => {
        await data.prepare(operation, false, layout); data.validatePrepared(layout);
        return data.getPrepared();
      }, signal);
      if (data.alive.current) setForegroundId(task.id);
      const cancel = () => { void manager.tasks.cancel(task.id).catch(() => undefined); };
      let unsubscribe = () => {};
      try {
        await new Promise<void>((resolve, reject) => {
          const changed = () => {
            const current = manager.tasks.getSnapshot().find(item => item.id === task.id);
            if (!current) return;
            if (data.alive.current) data.setProgress(current.progress);
            if (current.status === 'succeeded') { unsubscribe(); resolve(); }
            else if (['failed', 'interrupted', 'cancelled'].includes(current.status) || current.error) { unsubscribe(); reject(new Error(current.status === 'cancelled' ? '导出已取消。' : current.error ?? '导出未完成，请查看导出记录。')); }
          };
          unsubscribe = manager.tasks.subscribe(changed);
          signal.addEventListener('abort', cancel, { once: true }); changed();
          if (signal.aborted) cancel();
        });
        signal.throwIfAborted(); await manager.download(task.id, signal);
        if (data.alive.current) data.setMessage(`已生成 ${mode === 'answers' ? copies.length : 1} 份并保存导出记录，下载已发起。${data.cacheNotice.current}`);
      } finally { unsubscribe(); signal.removeEventListener('abort', cancel); }
    });
  }
  // Decision: .agents/notes/implemented/storage/2026-10-14-background-pdf-exports.md
  async function retryForegroundSave() {
    if (!recovery) return;
    const id = recovery.id;
    await data.work(async signal => {
      const cancel = () => { void manager.tasks.cancel(id).catch(() => undefined); };
      signal.addEventListener('abort', cancel, { once: true });
      try {
        signal.throwIfAborted(); data.setProgress('正在保存已生成的导出文件…');
        await manager.tasks.retrySave(id);
        signal.throwIfAborted();
        const saved = manager.tasks.getSnapshot().find(task => task.id === id);
        if (saved?.status !== 'succeeded') throw new Error('原导出未完成，请查看导出记录。');
        await manager.download(id, signal);
        if (data.alive.current) { setForegroundId(null); data.setMessage('原导出结果已保存，下载已发起。'); }
      } finally { signal.removeEventListener('abort', cancel); }
    });
  }
  async function cancelForegroundSave() {
    if (!recovery) return;
    const id = recovery.id;
    await data.work(async () => {
      await manager.tasks.cancel(id);
      if (manager.tasks.pendingSaveIds.includes(id)) throw new Error('本次导出已取消，取消状态尚未保存，请在导出记录重试保存。');
      if (data.alive.current) { setForegroundId(null); data.setMessage('本次导出已取消。'); }
    });
  }
  async function download() {
    if (!snapshot || unavailable || recovery) return;
    await data.work(async signal => {
      data.setProgress('正在加入后台导出…');
      await manager.submitCollected({ snapshot, mode, layout, copies, prepared: data.getPrepared() }, undefined, signal);
      if (data.alive.current && !signal.aborted) close();
    });
  }
  return <BatchPdfDialog title="导出 PDF" closeLabel="关闭导出" busy={busy} onClose={close} onRequestClose={() => { if (!busy) close(); }} footer={busy ? <Button title={data.controller.current?.signal.aborted ? '正在取消…' : '取消导出'} compact secondary disabled={!!data.controller.current?.signal.aborted} onPress={() => { data.controller.current?.abort(); data.setProgress('正在取消导出…'); }} /> : <>
    <Button title="导出记录" compact secondary onPress={() => { if (data.confirmClose()) { manager.open(); onClose(); } }} />
    {!snapshot ? <Button title="重试读取题目" compact onPress={data.retryLoad} /> : recovery ? <><Button title="取消本次导出" compact secondary onPress={() => void cancelForegroundSave()} /><Button title="重试保存并下载" compact onPress={() => void retryForegroundSave()} /></> : <>
      <Button title="打印 / 保存 PDF" compact secondary disabled={unavailable} onPress={() => void print()} />
      {mode !== 'reading' && <Button title={mode === 'answers' && copies.length > 1 ? '下载 PDF 压缩包' : '下载 PDF'} compact disabled={unavailable} onPress={() => void foregroundDownload()} />}
      <Button title="后台导出" compact secondary disabled={unavailable} onPress={() => void download()} />
    </>}
  </>}>
    <BatchPdfPanel data={data} mode={mode} setMode={setMode} layout={layout} setLayout={setLayout} copy={copy} copies={copies} planError={pageError || (mode === 'answers' ? error : '')} copyIndex={copyIndex} setCopyIndex={setCopyIndex} questionIndex={questionIndex} setQuestionIndex={setQuestionIndex} imageRole={imageRole} setImageRole={setImageRole} printRoot={printRoot} configured={!!runtime.settings} settingsForm={<BatchCopySettings questions={printableQuestions} requests={requests} drafts={quantities.drafts} references={references} busy={busy} onEdit={editQuantity} onReferences={setReferences} />}>
      {snapshot && (mode === 'questions' ? data.ready && <BatchCopyDocument mode="questions" snapshot={snapshot} problems={questionSources} layouts={layouts} images={images} /> : mode === 'answers' && copy ? data.ready && <BatchCopyDocument snapshot={snapshot} problems={questionSources} questions={questions} copy={copy} layouts={layouts} images={images} /> : data.readingReady && <BatchPrintDocument snapshot={snapshot} images={images} />)}
    </BatchPdfPanel>
  </BatchPdfDialog>;
}
