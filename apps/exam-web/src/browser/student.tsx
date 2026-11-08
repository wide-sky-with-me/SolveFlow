// Decision: .agents/notes/implemented/architecture/2026-11-07-early-answer-publish.md
// Decision: .agents/notes/implemented/architecture/2026-11-05-exam-client-recovery.md
// Decision: .agents/notes/implemented/architecture/2026-11-05-student-manual-navigation.md
// Decision: .agents/notes/implemented/architecture/2026-11-06-student-rerun.md
import { newRequestId } from './request-id.js';
import { ExamEndNotice } from './exam-clock.js';
import { StudentExamStatus } from './student-header.js';
import { StudentAnswer } from './student-answer.js';
import { slotClass, slotState } from './slot-state.js';
import { SectionAnswers } from './section-answers.js';
import './student-flow.css';
import { ImageViewer } from './image-viewer.js';
import { QuestionContent, QuestionImages } from './question-content.js';
// Decision: .agents/notes/implemented/architecture/2026-11-03-browser-intent-lifecycle.md
import { MAX_SOURCE_IMAGE_BYTES } from '@solveflow/image-input/formats';
import { browserImage, IMAGE_INPUT_ACCEPT } from '@solveflow/image-input';
// Decision: .agents/notes/implemented/architecture/2026-11-03-exam-resolution-notifications.md
// Decision: .agents/notes/implemented/architecture/2026-11-03-exam-answer-presentation.md
// Decision: .agents/notes/implemented/architecture/2026-11-03-exam-review-hardening.md
// Decision: .agents/notes/implemented/architecture/2026-11-03-exam-navigation-and-tracking.md
// Decision: .agents/notes/implemented/architecture/2026-11-03-durable-exam-reviews.md
import { useEffect, useRef, useState } from 'react';
import { z } from 'zod';
import { EXAM_SOURCE_IMAGE_BYTES, EXAM_MATERIAL_COUNT, ExamDetailSchema, ExamSubmissionReceiptSchema, ExamNavigationResultSchema, type ExamAnswerRevision, type ExamNavigationAction, type ExamResolution, type ExamSlot } from '@solveflow/contracts/managed-exam';
import { Icon } from '@solveflow/web-ui/icons';
import { RichText } from './rich-text.js';
import { api, idResponse, post, RequestError } from './api.js';
import { activeStatuses, AnswerRevisions, Dialog, ErrorText, Feedback, ResolvedAnswers, statusLabels, VerificationAlerts } from './components.js';
import { useAttempt } from './use-attempt.js';
import { ResolutionReminder } from './resolution-reminder.js';
type Draft = {
    slot: ExamSlot;
    kind: 'initial' | 'retake' | 'supplement';
    requestId: string;
    submitted: boolean;
    files: {
        id: string;
        file: File;
        url: string;
        assetId: string | null;
    }[];
};
export function StudentAttempt({ id, onExit, focus }: {
    id: string;
    onExit: () => void;
    focus?: {slotId:string;version:number};
}) {
    const { attempt, error: syncError, online, refresh } = useAttempt(id);
    const focusedMessage = useRef(0);
    const [messageRetry,setMessageRetry]=useState<{slotId:string;version:number}|null>(null);
    const [selected, setSelected] = useState<string | null>(null), [viewModule, setViewModule] = useState<string | null>(null), [error, setError] = useState(''), [busy, setBusy] = useState(false), [draft, setDraft] = useState<Draft | null>(null), [detail, setDetail] = useState<z.infer<typeof ExamDetailSchema> | null>(null), [preview, setPreview] = useState<string | null>(null), [navOpen, setNavOpen] = useState(false), [navModule, setNavModule] = useState<string | null>(null), [navBusy, setNavBusy] = useState(false);
    const [draftError, setDraftError] = useState('');
    const savingRequest = useRef<AbortController | null>(null);
    const rerunRequest = useRef<AbortController | null>(null), rerunKey = useRef<{key:string;id:string}|null>(null);
    const navigationVersion = useRef(-1), navigationRetry = useRef<{ key: string; id: string } | null>(null);
    const openingResolution = useRef(false);
    const imageImport = useRef<AbortController | null>(null);
    const detailRequest = useRef<AbortController | null>(null);
    const [importing, setImporting] = useState(false), [pickingImage, setPickingImage] = useState(false);
    const taskError = useRef<{ slotId: string; runId: string; message: string } | null>(null);
    const input = useRef<HTMLInputElement>(null), target = useRef<{
        slot: ExamSlot;
        kind: Draft['kind'];
    } | null>(null), draftRef = useRef<Draft | null>(null), pending = useRef<{
        runId: string;
        slotId: string;
        revision: number;
    } | null>(null);
    draftRef.current = draft;
    useEffect(() => () => {
        imageImport.current?.abort();
        savingRequest.current?.abort();
        rerunRequest.current?.abort();
        detailRequest.current?.abort();
        for (const file of draftRef.current?.files ?? [])
            URL.revokeObjectURL(file.url);
    }, []);
    useEffect(() => {
        const field = input.current;
        const cancelled = () => setPickingImage(false);
        field?.addEventListener('cancel', cancelled);
        return () => field?.removeEventListener('cancel', cancelled);
    }, [attempt?.id]);
    useEffect(() => {
        if (!attempt)
            return;
        const reported = taskError.current;
        if (reported) {
            const current = attempt.slots.find(s => s.id === reported.slotId);
            if (selected !== reported.slotId || current?.runId !== reported.runId || current.status === 'completed' && current.presentation) {
                setError(value => value === reported.message ? '' : value);
                taskError.current = null;
            }
        }
        if (!selected) {
            const current = attempt.slots.find(s => s.id === attempt.viewedSlotId) ?? attempt.slots.find(s => s.id === attempt.nextSlotId) ?? attempt.slots.find(s => s.moduleId === (attempt.modules.find(m => m.state === 'available')?.id)) ?? attempt.slots.at(-1);
            if (current) {
                setSelected(current.id);
                setViewModule(current.moduleId);
            }
        }
        if (attempt.navigationVersion > navigationVersion.current) {
            const changed = navigationVersion.current >= 0;
            navigationVersion.current = attempt.navigationVersion;
            if (changed && attempt.viewedSlotId) { const next = attempt.slots.find(s => s.id === attempt.viewedSlotId); if (next) { setSelected(next.id); setViewModule(next.moduleId); } }
        }
        // Recover the waiter from the authoritative run after a refresh/reconnect.
        // Completion updates the answer in place; only explicit navigation changes the viewed question.
        if (!pending.current && selected) {
            const running = attempt.slots.find(s => s.id === selected);
            if (running?.runId && activeStatuses.has(running.status))
                pending.current = { runId: running.runId, slotId: running.id, revision: running.revision };
        }
        const wait = pending.current;
        if (wait) {
            const slot = attempt.slots.find(s => s.id === wait.slotId);
            if (slot && slot.revision >= wait.revision && slot.runId !== wait.runId) pending.current = null;
            if (slot && slot.runId === wait.runId && !activeStatuses.has(slot.status)) {
                if (busy || navBusy) return;
                pending.current = null;
                // Clarification already has an actionable persistent incident.
                if (slot.status !== 'completed' && selected === slot.id && slot.status !== 'needs_clarification') {
                    const message = statusLabels[slot.status] ?? '答题未完成，请重拍或补图。';
                    taskError.current = { slotId: slot.id, runId: wait.runId, message };
                    setError(message);
                }
            }
        }
    }, [attempt, selected, busy, navBusy, navOpen, draft, preview, detail]);
    useEffect(() => {
        if (!attempt || !selected || attempt.viewedSlotId === selected || busy || navBusy || navOpen || draft || preview || detail || attempt.timing.endedAt || attempt.timing.remainingSeconds === 0 || ['closed', 'cancelled'].includes(attempt.state)) return;
        const timer = setTimeout(() => { void navigate({ action: 'select_slot', slotId: selected }); }, 200);
        return () => clearTimeout(timer);
    }, [selected, attempt?.viewedSlotId, attempt?.navigationVersion, attempt?.timing.endedAt, attempt?.timing.remainingSeconds, attempt?.state, busy, navBusy, navOpen, draft, preview, detail]);
    useEffect(()=>{
        if(!focus||focusedMessage.current===focus.version||!attempt||busy||navBusy||navOpen||draft||preview||detail)return;
        if(!attempt.slots.some(slot=>slot.id===focus.slotId))return;
        focusedMessage.current=focus.version;
        setMessageRetry(null);
        void locateMessage(focus);
    },[focus?.version,attempt?.id,busy,navBusy,navOpen,draft,preview,detail]);
    const openDetailId = detail?.slot.id;
    useEffect(() => {
        if (!openDetailId) return;
        const controller = new AbortController();
        void api('/slots/' + openDetailId, ExamDetailSchema, { signal: controller.signal }).then(value => {
            if (!controller.signal.aborted) setDetail(current => current?.slot.id === openDetailId ? value : current);
        }).catch(e => { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : '同步失败。'); });
        return () => controller.abort();
    }, [openDetailId, attempt?.lastSeq]);
    if (!attempt)
        return <section className="card"><ErrorText error={syncError}/><p>正在同步考试…</p><button onClick={onExit}>返回</button></section>;
    const slot = attempt.slots.find(s => s.id === selected), module = attempt.modules.find(m => m.id === viewModule);
    const closed = !!attempt.timing.endedAt || attempt.timing.remainingSeconds === 0 || ['closed', 'cancelled'].includes(attempt.state);
    const active = slot && activeStatuses.has(slot.status);
    const skipped = attempt.slots.filter(s => slotState(s).tone === 'skipped');
    const sectionSlots = attempt.slots.filter(item => item.moduleId === module?.id).sort((a, b) => a.position - b.position);
    const sectionIndex = sectionSlots.findIndex(item => item.id === slot?.id);
    const previousSlot = sectionIndex > 0 ? sectionSlots[sectionIndex - 1] : undefined;
    const nextSlot = sectionIndex >= 0 ? sectionSlots[sectionIndex + 1] : undefined;
    const nextModule = attempt.modules.filter(item => item.position > (module?.position ?? Infinity)).sort((a, b) => a.position - b.position)[0];
    const atSectionEnd = sectionIndex >= 0 && sectionIndex === sectionSlots.length - 1;

    async function navigate(action: ExamNavigationAction) {
        if (!attempt || busy || navBusy) return false;
        if (closed) { const target = 'slotId' in action ? attempt.slots.find(s => s.id === action.slotId) : attempt.slots.find(s => s.moduleId === action.moduleId); if (target) { setSelected(target.id); setViewModule(target.moduleId); setNavOpen(false); } return !!target; }
        const expectedVersion = Math.max(attempt.navigationVersion, navigationVersion.current);
        const key = JSON.stringify({ ...action, expectedVersion });
        if (navigationRetry.current?.key !== key) navigationRetry.current = { key, id: newRequestId() };
        setNavBusy(true); setError('');
        try {
            const result = await api('/attempts/' + attempt.id + '/navigation', ExamNavigationResultSchema, post({ ...action, expectedVersion, requestId: navigationRetry.current.id }));
            navigationVersion.current = result.navigationVersion;
            const target = attempt.slots.find(s => s.id === result.slotId);
            if (target) { setSelected(target.id); setViewModule(target.moduleId); }
            setNavOpen(false); await refresh();
            return true;
        } catch (e) { setError(e instanceof Error ? e.message : '跳转失败。'); await refresh(); return false; }
        finally { setNavBusy(false); }
    }
    async function locateMessage(target:{slotId:string;version:number}) {
        const ok=await navigate({action:'select_slot',slotId:target.slotId});
        if(focusedMessage.current===target.version)setMessageRetry(ok?null:target);
    }
    async function viewAnswerRevision(notice: ExamAnswerRevision) {
        if (busy || navBusy) return;
        setBusy(true);
        try {
            if (!await navigate({ action: 'select_slot', slotId: notice.slotId })) return;
            const latest = await loadDetail(notice.slotId);
            // Only reading the published answer clears the revision notice; the
            // provisional draft is never treated as the final answer here.
            if (latest && latest.slot.revision === notice.revision && latest.slot.presentation)
                await api('/answer-revisions/' + notice.id + '/read', z.strictObject({ ok: z.boolean() }), { method: 'POST' });
            await refresh();
        } catch (e) { setError(e instanceof Error ? e.message : '读取答案失败，请重试。'); }
        finally { setBusy(false); }
    }
    async function viewResolution(notice: ExamResolution) {
        if (busy || navBusy || openingResolution.current) return;
        openingResolution.current = true;
        try {
            if (!await navigate({ action: 'select_slot', slotId: notice.slotId })) return;
            setBusy(true);
            const latest = await loadDetail(notice.slotId);
            if (!latest) return;
            // Read only after successfully opening the current answer, never on mere notification delivery.
            if (latest.slot.revision === notice.revision && latest.slot.presentation)
                await api('/resolutions/' + notice.id + '/read', z.strictObject({ ok: z.boolean() }), { method: 'POST' });
            await refresh();
        } catch (e) { setError(e instanceof Error ? e.message : '读取答案失败，请重试。'); }
        finally { setBusy(false); openingResolution.current = false; }
    }
    function choose(kind: Draft['kind'], camera = false) {
        if (!slot || busy || navBusy)
            return;
        target.current = { slot, kind };
        if (input.current) {
            input.current.value = '';
            input.current.multiple = kind === 'supplement';
            if (camera)
                input.current.setAttribute('capture', 'environment');
            else
                input.current.removeAttribute('capture');
            setPickingImage(true);
            input.current.click();
        }
    }
    function clearDraft() {
        if (busy)
            return;
        for (const item of draft?.files ?? [])
            URL.revokeObjectURL(item.url);
        if (draft?.submitted) void refresh();
        setDraft(null); setDraftError('');
    }
    async function prepareDraft(chosen: { slot: ExamSlot; kind: Draft['kind'] }, files: File[]) {
        if (imageImport.current) return;
        const controller = new AbortController(); imageImport.current = controller;
        setBusy(true); setImporting(true); setError('');
        const prepared: Draft['files'] = [];
        try {
            for (const file of files) {
                const source = await browserImage(file, { maxBytes: MAX_SOURCE_IMAGE_BYTES, maxPixels: 20_000_000, signal: controller.signal });
                controller.signal.throwIfAborted();
                const upload = source === file ? file : new File([source], file.name.replace(/\.[^.]*$/, '') + '.jpg', { type: 'image/jpeg', lastModified: file.lastModified });
                if (upload.size > EXAM_SOURCE_IMAGE_BYTES) throw new Error('转换后的图片超过10MiB，请先缩小。');
                prepared.push({ id: newRequestId(), file: upload, url: URL.createObjectURL(upload), assetId: null });
            }
            for (const item of draftRef.current?.files ?? []) URL.revokeObjectURL(item.url);
            setDraftError('');
            setDraft({ slot: chosen.slot, kind: chosen.kind, requestId: newRequestId(), submitted: false, files: prepared });
        } catch (error) {
            for (const item of prepared) URL.revokeObjectURL(item.url);
            if (!controller.signal.aborted) setError(error instanceof Error ? error.message : '图片处理失败。');
        } finally {
            if (imageImport.current === controller) {
                imageImport.current = null;
                if (!controller.signal.aborted) { setBusy(false); setImporting(false); }
            }
        }
    }
    function cancelImport() {
        const controller = imageImport.current; imageImport.current = null;
        controller?.abort(); setBusy(false); setImporting(false);
    }
    async function acceptSaved(value: Draft, runId: string) {
        pending.current = { runId, slotId: value.slot.id, revision: value.slot.revision + 1 };
        for (const item of value.files) URL.revokeObjectURL(item.url);
        setDraft(null); setDraftError(''); await refresh();
    }
    async function saveDraft() {
        if (!draft || busy || closed || savingRequest.current) return;
        const value = draft, controller = new AbortController(); savingRequest.current = controller;
        let submitted = value.submitted, submitting = false;
        setBusy(true); setDraftError('');
        const receipt = () => api('/slots/' + value.slot.id + '/submissions/' + value.requestId, ExamSubmissionReceiptSchema, { signal: controller.signal }, 8000);
        try {
            if (submitted) {
                const saved = await receipt();
                if (saved.runId) { await acceptSaved(value, saved.runId); return; }
            }
            const assets: string[] = [];
            for (const item of value.files) {
                if (!item.assetId) {
                    try {
                        const result = await api('/slots/' + value.slot.id + '/images', idResponse, { method: 'POST', headers: { 'content-type': item.file.type || 'image/jpeg', 'x-request-id': item.id }, body: item.file, signal: controller.signal });
                        item.assetId = result.id;
                    } catch (error) { item.id = newRequestId(); throw error; }
                }
                assets.push(item.assetId);
            }
            // Once sent, keep exactly these files and this key until the receipt is known.
            submitted = true; submitting = true; setDraft(current => current?.requestId === value.requestId ? { ...current, submitted: true } : current);
            const result = await api('/slots/' + value.slot.id + '/submissions', z.strictObject({ runId: z.uuid() }), { ...post({ requestId: value.requestId, expectedRevision: value.slot.revision, kind: value.kind, assetIds: assets }), signal: controller.signal });
            await acceptSaved(value, result.runId);
        } catch (error) {
            if (controller.signal.aborted) return;
            // Only a rejected submission can unlock its draft; a failed receipt read says nothing about acceptance.
            const rejected = submitting && error instanceof RequestError && error.status >= 400 && error.status < 500 && error.status !== 408;
            if (submitted && !rejected) {
                if (submitting) {
                    try {
                        const saved = await receipt();
                        if (saved.runId) { await acceptSaved(value, saved.runId); return; }
                    } catch { if (controller.signal.aborted) return; }
                }
                setDraftError('保存结果暂未确认，图片已保留。请同步并重试。');
            } else {
                setDraft(current => current?.requestId === value.requestId ? { ...current, submitted: false } : current);
                setDraftError(error instanceof RequestError && error.status === 409 ? '题图或保存状态已更新，请返回题目同步后重新选图。' : error instanceof Error ? error.message : '保存失败，图片已保留，请重试。');
            }
        } finally {
            if (savingRequest.current === controller) savingRequest.current = null;
            if (!controller.signal.aborted) setBusy(false);
        }
    }
    async function loadDetail(slotId: string) {
        detailRequest.current?.abort();
        const controller = new AbortController();
        detailRequest.current = controller;
        try {
            const latest = await api('/slots/' + slotId, ExamDetailSchema, { signal: controller.signal });
            if (controller.signal.aborted || detailRequest.current !== controller) return null;
            setDetail(latest);
            return latest;
        }
        catch (error) {
            if (!controller.signal.aborted) setError(error instanceof Error ? error.message : '读取失败。');
            return null;
        }
        finally {
            if (detailRequest.current === controller) detailRequest.current = null;
        }
    }
    async function reanswer() {
        if (!slot || closed || active || busy || navBusy || rerunRequest.current) return;
        const key = JSON.stringify([slot.id, slot.revision, slot.runId, slot.reviewId]);
        if (rerunKey.current?.key !== key) rerunKey.current = {key,id:newRequestId()};
        const controller = new AbortController(); rerunRequest.current = controller;
        setBusy(true); setError(''); taskError.current = null;
        try {
            const result = await api('/slots/' + slot.id + '/run', idResponse, { ...post({requestId:rerunKey.current.id,expectedRevision:slot.revision,expectedRunId:slot.runId,expectedReviewId:slot.reviewId}), signal:controller.signal });
            if (controller.signal.aborted) return;
            pending.current = {runId:result.id,slotId:slot.id,revision:slot.revision};
            await refresh();
        } catch (e) {
            if (!controller.signal.aborted) { setError(e instanceof Error ? e.message : '重新解答失败，请同步后重试。'); void refresh(); }
        } finally {
            if (rerunRequest.current === controller) rerunRequest.current = null;
            if (!controller.signal.aborted) setBusy(false);
        }
    }
    function closeDetail() {
        detailRequest.current?.abort();
        detailRequest.current = null;
        setDetail(null);
    }
    return <>
    <StudentExamStatus id={id} title={attempt.title} timing={attempt.timing} onDeadline={refresh}/>
    {!online && <div className="student-connection"><span className="badge amber" role="status">正在重连</span></div>}
    <ExamEndNotice id={id} studentId={attempt.studentId} timing={attempt.timing}/>
    <VerificationAlerts attempt={attempt} emphasis disabled={busy || navBusy} onSelect={s => { void navigate({ action: 'select_slot', slotId: s.id }); }}/>
    <ResolvedAnswers resolutions={attempt.resolutions} disabled={busy || navBusy} onSelect={notice => void viewResolution(notice)}/>
    <AnswerRevisions notices={attempt.answerRevisions} disabled={busy || navBusy} onSelect={notice => void viewAnswerRevision(notice)}/>
    <ResolutionReminder resolutions={attempt.resolutions} ready={!busy && !navBusy && !pickingImage && !importing && !draft && !preview && !detail && !navOpen} onSelect={notice => void viewResolution(notice)}/>
    <ErrorText error={!draft && !navOpen && !detail && !preview ? error || syncError : ''}/>{messageRetry&&!draft&&!navOpen&&!detail&&!preview&&<button className="secondary" disabled={busy||navBusy} onClick={()=>void locateMessage(messageRetry)}>重新定位消息题目</button>}{closed && <Feedback>考试已结束</Feedback>}
    <nav className="module-steps" aria-label="考试模块">{attempt.modules.map(m => <button key={m.id} title={m.title} className={m.id === viewModule ? 'selected' : ''} aria-pressed={m.id === viewModule} disabled={busy || navBusy} onClick={() => void navigate({ action: 'select_module', moduleId: m.id })}><span className="module-title">{m.title}</span></button>)}</nav>
    {module && <section className="card student-question"><div className="section-head"><h2>{module.title}</h2><div className="toolbar"><button className="quiet question-jump" aria-label="总览" onClick={() => { setNavModule(module.id); setNavOpen(true); }} disabled={busy || navBusy}><Icon name="grid"/>总览</button></div></div>
      {slot && <div className={"capture-box" + (slot.presentation ? " with-answer" : "")}><div className="section-head"><h2>第{slot.position}题</h2>{!active && slotState(slot).tone !== 'empty' && <span className={'badge ' + slotClass(slot)}>{slotState(slot).label}</span>}</div>
        <QuestionImages images={slot.images} onOpen={setPreview}/>
        {!closed && <><button className="primary camera-entry" disabled={busy || navBusy} onClick={() => choose(slot.revision ? 'retake' : 'initial', true)}><Icon name="camera"/>{slot.revision ? '重拍本题' : '拍摄第' + slot.position + '题'}</button><div className="inline-actions"><button className="quiet" disabled={busy || navBusy} onClick={() => choose(slot.revision ? 'retake' : 'initial')}>从相册选择</button>{slot.revision > 0 && <><button className="quiet" disabled={busy || navBusy} onClick={() => choose('supplement')}>补图</button><button className="quiet" disabled={busy || navBusy || active} onClick={() => void reanswer() }><Icon name="reset"/>重新解答</button></>}</div></>}
        {slot.errorCode === 'QUOTA_EXCEEDED' && <ErrorText error="今日调用额度已用完。"/>}
      {slot && <nav className="question-paging" aria-label="逐题导航"><button className="secondary" disabled={busy || navBusy || !previousSlot} onClick={() => { if (previousSlot) void navigate({ action: 'select_slot', slotId: previousSlot.id }); }}><Icon name="chevron-right" className="previous-chevron"/>上一题</button>{active && slot.runId && !closed && <button className="quiet stop-answer" disabled={busy || navBusy} onClick={() => { void api('/runs/' + slot.runId + '/cancel', z.object({ ok: z.boolean() }), { method: 'POST' }).then(() => refresh()).catch(e => setError(e instanceof Error ? e.message : '停止失败。')); }}>停止作答</button>}{atSectionEnd && nextModule && !closed ? <button className="primary" disabled={busy || navBusy} onClick={() => void navigate({ action: 'select_module', moduleId: nextModule.id })}><span className="next-module-label" title={nextModule.title}>进入{nextModule.title}</span><Icon name="chevron-right"/></button> : <button className="primary" disabled={busy || navBusy || !nextSlot} onClick={() => { if (nextSlot) void navigate({ action: 'select_slot', slotId: nextSlot.id }); }}>下一题<Icon name="chevron-right"/></button>}</nav>}
      </div>}
      {slot && <StudentAnswer key={slot.id} slot={slot} onSync={refresh}/>}

      {skipped.length > 0 && <button className="quiet skipped-link" onClick={() => { setNavModule(skipped[0]?.moduleId ?? module.id); setNavOpen(true); }}>已跳过 {skipped.length} 题</button>}
    </section>}
    {navOpen && <Dialog title="题目总览" className="student-overview" onClose={() => { if (!navBusy) setNavOpen(false); }}><nav className="module-steps" aria-label="导航模块">{attempt.modules.map(m => <button key={m.id} title={m.title} className={m.id === navModule ? 'selected' : ''} onClick={() => setNavModule(m.id)} disabled={navBusy}><span className="module-title">{m.title}</span></button>)}</nav><SectionAnswers slots={attempt.slots.filter(s => s.moduleId === navModule).sort((a,b)=>a.position-b.position)} selectedId={selected} alerts={new Set(attempt.alerts.map(a=>a.slotId))} disabled={navBusy} onSelect={s=>void navigate({action:'select_slot',slotId:s.id})}/><ErrorText error={error || syncError}/></Dialog>}
    <input ref={input} type="file" accept={IMAGE_INPUT_ACCEPT} hidden onChange={e => {
            setPickingImage(false);
            if (closed) { e.target.value = ''; return; }
            const chosen = target.current, files = Array.from(e.target.files ?? []);
            if (!chosen || !files.length)
                return;
            if (files.length > EXAM_MATERIAL_COUNT || files.some(file => file.size > MAX_SOURCE_IMAGE_BYTES)) {
                setError('每次最多7张补图，原图单张不超过32MiB。');
                return;
            }
            void prepareDraft(chosen, files);
        }}/>
    {importing && <Dialog title="正在处理图片…" onClose={cancelImport}><div className="dialog-footer"><button onClick={cancelImport}>取消</button></div></Dialog>}
    {draft && <Dialog title={'第' + draft.slot.position + '题 · ' + (draft.kind === 'supplement' ? '补图' : '题图')} onClose={clearDraft}><div className="draft-images">{draft.files.map((item, i) => <div className="draft-image" key={item.id}><img src={item.url} alt={'待保存题图' + (i + 1)}/><button className="corner-delete" disabled={busy || draft.submitted} aria-label={'移除第' + (i + 1) + '张'} onClick={() => { URL.revokeObjectURL(item.url); setDraft({ ...draft, files: draft.files.filter(v => v.id !== item.id) }); }}>×</button></div>)}</div><ErrorText error={draftError || syncError}/>{closed&&<Feedback>考试已结束，无法提交题图。</Feedback>}<div className="dialog-footer"><button onClick={clearDraft} disabled={busy}>{draft.submitted ? '返回题目' : '取消'}</button><button className="primary" disabled={busy || closed || !draft.files.length} onClick={() => void saveDraft()}>{busy ? '正在保存…' : draft.submitted ? '同步并重试' : '保存并解答'}</button></div></Dialog>}
    {preview && <ImageViewer key={preview} src={preview} onClose={() => setPreview(null)}/>}
    {detail && <Dialog title={'第' + detail.slot.position + '题'} className="student-question-detail" onClose={closeDetail}><ErrorText error={error || syncError}/>{detail.slot.presentation && !detail.slot.presentation.simulated && <span className={'badge ' + (detail.slot.presentation.verified ? 'green' : '')}>{detail.slot.presentation.humanConfirmed ? '老师已确认' : detail.slot.presentation.verified ? 'AI 已核验' : '待核验'}</span>}<QuestionImages images={detail.slot.images} onOpen={setPreview}/>{detail.problem && <QuestionContent problem={detail.problem} selectedOptions={detail.slot.presentation?.selectedOptions??[]}/>}<h3>答案</h3><RichText text={detail.slot.presentation?.answer ?? '暂未出答案。'}/><details><summary>题图版本</summary>{detail.revisions.map(v => <p key={v.revision}>第{v.revision}版 · {v.reason === 'initial' ? '首次拍摄' : v.reason === 'retake' ? '重拍' : '补图'}</p>)}</details></Dialog>}
  </>;
}
