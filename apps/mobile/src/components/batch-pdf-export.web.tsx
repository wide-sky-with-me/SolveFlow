import { useEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { batchPrintFilename, batchQuestionFilename, clientError, planBatchPrintCopies } from '@solveflow/client/presentation';
import type { BatchPrintCopy, BatchPrintCopyRequest, BatchPrintReference } from '@solveflow/contracts/local';
import type { Runtime } from '../runtime';
import type { BatchPdfContent } from '../local/batch-print-presentation.web';
import { Button } from './ui';
import { BatchPdfDialog } from './batch-pdf-dialog.web';
import { BatchPdfPanel } from './batch-pdf-panel.web';
import { BatchPrintDocument } from '../dom/batch-print-document';
import { BatchCopyDocument } from '../dom/batch-copy-document';
import { openBatchPrint } from '../local/print-batch.web';
import { exportBatchPdfs } from '../local/download-batch-pdfs.web';
import { useBatchPdfExport } from './use-batch-pdf-export.web';
import { BatchCopySettings } from './batch-copy-settings.web';
import '../dom/answer.css';
import '../../.generated/katex.css';
import '../dom/batch-print.css';

export const batchPdfAvailable = true;
function planError(cause: unknown) { return cause instanceof Error && cause.name === 'ZodError' ? '请检查份数、对错数量与参照答案。' : clientError(cause); }
export function BatchPdfExport({ runtime, batchId, onClose }: { runtime: Runtime; batchId: string; onClose: () => void }) {
  const data = useBatchPdfExport(runtime, batchId);
  const { snapshot, questions, layouts, images, busy } = data;
  const [mode, setMode] = useState<BatchPdfContent>('answers'); const [copyIndex, setCopyIndex] = useState(0); const [questionIndex, setQuestionIndex] = useState(0); const [imageRole, setImageRole] = useState('question');
  const [requests, setRequests] = useState<BatchPrintCopyRequest[]>([]); const [references, setReferences] = useState<BatchPrintReference[]>([]);
  const [settingsOpen, setSettingsOpen] = useState(false); const [draftRequests, setDraftRequests] = useState<BatchPrintCopyRequest[]>([]); const [draftReferences, setDraftReferences] = useState<BatchPrintReference[]>([]);
  const printRoot = useRef<HTMLDivElement>(null);
  useEffect(() => { if (questions.length) { const wrong = questions.filter(question => question.baselineWrong).length; setRequests([{ correct: questions.length - wrong, incorrect: wrong }]); } }, [questions]);
  useEffect(() => { if (snapshot && !questions.length) setMode('reading'); }, [snapshot, questions.length]);
  function calculate(requested: BatchPrintCopyRequest[], referred: BatchPrintReference[]): { copies: BatchPrintCopy[]; error: string } {
    if (!questions.length) return { copies: [], error: data.variantError };
    try { return { copies: planBatchPrintCopies(questions, requested, referred), error: '' }; } catch (cause) { return { copies: [], error: planError(cause) }; }
  }
  const plan = useMemo(() => calculate(requests, references), [questions, requests, references, data.variantError]);
  const draftPlan = calculate(draftRequests, draftReferences); const copy = plan.copies[Math.min(copyIndex, plan.copies.length - 1)];
  function settings() { setDraftRequests(requests.map(item => ({ ...item }))); setDraftReferences(references.map(item => ({ ...item }))); setSettingsOpen(true); }
  async function print() {
    if (!snapshot) return;
    await data.work(async signal => {
      if (mode !== 'reading' && questions.length) await data.prepare(signal); else await data.prepareReading(signal);
      const element = printRoot.current?.firstElementChild; if (!element) throw new Error('导出预览无法读取。');
      data.cleanupPrint.current?.(); data.cleanupPrint.current = await openBatchPrint(element, mode === 'questions' ? batchQuestionFilename(snapshot.batch.title, questions.length) : mode === 'answers' && copy ? batchPrintFilename(snapshot.batch.title, copy) : `${snapshot.batch.title}-题目与AI回答`, signal); if (data.alive.current) data.setMessage('打印窗口已打开，请选择「另存为 PDF」。'); });
  }
  async function download() {
    if (!snapshot || mode === 'reading' || !questions.length || mode === 'answers' && (!plan.copies.length || plan.error)) return;
    await data.work(async signal => {
      await data.prepare(signal);
      const currentElement = () => { if (signal.aborted) throw new Error('导出已取消。'); const element = printRoot.current?.firstElementChild; if (!element) throw new Error('导出预览无法读取。'); return element; };
      const files = mode === 'questions' ? [{ name: batchQuestionFilename(snapshot.batch.title, questions.length), element: () => { flushSync(() => setMode('questions')); return currentElement(); } }] : plan.copies.map((value, index) => ({ name: batchPrintFilename(snapshot.batch.title, value, { multiple: plan.copies.length > 1 }), element: () => {
        flushSync(() => { setMode('answers'); setCopyIndex(index); }); return currentElement();
      } }));
      await exportBatchPdfs(files, `${snapshot.batch.title}_${files.length}份.zip`, signal, value => { if (data.alive.current) data.setProgress(`生成第 ${value.copy} / ${value.copies} 份 · 第 ${value.page} / ${value.pages} 页`); });
      if (data.alive.current) data.setMessage(`已生成 ${files.length} 份${files.length > 1 ? ' PDF 压缩包' : ' PDF'}并发起下载。${data.cacheNotice.current}`);
    });
  }
  return <>
    <BatchPdfDialog title="导出 PDF" closeLabel="关闭导出" busy={busy} onClose={onClose} onRequestClose={() => { if (busy) data.controller.current?.abort(); else onClose(); }} footer={busy ? <Button title="取消导出" compact secondary onPress={() => data.controller.current?.abort()} /> : <>
      <Button title="打印 / 保存 PDF" compact secondary disabled={!snapshot || mode === 'answers' && (!copy || !!plan.error) || mode === 'questions' && !questions.length} onPress={() => void print()} />
      {mode !== 'reading' && <Button title={mode === 'answers' && plan.copies.length > 1 ? '下载 PDF 压缩包' : '下载 PDF'} compact disabled={mode === 'answers' ? !copy || !!plan.error : !questions.length} onPress={() => void download()} />}
    </>}>
      <BatchPdfPanel data={data} mode={mode} setMode={setMode} copy={copy} copies={plan.copies} planError={plan.error} onSettings={settings} copyIndex={copyIndex} setCopyIndex={setCopyIndex} questionIndex={questionIndex} setQuestionIndex={setQuestionIndex} imageRole={imageRole} setImageRole={setImageRole} printRoot={printRoot} configured={!!runtime.settings}>
        {snapshot && (mode === 'questions' ? data.ready && <BatchCopyDocument mode="questions" snapshot={snapshot} questions={questions} layouts={layouts} images={images} /> : mode === 'answers' && copy ? data.ready && <BatchCopyDocument snapshot={snapshot} questions={questions} copy={copy} layouts={layouts} images={images} /> : data.readingReady && <BatchPrintDocument snapshot={snapshot} images={images} />)}
      </BatchPdfPanel>
    </BatchPdfDialog>
    {settingsOpen && <BatchCopySettings questions={questions} requests={draftRequests} references={draftReferences} error={draftPlan.error} onRequests={setDraftRequests} onReferences={setDraftReferences} onClose={() => setSettingsOpen(false)} onApply={() => { setRequests(draftRequests); setReferences(draftReferences); setCopyIndex(0); setMode('answers'); setSettingsOpen(false); }} />}
  </>;
}
