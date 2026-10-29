import { useId, type KeyboardEvent } from 'react';
import type { BatchPrintCopyRequest, BatchPrintQuestion, BatchPrintReference } from '@solveflow/contracts/local';
import { MAX_BATCH_PRINT_COPIES, MAX_BATCH_PRINT_REMARK_CHARACTERS } from '@solveflow/contracts/local';
import { parsePrintCopyDrafts, printCopyInteger, type PrintCopyDrafts, type PrintCopyField } from '../local/print-copy-drafts';

export function BatchCopySettings({ questions, requests, drafts, references, busy, onEdit, onRemark, onReferences }: { questions: BatchPrintQuestion[]; requests: BatchPrintCopyRequest[]; drafts: PrintCopyDrafts; references: BatchPrintReference[]; busy: boolean; onEdit: (field: PrintCopyField, text: string | null) => void; onRemark: (index: number, text: string) => void; onReferences: (value: BatchPrintReference[]) => void }) {
  const total = questions.length;
  const wrong = 0;
  const quantity = parsePrintCopyDrafts({ requests, drafts }, total, wrong);
  const errorId = useId();
  const countText = drafts.count?.text ?? String(requests.length);
  function key(event: KeyboardEvent<HTMLInputElement>, field: PrintCopyField, text: string, previous: number) {
    const min = field === 'count' ? 1 : 0;
    const max = field === 'count' ? MAX_BATCH_PRINT_COPIES : total;
    if (event.key === 'Escape' && printCopyInteger(text, min, max) === null) { event.preventDefault(); event.stopPropagation(); onEdit(field, null); return; }
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
    event.preventDefault();
    const value = printCopyInteger(text, min, max) ?? previous;
    onEdit(field, String(Math.max(min, Math.min(max, value + (event.key === 'ArrowUp' ? 1 : -1)))));
  }
  function reference(question: BatchPrintQuestion, value: string, wrongAnswer = false) {
    const previous = references.find(item => item.key === question.key) ?? { key: question.key };
    const next: BatchPrintReference = wrongAnswer ? { ...previous, wrongAnswer: value } : question.validOptions.length ? { ...previous, referenceOptions: value.trim() ? value.toUpperCase().split(/[、,\s]+/).filter(Boolean) : null } : { ...previous, referenceAnswer: value.trim() || null };
    onReferences([...references.filter(item => item.key !== question.key), next]);
  }
  return <section className="pdf-copy-settings" aria-label="作答副本设置">
    <label className="pdf-copy-count"><span>导出份数</span><input
      aria-label="导出份数" type="text" inputMode="numeric" maxLength={8}
      value={countText} aria-invalid={quantity.invalidCount}
      aria-describedby={quantity.invalidCount ? errorId : undefined} disabled={busy}
      onChange={event => onEdit('count', event.target.value)}
      onKeyDown={event => key(event, 'count', countText, requests.length)}
    /></label>
    {!!quantity.error && <p className="pdf-note" role="status" id={errorId}>{quantity.error}</p>}
    <div className="pdf-copy-list">
      <div className="pdf-copy-head" aria-hidden="true"><span>副本</span><span>最终错题数</span><span>答对题数</span><span className="pdf-copy-remark-heading">备注</span></div>
      {requests.map((request, index) => <div className="pdf-copy-row" key={index}>
        <strong>第 {index + 1} 份</strong>
        <label className="pdf-field pdf-copy-wrong"><span className="pdf-sr-only">最终错题数</span><input
          aria-label={`第${index + 1}份答错题数`} type="text" inputMode="numeric" maxLength={8}
          value={drafts.incorrect?.[index]?.text ?? String(request.incorrect)}
          aria-invalid={quantity.invalidIncorrect.includes(index)}
          aria-describedby={quantity.invalidIncorrect.includes(index) ? errorId : undefined} disabled={busy}
          onChange={event => onEdit(index, event.target.value)}
          onKeyDown={event => key(event, index, drafts.incorrect?.[index]?.text ?? String(request.incorrect), request.incorrect)}
        /></label>
        <span className="pdf-copy-correct" aria-label={`第${index + 1}份答对题数`}>对 {request.correct} 题</span>
        <label className="pdf-field pdf-copy-remark"><span className="pdf-sr-only">备注</span><input aria-label={`第${index + 1}份备注`} type="text" maxLength={MAX_BATCH_PRINT_REMARK_CHARACTERS} value={request.remark ?? ''} placeholder="备注（选填）" disabled={busy} onChange={event => onRemark(index, event.target.value)} /></label>
      </div>)}
    </div>
    <details className="pdf-disclosure"><summary>逐题参照答案与错误作答</summary><div className="pdf-disclosure-content">
      <p className="pdf-note">可覆盖导出参照作答；非选择题可填写错误作答，留空以未作答计错。未保存的答案保持空白，不自动补答。</p>
      {questions.map(question => {
        const saved = references.find(item => item.key === question.key);
        const value = question.validOptions.length ? saved?.referenceOptions !== undefined ? saved.referenceOptions?.join('、') ?? '' : question.candidate?.selectedOptions?.join('、') ?? '' : saved?.referenceAnswer !== undefined ? saved.referenceAnswer ?? '' : question.candidate?.answer ?? '';
        return <div className="pdf-reference-row" key={question.key}>
          <label className="pdf-field">第 {question.ordinal} 题{question.baselineWrong ? ' · 原标红' : ''}<input aria-label={`第${question.ordinal}题参照答案`} value={value} disabled={busy} placeholder={question.validOptions.length ? (question.printOptions ?? question.validOptions).length ? `选项 ${(question.printOptions ?? question.validOptions).join('/')}` : '待核对选项' : '填写参照作答'} onChange={event => reference(question, event.target.value)} /></label>
          {!question.validOptions.length && <label className="pdf-field">错误作答<input aria-label={`第${question.ordinal}题错误作答`} value={saved?.wrongAnswer ?? ''} disabled={busy} onChange={event => reference(question, event.target.value, true)} /></label>}
        </div>;
      })}
    </div></details>
  </section>;
}
