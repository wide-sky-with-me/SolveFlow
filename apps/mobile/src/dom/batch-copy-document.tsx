import type { BatchPrintSnapshot, BatchPrintProblem, BatchPrintQuestion, BatchPrintCopy } from '@solveflow/contracts/local';
import { subjectLabel } from '@solveflow/contracts/http';
import { MathText } from './math-text';
import type { PrintImages } from './batch-print-document';
import type { PrintLayouts, PrintAsset } from '../local/batch-print-presentation.web';

function Asset({ asset, images }: { asset: PrintAsset; images: PrintImages }) {
  const image = images[asset.key];
  if (!image) return <p className="print-warning">图示尚待整理。</p>;
  return <figure className={`print-copy-figure ${asset.role === 'option' ? 'option-figure' : ''}`} data-source-kind={asset.role}><img src={image} alt={asset.alt} />{asset.role === 'source' && <figcaption>保存的原题图</figcaption>}</figure>;
}
type PrintOption = NonNullable<NonNullable<BatchPrintProblem['problem']>['options']>[number];
function Option({ option, assets, images }: { option: PrintOption; assets: PrintAsset[]; images: PrintImages }) {
  const figures = assets.filter(asset => asset.role === 'option' && asset.optionLabel === option.label);
  const caption = option.text.trim().replace(/[.。]$/, '').toLowerCase();
  const diagramOnly = figures.length > 0 && (caption === '见选项图' || caption === `circuit diagram ${option.label.toLowerCase()}`);
  return <li className={diagramOnly ? 'diagram-only' : undefined} aria-label={diagramOnly ? `${option.label}. ${option.text}` : undefined}>
    <div className="print-copy-option-text"><strong>{option.label}.</strong>{!diagramOnly && <MathText text={option.text} inlineDisplayStyle />}</div>
    {figures.map(asset => <Asset key={asset.key} asset={asset} images={images} />)}
  </li>;
}

/** Every question owns one page; answer fields are inaccessible in the pure projection. */
export function BatchCopyDocument(props: { snapshot: BatchPrintSnapshot; problems: BatchPrintProblem[]; layouts: PrintLayouts; images: PrintImages } & ({ mode: 'questions'; copy?: never; questions?: never } | { mode?: 'answers'; copy: BatchPrintCopy; questions: BatchPrintQuestion[] })) {
  const { snapshot, problems, layouts, images } = props;
  const copy = props.mode === 'questions' ? null : props.copy;
  return <main className="batch-print-document print-copy-document" data-testid="batch-copy-document" data-pdf-content={copy ? 'answers' : 'questions'}>
    {problems.map(question => {
      const answer = copy?.answers.find(item => item.key === question.key);
      const original = props.mode === 'questions' ? undefined : props.questions.find(item => item.key === question.key);
      const layout = layouts[question.key];
      const problem = layout?.problem ?? question.problem;
      const assets = layout?.assets ?? [];
      const figures = assets.filter(asset => asset.role !== 'option');
      const reviewNotes = [
        problem?.uncertainties.length ? `识别待核对：${problem.uncertainties.join('；')}` : '',
        layout?.warnings.length ? `整理待核对：${layout.warnings.join('；')}` : '',
      ].filter(Boolean);
      return <article key={question.key} className="print-copy-question print-question-page" data-testid="copy-question" data-pdf-question={question.ordinal}>
        <header className="print-page-heading"><span>QUESTION {String(question.ordinal).padStart(2, '0')}</span><h2>第 {question.ordinal} 题</h2><span>{problem ? subjectLabel(problem.subject) : ''}</span></header>
        <div className="print-page-body"><div className="print-page-inner">
          {problem ? <>
            <div className="print-page-stem"><MathText text={problem.text} /></div>
            {!!figures.length && <div className={`print-page-diagrams ${figures.length > 1 ? 'multiple' : ''}`}>{figures.map(asset => <Asset key={asset.key} asset={asset} images={images} />)}</div>}
            {problem.options && <ol className={`print-copy-options${assets.some(asset => asset.role === 'option') ? ' has-diagrams' : ''}`}>{problem.options.map(option => <Option key={option.label} option={option} assets={assets} images={images} />)}</ol>}
          </> : <p className="print-warning">题干尚待提取。</p>}
          {!!reviewNotes.length && <div className="print-warning">{reviewNotes.map(text => <MathText key={text} text={text} />)}</div>}
          {copy && <div className="print-copy-answer" data-testid="copy-answer" data-adjusted={answer?.changed ? 'true' : 'false'}><strong>作答：</strong>{answer?.selectedOptions ? <span>{answer.selectedOptions.join('、')}</span> : answer?.answer ? <MathText text={!answer.changed && original?.candidate.responseValue ? original.candidate.responseValue : answer.answer} /> : <span>未作答</span>}</div>}
          {answer && !answer.changed && answer.selectedOptions?.some(label => !problem?.options?.some(option => option.label === label)) && <p className="print-warning">原作答选项未见于整理内容，请核对；原回答保留。</p>}
        </div></div>
        <footer className="print-page-footer"><span>{snapshot.batch.title}</span><span>{copy ? `第${String(copy.copyIndex).padStart(2, '0')}份 · 对${copy.correct} / 错${copy.incorrect}` : '题目'} · {question.ordinal} / {problems.length}</span></footer>
      </article>;
    })}
  </main>;
}
