import type { BatchPrintSnapshot, BatchPrintQuestion, BatchPrintCopy } from '@solveflow/contracts/local';
import { subjectLabel } from '@solveflow/contracts/http';
import { MathText } from './math-text';
import type { PrintImages } from './batch-print-document';
import type { PrintLayouts, PrintAsset } from '../local/batch-print-presentation.web';

function Asset({ asset, images }: { asset: PrintAsset; images: PrintImages }) {
  const image = images[asset.key];
  if (!image) return <p className="print-warning">图示无法读取，请重新整理后导出。</p>;
  return <figure data-pdf-block className={`print-copy-figure ${asset.role === 'option' ? 'option-figure' : ''}`}><img src={image} alt={asset.alt} />{asset.role === 'source' && <figcaption>原题图 · 识别待核对</figcaption>}</figure>;
}
/** Exported answers are copies; source candidates and their verification are never rewritten. */
export function BatchCopyDocument(props: { snapshot: BatchPrintSnapshot; questions: BatchPrintQuestion[]; layouts: PrintLayouts; images: PrintImages } & ({ mode: 'questions'; copy?: never } | { mode?: 'answers'; copy: BatchPrintCopy })) {
  const { snapshot, questions, layouts, images } = props; const copy = props.mode === 'questions' ? null : props.copy;
  return <main className="batch-print-document print-copy-document" data-testid="batch-copy-document" data-pdf-content={copy ? 'answers' : 'questions'}>
    <header className="print-copy-heading" data-pdf-block><p className="print-eyebrow">SOLVEFLOW · {copy ? `作答副本 ${String(copy.copyIndex).padStart(2, '0')}` : '题目'}</p><h1>{snapshot.batch.title}</h1><p>{copy ? `总 ${copy.total} 题 · 对 ${copy.correct} 题 · 错 ${copy.incorrect} 题` : `总 ${questions.length} 题`}</p>{copy && <p className="print-copy-note">对错数量按本次导出设置统计。</p>}</header>
    {questions.map(question => {
      const answer = copy?.answers.find(item => item.key === question.key); const layout = layouts[question.key];
      const problem = layout?.problem ?? question.candidate.problem; const assets = layout?.assets ?? [];
      return <article key={question.key} className="print-copy-question" data-testid="copy-question" data-pdf-block>
        <h2>{question.ordinal}. <span>{subjectLabel(problem.subject)}</span></h2><div data-pdf-block><MathText text={problem.text} /></div>
        {assets.filter(asset => asset.role !== 'option').map(asset => <Asset key={asset.key} asset={asset} images={images} />)}
        {problem.options && <ol className="print-copy-options">{problem.options.map(option => <li key={option.label} data-pdf-block><div className="print-copy-option-text"><strong>{option.label}.</strong><MathText text={option.text} /></div>{assets.filter(asset => asset.role === 'option' && asset.optionLabel === option.label).map(asset => <Asset key={asset.key} asset={asset} images={images} />)}</li>)}</ol>}
        {layout?.warnings.map(warning => <p key={warning} className="print-warning">{warning}</p>)}
        {copy && <div className="print-copy-answer" data-pdf-block data-testid="copy-answer" data-adjusted={answer?.changed ? 'true' : 'false'}><strong>作答：</strong>{answer?.selectedOptions ? <span>{answer.selectedOptions.join('、')}</span> : answer?.answer ? <MathText text={!answer.changed && question.candidate.responseValue ? question.candidate.responseValue : answer.answer} /> : <span>未作答</span>}</div>}
      </article>;
    })}
  </main>;
}
