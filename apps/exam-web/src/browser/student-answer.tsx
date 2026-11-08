import { useEffect, useState } from 'react';
import { ExamDetailSchema, type ExamSlot } from '@solveflow/contracts/managed-exam';
import { z } from 'zod';
import { AnswerSummary } from './answer-summary.js';
import { Icon } from '@solveflow/web-ui/icons';
import { api } from './api.js';
import { activeStatuses, ErrorText, statusLabels } from './components.js';
import { QuestionContent } from './question-content.js';

type Detail = z.infer<typeof ExamDetailSchema>;
function sameMaterial(detail: Detail, slot: ExamSlot) {
    return detail.slot.id === slot.id && detail.slot.revision === slot.revision && detail.slot.runId === slot.runId && detail.slot.reviewId === slot.reviewId;
}

// Decision: .agents/notes/implemented/architecture/2026-11-05-student-manual-navigation.md
// Decision: .agents/notes/implemented/architecture/2026-11-07-early-answer-publish.md
export function StudentAnswer({ slot, onSync }: { slot: ExamSlot; onSync: () => Promise<unknown> }) {
    const active = activeStatuses.has(slot.status), answer = slot.presentation;
    // The solver answer is shown while the verifier still runs; the badge keeps it honest.
    const provisional = !answer && slot.draft ? { answer: slot.draft.answer, selectedOptions: slot.draft.selectedOptions, verified: false, simulated: false, humanConfirmed: false } : null;
    const shown = answer ?? provisional;
    const key = JSON.stringify([slot.id, slot.revision, slot.runId, slot.reviewId, active ? 'active' : slot.status, answer, provisional?.answer ?? null]);
    const [resource, setResource] = useState<{ key: string; detail: Detail | null; error: string }>({ key: '', detail: null, error: '' });
    const [retry, setRetry] = useState(0);
    const [expanded, setExpanded] = useState(false);
    const needsDetail = expanded || !!shown?.selectedOptions?.length;
    useEffect(() => {
        if (!needsDetail || !slot.revision || active && !shown) return;
        const controller = new AbortController();
        void api('/slots/' + slot.id, ExamDetailSchema, { signal: controller.signal }).then(detail => {
            if (controller.signal.aborted) return;
            if (!sameMaterial(detail, slot)) { void onSync(); return; }
            setResource({ key, detail, error: '' });
        }).catch(error => {
            if (!controller.signal.aborted) setResource({ key, detail: null, error: error instanceof Error ? error.message : '读取题目失败。' });
        });
        return () => controller.abort();
        // Share the current version's detail between the choice preview and disclosure; polling/expanding must not refetch it.
    }, [key, retry, onSync, needsDetail]);
    const detail = resource.key === key && resource.detail && sameMaterial(resource.detail, slot) ? resource.detail : null;
    const error = resource.key === key ? resource.error : '';
    return <section className="current-answer answer-card" aria-label={'第' + slot.position + '题答案'}>
      <div className="section-head"><h3>第{slot.position}题答案</h3>{active ? <span className="badge blue" role="status">{statusLabels[slot.status]}</span> : answer && !answer.simulated && <span className={'badge ' + (answer.verified ? 'green' : '')}>{answer.humanConfirmed ? '老师已确认' : answer.verified ? 'AI 已核验' : '待核验'}</span>}</div>
      {shown ? <><AnswerSummary answer={shown} options={detail?.problem?.options}/>{provisional && <p className="muted" role="status">校验中，最终结果可能调整。</p>}</> : !active && <p className="muted">本题尚无答案</p>}
      {!!slot.revision && <details className="answer-question-details" open={expanded} onToggle={event => setExpanded(event.currentTarget.open)}><summary>题目详情<Icon name="chevron-down"/></summary>
        {error ? <div className="inline-read-error"><ErrorText error={error}/><button className="quiet" onClick={() => setRetry(value => value + 1)}>重新读取题目</button></div> : !detail && <p className="muted" role="status">{active && !shown ? '正在处理本题…' : '正在读取题目…'}</p>}
        {detail?.problem && <QuestionContent problem={detail.problem} selectedOptions={shown?.selectedOptions ?? []}/>}
        {!!detail?.revisions.length && <details className="question-versions"><summary>题图版本</summary>{detail.revisions.map(version => <p key={version.revision}>第{version.revision}版 · {version.reason === 'initial' ? '首次拍摄' : version.reason === 'retake' ? '重拍' : '补图'}</p>)}</details>}
      </details>}
    </section>;
}
