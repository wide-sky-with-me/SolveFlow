// Decision: .agents/notes/implemented/architecture/2026-11-04-managed-exam-audit-fixes.md
// Decision: .agents/notes/implemented/architecture/2026-11-03-exam-answer-presentation.md
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { createRoot } from 'react-dom/client';
import { z } from 'zod';
import { ExamSessionSchema, type ExamUser } from '@solveflow/contracts/managed-exam';
import { Icon } from '@solveflow/web-ui/icons';
import { api, idResponse, post, RequestError, identityChanged } from './api.js';
import { Brand, ErrorText } from './components.js';
import { Admin } from './admin.js';
import { AppearanceMenu } from './appearance.js';
import { readSidebarCollapsed, saveSidebarCollapsed } from './layout-preference.js';
import { StudentWorkspace } from './student-workspace.js';
import { StudentHeaderSlot, type StudentNavigation } from './student-header.js';
import { AccountMenu } from './account-menu.js';
import { ImageSession } from './image-session.js';
import './styles.css';
import './review.css';
import './notifications.css';
import './console.css';
import './home.css';
import './paging.css';
import './practice.css';
import './exam-clock.css';
import './design.css';
function App() {
    const [studentHeader, setStudentHeader] = useState<HTMLDivElement | null>(null);
    const [studentNavigation, setStudentNavigation] = useState<StudentNavigation>({version:0,view:'home'}), [homeVersion, setHomeVersion] = useState(0);
    const [collapsed, setCollapsed] = useState(readSidebarCollapsed), [mobileNav, setMobileNav] = useState(false), [narrow, setNarrow] = useState(() => matchMedia('(max-width: 900px)').matches);
    useEffect(() => { const query=matchMedia('(max-width: 900px)'); const change=()=>{setNarrow(query.matches);if(!query.matches)setMobileNav(false);};query.addEventListener('change',change);return()=>query.removeEventListener('change',change); }, []);
    const authGeneration = useRef(0), authRequest = useRef<AbortController | null>(null);
    const [user, setUser] = useState<ExamUser | null>(null), [ready, setReady] = useState(false), [error, setError] = useState(''), [busy, setBusy] = useState(false), [attempt, setAttempt] = useState<string | null>(null), [staffMode, setStaffMode] = useState(location.pathname === '/admin');
    useEffect(() => {
        const controller = new AbortController(), generation = authGeneration.current;
        authRequest.current = controller;
        const current = () => !controller.signal.aborted && generation === authGeneration.current;
        void api('/session', ExamSessionSchema, { signal: controller.signal }).then(session => {
            if (!current()) return;
            setUser(session.user);
            setStaffMode(session.user.roles.some(r => r !== 'student'));
        }).catch(error => {
            if (current() && !(error instanceof RequestError && error.status === 401))
                setError(error instanceof Error ? error.message : '服务暂不可用。');
        }).finally(() => { if (current()) setReady(true); if (authRequest.current === controller) authRequest.current = null; });
        return () => controller.abort();
    }, []);
    useEffect(() => {
        const clear = (message: string) => {
            authGeneration.current++; authRequest.current?.abort(); authRequest.current = null;
            setUser(null); setAttempt(null); setBusy(false); setReady(true); setMobileNav(false); setError(message);
        };
        const expired = () => clear('登录已失效，请重新登录。');
        const changed = (event: StorageEvent) => { if (event.key === 'solveflow-exam-auth-change') clear('登录身份已在其他页面变化，请重新登录。'); };
        window.addEventListener('exam-auth-expired', expired); window.addEventListener('storage', changed);
        return () => { authRequest.current?.abort(); window.removeEventListener('exam-auth-expired', expired); window.removeEventListener('storage', changed); };
    }, []);
    async function login(event: FormEvent<HTMLFormElement>) {
        event.preventDefault(); if (busy) return;
        const data = new FormData(event.currentTarget), generation = ++authGeneration.current, controller = new AbortController();
        authRequest.current?.abort(); authRequest.current = controller;
        const current = () => !controller.signal.aborted && generation === authGeneration.current;
        setBusy(true); setError('');
        try {
            const session = await api('/auth/login', ExamSessionSchema, { ...post({ username: String(data.get('username')), password: String(data.get('password')) }), signal: controller.signal });
            if (!current()) return;
            setAttempt(null); setStudentNavigation({version:0,view:'home'}); setUser(session.user); setStaffMode(session.user.roles.some(r => r !== 'student')); identityChanged();
        } catch (error) { if (current()) setError(error instanceof Error ? error.message : '登录失败。'); }
        finally { if (current()) setBusy(false); if (authRequest.current === controller) authRequest.current = null; }
    }
    async function logout() {
        if (busy) return;
        const generation = ++authGeneration.current, controller = new AbortController();
        authRequest.current?.abort(); authRequest.current = controller;
        const current = () => !controller.signal.aborted && generation === authGeneration.current;
        setBusy(true); setError('');
        try {
            await api('/auth/logout', z.object({ ok: z.boolean() }), { method: 'POST', signal: controller.signal });
            if (!current()) return;
            setUser(null); setAttempt(null); setMobileNav(false); identityChanged();
        } catch (error) { if (current()) setError(error instanceof Error ? error.message : '退出失败。'); }
        finally { if (current()) setBusy(false); if (authRequest.current === controller) authRequest.current = null; }
    }
    async function start(id: string) { const generation = authGeneration.current;  setBusy(true); setError(''); try {
        const next = await api('/assignments/' + id + '/start', idResponse, { method: 'POST' });
        if (generation === authGeneration.current) setAttempt(next.id);
    }
    catch (error) {
        if (generation === authGeneration.current) setError(error instanceof Error ? error.message : '进入失败。');
    }
    finally {
        if (generation === authGeneration.current) setBusy(false);
    } }
    if (!ready)
        return <main className="loading">正在连接…</main>;
    if (!user)
        return <main className="login-shell"><div className="login-appearance"><AppearanceMenu/></div><section className="card login-card"><Brand /><h1>登录考试</h1><form onSubmit={event => void login(event)}><label>用户名<input name="username" autoComplete="username" required maxLength={64}/></label><label>密码<input name="password" type="password" autoComplete="current-password" required maxLength={256}/></label><ErrorText error={error}/><button className="primary full" type="submit" disabled={busy}>{busy ? '正在登录…' : '登录'}</button></form></section></main>;
    const staff = user.roles.some(r => r !== 'student'), activeExam = !(staff && staffMode) && !!attempt;
    function navigateStudent(view: StudentNavigation['view']) { setAttempt(null); setError(''); setStudentNavigation(current=>({version:current.version+1,view})); }
    return <ImageSession key={user.id}><StudentHeaderSlot.Provider value={activeExam ? studentHeader : null}><header className={'header-bar '+(staff && staffMode?'console-header':'student-header')+(activeExam?' has-exam':'')}><div className="header"><div className="header-brand"><button className="brand-home" aria-label="返回首页" disabled={busy} onClick={()=>{setMobileNav(false);if(staff&&staffMode)setHomeVersion(value=>value+1);else navigateStudent('home');}}><Brand /></button>{staff && staffMode && <button className="icon-button sidebar-trigger" aria-label={narrow ? mobileNav ? '关闭导航' : '展开导航' : collapsed ? '展开导航' : '收起导航'} aria-expanded={narrow ? mobileNav : !collapsed} onClick={() => {if(narrow)setMobileNav(v=>!v);else setCollapsed(value=>{saveSidebarCollapsed(!value);return !value;});}}><Icon name="panel-left"/></button>}</div>{activeExam&&<div className="student-exam-header-slot" ref={setStudentHeader}/>}<div className="toolbar header-tools"><AppearanceMenu/>{staff && staffMode && user.roles.includes('student') && <button className="quiet" onClick={() => setStaffMode(v => !v)}>{staffMode ? '学生端' : '管理端'}</button>}{staff&&staffMode?<><span className="user-avatar" aria-hidden="true">{user.displayName.slice(0,1)}</span><span className="user-name">{user.displayName}</span><button className="icon-button" aria-label="退出登录" onClick={() => void logout()} disabled={busy}><Icon name="logout"/></button></>:<AccountMenu name={user.displayName} busy={busy} onHistory={()=>navigateStudent('history')} onLogout={()=>void logout()} {...(staff?{onManagement:()=>setStaffMode(true)}:{})}/>}</div></div></header>
    {staff && staffMode ? <Admin key={homeVersion} user={user} collapsed={collapsed} mobileNav={mobileNav} onNavClose={()=>setMobileNav(false)}/> : <StudentWorkspace key={user.id} navigation={studentNavigation} attempt={attempt} busy={busy} error={error} onAttempt={setAttempt} onStart={start}/>}
  </StudentHeaderSlot.Provider></ImageSession>;
}
const root = document.getElementById('root');
if (!root)
    throw new Error('MISSING_ROOT');
createRoot(root).render(<App />);
