import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import { createRoot } from 'react-dom/client';
import { EXAM_LABELS, ExamTypeSchema, type ExamType, type LocalRecord, type LocalHistorySummary } from '@solveflow/contracts/local';
import { terminal } from '@solveflow/contracts/http';
import { PhotoAccountSchema, type PhotoAccount } from '@solveflow/contracts/photo';
import { openPhotoRuntime, executePhoto, type PhotoRuntime } from './runtime.js';
import { preparePhoto } from './photo.js';
import { RichText } from './markdown.js';
import './styles.css';
const message = (e: unknown) => e instanceof Error ? e.message : '操作未完成，请重试。';
function CameraIcon() { return <svg viewBox="0 0 48 48" fill="none" aria-hidden="true"><path d="M7 15h9l4-6h9l4 6h8v24H7z" stroke="currentColor" strokeWidth="2.8" strokeLinejoin="round"/><circle cx="24" cy="26" r="7" stroke="currentColor" strokeWidth="2.8"/></svg>; }
function App() {
  const [account, setAccount] = useState<PhotoAccount | null>(null), [loading, setLoading] = useState(true), [error, setError] = useState('');
  async function check() { try { const r = await fetch('/api/session', { cache: 'no-store' }); if (r.status === 401) { setAccount(null); return; } if (!r.ok) throw new Error('暂时无法连接服务。'); setAccount(PhotoAccountSchema.parse(await r.json())); } catch (e) { setError(message(e)); } finally { setLoading(false); } }
  useEffect(() => { void check(); const expired = () => { setAccount(null); setError('登录已失效，请重新输入访问密钥。'); }; window.addEventListener('photo-auth-expired', expired); return () => window.removeEventListener('photo-auth-expired', expired); }, []);
  return <>{loading ? <div className="loading" role="status">正在打开…</div> : account ? <Workspace key={account.accountId} account={account} onLogout={() => setAccount(null)} /> : <Login error={error} onLogin={setAccount} />}</>;
}
function Login({ error: initialError, onLogin }: { error: string; onLogin: (a: PhotoAccount) => void }) {
  const [key, setKey] = useState(''), [error, setError] = useState(initialError), [busy, setBusy] = useState(false); const working = useRef(false);
  async function submit(e: FormEvent) { e.preventDefault(); if (working.current) return; working.current = true; setBusy(true); setError(''); try { const r = await fetch('/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ key }), redirect: 'error' }); if (!r.ok) { const body: unknown = await r.json(); throw new Error(body && typeof body === 'object' && 'message' in body && typeof body.message === 'string' ? body.message : '登录失败，请重试。'); } const value: unknown = await r.json(); const a = PhotoAccountSchema.parse(value); setKey(''); onLogin(a); } catch (e) { setError(message(e)); } finally { working.current = false; setBusy(false); } }
  return <main className="login"><div className="brand"><img src="/icon.svg" alt=""/>SolveFlow</div><form onSubmit={e => void submit(e)} className="card login-card"><div className="login-symbol"><CameraIcon/></div><h1>拍照解题</h1><label htmlFor="access-key">访问密钥</label><input id="access-key" type="password" autoComplete="current-password" value={key} onChange={e => setKey(e.target.value)} maxLength={160} disabled={busy} placeholder="输入访问密钥" required/>{error && <p role="alert" className="error">{error}</p>}<button className="primary" disabled={busy || !key.trim()}>{busy ? '正在登录…' : '进入'}</button></form></main>;
}
function Workspace({ account, onLogout }: { account: PhotoAccount; onLogout: () => void }) {
  const [runtime, setRuntime] = useState<PhotoRuntime | null>(null), [error, setError] = useState(''), [busy, setBusy] = useState(false), [running, setRunning] = useState(false), [tab, setTab] = useState<'photo' | 'history'>('photo');
  const [exam, setExam] = useState<ExamType>('act'), [record, setRecord] = useState<LocalRecord | null>(null), [history, setHistory] = useState<LocalHistorySummary[]>([]), [draft, setDraft] = useState<Awaited<ReturnType<typeof preparePhoto>> | null>(null), [remove, setRemove] = useState<string | null>(null), [unsaved, setUnsaved] = useState(false);
  const camera = useRef<HTMLInputElement>(null), gallery = useRef<HTMLInputElement>(null), working = useRef(false), runtimeRef = useRef<PhotoRuntime | null>(null), selected = useRef<string | null>(null), alive = useRef(true), revision = useRef(0);
  async function refresh() { const r = runtimeRef.current; if (!r) return; const rows = await r.repository.listHistory(); if (alive.current) setHistory(rows); }
  useEffect(() => {
    alive.current = true; let disposed = false; let unsubscribe = () => {}; let unstore = () => {};
    const serviceError = (e: Event) => { if (e instanceof CustomEvent && typeof e.detail === 'string' && e.detail.length < 200) setError(e.detail); };
    window.addEventListener('photo-service-error', serviceError);
    void openPhotoRuntime(account.accountId).then(async r => {
      if (disposed) { await r.close(); return; } runtimeRef.current = r; setRuntime(r);
      unsubscribe = r.engine.subscribe(run => { if (disposed) return; setRunning(r.engine.actives.length > 0); if (selected.current === run.sessionId) void r.repository.read(run.sessionId).then(value => { if (!disposed && selected.current === value.session.id) setRecord(value); }).catch(e => setError(message(e))); void refresh().catch(e => setError(message(e))); });
      unstore = r.engine.subscribeStorage(() => {
        setUnsaved(r.engine.storageBlocked); setRunning(r.engine.actives.length > 0);
        const pending = r.engine.unsavedRuns.find(run => run.sessionId === selected.current);
        if (pending) setRecord(value => value?.session.id === pending.sessionId ? { ...value, session: { ...value.session, runs: value.session.runs.map(run => run.id === pending.id ? pending : run) } } : value);
      });
      await refresh();
    }).catch(e => { if (!disposed) setError(message(e)); });
    return () => { disposed = true; alive.current = false; revision.current++; window.removeEventListener('photo-service-error', serviceError); unsubscribe(); unstore(); const r = runtimeRef.current; runtimeRef.current = null; if (r) void r.close(); };
  }, [account.accountId]);
  async function pick(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]; e.target.value = ''; if (!file || working.current || running) return;
    working.current = true; setBusy(true); setError(''); const ticket = ++revision.current;
    try { const photo = await preparePhoto(file); if (alive.current && ticket === revision.current) { selected.current = null; setRecord(null); setDraft(photo); setTab('photo'); } } catch (e) { if (alive.current) setError(message(e)); } finally { working.current = false; if (alive.current) setBusy(false); }
  }
  async function solve(retry = false) {
    const r = runtimeRef.current; if (!r || working.current || r.engine.active || unsaved || (!draft && !record)) return;
    working.current = true; setBusy(true); setError('');
    try { let current = record; if (!retry && draft) { current = await r.engine.create(draft.image, draft.width, draft.height, exam); selected.current = current.session.id; setRecord(current); setDraft(null); }
      if (!current) return;
      await r.engine.start(current.session.id, '', undefined, executePhoto); setRunning(r.engine.actives.length > 0); await refresh();
    } catch (e) { setError(message(e)); } finally { working.current = false; if (alive.current) setBusy(false); }
  }
  async function open(id: string) { const r = runtimeRef.current; if (!r || busy) return; const ticket = ++revision.current; setError(''); try { const row = await r.repository.read(id); if (alive.current && ticket === revision.current) { selected.current = id; setRecord(row); setExam(row.exam ?? 'act'); setDraft(null); setTab('photo'); } } catch (e) { setError(message(e)); } }
  async function logout() { if (working.current) return; setBusy(true); try { await runtime?.engine.cancel(); const r = await fetch('/api/logout', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }); if (!r.ok) throw new Error('退出失败，请重试。'); onLogout(); } catch (e) { setError(message(e)); setBusy(false); } }
  async function removeRecord() { if (!remove || !runtime) return; try { await runtime.engine.remove(remove); if (selected.current === remove) { selected.current = null; setRecord(null); } setRemove(null); await refresh(); } catch (e) { setError(message(e)); } }
  const run = record?.session.runs.at(-1); const outcome = run?.outcome; const candidate = outcome && 'candidate' in outcome ? outcome.candidate : undefined;
  const labels: Record<string, string> = { queued: '正在识别题目', understanding: '正在识别题目', solving: '正在解答', verifying: '正在核对', revising: '正在复核答案' };
  const isCurrentRunning = !!run && !terminal(run.status);
  return <div className="app"><header className="header"><a className="brand" href="/" onClick={e => { e.preventDefault(); setTab('photo'); }}><img src="/icon.svg" alt=""/>SolveFlow</a><div className="header-actions"><label className="exam"><span className="sr-only">考试类型</span><select aria-label="考试类型" value={exam} disabled={busy || running} onChange={e => setExam(ExamTypeSchema.parse(e.target.value))}>{ExamTypeSchema.options.map(x => <option key={x} value={x}>{EXAM_LABELS[x]}</option>)}</select></label><button className="icon-button" aria-label="退出登录" onClick={() => void logout()} disabled={busy}>↪</button></div></header><main className="content"><nav className="tabs" aria-label="页面"><button role="tab" aria-selected={tab === 'photo'} onClick={() => setTab('photo')}>拍照解题</button><button role="tab" aria-selected={tab === 'history'} onClick={() => { setTab('history'); void refresh().catch(e => setError(message(e))); }}>历史记录{history.length ? <span>{history.length}</span> : null}</button></nav>
    {error && <p role="alert" className="error banner">{error}</p>}
    {unsaved && <div role="alert" className="error banner">答案尚未保存，请保持此页打开。<button onClick={() => void runtime?.engine.retryPendingSaves().then(() => refresh()).catch(e => setError(message(e)))}>重试保存</button></div>}
    {tab === 'photo' ? <><section className={`capture ${draft || record ? 'compact' : ''}`}><button className="camera-entry" onClick={() => camera.current?.click()} disabled={busy || running || !runtime || unsaved}><CameraIcon/><strong>{draft || record ? '拍下一题' : '拍摄题目'}</strong></button><button className="album-entry" onClick={() => gallery.current?.click()} disabled={busy || running || !runtime || unsaved}>从相册选择</button></section>
      {busy && <p role="status" className="muted">正在处理…</p>}
      {draft && <section className="card preview"><img src={draft.image} alt="待解答题图"/><button className="primary" disabled={busy || running || unsaved} onClick={() => void solve()}>开始解题</button></section>}
      {record && <section className="card result" aria-label="题目与答案">{isCurrentRunning ? <div className="progress" role="status"><span className="spinner"/>{labels[run.status] ?? '正在解答'}<button onClick={() => void runtime?.engine.cancel().catch(e => setError(message(e)))}>停止</button></div> : null}
        {candidate && <>{candidate.kind === 'answer' ? <><div className="answer-heading"><h1>{candidate.selectedOptions?.length ? `答案 ${candidate.selectedOptions.join('、')}` : '解答'}</h1><span className="muted">{outcome && 'verified' in outcome && outcome.verified ? '已校验' : '未校验'}</span></div><div className="markdown"><RichText text={candidate.answer}/>{candidate.questions?.map(q => <div key={q.number}><h2>第{q.number}题</h2><RichText text={q.answer}/></div>)}</div></> : <div className="clarification"><h2>还需要补充信息</h2>{candidate.clarificationQuestions.map(q => <p key={q}>{q}</p>)}</div>}
          <details className="question"><summary>查看题目</summary><div className="markdown"><RichText text={candidate.problem.text}/>{candidate.problem.options?.map(o => <div className="option" key={o.label}><b>{o.label}.</b> <RichText text={o.text}/></div>)}</div><img src={record.image} alt="题目原图"/></details></>}
        {run?.status === 'failed' && <p role="alert" className="error">{outcome && 'error' in outcome ? outcome.error.message : '本次解答未完成。'}</p>}
        {run?.status === 'cancelled' && <p className="muted">本次解答已停止。</p>}
        {!isCurrentRunning && <button className="secondary" onClick={() => void solve(true)} disabled={busy || running || unsaved}>{candidate ? '重新解答' : '重新尝试'}</button>}
      </section>}
      {!record && !draft && history.length > 0 && <section className="recent"><h2>最近解答</h2>{history.slice(0,3).map(row => <HistoryRow key={row.id} row={row} onOpen={() => void open(row.id)}/>)}</section>}
    </> : <section className="history">{!history.length ? <div className="empty">还没有答题记录</div> : history.map(row => <HistoryRow key={row.id} row={row} onOpen={() => void open(row.id)} onRemove={() => setRemove(row.id)}/>)}</section>}
    </main><input ref={camera} type="file" accept="image/*" capture="environment" onChange={e => void pick(e)} hidden aria-label="拍照题图"/><input ref={gallery} type="file" accept="image/*" onChange={e => void pick(e)} hidden aria-label="相册题图"/>
    {remove && <div className="modal-backdrop"><section role="dialog" aria-modal="true" aria-labelledby="delete-title" className="card modal"><h2 id="delete-title">删除这条记录？</h2><div className="modal-actions"><button className="secondary" onClick={() => setRemove(null)}>保留</button><button className="danger" onClick={() => void removeRecord()}>删除记录</button></div></section></div>}
  </div>;
}
function HistoryRow({ row, onOpen, onRemove }: { row: LocalHistorySummary; onOpen: () => void; onRemove?: () => void }) {
  return <article className="history-row"><button className="history-open" onClick={onOpen}><span className={`dot ${row.answerState === 'verified' ? 'green' : ''}`}/><span className="history-body"><strong>{row.text || '待解答题目'}</strong><small>{new Date(row.createdAt).toLocaleString('zh-CN', { month:'numeric', day:'numeric', hour:'2-digit', minute:'2-digit' })}</small></span><span className="chevron">›</span></button>{onRemove && <button className="icon-button" aria-label="删除历史记录" onClick={onRemove}>×</button>}</article>;
}
const root = document.getElementById('root'); if (!root) throw new Error('Missing app root.'); createRoot(root).render(<App/>);
