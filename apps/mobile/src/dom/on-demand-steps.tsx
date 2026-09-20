import { answerText } from "@solveflow/contracts/agent";
import { useState } from 'react';
import type { AnswerDocumentPayload } from '@solveflow/client';
import type { RunContext } from '@solveflow/contracts/http';
import { TeachingSteps } from './answer-content';
import { AnswerFigure } from './answer-figure';
import { MathText } from './math-text';

/** The saved source answer stays mounted during the independent explanation run. */
export function OnDemandSteps({ explanation, disabled, onRequest, onCancel, onFocus, originalImageUrl }: {
  originalImageUrl?: string | undefined;
  explanation: AnswerDocumentPayload['explanation']; disabled: boolean;
  onRequest: () => Promise<void>; onCancel: () => Promise<void>;
  onFocus: (context: RunContext, label: string) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [requesting, setRequesting] = useState(false);
  const result = explanation?.outcome;
  const pending = requesting || !!explanation && result === null;
  async function request() {
    if (disabled || pending || result?.status === 'completed') return;
    setRequesting(true);
    try { await onRequest(); } finally { setRequesting(false); }
  }
  return <details className="step-details reading-card" open={open}>
    <summary aria-label="详细步骤" onClick={event => { event.preventDefault(); const next = !open; setOpen(next); if (next && !explanation) void request(); }}>
      <span>详细步骤</span><span>{pending ? '生成中' : open ? '收起' : '展开'}</span>
    </summary>
    {open && <div>
      {pending ? <div className="steps-wait" role="status"><span className="steps-wait-dot" />正在整理步骤…<button onClick={() => void onCancel()}>取消</button></div>
        : result?.status === 'completed' ? <>
          {!result.verified && result.verificationStatus !== 'not_requested' && <div className="unverified-note"><p>本次步骤尚未通过完整校验，请核对后使用。</p>{result.verification?.issues.map((issue, index) => <MathText key={index} text={issue.message} />)}</div>}
          <button className="verify-button" disabled={disabled || !!explanation?.verificationPending || result.verified || !!result.verification} onClick={() => void onFocus({ kind: 'verification', sourceRunId: explanation!.runId }, '校验步骤')}>{explanation?.verificationPending ? '校验中' : result.verified ? '校验通过' : result.verification ? result.verification.verdict === 'fail' ? '发现问题' : '无法确认' : '校验步骤'}</button>
          <MathText text={answerText(result.candidate)} originalImageUrl={originalImageUrl} />
          <TeachingSteps originalImageUrl={originalImageUrl} steps={result.candidate.steps} disabled={disabled} onAskStep={(step, label) => void onFocus({ kind: 'step', sourceRunId: explanation!.runId, stepId: step.id }, label)} />
          {result.candidate.figures?.map(figure => <AnswerFigure key={figure.id} figure={figure} />)}
        </> : <>
          {result && <p role="alert">{result.status === 'needs_clarification' ? result.candidate.clarificationQuestions.join('；') : result.error.message}</p>}
          <button disabled={disabled} onClick={() => void request()}>{result ? '重新生成步骤' : '查看详细步骤'}</button>
        </>}
    </div>}
  </details>;
}
