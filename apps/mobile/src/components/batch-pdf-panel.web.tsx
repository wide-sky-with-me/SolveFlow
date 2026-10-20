import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type RefObject, type ReactNode } from 'react';
import { PdfPicker } from './pdf-picker.web';
import { PrintPerspectiveEditor } from './print-perspective-editor.web';
import type { BatchPrintCopy } from '@solveflow/contracts/local';
import type { BatchPdfContent } from '../local/batch-print-presentation.web';
import type { BatchPdfExportData } from './use-batch-pdf-export.web';
import type { ExportLayout } from '../local/prepare-batch-export.web';
import { Button, Notice } from './ui';
import { parsePrintNumberDrafts, printNumberText, printCropSides, type PrintNumberDrafts, type PrintNumberField } from '../local/print-number-drafts';

export function BatchPdfPanel({ data, mode, setMode, layout, setLayout, copy, copies, planError, settingsForm, copyIndex, setCopyIndex, questionIndex, setQuestionIndex, imageRole, setImageRole, printRoot, children, configured }: { data: BatchPdfExportData; mode: BatchPdfContent; setMode: (value: BatchPdfContent) => void; layout: ExportLayout; setLayout: (value: ExportLayout) => void; copy: BatchPrintCopy | undefined; copies: BatchPrintCopy[]; planError: string; settingsForm: ReactNode; copyIndex: number; setCopyIndex: (value: number) => void; questionIndex: number; setQuestionIndex: (value: number) => void; imageRole: string; setImageRole: (value: string) => void; printRoot: RefObject<HTMLDivElement | null>; children: ReactNode; configured: boolean }) {
  const [editorOpen, setEditorOpen] = useState(false); const [previewOpen, setPreviewOpen] = useState(false);
  const [reviewNotes, setReviewNotes] = useState<Record<string, string>>({});
  const editor = useRef<HTMLDetailsElement>(null);
  useEffect(() => { if (editorOpen) editor.current?.scrollIntoView({ block: 'start' }); }, [editorOpen]);
  function preparePreview(value: BatchPdfContent, policy = layout) { void data.work(signal => value === 'reading' ? data.prepareReading(signal) : data.prepare(signal, false, policy)); }
  const { snapshot, sources, questions: answerQuestions, questionSources: questions, layouts, images, selected, draft, setDraft, imageResetToken, busy, progress, error, message } = data;
  const feedback = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (busy || !error || !feedback.current) return;
    feedback.current.focus({ preventScroll: true });
    feedback.current.scrollIntoView({ block: 'start' });
  }, [busy, error]);
  const question = questions[questionIndex]; const source = sources[selected]; const ownSources = sources.map((item, index) => ({ ...item, index })).filter(item => !question || item.key.startsWith(`${question.recordId}/`));
  const [numericDrafts, setNumericDrafts] = useState<PrintNumberDrafts>({}); const numericErrorId = useId();
  useEffect(() => { setNumericDrafts({}); }, [source?.key, source?.image, draft.rotation, draft.crop.left, draft.crop.top, draft.crop.right, draft.crop.bottom, draft.perspective, imageResetToken]);
  const numeric = parsePrintNumberDrafts(draft, numericDrafts);
  function numericText(field: PrintNumberField) { return numericDrafts[field] ?? printNumberText(draft, field); }
  function numericKey(event: KeyboardEvent<HTMLInputElement>, field: PrintNumberField) {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setNumericDrafts(current => { const next = { ...current }; delete next[field]; return next; }); return; }
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
    event.preventDefault(); const value = Number(numericText(field)); const initial = Number.isFinite(value) ? value : Number(printNumberText(draft, field));
    const stepped = initial + (event.key === 'ArrowUp' ? 1 : -1) * (field === 'rotation' ? .25 : .5);
    const next = Math.max(field === 'rotation' ? -15 : 0, Math.min(field === 'rotation' ? 15 : 100, stepped));
    setNumericDrafts(current => ({ ...current, [field]: String(Math.round(next * 1_000_000) / 1_000_000) }));
  }
  function chooseQuestion(index: number) { setQuestionIndex(index); setImageRole('question'); const current = questions[index]; const first = sources.findIndex(item => item.key.startsWith(`${current?.recordId}/`)); if (first >= 0) data.choose(first); }
  const paperPreparation = !!snapshot && mode !== 'reading' && layout === 'paper';
  const contentReviewCount = data.contentReviewIndices.length;
  const preparationState = busy ? 'working' : data.unsavedCount ? 'unsaved' : data.pendingQuestions || contentReviewCount ? 'pending' : 'ready';
  const reviewCount = data.reviewQuestionIndices.length; const extractionCount = data.pendingQuestions - reviewCount;
  const preparationStatus = busy ? progress || '正在处理…' : data.unsavedCount ? `${data.unsavedCount} 项整理结果尚未保存` : [data.pendingQuestions ? [extractionCount ? `${extractionCount} 题待整理` : '', reviewCount ? `${reviewCount} 题待核对图示` : ''].filter(Boolean).join('，') : contentReviewCount ? '已整理' : '已整理，可直接复用', contentReviewCount ? `${contentReviewCount} 题内容待核对` : ''].filter(Boolean).join('，');
  function reviewQuestion(indices: number[]) { const index = indices[0]; if (index !== undefined) chooseQuestion(index); if (editor.current) { editor.current.open = true; editor.current.scrollIntoView({ block: 'nearest' }); editor.current.querySelector('summary')?.focus({ preventScroll: true }); } }
  function reviewImages() { reviewQuestion(data.reviewQuestionIndices); }
  function reviewContent() { reviewQuestion(data.contentReviewIndices); }
  return <>
    {!!progress && !paperPreparation && <p className="pdf-note" role="status">{progress}</p>}{!!error && <div ref={feedback} tabIndex={-1} data-testid="pdf-operation-feedback"><Notice text={error} error /></div>}{!!message && <Notice text={message} />}
    {paperPreparation && data.cacheReadFailed && <div className="pdf-actions"><Button title="重试读取整理结果" compact disabled={busy || data.unsavedCount > 0} onPress={() => void data.retryPreparedRead()} /><span className="pdf-note">仅读取已保存结果，不调用模型。</span></div>}
    {snapshot && <><div className="pdf-batch-summary" data-testid="pdf-batch-summary">
      <div className="pdf-batch-info"><p className="pdf-batch-title">{snapshot.batch.title}</p><p className="pdf-counts">{mode === 'questions' ? `共 ${questions.length} 题` : copy ? `共 ${copy.total} 题 · 对 ${copy.correct} 题 · 错 ${copy.incorrect} 题` : `${snapshot.records.length} 张题图`}</p></div>
      {paperPreparation && <div className="pdf-preparation" data-state={preparationState}>
        <div className="pdf-preparation-controls">{data.unsavedCount > 0 ? <Button title="重试保存整理" compact disabled={busy} onPress={() => void data.savePending()} /> : <Button title="整理题目与图示" compact disabled={busy || !configured || data.pendingQuestions === 0} onPress={() => void data.processPaper()} />}{data.hasStraightenableFigures && <Button title="摆正本批图示" compact secondary disabled={busy || data.unsavedCount > 0} onPress={() => void data.straightenFigures()} />}{reviewCount > 0 && <Button title="核对图示" compact secondary disabled={busy} onPress={reviewImages} />}{contentReviewCount > 0 && <Button title="核对内容" compact secondary disabled={busy} onPress={reviewContent} />}</div>
        <p className="pdf-preparation-status" role="status" aria-label="试卷整理状态" aria-live="polite" aria-atomic="true">{preparationStatus}</p>
      </div>}
    </div>
      <div className="pdf-config"><div className="pdf-field"><span>导出内容</span><div className="pdf-mode-switch" role="group" aria-label="导出内容"><Button title="题目与作答" compact selected={mode === 'answers'} secondary={mode !== 'answers'} disabled={busy || !answerQuestions.length} onPress={() => { setMode('answers'); if (previewOpen) preparePreview('answers'); }} /><Button title="纯题目" compact selected={mode === 'questions'} secondary={mode !== 'questions'} disabled={busy || !questions.length} onPress={() => { setMode('questions'); if (previewOpen) preparePreview('questions'); }} /><Button title="原始记录" compact selected={mode === 'reading'} secondary={mode !== 'reading'} disabled={busy} onPress={() => { setMode('reading'); if (previewOpen) preparePreview('reading'); }} /></div></div></div>
      {mode !== 'reading' && <div className="pdf-field" style={{ marginTop: 14 }}><span>导出版式</span><div className="pdf-mode-switch" role="group" aria-label="导出版式"><Button title="整理后的试卷" compact selected={layout === 'paper'} secondary={layout !== 'paper'} disabled={busy} onPress={() => { setLayout('paper'); if (previewOpen) preparePreview(mode, 'paper'); }} /><Button title="已保存内容" compact selected={layout === 'saved'} secondary={layout !== 'saved'} disabled={busy} onPress={() => { setLayout('saved'); if (previewOpen) preparePreview(mode, 'saved'); }} /><Button title="严格试卷版" compact selected={layout === 'clean'} secondary={layout !== 'clean'} disabled={busy} onPress={() => { setLayout('clean'); if (previewOpen) preparePreview(mode, 'clean'); }} /></div></div>}
      {!paperPreparation && data.unsavedCount > 0 && <div className="pdf-actions"><Button title="重试保存整理" compact disabled={busy} onPress={() => void data.savePending()} /><span className="pdf-note" role="status">整理结果尚未保存</span></div>}
      {mode === 'answers' && !!answerQuestions.length && settingsForm}
      {mode === 'questions' && <p className="pdf-note">{layout === 'saved' ? '不附作答文字；保留的原图可能含手写作答，可在图片整理中手动裁切。' : '仅题干、选项与必要图示，不附作答。'}</p>}
      {mode !== 'reading' && layout !== 'paper' && <p className="pdf-note">{layout === 'saved' ? '保底出口：使用保存的内容；未确认图示时保留原图。' : configured ? '缺少整理结果时调用模型；题干和选项完整才导出。' : '严格试卷版需要手动整理图示，或配置模型。'}</p>}
      {mode === 'answers' && !!data.variantError && <Notice text={data.variantError} />}{!!planError && <Notice text={planError} error />}
      {mode === 'answers' && copies.length > 1 && <PdfPicker label="当前副本" value={String(Math.min(copyIndex, copies.length - 1))} disabled={busy} onChange={value => setCopyIndex(Number(value))} options={copies.map((item, index) => ({ value: String(index), label: `第 ${index + 1} 份 · 对 ${item.correct} / 错 ${item.incorrect}` }))} />}
      <details ref={editor} className="pdf-disclosure" onToggle={event => setEditorOpen(event.currentTarget.open)}><summary>图片整理</summary>{editorOpen && <div className="pdf-disclosure-content">
        {data.hasEnhanceableFigures && <div className="pdf-actions"><Button title="更新本批清晰化" compact secondary disabled={busy || data.unsavedCount > 0} onPress={() => void data.enhanceFigures()} /></div>}
        {!!questions.length && <><div className="pdf-form-grid"><PdfPicker label="当前题目" value={String(questionIndex)} disabled={busy} onChange={value => chooseQuestion(Number(value))} options={questions.map((item, index) => ({ value: String(index), label: `第 ${item.ordinal} 题` }))} /><PdfPicker label="图示归属" value={imageRole} disabled={busy} onChange={setImageRole} options={[{ value: 'question', label: '题干图' }, ...(layouts[question?.key ?? '']?.problem.options ?? question?.problem?.options ?? []).map(option => ({ value: option.label, label: `选项 ${option.label} 图` }))]} /></div>
          <div className="pdf-actions">{question && <Button title={questions.filter(item => item.recordId === question.recordId).length > 1 ? '重新整理当前题组' : '重新整理当前题'} compact disabled={busy || !configured} onPress={() => void data.analyzeQuestion(question.key)} />}{question && data.canRefine && <Button title={questions.filter(item => item.recordId === question.recordId).length > 1 ? '精修当前题组' : '精修当前题'} compact secondary disabled={busy || !configured} onPress={() => void data.analyzeQuestion(question.key, { reviewNotes: reviewNotes[question.recordId] ?? '' })} />}<Button title="重新整理本批" compact secondary disabled={busy || !configured} onPress={() => void data.analyze()} />{question && <><Button title="本题仅保留文字" compact secondary disabled={busy} onPress={() => void data.setQuestionMode(question.key, true)} /><Button title="本题恢复原图" compact secondary disabled={busy} onPress={() => void data.setQuestionMode(question.key, false)} /></>}</div>
          {question && data.canRefine && <details className="pdf-disclosure"><summary>精修核对意见（可选）</summary><label className="pdf-field"><textarea aria-label="精修核对意见" className="pdf-refine-notes" rows={3} maxLength={2000} disabled={busy} value={reviewNotes[question.recordId] ?? ''} placeholder="例如：某选项横轴被截断，或与相邻选项用了重复的图。" onChange={event => setReviewNotes(current => ({ ...current, [question.recordId]: event.target.value }))} /></label></details>}
          {question && layouts[question.key]?.problem.optionsComplete === false && <Notice text="本题选项尚未确认完整，导出保留现有内容和疑点。" />}
          {question && <p className="pdf-note">{layouts[question.key]?.assets.length ? '可裁切原图，或由 AI 提取题干与选项中的图示。' : '纯文字题目，仅导出文字。'}</p>}
        </>}
        {ownSources.length > 1 && <div style={{ marginTop: 14 }}><PdfPicker label="图片来源" value={String(selected)} disabled={busy} onChange={value => data.choose(Number(value))} options={ownSources.map(item => ({ value: String(item.index), label: item.label }))} /></div>}
        {source && <div className="pdf-image-review"><figure><figcaption>{source.region ? '提取裁片' : '原图'}</figcaption><img src={source.image} alt="导出源图" /></figure><figure><figcaption>导出效果</figcaption><img src={images[source.key]} alt="整理后题图" /></figure></div>}
        <div className="pdf-form-grid"><label className="pdf-field">旋转角度（°）<input aria-label="导出题图旋转角度" type="text" inputMode="text" maxLength={24} value={numericText('rotation')} aria-invalid={numeric.invalid.includes('rotation')} aria-describedby={numeric.error ? numericErrorId : undefined} disabled={busy} onChange={event => setNumericDrafts(current => ({ ...current, rotation: event.target.value }))} onKeyDown={event => numericKey(event, 'rotation')} /></label><label className="pdf-check"><input aria-label="清晰化题图" type="checkbox" checked={draft.enhance} disabled={busy} onChange={event => setDraft(current => ({ ...current, enhance: event.target.checked }))} />清理底色与锐化</label></div>
        <div className="pdf-crop-grid">{printCropSides.map((side, index) => <label className="pdf-field" key={side}>{['左边', '上边', '右边', '下边'][index]}（%）<input aria-label={`导出裁切${side}`} type="text" inputMode="decimal" maxLength={24} disabled={busy} value={numericText(side)} aria-invalid={numeric.invalid.includes(side)} aria-describedby={numeric.error ? numericErrorId : undefined} onChange={event => setNumericDrafts(current => ({ ...current, [side]: event.target.value }))} onKeyDown={event => numericKey(event, side)} /></label>)}</div>
        {!!numeric.error && <p id={numericErrorId} className="pdf-note" role="status">{numeric.error}</p>}
        <div className="pdf-actions"><Button title="更新图像预览" compact disabled={busy || !numeric.adjustment} onPress={() => { if (numeric.adjustment) void data.adjust(false, false, numeric.adjustment); }} /><Button title="自动整理本图" compact secondary disabled={busy} onPress={() => void data.adjust(true)} /><Button title={source?.region ? '恢复裁片' : '恢复原图'} compact secondary disabled={busy} onPress={() => void data.adjust(false, true)} />{question && <><Button title="将当前裁片用于本题" compact secondary disabled={busy} onPress={() => void data.useCurrentIllustration(question.key, imageRole === 'question' ? undefined : imageRole)} /><Button title="本图无需保留" compact secondary disabled={busy} onPress={() => void data.excludeCurrentSource(question.key)} /></>}</div>
        {source && <PrintPerspectiveEditor key={source.key} uri={source.image} value={draft.perspective} resetToken={imageResetToken} busy={busy} onApply={value => void data.correctPerspective(value)} />}
      </div>}</details>
      <details className="pdf-disclosure" onToggle={event => { const open = event.currentTarget.open; setPreviewOpen(open); if (open && !busy) preparePreview(mode); }}><summary>预览导出内容</summary><div className="pdf-preview" ref={printRoot} data-testid="batch-print-preview">{children}</div></details>
    </>}
  </>;
}
