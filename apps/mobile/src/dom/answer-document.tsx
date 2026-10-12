'use dom';
import { ReadingMemory, type ReadingState } from './reading-state';
import { OnDemandSteps } from './on-demand-steps';
import { useDocumentHeight } from './use-document-height';
import { useQuestionSwipe } from './use-question-swipe';
import { useEffect, useMemo, useState } from 'react';
import { decodeAnswerDocument, verificationFeedback } from '@solveflow/client/presentation';
import { subjectLabel, type RunContext } from '@solveflow/contracts/http';
import { AnswerContent } from './answer-content';
import { ProblemStatement } from './problem-statement';
import { KnowledgePanel } from './knowledge-panel';
import { MathText } from './math-text';
import '../../.generated/katex.css';
import './answer.css';
import './theme.css';
import { useDocumentTheme, type DocumentTheme } from './document-theme';
/** Only validated answer data and a decoded authorized image enter this local document. */
export default function AnswerDocument({ theme = 'light', payload, onFocus, onCorrect, onReady, onViewOriginal, onRegenerate, onPageSwipe, onRequestSteps, onCancelSteps, onRequestKnowledge, onCancelKnowledge, onHeight, onHistory, onVerify, onDiagnostics, onShareOriginal, initialReadingState, onReadingState }: {
  initialReadingState?: ReadingState | undefined;
  onReadingState?: ((value: ReadingState) => Promise<void>) | undefined;
  onShareOriginal?: (() => Promise<void>) | undefined;
  onVerify?: (() => Promise<void>) | undefined;
  onDiagnostics?: (() => Promise<void>) | undefined;
  onHistory?: (() => Promise<void>) | undefined;
  onHeight?: ((height: number) => Promise<void>) | undefined;
  onRequestSteps?: (() => Promise<void>) | undefined; onCancelSteps?: (() => Promise<void>) | undefined;
  onRequestKnowledge?: (() => Promise<void>) | undefined; onCancelKnowledge?: (() => Promise<void>) | undefined;
  onPageSwipe?: ((direction: number) => Promise<void>) | undefined;
  dom?: import('expo/dom').DOMProps;
  payload: string; theme?: DocumentTheme;
  onFocus: (context: RunContext, label: string) => Promise<void>;
  onCorrect: () => Promise<void>;
  onReady: () => Promise<void>;
  onViewOriginal: () => Promise<void>;
  onRegenerate: () => Promise<void>;
}) {
  useDocumentTheme(theme);
  const [reading, setReading] = useState<ReadingState>(() => initialReadingState ?? {});
  const readingMemory = useMemo(() => ({ state: reading, update(key: string, open: boolean) {
    const value = { ...reading, [key]: open }; setReading(value); void onReadingState?.(value);
  } }), [reading, onReadingState]);
  const swipeRoot = useQuestionSwipe(onPageSwipe);
  useDocumentHeight(swipeRoot, onHeight);
  const { explanation, knowledge, outcome: result, image, width, height, runId, number, disabled, showRegenerate, showHistory, verificationPending, verificationFailed, verificationErrorCode } = useMemo(() => decodeAnswerDocument(payload), [payload]);
  useEffect(() => {
    // A React commit is not a Chromium paint. Let the document render across
    // two browser frames before the native pager exposes its WebView surface.
    // Native requestAnimationFrame runs on a different clock and cannot provide
    // this guarantee. Do not wait for fonts: hidden WebViews may defer them.
    let frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(() => { void onReady(); });
    });
    return () => cancelAnimationFrame(frame);
  }, [payload, onReady]);
  if (result.status !== 'completed' && result.status !== 'needs_clarification') return null;
  const detailResult = explanation?.outcome?.status === 'completed' ? explanation.outcome : null;
  const candidate = result.candidate; const original = image ?? undefined;
  const feedback = verificationFeedback(result, verificationErrorCode);
  return <ReadingMemory value={readingMemory}><article ref={swipeRoot} className="answer-document">
    <ProblemStatement onDiagnostics={onDiagnostics ? () => void onDiagnostics() : undefined} onShareOriginal={onShareOriginal} onHistory={showHistory && onHistory ? () => void onHistory() : undefined} problem={candidate.problem} image={original} imageSize={{ width, height }} onViewOriginal={() => void onViewOriginal()} onCorrect={() => void onCorrect()} onRegenerate={showRegenerate ? () => void onRegenerate() : undefined} disabled={disabled} />
    {result.status === 'completed' ? <>
      {feedback && <section className="unverified-note" aria-label="校验说明"><strong>{feedback.title}</strong><p>{feedback.reason}</p>{feedback.issues.map((issue, i) => <div key={i}><strong>{issue.label}</strong><MathText text={issue.message} /></div>)}<p>{feedback.next}</p></section>}
      <AnswerContent verificationNotRequested={!verificationPending && result.verificationStatus === 'not_requested'} onVerify={onVerify ? () => void onVerify() : undefined} verificationLabel={verificationPending ? '校验中' : verificationFailed ? '重试校验' : result.verified ? '校验通过' : result.verification ? result.verification.verdict === 'fail' ? '发现问题' : '无法确认' : '校验'} verificationDisabled={disabled || !!verificationPending || result.verified || !!result.verification} hideSteps={!result.candidate.steps.length && !!onRequestSteps} candidate={result.candidate} subject={subjectLabel(candidate.problem.subject)} originalImageUrl={original} disabled={disabled}
        onAskStep={(step, label) => void onFocus({ kind: 'step', sourceRunId: runId, stepId: step.id }, label)}
        onAskQuestion={value => void onFocus({ kind: 'question', sourceRunId: runId, number: value }, `第${value}题`)} />
      {!result.candidate.steps.length && onRequestSteps && <OnDemandSteps originalImageUrl={original} explanation={explanation} disabled={disabled} onRequest={onRequestSteps} onCancel={onCancelSteps ?? (async () => {})} onFocus={onFocus} />}
      <KnowledgePanel candidate={detailResult?.candidate ?? result.candidate} knowledge={knowledge} disabled={disabled} onAsk={name => void onFocus({ kind: 'knowledge', sourceRunId: knowledge?.runId ?? (detailResult ? explanation!.runId : runId), name, ...(detailResult || number === null ? {} : { number }) }, `知识点：${name}`)} onRequest={onRequestKnowledge ?? (async () => {})} onCancel={onCancelKnowledge ?? (async () => {})} />
    </> : <div className="clarification reading-card">{candidate.clarificationQuestions.map(question => <MathText key={question} text={question} />)}</div>}
  </article></ReadingMemory>;
}
