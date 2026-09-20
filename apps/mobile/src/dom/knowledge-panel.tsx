import type { AnswerCandidate } from "@solveflow/contracts/agent";
import { useState } from 'react';
import type { AnswerDocumentPayload } from '@solveflow/client';
import { MathText } from "./math-text";

/** Knowledge points load on demand; the saved answer keeps rendering while they generate. */
export function KnowledgePanel({ candidate, knowledge, disabled, onAsk, onRequest, onCancel }: {
  candidate: AnswerCandidate; knowledge: AnswerDocumentPayload['knowledge']; disabled: boolean;
  onAsk: (name: string) => void; onRequest: () => Promise<void>; onCancel: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [requesting, setRequesting] = useState(false);
  const result = knowledge?.outcome;
  const pending = requesting || !!knowledge && result === null;
  const source = result?.status === 'completed' ? result.candidate : candidate;
  const names = [...new Set([...(source.knowledgeDetails ?? []).map(point => point.name), ...source.knowledgePoints])];
  async function request() {
    if (disabled || pending || result?.status === 'completed') return;
    setRequesting(true);
    try { await onRequest(); } finally { setRequesting(false); }
  }
  if (names.length && !pending) return <section className="knowledge-panel reading-card" aria-label="本题知识点"><h3>知识点</h3>
    {names.map(name => { const detail = source.knowledgeDetails?.find(point => point.name === name);
      return <details key={name}><summary><MathText text={name} /><svg className="knowledge-chevron" viewBox="0 0 20 20" width="20" height="20" aria-hidden="true"><path d="m7 4 6 6-6 6" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg></summary><div className="knowledge-detail">
        {detail ? <><h5>是什么</h5><MathText text={detail.explanation} /><h5>本题怎么用</h5><MathText text={detail.application} />{detail.pitfall && <><h5>注意什么</h5><MathText text={detail.pitfall} /></>}</> : <p>可以结合本题追问定义、用法或易错点。</p>}
        <button className="context-button" disabled={disabled} onClick={() => onAsk(name)}>追问这个知识点</button>
      </div></details>;
    })}
  </section>;
  return <details className="knowledge-toggle reading-card" open={open}>
    <summary aria-label="知识点" onClick={event => { event.preventDefault(); const next = !open; setOpen(next); if (next && !knowledge) void request(); }}>
      <span>知识点</span><span>{pending ? '生成中' : open ? '收起' : '展开'}</span>
    </summary>
    {open && <div>
      {pending ? <div className="steps-wait" role="status"><span className="steps-wait-dot" />正在整理知识点…<button onClick={() => void onCancel()}>取消</button></div>
        : <>{result && result.status !== 'completed' && <p role="alert">{result.status === 'needs_clarification' ? result.candidate.clarificationQuestions.join('；') : result.error.message}</p>}
          <button disabled={disabled} onClick={() => void request()}>{result ? '重新生成知识点' : '查看知识点'}</button></>}
    </div>}
  </details>;
}
