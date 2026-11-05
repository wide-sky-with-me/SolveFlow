// Decision: .agents/notes/implemented/architecture/2026-11-04-photo-view-ordering.md
import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import { createRoot } from 'react-dom/client';
import type { ExamType, LocalRecord, LocalHistorySummary } from '@solveflow/contracts/local';
import type { SafeAgentError } from '@solveflow/contracts/agent';
import { terminal } from '@solveflow/contracts/http';
import { PhotoAccountSchema, type PhotoAccount } from '@solveflow/contracts/photo';
import { openPhotoRuntime, type PhotoRuntime } from './runtime.js';
import { preparePhoto } from './photo.js';
import { RichText } from './markdown.js';
import { Icon, CaptureArtwork } from './icons.js';
import { ExamPicker } from './exam-picker.js';
import { Dialog } from '@solveflow/web-ui/dialog';
import { mergeRunViews } from './run-view.js';
import type { RunView } from '@solveflow/contracts/http';
import brandIcon from './icon.svg';
import './styles.css';
const message = (e: unknown) => e instanceof Error ? e.message : '操作未完成，请重试。';
function failureMessage(error: SafeAgentError) {
  if (error.code === 'MODEL_UNAVAILABLE' || error.code === 'MODEL_REQUEST_REJECTED') return '暂时无法完成解答，请稍后重试。';
  if (error.code === 'SPEND_LIMIT') return '解题服务额度不足，请联系管理员。';
  return error.message;
}
function App() {
  const [account, setAccount] = useState<PhotoAccount | null>(null), [loading, setLoading] = useState(true), [error, setError] = useState('');
  async function check() { try { const r = await fetch('/api/session', { cache: 'no-store' }); if (r.status === 401) { setAccount(null); return; } if (!r.ok) throw new Error('暂时无法连接服务。'); setAccount(PhotoAccountSchema.parse(await r.json())); } catch (e) { setError(message(e)); } finally { setLoading(false); } }
  useEffect(() => { void check(); const expired = () => { setAccount(null); setError('登录已失效，请重新输入访问密钥。'); }; window.addEventListener('photo-auth-expired', expired); return () => window.removeEventListener('photo-auth-expired', expired); }, []);
  return <>{loading ? <div className="loading" role="status">正在打开…</div> : account ? <Workspace key={account.accountId} account={account} onLogout={() => setAccount(null)} /> : <Login error={error} onLogin={setAccount} />}</>;
}
function Login({ error: initialError, onLogin }: { error: string; onLogin: (a: PhotoAccount) => void }) {
  const [key, setKey] = useState(''), [error, setError] = useState(initialError), [busy, setBusy] = useState(false); const working = useRef(false);
  async function submit(e: FormEvent) { e.preventDefault(); if (working.current) return; working.current = true; setBusy(true); setError(''); try { const r = await fetch('/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ key }), redirect: 'error' }); if (!r.ok) { const body: unknown = await r.json(); throw new Error(body && typeof body === 'object' && 'message' in body && typeof body.message === 'string' ? body.message : '登录失败，请重试。'); } const value: unknown = await r.json(); const a = PhotoAccountSchema.parse(value); setKey(''); onLogin(a); } catch (e) { setError(message(e)); } finally { working.current = false; setBusy(false); } }
  return <main className="login"><div className="brand"><img src={brandIcon} alt=""/>SolveFlow</div><form onSubmit={e => void submit(e)} className="card login-card"><CaptureArtwork/><h1>拍照解题</h1><label htmlFor="access-key">访问密钥</label><div className="key-input"><Icon name="key"/><input id="access-key" type="password" autoComplete="current-password" value={key} onChange={e => setKey(e.target.value)} maxLength={160} disabled={busy} placeholder="输入访问密钥" required/></div>{error && <p role="alert" className="error">{error}</p>}<button className="primary" disabled={busy || !key.trim()}><span>{busy ? '正在登录…' : '进入'}</span><Icon name="arrow-right"/></button></form></main>;
}
function Workspace({ account, onLogout }: { account: PhotoAccount; onLogout: () => void }) {
  const [runtime, setRuntime] = useState<PhotoRuntime | null>(null), [error, setError] = useState(''), [busy, setBusy] = useState(false), [running, setRunning] = useState(false), [tab, setTab] = useState<'photo' | 'history'>('photo');
  const [exam, setExam] = useState<ExamType>('general'), [record, setRecord] = useState<LocalRecord | null>(null), [history, setHistory] = useState<LocalHistorySummary[]>([]), [draft, setDraft] = useState<Awaited<ReturnType<typeof preparePhoto>> | null>(null), [remove, setRemove] = useState<string | null>(null), [unsaved, setUnsaved] = useState(false);
  const camera = useRef<HTMLInputElement>(null), gallery = useRef<HTMLInputElement>(null), working = useRef(false), runtimeRef = useRef<PhotoRuntime | null>(null), selected = useRef<string | null>(null), alive = useRef(true), revision = useRef(0);
  const keepRecord = useRef<HTMLButtonElement>(null), historyTab = useRef<HTMLButtonElement>(null);
  const deleting = useRef(false); const [removing, setRemoving] = useState(false);
  function withRuns(value: LocalRecord, runs: RunView[]): LocalRecord {
    const outcome = runs.at(-1)?.outcome;
    const subject = outcome && 'candidate' in outcome ? outcome.candidate.problem.subject : value.session.subject;
    return { ...value, session: { ...value.session, subject, runs } };
  }
  function adoptRecord(r: PhotoRuntime, value: LocalRecord) {
    if (!alive.current || runtimeRef.current !== r || selected.current !== value.session.id) return;
    setRecord(current => {
      if (!alive.current || runtimeRef.current !== r || selected.current !== value.session.id) return current;
      let runs = mergeRunViews(current?.session.id === value.session.id ? current.session.runs : [], value.session.runs);
      runs = mergeRunViews(runs, [...r.engine.actives, ...r.engine.unsavedRuns].filter(run => run.sessionId === value.session.id));
      return withRuns(value, runs);
    });
  }
  function readSelected(r: PhotoRuntime, id: string) {
    void r.repository.read(id).then(value => adoptRecord(r, value)).catch(e => {
      if (alive.current && runtimeRef.current === r && selected.current === id) setError(message(e));
    });
  }
  async function refresh() { const r = runtimeRef.current; if (!r) return; const rows = await r.repository.listHistory(); if (alive.current) setHistory(rows); }
  useEffect(() => {
    alive.current = true; let disposed = false; let unsubscribe = () => {}; let unstore = () => {}; let unremote = () => {};
    const serviceError = (e: Event) => { if (e instanceof CustomEvent && typeof e.detail === 'string' && e.detail.length < 200) setError(e.detail); };
    window.addEventListener('photo-service-error', serviceError);
    void openPhotoRuntime(account.accountId).then(async r => {
      if (disposed) { await r.close(); return; } runtimeRef.current = r; setRuntime(r);
      unsubscribe = r.engine.subscribe(run => {
        if (disposed) return;
        setRunning(r.engine.actives.length > 0 || r.remote.pending);
        if (selected.current === run.sessionId) setRecord(current => current?.session.id === run.sessionId ? withRuns(current, mergeRunViews(current.session.runs, [run])) : current);
        void refresh().catch(e => setError(message(e)));
      });
      unstore = r.engine.subscribeStorage(() => {
        setUnsaved(r.engine.storageBlocked); setRunning(r.engine.actives.length > 0 || r.remote.pending);
        const pending = r.engine.unsavedRuns.find(run => run.sessionId === selected.current);
        if (pending) setRecord(value => value?.session.id === pending.sessionId ? withRuns(value, mergeRunViews(value.session.runs, [pending])) : value);
      });
      unremote = r.remote.subscribe(() => { if (disposed) return; setRunning(r.engine.actives.length > 0 || r.remote.pending); void refresh().catch(e => setError(message(e))); if (selected.current) readSelected(r, selected.current); });
      if (r.remote.latestSessionId) { selected.current = r.remote.latestSessionId; adoptRecord(r, await r.repository.read(r.remote.latestSessionId)); }
      setRunning(r.engine.actives.length > 0 || r.remote.pending);
      await refresh();
    }).catch(e => { if (!disposed) setError(message(e)); });
    return () => { disposed = true; alive.current = false; revision.current++; window.removeEventListener('photo-service-error', serviceError); unsubscribe(); unstore(); unremote(); const r = runtimeRef.current; runtimeRef.current = null; if (r) void r.close(); };
  }, [account.accountId]);
  async function pick(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]; e.target.value = ''; if (!file || working.current || running || runtimeRef.current?.remote.pending) return;
    working.current = true; setBusy(true); setError(''); const ticket = ++revision.current;
    try { const photo = await preparePhoto(file); if (alive.current && ticket === revision.current) { selected.current = null; setRecord(null); setDraft(photo); setTab('photo'); } } catch (e) { if (alive.current) setError(message(e)); } finally { working.current = false; if (alive.current) setBusy(false); }
  }
  async function solve(retry = false) {
    const r = runtimeRef.current; if (!r || working.current || r.engine.active || r.remote.pending || unsaved || (!draft && !record)) return;
    working.current = true; setBusy(true); setError('');
    try { let current = record; if (!retry && draft) { current = await r.engine.create(draft.image, draft.width, draft.height, exam); selected.current = current.session.id; setRecord(current); setDraft(null); }
      if (!current) return;
      await r.engine.start(current.session.id, '', undefined, r.remote.execute); setRunning(r.engine.actives.length > 0 || r.remote.pending); await refresh();
    } catch (e) { setError(message(e)); } finally { working.current = false; if (alive.current) setBusy(false); }
  }
  async function open(id: string) { const r = runtimeRef.current; if (!r || busy) return; const ticket = ++revision.current; setError(''); try { const row = await r.repository.read(id); if (alive.current && ticket === revision.current) { selected.current = id; adoptRecord(r, row); setExam(row.exam ?? 'general'); setDraft(null); setTab('photo'); } } catch (e) { if (alive.current && ticket === revision.current) setError(message(e)); } }
  async function logout() { if (working.current) return; setBusy(true); try { await runtime?.remote.cancel(); const r = await fetch('/api/logout', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }); if (!r.ok) throw new Error('退出失败，请重试。'); onLogout(); } catch (e) { setError(message(e)); setBusy(false); } }
  async function removeRecord() {
    if (!remove || !runtime || deleting.current) return;
    const id = remove; deleting.current = true; setRemoving(true);
    try {
      await runtime.engine.remove(id);
      if (selected.current === id) { selected.current = null; setRecord(null); }
      // Remove the invoking row before closing, so focus can return to the history tab.
      setHistory(rows => rows.filter(row => row.id !== id));
      setRemove(current => current === id ? null : current); await refresh();
    } catch (e) { setError(message(e)); }
    finally { deleting.current = false; if (alive.current) setRemoving(false); }
  }
  const run = record?.session.runs.at(-1), outcome = run?.outcome;
  const prior = !outcome || outcome.status === 'failed' || outcome.status === 'cancelled' ? record?.session.runs.slice(0, -1).reverse().find(item => item.outcome?.status === 'completed')?.outcome : undefined;
  const shownOutcome = outcome && 'candidate' in outcome ? outcome : prior;
  const candidate = shownOutcome && 'candidate' in shownOutcome ? shownOutcome.candidate : undefined;
  const previousAnswer = !!candidate && shownOutcome !== outcome;
  const labels: Record<string, string> = { queued: '正在识别题目', understanding: '正在识别题目', solving: '正在解答', verifying: '正在核对', revising: '正在复核答案' };
  const isCurrentRunning = !!run && (!terminal(run.status) || !!runtime?.remote.has(run.id));
  return <div className="app"><div className="header-bar"><header className="header"><a className="brand" href="/" onClick={e => { e.preventDefault(); setTab('photo'); }}><img src={brandIcon} alt=""/>SolveFlow</a><div className="header-actions"><ExamPicker value={exam} disabled={busy || running} onChange={setExam}/><button className="icon-button logout-button" aria-label="退出登录" title="退出登录" onClick={() => void logout()} disabled={busy || unsaved}><Icon name="logout"/></button></div></header></div><main className="content"><nav className="tabs" aria-label="页面"><button role="tab" aria-selected={tab === 'photo'} onClick={() => setTab('photo')}><Icon name="camera"/>拍照解题</button><button ref={historyTab} role="tab" aria-selected={tab === 'history'} onClick={() => { setTab('history'); void refresh().catch(e => setError(message(e))); }}><Icon name="history"/>历史记录{history.length ? <span className="tab-count">{history.length}</span> : null}</button></nav>
    {error && <p role="alert" className="error banner">{error}</p>}
    {runtime?.remote.cancellationPending && <p role="status" className="muted banner">停止请求待联网同步。</p>}
    {unsaved && <div role="alert" className="error banner">答案尚未保存，请保持此页打开。<button onClick={() => void runtime?.engine.retryPendingSaves().then(() => refresh()).catch(e => setError(message(e)))}>重试保存</button></div>}
    {tab === 'photo' ? <><section className={`capture ${draft || record ? 'compact' : ''}`}>
      {!draft && !record && <CaptureArtwork/>}
      <div className="capture-body">{!draft && !record && <h1>把题目拍清楚</h1>}
        <div className="capture-actions"><button className="camera-entry" onClick={() => camera.current?.click()} disabled={busy || running || !runtime || unsaved}><Icon name="camera"/><span>{draft || record ? '拍下一题' : '拍摄题目'}</span></button><button className="album-entry" onClick={() => gallery.current?.click()} disabled={busy || running || !runtime || unsaved}><Icon name="album"/><span>从相册选择</span></button></div>
      </div>
    </section>
      {busy && <p role="status" className="muted">正在处理…</p>}
      {draft && <section className="card preview"><img src={draft.image} alt="待解答题图"/><button className="primary" disabled={busy || running || unsaved} onClick={() => void solve()}>开始解题</button></section>}
      {record && <section className="card result" aria-label="题目与答案">{isCurrentRunning ? <div className="progress" role="status"><span className="spinner"/>{runtime?.remote.has(run.id) && terminal(run.status) ? '正在同步答题结果' : labels[run.status] ?? '正在解答'}<button onClick={() => void runtime?.remote.cancel().catch(e => setError(message(e)))}>停止</button></div> : null}
        {run?.status === 'failed' && !isCurrentRunning && <p role="alert" className="error">{outcome && 'error' in outcome ? failureMessage(outcome.error) : '本次解答未完成。'}</p>}
        {run?.status === 'cancelled' && <p className="muted">本次解答已停止。</p>}
        {candidate && <>{candidate.kind === 'answer' ? <><div className="answer-heading"><h1>{candidate.selectedOptions?.length ? `答案 ${candidate.selectedOptions.join('、')}` : '解答'}</h1><span className="muted">{previousAnswer ? '上次答案' : shownOutcome && 'verified' in shownOutcome && shownOutcome.verified ? '已校验' : '未校验'}</span></div><div className="markdown"><RichText text={candidate.answer}/>{candidate.questions?.map(q => <div key={q.number}><h2>第{q.number}题</h2><RichText text={q.answer}/></div>)}</div></> : <div className="clarification"><h2>还需要补充信息</h2>{candidate.clarificationQuestions.map(q => <p key={q}>{q}</p>)}</div>}
        </>}
        <details className="question"><summary>查看题目</summary>{candidate && <div className="markdown"><RichText text={candidate.problem.text}/>{candidate.problem.options?.map(o => <div className="option" key={o.label}><b>{o.label}.</b> <RichText text={o.text}/></div>)}</div>}<img src={record.image} alt="题目原图"/></details>
        {!isCurrentRunning && <button className="secondary" onClick={() => void solve(true)} disabled={busy || running || unsaved}>{candidate ? '重新解答' : '重新尝试'}</button>}
      </section>}
      {!record && !draft && history.length > 0 && <section className="recent"><h2>最近解答</h2>{history.slice(0,3).map(row => <HistoryRow key={row.id} row={row} onOpen={() => void open(row.id)}/>)}</section>}
    </> : <section className="history">{!history.length ? <div className="empty card"><CaptureArtwork history/><h1>还没有答题记录</h1><button className="secondary empty-action" onClick={() => setTab('photo')}>去拍一道题<Icon name="arrow-right"/></button></div> : <div className="card history-card">{history.map(row => <HistoryRow key={row.id} row={row} onOpen={() => void open(row.id)} onRemove={() => setRemove(row.id)} busy={removing}/>)}</div>}</section>}
    </main><input ref={camera} type="file" accept="image/*,.heic,.heif" capture="environment" onChange={e => void pick(e)} hidden aria-label="拍照题图"/><input ref={gallery} type="file" accept="image/*,.heic,.heif" onChange={e => void pick(e)} hidden aria-label="相册题图"/>
    {remove && <Dialog title="删除这条记录？" className="photo-dialog" onClose={() => setRemove(null)} initialFocus={keepRecord} returnFocus={historyTab}><div className="modal-actions"><button ref={keepRecord} className="secondary" onClick={() => setRemove(null)} disabled={removing}>保留</button><button className="danger" onClick={() => void removeRecord()} disabled={removing}>{removing ? '正在删除…' : '删除记录'}</button></div></Dialog>}
  </div>;
}
function HistoryRow({ row, onOpen, onRemove, busy = false }: { row: LocalHistorySummary; onOpen: () => void; onRemove?: () => void; busy?: boolean }) {
  return <article className="history-row"><button className="history-open" onClick={onOpen}><span className={`history-symbol ${row.answerState === 'verified' ? 'green' : ''}`}><Icon name="book"/></span><span className="history-body"><strong>{row.text || '待解答题目'}</strong><small>{new Date(row.createdAt).toLocaleString('zh-CN', { month:'numeric', day:'numeric', hour:'2-digit', minute:'2-digit' })}</small></span><Icon name="chevron-right" className="chevron"/></button>{onRemove && <button className="icon-button delete-button" aria-label="删除历史记录" title="删除历史记录" onClick={onRemove} disabled={busy}><Icon name="trash"/></button>}</article>;
}
const root = document.getElementById('root'); if (!root) throw new Error('Missing app root.'); createRoot(root).render(<App/>);
