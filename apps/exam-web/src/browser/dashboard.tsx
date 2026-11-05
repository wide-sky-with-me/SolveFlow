import { ExamClock } from './exam-clock.js';
// Decision: .agents/notes/implemented/architecture/2026-11-03-exam-console-dashboard.md
import { useEffect, useRef, useState } from 'react';
import type { z } from 'zod';
import { ExamDashboardSchema, ExamChoicePageSchema, type ExamProgressSchema } from '@solveflow/contracts/managed-exam';
import { EXAM_LABELS } from '@solveflow/contracts/exam';
import { Icon } from '@solveflow/web-ui/icons';
import { Select } from '@solveflow/web-ui/select';
import { alertLabels, ErrorText, RefreshButton } from './components.js';
import { PublicationChart, Distribution } from './charts.js';
import { AppearanceMenu } from './appearance.js';
import { WallContent } from './wall.js';
import { RemoteSelect } from './remote-select.js';
import { HomeContent } from './home.js';
import { usePageResource } from './paging.js';

type Progress = z.infer<typeof ExamProgressSchema>;
const number = (value: number) => value.toLocaleString('zh-CN');

export function StudentProgressTable({ progress, onWatch, limit }: { progress: Progress[]; onWatch: (id: string) => void; limit?: number }) {
    const sorted = [...progress].sort((a,b) => b.attention-a.attention || b.active-a.active || Number(b.online)-Number(a.online) || a.studentName.localeCompare(b.studentName));
    const rows = limit ? sorted.slice(0, limit) : sorted;
    return <div className="table-wrap console-table student-progress-table"><table role="table"><colgroup><col className="progress-student"/><col className="progress-position-column"/><col className="progress-number" span={3}/><col className="progress-status-column"/><col className="progress-duration"/><col className="progress-action"/></colgroup><thead><tr><th>学生 / 场次</th><th>当前位置</th><th>已有答案</th><th>AI 核验</th><th>待处理</th><th>状态</th><th>用时</th><th>操作</th></tr></thead><tbody>{rows.map(p => <tr role="row" className="student-row" key={p.assignmentId} onClick={() => { if(p.attemptId) onWatch(p.attemptId); }}>
      <td role="cell" data-label="学生 / 场次"><strong title={p.studentName}>{p.studentName}</strong><span className="table-sub">{p.title}</span></td><td role="cell" data-label="当前位置"><span className="progress-position" title={p.moduleTitle ? p.moduleTitle+(p.currentPosition?' · 第'+p.currentPosition+'题':'') : '尚未进入'}><span className="progress-module-name">{p.moduleTitle || '尚未进入'}</span>{p.moduleTitle && p.currentPosition ? <span className="progress-question">{' · 第'+p.currentPosition+'题'}</span> : null}</span></td><td role="cell" data-label="已有答案">{p.answered} / {p.total}</td><td role="cell" data-label="AI 核验">{p.verified}</td><td role="cell" data-label="待处理">{p.attention ? <span className="badge red">{p.attention} 题</span> : '—'}</td><td role="cell" data-label="状态"><span className="progress-status"><span><i className={'connection-dot'+(p.online?' online':'')}/>{p.online?'在线':'离线'}</span>{p.active>0 && <span className="badge blue">处理中</span>}</span></td><td role="cell" data-label="用时"><ExamClock timing={p.timing} compact/></td><td role="cell" data-label="操作"><button className="quiet" disabled={!p.attemptId} onClick={e => {e.stopPropagation();if(p.attemptId)onWatch(p.attemptId);}}>查看</button></td>
    </tr>)}</tbody></table>{!rows.length && <p className="empty">暂无考试分配</p>}</div>;
}

export function Dashboard({ wall = false, analytics = false, onWatch, onIssues, onExit, onViewAll }: { wall?: boolean; analytics?: boolean; onWatch: (id: string) => void; onIssues: (reason?: string, sitting?: string) => void; onExit: () => void; onViewAll?: (sitting:string)=>void }) {
    const home = !wall && !analytics;
    const [chartMode,setChartMode]=useState<'area'|'bar'>('area');
    const [sitting, setSitting] = useState(''), [fullscreen,setFullscreen]=useState(false);
    const showIssues = (reason?: string) => onIssues(reason, sitting);
    const root=useRef<HTMLElement>(null);
    const {data,error,loading,refreshing,refreshManually}=usePageResource(ExamDashboardSchema,'/admin/dashboard'+(sitting?'?sittingId='+encodeURIComponent(sitting):''));
    const [fullscreenError,setFullscreenError]=useState('');
    useEffect(()=>{if(data)setFullscreenError('');},[data]);
    useEffect(()=>{
        if(!wall)return;
        const previous=document.body.style.overflow;document.body.style.overflow='hidden';
        const change=()=>setFullscreen(!!document.fullscreenElement);
        document.addEventListener('fullscreenchange',change);
        return()=>{document.body.style.overflow=previous;document.removeEventListener('fullscreenchange',change);if(document.fullscreenElement===root.current)void document.exitFullscreen().catch(()=>{});};
    },[wall]);
    async function toggleFullscreen(){try{if(document.fullscreenElement)await document.exitFullscreen();else if(root.current?.requestFullscreen)await root.current.requestFullscreen();else setFullscreenError('当前浏览器不支持全屏，可使用大屏页面。');}catch{setFullscreenError('无法进入全屏，可继续使用大屏页面。');}}
    const visible=data?.students??[];
    const summary=data?.summary;
    const pending=visible.filter(p=>p.attention>0);
    const issuesPanel = data && <section className="panel issues-panel"><div className="section-head"><h2>待处理原因</h2><button className="quiet" onClick={()=>showIssues()}>查看</button></div><div className="reason-bars">{!data.issues.length && <p className="empty">暂无待处理问题</p>}{data.issues.map(item=><button key={item.reason} onClick={()=>showIssues(item.reason)}><span>{alertLabels[item.reason]}<strong>{item.count}</strong></span><i><b style={{width:(item.count/Math.max(1,...data.issues.map(i=>i.count))*100)+'%'}}/></i></button>)}</div></section>;
    const trendPanel = data && <section className="panel trend-panel"><div className="section-head"><h2>近1小时答案发布</h2><div className="chart-mode" role="group" aria-label="发布图类型"><button aria-pressed={chartMode==='area'} onClick={()=>setChartMode('area')}>趋势</button><button aria-pressed={chartMode==='bar'} onClick={()=>setChartMode('bar')}>柱图</button></div></div><div className="inline-legend"><span><i className="dot-blue"/>AI 答案</span><span><i className="dot-green"/>人工答案</span></div><PublicationChart points={data.throughput} mode={chartMode}/></section>;
    const modulesPanel = data && <section className="panel modules-panel"><div className="section-head"><h2>模块进度</h2></div><div className="module-bars">{!data.modules.length && <p className="empty">暂无已开始的模块</p>}{data.modules.map(m=><div key={JSON.stringify([m.exam,m.title,m.sectionCode])}><div><span title={EXAM_LABELS[m.exam]+' · '+m.title}>{EXAM_LABELS[m.exam]} · {m.title}</span><strong>{m.answered} / {m.total}</strong></div><div className="module-track" role="progressbar" aria-valuenow={m.answered} aria-valuemin={0} aria-valuemax={m.total||1} aria-label={EXAM_LABELS[m.exam]+' · '+m.title+'答题进度'}><i style={{width:(m.total?Math.min(100,m.answered/m.total*100):0)+'%'}}/></div>{m.attention>0 && <button className="module-attention feedback-tone-error" onClick={()=>showIssues()}>{m.attention} 题待处理</button>}</div>)}</div></section>;
    const studentsPanel = data && summary && <section className="panel students-panel"><div className="section-head"><h2>{analytics?'发布明细':'学生进度'}</h2>{!analytics && <div className="toolbar"><span className="muted">{summary.online} 位在线</span>{onViewAll&&<button className="quiet" onClick={()=>onViewAll(sitting)}>查看全部</button>}</div>}</div>{analytics ? <div className="table-wrap console-table"><table><thead><tr><th>时间段</th><th>AI 答案</th><th>人工答案</th><th>合计</th></tr></thead><tbody>{data.throughput.map(p=><tr key={p.at}><td>{new Date(p.at).toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit'})} – {new Date(Date.parse(p.at)+300000).toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit'})}</td><td>{p.ai}</td><td>{p.human}</td><td>{p.ai+p.human}</td></tr>)}</tbody></table></div> : <StudentProgressTable progress={visible} onWatch={onWatch} limit={8}/>}</section>;
    return <section className={'dashboard'+(wall?' display-wall':home?' dashboard-home':'')} ref={root} aria-label={wall?'考试数据大屏':'考试数据看板'}>
      <div className="dashboard-toolbar"><div className="dashboard-filter"><RemoteSelect label="考试场次" allLabel="全部场次" value={sitting} onChange={setSitting} schema={ExamChoicePageSchema} endpoint="/admin/dashboard/sittings/page"/></div><div className="dashboard-controls">{data && <span className="sync-time">更新于 {new Date(data.generatedAt).toLocaleTimeString('zh-CN')}</span>}<RefreshButton secondary busy={refreshing} disabled={loading} onRefresh={refreshManually}/>{wall && <><AppearanceMenu/><button className="secondary" onClick={()=>void toggleFullscreen()}><Icon name="expand"/>{fullscreen?'退出全屏':'全屏'}</button><button className="quiet" onClick={onExit}>返回控制台</button></>}</div></div>
      <ErrorText error={fullscreenError||error}/>{!data && !error && <p className="empty">正在同步看板…</p>}
      {summary && <><div className="console-metrics">{[
        {label:'在线学生',value:summary.online,extra:'/ '+summary.students,icon:'users' as const,tone:'blue'},
        {label:'已有答案',value:summary.answered,extra:'/ '+summary.total,icon:'book' as const,tone:'blue'},
        {label:'AI 已核验',value:summary.verified,icon:'check' as const,tone:'green'},
        {label:'人工确认',value:summary.humanConfirmed,icon:'users' as const,tone:'green'},
        {label:'正在处理',value:summary.active,icon:'history' as const,tone:'blue'},
        {label:'待处理题',value:summary.attention,icon:'alert' as const,tone:'red'},
      ].filter(metric=>!home || (metric.label!=='已有答案' && metric.label!=='待处理题')).map(metric=><article className={'console-metric '+metric.tone} key={metric.label}><div><span>{metric.label}</span><strong>{number(metric.value)}{metric.extra && <small>{metric.extra}</small>}</strong></div><span className="metric-icon"><Icon name={metric.icon}/></span>{metric.label==='待处理题' && <button className="metric-link" aria-label="查看待处理题" onClick={()=>showIssues()}/>}</article>)}</div>
      {wall ? <WallContent data={data} trend={trendPanel} modules={modulesPanel} issues={issuesPanel} onWatch={onWatch} onIssues={()=>showIssues()} {...(onViewAll?{onViewAll:()=>onViewAll(sitting)}:{})}/> : home ? <HomeContent data={data} trend={trendPanel} modules={modulesPanel} issues={issuesPanel} students={studentsPanel} onIssues={()=>showIssues()}/> : <>
      {pending.length>0 && <section className="console-attention feedback-tone-error" aria-label="学生待处理问题"><strong>{summary.attention} 题待处理</strong><div>{pending.map(p=><button key={p.assignmentId} onClick={()=>{if(p.attemptId)onWatch(p.attemptId);}}>{p.studentName}<span>{p.attention}</span></button>)}</div><button className="quiet" onClick={()=>showIssues()}>全部问题<Icon name="chevron-right"/></button></section>}
      <div className="dashboard-charts">{trendPanel}
      <section className="panel distribution-panel"><div className="section-head"><h2>题目状态</h2></div><Distribution data={data.distribution}/></section>
      {issuesPanel}</div>
      <div className={'dashboard-bottom'+(analytics?' analytics':'')}>{modulesPanel}
      {studentsPanel}</div></>}</>}
    </section>;
}
