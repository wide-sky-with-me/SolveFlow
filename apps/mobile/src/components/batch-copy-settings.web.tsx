import type { BatchPrintCopyRequest, BatchPrintQuestion, BatchPrintReference } from '@solveflow/contracts/local';
import { MAX_BATCH_PRINT_COPIES } from '@solveflow/contracts/local';
import { BatchPdfDialog } from './batch-pdf-dialog.web';
import { Button, Notice } from './ui';

export function BatchCopySettings({ questions, requests, references, error, onRequests, onReferences, onClose, onApply }: { questions: BatchPrintQuestion[]; requests: BatchPrintCopyRequest[]; references: BatchPrintReference[]; error: string; onRequests: (value: BatchPrintCopyRequest[]) => void; onReferences: (value: BatchPrintReference[]) => void; onClose: () => void; onApply: () => void }) {
  const total = questions.length; const wrong = questions.filter(question => question.baselineWrong).length;
  function count(value: number) {
    if (!Number.isInteger(value) || value < 1 || value > MAX_BATCH_PRINT_COPIES) return;
    onRequests(Array.from({ length: value }, (_, index) => requests[index] ?? { correct: total - wrong, incorrect: wrong }));
  }
  function update(index: number, value: number, correct: boolean) { onRequests(requests.map((request, position) => position === index ? { correct: correct ? value : total - value, incorrect: correct ? total - value : value } : request)); }
  function reference(question: BatchPrintQuestion, value: string, wrongAnswer = false) {
    const previous = references.find(item => item.key === question.key) ?? { key: question.key };
    const next: BatchPrintReference = wrongAnswer ? { ...previous, wrongAnswer: value } : question.validOptions.length ? { ...previous, referenceOptions: value.trim() ? value.toUpperCase().split(/[、,\s]+/).filter(Boolean) : null } : { ...previous, referenceAnswer: value.trim() || null };
    onReferences([...references.filter(item => item.key !== question.key), next]);
  }
  return <BatchPdfDialog title="批量导出设置" closeLabel="关闭设置" onClose={onClose} footer={<><Button title="取消设置" compact secondary onPress={onClose} /><Button title="应用导出设置" compact disabled={!!error} onPress={onApply} /></>}>
    <p className="pdf-counts">共 {total} 题 · 原作答对 {total - wrong} 题、错 {wrong} 题</p>
    <p className="pdf-note">除原校验红色警告外，按原作答计对。调整只改变导出副本。</p>
    <label className="pdf-field pdf-copy-field" style={{ marginTop: 16 }}>导出份数<input aria-label="导出份数" type="number" min={1} max={MAX_BATCH_PRINT_COPIES} value={requests.length} onChange={event => count(Number(event.target.value))} /></label>
    <div>{requests.map((request, index) => <div className="pdf-copy-row" key={index}><strong>第 {index + 1} 份</strong><label className="pdf-field">答对<input aria-label={`第${index + 1}份答对题数`} type="number" min={0} max={total} value={request.correct} onChange={event => update(index, Number(event.target.value), true)} /></label><label className="pdf-field">答错<input aria-label={`第${index + 1}份答错题数`} type="number" min={0} max={total} value={request.incorrect} onChange={event => update(index, Number(event.target.value), false)} /></label></div>)}</div>
    <details className="pdf-disclosure"><summary>逐题参照答案与错误作答</summary><div className="pdf-disclosure-content"><p className="pdf-note">减少原有红色警告题的错误数前，须填写参照答案。非选择题未填写错误作答时留空并计错。</p>
      {questions.map(question => { const saved = references.find(item => item.key === question.key); const value = question.validOptions.length ? saved?.referenceOptions !== undefined ? saved.referenceOptions?.join('、') ?? '' : question.baselineWrong ? '' : question.candidate.selectedOptions?.join('、') ?? '' : saved?.referenceAnswer !== undefined ? saved.referenceAnswer ?? '' : question.baselineWrong ? '' : question.candidate.answer;
        return <div className="pdf-reference-row" key={question.key}><label className="pdf-field">第 {question.ordinal} 题{question.baselineWrong ? ' · 原红色警告' : ''}<input aria-label={`第${question.ordinal}题参照答案`} value={value} placeholder={question.validOptions.length ? `选项 ${question.validOptions.join('/')}` : '填写参照作答'} onChange={event => reference(question, event.target.value)} /></label>{!question.validOptions.length && <label className="pdf-field">错误作答<input aria-label={`第${question.ordinal}题错误作答`} value={saved?.wrongAnswer ?? ''} onChange={event => reference(question, event.target.value, true)} /></label>}</div>;
      })}
    </div></details>{!!error && <Notice text={error} error />}
  </BatchPdfDialog>;
}
