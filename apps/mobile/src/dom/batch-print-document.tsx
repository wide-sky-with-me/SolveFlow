import type { BatchPrintSnapshot, LocalRecord } from '@solveflow/contracts/local';
import { EXAM_LABELS } from '@solveflow/contracts/local';
import { isAuxiliaryContext, subjectLabel, type RunView } from '@solveflow/contracts/http';
import { questionConversations } from '@solveflow/client/learning';
import { formatHistoryTime, verificationFeedback } from '@solveflow/client/presentation';
import { AnswerContent, TeachingSteps } from './answer-content';
import { MathText } from './math-text';
import { ReadingMemory } from './reading-state';

import { printImageKey, recordPrintImages, type PrintImages } from '../local/batch-print-images';
export { printImageKey, recordPrintImages, type PrintImages } from '../local/batch-print-images';
function PrintedAnswer({ run, runs }: { run: RunView; runs: RunView[] }) {
  const check = runs.findLast(item => item.context?.kind === 'verification' && item.context.sourceRunId === run.id);
  const result = check?.outcome?.status === 'completed' ? check.outcome : run.outcome;
  if (!result) return <p className="print-warning">尚无已保存的 AI 回答。</p>;
  if (result.status !== 'completed' && result.status !== 'needs_clarification') return <p className="print-warning">{result.status === 'cancelled' ? '本次解题已取消。' : `本次解题失败：${result.error.message}`}</p>;
  const candidate = result.candidate; const feedback = verificationFeedback(result);
  const explanation = runs.findLast(item => item.context?.kind === 'explanation' && item.context.sourceRunId === run.id && item.outcome?.status === 'completed');
  const knowledge = runs.findLast(item => item.context?.kind === 'knowledge-list' && item.context.sourceRunId === run.id && item.outcome?.status === 'completed');
  const knowledgeCandidate = knowledge?.outcome?.status === 'completed' ? knowledge.outcome.candidate : explanation?.outcome?.status === 'completed' ? explanation.outcome.candidate : candidate;
  const knowledgeDetails = knowledgeCandidate.kind === 'answer' ? knowledgeCandidate.knowledgeDetails ?? [] : [];
  const knowledgeNames = [...new Set([...knowledgeDetails.map(detail => detail.name), ...knowledgeCandidate.knowledgePoints])];
  return <>
    <section className="print-section"><h3>题目 · AI 识别文本</h3><MathText text={candidate.problem.text} />
      {candidate.problem.options && <ol className="print-options">{candidate.problem.options.map(option => <li key={option.label}><strong>{option.label}</strong><MathText text={option.text} /></li>)}</ol>}
      {!!candidate.problem.uncertainties.length && <p className="print-warning">识别待核对：{candidate.problem.uncertainties.join('；')}</p>}
    </section>
    <section className="print-section print-response"><h3>AI 回答 <span className={`print-status ${result.status === 'completed' && result.verified ? 'checked' : ''}`}>{result.status === 'needs_clarification' ? '待补充条件' : result.verified ? '校验通过' : result.verificationStatus === 'pending' ? '校验未完成' : result.verification?.verdict === 'fail' ? '校验发现问题' : '未确认'}</span></h3>
      {result.status === 'completed' ? <AnswerContent candidate={result.candidate} subject={subjectLabel(candidate.problem.subject)} /> : candidate.clarificationQuestions.map(question => <MathText key={question} text={question} />)}
      {feedback && <aside className="print-warning"><strong>{feedback.title}</strong><p>{feedback.reason}</p>{feedback.issues.map((issue, index) => <p key={index}>{issue.label}：{issue.message}</p>)}</aside>}
      {explanation?.outcome?.status === 'completed' && !!explanation.outcome.candidate.steps.length && <section><h4>已保存的详细步骤</h4><TeachingSteps steps={explanation.outcome.candidate.steps} /></section>}
      {!!knowledgeNames.length && <section><h4>已保存的知识点</h4>{knowledgeNames.map(name => { const detail = knowledgeDetails.find(item => item.name === name); return <div key={name}><h5><MathText text={name} inlineMathCode /></h5>{detail && <><MathText text={detail.explanation} inlineMathCode /><MathText text={detail.application} inlineMathCode />{detail.pitfall && <MathText text={detail.pitfall} inlineMathCode />}</>}</div>; })}</section>}
    </section>
  </>;
}
export function BatchPrintDocument({ snapshot, images }: { snapshot: BatchPrintSnapshot; images: PrintImages }) {
  return <ReadingMemory value={{ state: { steps: true }, update() {} }}><main className="batch-print-document" data-testid="batch-print-document">
    <header className="print-cover"><div className="print-brand">SOLVEFLOW <span>学习记录</span></div><div className="print-cover-line" /><p className="print-eyebrow">BATCH REVIEW · {EXAM_LABELS[snapshot.batch.exam]}</p><h1>{snapshot.batch.title}</h1><p className="print-cover-subtitle">题目原图 · 识别题干 · AI 回答</p><div className="print-cover-meta"><span>{snapshot.records.length} 张题图</span><span>{formatHistoryTime(snapshot.batch.createdAt)}</span></div><p className="print-cover-note">本册整理已保存的回答与校验状态。AI 识别题干请与原图核对；图像整理仅用于阅读，应用内原图保持不变。</p>
      <nav className="print-index" aria-label="批次目录">{snapshot.records.map((record, index) => <a key={record.session.id} href={`#print-question-${record.session.id}`}>{String(index + 1).padStart(2, '0')} <span>{subjectLabel(record.session.subject)}</span></a>)}</nav>
    </header>
    {snapshot.records.map((record, index) => <article className="print-question" key={record.session.id} id={`print-question-${record.session.id}`} data-testid="printed-question"><header className="print-question-heading"><span>QUESTION {String(index + 1).padStart(2, '0')}</span><h2>第 {index + 1} 张题图</h2><span>{subjectLabel(record.session.subject)}</span></header>
      <div className="print-question-body"><section className="print-section print-originals"><h3>原题图 · 阅读副本</h3>{recordPrintImages(record, 'history').map((source, number) => <figure key={source.id}><img src={images[printImageKey(record.session.id, source.id)] ?? source.image} alt={`第${index + 1}张题图${number ? `补图${number}` : '原图'}`} /><figcaption>{number ? `补图 ${number}` : '原图'} · 应用内源文件保留</figcaption></figure>)}</section><div className="print-written">
      {questionConversations(record.session.runs).map(thread => { const run = thread.runs.findLast(item => !isAuxiliaryContext(item.context?.kind)); return run ? <div key={thread.key}>{thread.number !== undefined && <h3>第 {thread.number} 题</h3>}<PrintedAnswer run={run} runs={thread.runs} /></div> : null; })}
      {!record.session.runs.length && <p className="print-warning">尚未解题，只有已保存原图。</p>}</div></div>
    </article>)}
  </main></ReadingMemory>;
}
