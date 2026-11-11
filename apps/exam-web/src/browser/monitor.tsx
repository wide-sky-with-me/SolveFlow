import { newRequestId } from './request-id.js';
import { ExamClock, EndExamButton } from './exam-clock.js';
// Decision: .agents/notes/implemented/architecture/2026-11-03-teacher-question-actions.md
// Decision: .agents/notes/implemented/architecture/2026-11-03-exam-answer-presentation.md
// Decision: .agents/notes/implemented/architecture/2026-11-03-exam-navigation-and-tracking.md
// Decision: .agents/notes/implemented/architecture/2026-11-03-durable-exam-reviews.md
import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { z } from 'zod';
import { MAX_ANSWER_CHARACTERS } from '@solveflow/contracts/agent';
import { ExamDetailSchema, formatExamChoiceAnswer, type ExamAttempt } from '@solveflow/contracts/managed-exam';
import { overviewClass, overviewState, slotState } from './slot-state.js';
import { SlotStateLegend } from './section-answers.js';
import { RichText } from './rich-text.js';
import { AnswerSummary } from './answer-summary.js';
import { api, idResponse, post } from './api.js';
import { activeStatuses, Dialog, ErrorText, statusLabels, VerificationAlerts } from './components.js';
import { useAttempt } from './use-attempt.js';
import { Icon } from '@solveflow/web-ui/icons';
import { ImageViewer } from './image-viewer.js';
import { QuestionContent, QuestionImages } from './question-content.js';
import { ReviewModeTabs, type ReviewMode } from './review-mode-tabs.js';
const activityLabels: Record<ExamAttempt['activity'][number]['action'], string> = { select_slot: '切换到', select_module: '进入', skip_slot: '跳过', skip_module: '跳过模块' };
type Detail = z.infer<typeof ExamDetailSchema>;
type ReviewDraft = { slotId: string; revision: number; runId: string | null; reviewId: string | null; requestId: string; answer: string; originalAnswer: string; note: string; options: string[]; choices: {options: {label:string; text:string}[]; multiple:boolean} | null };
function TeacherChoices({ choices, selected, disabled, onSelect }: { choices: NonNullable<ReviewDraft['choices']>; selected: string[]; disabled: boolean; onSelect: (label: string, checked: boolean) => void }) {
    return <fieldset className="review-choices"><legend>{choices.multiple ? '选择答案（可多选）' : '选择答案'}</legend>{choices.options.map(option => <label key={option.label} className={'review-choice' + (selected.includes(option.label) ? ' selected' : '')}><input type={choices.multiple ? 'checkbox' : 'radio'} name="teacher-option" aria-label={option.label} disabled={disabled} checked={selected.includes(option.label)} onChange={event => onSelect(option.label, event.target.checked)}/><b aria-hidden="true">{option.label}</b></label>)}</fieldset>;
}
export function Monitor({ id, initialSlotId, onClose }: { id: string; initialSlotId?: string; onClose: () => void }) {
    const { attempt, error, refresh } = useAttempt(id);
    const [slotId, setSlotId] = useState<string | null>(initialSlotId ?? null), [detail, setDetail] = useState<Detail | null>(null), [failure, setFailure] = useState(''), [busy, setBusy] = useState(false), [draft, setDraft] = useState<ReviewDraft | null>(null);
    const [navigationOpen, setNavigationOpen] = useState(true), [activityOpen, setActivityOpen] = useState(false), [preview, setPreview] = useState<string | null>(null);
    const [messageDraft,setMessageDraft]=useState<{slotId:string;revision:number;requestId:string;message:string}|null>(null);
    const [mode, setMode] = useState<ReviewMode>('ai'), [messageSent, setMessageSent] = useState(false);
    const navigationId = useId();
    const modeId = useId();
    const retryKey = useRef<{ key: string; id: string } | null>(null);
    // Other questions and student navigation must not reload the teacher's open question.
    const detailVersion = JSON.stringify(attempt?.slots.find(slot => slot.id === slotId) ?? null);
    useEffect(() => { setDetail(null); setDraft(null); setMessageDraft(null); setMessageSent(false); setMode('ai'); setFailure(''); }, [slotId]);
    useEffect(() => {
        if (!slotId || detailVersion === 'null') return;
        const controller = new AbortController();
        void api('/slots/' + slotId, ExamDetailSchema, { signal: controller.signal }).then(value => {
            if (!controller.signal.aborted) { setDetail(value); setFailure(''); }
        }).catch(e => { if (!controller.signal.aborted) setFailure(e instanceof Error ? e.message : '读取失败。'); });
        return () => controller.abort();
    }, [slotId, detailVersion]);
    const candidate = detail?.outcome && 'candidate' in detail.outcome ? detail.outcome.candidate : null;
    const problem = detail?.problem ?? candidate?.problem;
    const issue = attempt?.alerts.find(a => a.slotId === slotId);
    const currentSlot = attempt?.slots.find(s => s.id === (attempt.viewedSlotId ?? attempt.nextSlotId));
    const currentModule = attempt?.modules.find(m => m.id === currentSlot?.moduleId);
    const snapshotSlot = detail && attempt?.slots.find(slot => slot.id === detail.slot.id && slot.revision === detail.slot.revision && slot.runId === detail.slot.runId && slot.reviewId === detail.slot.reviewId);
    const shownAnswer = snapshotSlot?.presentation ?? detail?.slot.presentation;
    const active = !!detail && activeStatuses.has(detail.slot.status);
    const reviewDirty = !!draft && (draft.answer !== draft.originalAnswer || !!draft.note);
    const messageDirty = !!messageDraft?.message;
    const editing = reviewDirty || messageDirty;
    function beginMessage() {
        if (!detail) return;
        setMessageDraft({slotId:detail.slot.id,revision:detail.slot.revision,requestId:newRequestId(),message:''});
        setMessageSent(false);
    }
    function selectMode(next: ReviewMode) {
        if (busy) return;
        if (next === 'manual' && !reviewDirty) beginReview();
        if (next === 'message' && !messageDirty) beginMessage();
        setMode(next); setFailure('');
    }
    async function sendMessage(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();if(!messageDraft||busy)return;
        setBusy(true);setFailure('');
        try{await api('/admin/slots/'+messageDraft.slotId+'/messages',idResponse,post({requestId:messageDraft.requestId,expectedRevision:messageDraft.revision,message:messageDraft.message}));setMessageDraft({...messageDraft,message:'',requestId:newRequestId()});setMessageSent(true);await refresh();}
        catch(error){setFailure(error instanceof Error?error.message:'发送消息失败，请重试。');}
        finally{setBusy(false);}
    }
    async function retry(action: 'solve' | 'verify') {
        if (!detail || busy) return;
        const key = [detail.slot.id, detail.slot.revision, detail.slot.runId, detail.slot.reviewId, action].join(':');
        if (retryKey.current?.key !== key) retryKey.current = { key, id: newRequestId() };
        setBusy(true); setFailure('');
        try { await api('/admin/slots/' + detail.slot.id + '/run', idResponse, post({ requestId: retryKey.current.id, expectedRevision: detail.slot.revision, expectedRunId: detail.slot.runId, expectedReviewId: detail.slot.reviewId, action })); await refresh(); }
        catch (e) { setFailure(e instanceof Error ? e.message : '处理失败。'); }
        finally { setBusy(false); }
    }
    function beginReview() {
        if (!detail || busy) return;
        const problem = detail.problem;
        const choices = problem?.optionsComplete !== false && problem?.options?.length && ['single-choice', 'multiple-choice'].includes(problem.response?.type ?? 'single-choice')
            ? {options: problem.options.map(option => ({label:option.label,text:option.text})), multiple:problem.response?.type === 'multiple-choice'} : null;
        const options = choices ? (detail.slot.presentation?.selectedOptions ?? (candidate?.kind === 'answer' ? candidate.selectedOptions ?? [] : [])).filter(label => choices.options.some(option => option.label === label)) : [];
        const answer = choices ? formatExamChoiceAnswer(choices.options, options) ?? '' : detail.slot.presentation?.answer ?? (candidate?.kind === 'answer' ? candidate.answer : '');
        setDraft({slotId:detail.slot.id,revision:detail.slot.revision,runId:detail.slot.runId,reviewId:detail.slot.reviewId,requestId:newRequestId(),answer,originalAnswer:answer,note:'',options,choices});
    }
    function chooseOption(label: string, checked: boolean) {
        if (!draft?.choices) return;
        const options = draft.choices.multiple ? checked ? [...draft.options.filter(value => value !== label), label] : draft.options.filter(value => value !== label) : [label];
        edit({options,answer:formatExamChoiceAnswer(draft.choices.options, options) ?? ''});
    }
    function edit(patch: Partial<ReviewDraft>) { if (draft) setDraft({ ...draft, ...patch, requestId: newRequestId() }); }
    async function confirm(event: React.FormEvent<HTMLFormElement>) {
        event.preventDefault();
        if (!draft || busy) return;
        setBusy(true); setFailure('');
        try {
            await api('/admin/slots/' + draft.slotId + '/confirm', idResponse, post({ requestId: draft.requestId, expectedRevision: draft.revision, expectedRunId: draft.runId, expectedReviewId: draft.reviewId, answer: draft.answer, selectedOptions: draft.options.length ? draft.options : null, note: draft.note }));
            setDraft(null); setMode('ai'); await refresh();
        } catch (e) { setFailure(e instanceof Error ? e.message : '确认失败。'); }
        finally { setBusy(false); }
    }
    return <Dialog className="monitor-dialog" actions={attempt && <div className="monitor-header-clock"><ExamClock timing={attempt.timing}/></div>} title={attempt?.studentName ?? '学生进度'} size="wide" notice={attempt && attempt.alerts.length > 0 && <VerificationAlerts attempt={attempt} disabled={busy||editing} onSelect={s => { if (!busy && !editing) setSlotId(s.id); }}/>} onClose={() => { if (!busy) onClose(); }}>
      <ErrorText error={error}/>
      {!attempt && !error && <p className="empty" role="status">正在同步学生进度…</p>}
      {attempt && <>
        <div className="exam-session-tools monitor-session"><EndExamButton id={id} timing={attempt.timing} title={attempt.title} studentName={attempt.studentName} onEnded={refresh}/></div>
        <div className="monitor-overview">
          <div className="section-head"><span>{currentSlot ? "学生位置：" + currentModule?.title + " · 第" + currentSlot.position + "题" : attempt.title}</span>{currentSlot && <button className="quiet" disabled={busy||editing} onClick={() => setSlotId(currentSlot.id)}>定位当前题</button>}</div>
          <div className="monitor-counts">{[["已答", attempt.slots.filter(s => s.presentation).length], ["未拍", attempt.slots.filter(s => !s.revision).length], ["跳过", attempt.slots.filter(s => slotState(s).tone === 'skipped').length]].map(([label, count]) => <span key={label}>{label}<strong>{count}</strong></span>)}</div>
        </div>
        <div className="monitor-tools">
          <button className="secondary" disabled={busy} aria-expanded={navigationOpen} aria-controls={navigationId} onClick={()=>setNavigationOpen(open=>!open)}><Icon name="grid"/>题目导航</button>
          <button className="quiet" onClick={()=>setActivityOpen(true)}><Icon name="history"/>操作记录</button>
        </div>
        {navigationOpen && <><SlotStateLegend/><section id={navigationId} className="question-nav monitor-navigation" aria-label="题目导航">{attempt.modules.map(m => <section key={m.id}><h3>{m.title}</h3><div className="slot-grid">{attempt.slots.filter(s => s.moduleId === m.id).map(s => {
            const flagged = attempt.alerts.some(a=>a.slotId===s.id), state = overviewState(s, flagged);
            return <button key={s.id} aria-label={m.title+' · 第'+s.position+'题'} aria-current={s.id===slotId?'step':undefined} className={overviewClass(state)+(s.id===slotId?' current':'')} title={editing ? '有未提交内容，请先保存或取消' : state.detail} disabled={busy||editing} onClick={()=>setSlotId(s.id)}>{s.position}<span className="navigation-phase overview-phase"><span className="slot-state-dot" aria-hidden="true"/>{state.label}</span>{flagged && <span className="section-answer-alert feedback-tone-error" aria-label="待处理">!</span>}</button>;
        })}</div></section>)}</section></>}
        {activityOpen && <Dialog title="操作记录" onClose={()=>setActivityOpen(false)}><div className="activity-history monitor-activity">{attempt.activity.length ? <ol>{attempt.activity.map(a=><li key={a.id}><span>{activityLabels[a.action]} {a.moduleTitle}{a.position?' · 第'+a.position+'题':''}{a.affectedCount>1?'（'+a.affectedCount+'题）':''}</span><time dateTime={a.createdAt}>{new Date(a.createdAt).toLocaleTimeString()}</time></li>)}</ol> : <p className="empty">暂无操作记录</p>}</div></Dialog>}
      </>}
      {detail && detail.slot.id === slotId && <section className="review-detail">
        <div className="review-heading">
          <div className="section-head"><h3>第{detail.slot.position}题</h3><span className="badge">{statusLabels[detail.slot.status]}</span></div>
          {detail.slot.revision > 0 && <ReviewModeTabs id={modeId} value={mode} disabled={busy} onChange={selectMode}/>}
        </div>
        <div className="review-layout">
          <section className="review-question" aria-label="题目与原图">
            <QuestionImages images={detail.slot.images} onOpen={setPreview}/>
            {problem && <QuestionContent problem={problem} selectedOptions={mode === 'manual' && draft?.choices ? draft.options : shownAnswer?.selectedOptions ?? []}/>}
          </section>
          <section className="review-response" aria-label="答案与处理">
            {detail.slot.presentation && <div className="review-current-answer"><div className="section-head"><h3>学生当前答案</h3><span className="badge">{detail.slot.presentation.humanConfirmed ? '老师已确认' : detail.slot.presentation.simulated ? '错题模拟' : detail.slot.presentation.verified ? 'AI 已核验' : '待核验'}</span></div><AnswerSummary answer={shownAnswer ?? detail.slot.presentation} options={problem?.options}/></div>}
            {editing && <p className="muted review-draft-note">有未提交内容，保存或取消后可切换题目。</p>}
            <div className="review-panel" role="tabpanel" id={modeId+'-manual-panel'} aria-labelledby={modeId+'-manual'} hidden={mode !== 'manual'}>
            <ErrorText error={mode === 'manual' ? failure : ''}/>
            {draft && <form className="human-review" onSubmit={e => void confirm(e)}>
              <h3>人工确认 · 第{detail.slot.position}题 · 第{draft.revision}版</h3>
              {draft.choices && <TeacherChoices choices={draft.choices} selected={draft.options} disabled={busy} onSelect={chooseOption}/>}
              {!draft.choices && <label>确认答案<textarea aria-label="确认答案" required maxLength={MAX_ANSWER_CHARACTERS} rows={5} disabled={busy} value={draft.answer} onChange={e => edit({ answer: e.target.value })}/></label>}
              <label>处理意见<textarea aria-label="处理意见" required maxLength={2000} rows={3} disabled={busy} value={draft.note} onChange={e => edit({ note: e.target.value })}/></label>
              <div className="dialog-footer"><button type="button" disabled={busy} onClick={() => {setDraft(null);setMode('ai');setFailure('');}}>取消</button><button className="primary" type="submit" disabled={busy || !draft.answer.trim() || !draft.note.trim()}>{busy ? '提交中…' : '保存并通知学生'}</button></div>
            </form>}
            </div>
            <div className="review-panel" role="tabpanel" id={modeId+'-message-panel'} aria-labelledby={modeId+'-message'} hidden={mode !== 'message'}>
              <ErrorText error={mode === 'message' ? failure : ''}/>
              {messageSent && <p className="review-sent feedback-tone-success" role="status">消息已发送</p>}
              {messageDraft && <form className="human-review teacher-message" onSubmit={event=>void sendMessage(event)}>
                <label>消息内容<textarea aria-label="消息内容" required maxLength={2000} rows={5} disabled={busy} value={messageDraft.message} onChange={event=>{setMessageSent(false);setMessageDraft(current=>current?{...current,message:event.target.value,requestId:current.message.trim()===event.target.value.trim()?current.requestId:newRequestId()}:null);}}/></label>
                <div className="dialog-footer"><button type="button" disabled={busy} onClick={()=>{setMessageDraft(null);setMessageSent(false);setMode('ai');setFailure('');}}>取消</button><button className="primary" type="submit" disabled={busy||!messageDraft.message.trim()}>{busy?'发送中…':'发送消息'}</button></div>
              </form>}
            </div>
            <div className="review-panel" role="tabpanel" id={modeId+'-ai-panel'} aria-labelledby={detail.slot.revision > 0 ? modeId+'-ai' : undefined} aria-label={detail.slot.revision > 0 ? undefined : '答案与处理'} hidden={mode !== 'ai'}>
            <ErrorText error={mode === 'ai' ? failure : ''}/>
            {detail.slot.revision > 0 && <div className="toolbar review-ai-actions">
              <button className="primary" disabled={busy || active || reviewDirty} onClick={() => void retry('solve')}>开始 AI 答题</button>
              <button className="quiet" disabled={busy || active || reviewDirty || candidate?.kind !== 'answer' || !!detail.slot.reviewId} onClick={() => void retry('verify')}>重新核验</button>
            </div>}
            {active && <p className="muted" role="status">{statusLabels[detail.slot.status]}…</p>}
            {reviewDirty && <button className="quiet" disabled={busy} onClick={()=>setDraft(null)}>放弃手动草稿</button>}
            {messageDirty && <button className="quiet" disabled={busy} onClick={()=>setMessageDraft(null)}>放弃消息草稿</button>}
            {detail.outcome?.status === 'completed' && detail.outcome.verification && <details open={!!issue}><summary>AI 核验意见</summary>{detail.outcome.verification.issues.map((i, n) => <p key={n}>{i.message}</p>)}<span className="badge">{detail.outcome.verification.verdict === 'pass' ? '通过' : detail.outcome.verification.verdict === 'fail' ? '未通过' : '无法确认'}</span></details>}
            {candidate?.kind === 'answer' && <details><summary>AI 原始答案</summary><RichText text={candidate.answer}/></details>}
            <details><summary>版本与人工处理记录</summary>{detail.humanReviews.map(r => <article className="record-row" key={r.id}><strong>{r.teacherName} · 人工确认 · 第{r.revision}版</strong><RichText text={r.answer}/><p>{r.note}</p><time>{new Date(r.createdAt).toLocaleString()}</time></article>)}{detail.revisions.map(v => <p key={v.revision}>第{v.revision}版 · {new Date(v.createdAt).toLocaleString()}</p>)}</details>
            </div>
          </section>
        </div>
      </section>}
      {!detail && <ErrorText error={failure}/>}
      {preview && <ImageViewer key={preview} src={preview} onClose={()=>setPreview(null)}/>}
    </Dialog>;
}
