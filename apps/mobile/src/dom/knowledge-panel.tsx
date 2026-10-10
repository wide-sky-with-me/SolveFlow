import { ReadingDetails, useReadingDisclosure } from './reading-state';
import type { AnswerCandidate } from "@solveflow/contracts/agent";
import { useState } from 'react';
import type { AnswerDocumentPayload } from '@solveflow/client/presentation';
import { MathText } from "./math-text";

/** Knowledge points load on demand; the saved answer keeps rendering while they generate. */
export function KnowledgePanel({ candidate, knowledge, disabled, onAsk, onRequest, onCancel }: {
  candidate: AnswerCandidate; knowledge: AnswerDocumentPayload['knowledge']; disabled: boolean;
  onAsk: (name: string) => void; onRequest: () => Promise<void>; onCancel: () => Promise<void>;
}) {
  const [open, setOpen] = useReadingDisclosure('knowledge');
  const [requesting, setRequesting] = useState(false);
  const result = knowledge?.outcome;
  const pending = requesting || !!knowledge && result === null;
  const source = result?.status === 'completed' ? result.candidate : candidate;
  const names = [...new Set([...(source.knowledgeDetails ?? []).map(point => point.name), ...source.knowledgePoints])];
  const needsDetails = names.some(name => !source.knowledgeDetails?.some(point => point.name === name));
  async function request() {
    if (disabled || pending || result?.status === 'completed') return;
    setOpen(true);
    setRequesting(true);
    try { await onRequest(); } finally { setRequesting(false); }
  }
  if (names.length && !pending) return <section className="knowledge-panel reading-card" aria-label="本题知识点"><h3>知识点</h3>
    {needsDetails && result?.status !== 'completed' && <>
      {result && <p role="alert">{result.status === 'needs_clarification' ? result.candidate.clarificationQuestions.join('；') : result.error.message}</p>}
      <button disabled={disabled} onClick={() => void request()}>{result ? '重新生成知识点' : '生成知识点讲解'}</button>
    </>}
    {names.map(name => { const detail = source.knowledgeDetails?.find(point => point.name === name);
      return <ReadingDetails key={name} stateKey={`knowledge:${name}`}><summary><MathText text={name} inlineMathCode /><svg className="knowledge-chevron" viewBox="0 0 20 20" width="20" height="20" aria-hidden="true"><path d="m7 4 6 6-6 6" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg></summary><div className="knowledge-detail">
        {detail && <><h5>是什么</h5><MathText text={detail.explanation} inlineMathCode /><h5>本题怎么用</h5><MathText text={detail.application} inlineMathCode />{detail.pitfall && <><h5>注意什么</h5><MathText text={detail.pitfall} inlineMathCode /></>}</>}
        <button className="context-button" disabled={disabled} onClick={() => onAsk(name)}>追问这个知识点</button>
      </div></ReadingDetails>;
    })}
  </section>;
  return <details className="knowledge-toggle reading-card" open={open}>
    <summary aria-label="知识点" onClick={event => { event.preventDefault(); const next = !open; setOpen(next); if (next && !knowledge) void request(); }}>
      <span>知识点</span><span>{pending ? '生成中' : open ? '收起' : '展开'}</span>
    </summary>
    {open && <div>
      {pending ? <div className="steps-wait" role="status"><span className="steps-wait-dot" />正在整理知识点…<button onClick={() => void onCancel()}>取消</button></div>
        : <>{result && result.status !== 'completed' && <p role="alert">{result.status === 'needs_clarification' ? result.candidate.clarificationQuestions.join('；') : result.error.message}</p>}
          {disabled && <p role="status">当前任务尚未结束或模型未配置，暂时无法生成知识点。</p>}
          <button disabled={disabled} onClick={() => void request()}>{result ? '重新生成知识点' : '查看知识点'}</button></>}
    </div>}
  </details>;
}
