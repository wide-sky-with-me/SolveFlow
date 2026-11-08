// Decision: .agents/notes/implemented/architecture/2026-11-03-exam-console-dashboard.md
import { useEffect, useState } from 'react';
import type { z } from 'zod';
import { ExamDashboardSchema, ExamChoicePageSchema, type ExamProgressSchema } from '@solveflow/contracts/managed-exam';
import { EXAM_LABELS } from '@solveflow/contracts/exam';
import { Icon } from '@solveflow/web-ui/icons';
import { alertLabels, ErrorText, RefreshButton } from './components.js';
import { ExamClock } from './exam-clock.js';
import { RemoteSelect } from './remote-select.js';
import { HomeContent } from './home.js';
import { PublicationPanel } from './dashboard-publications.js';
import { usePageResource } from './paging.js';

type Progress = z.infer<typeof ExamProgressSchema>;
const number = (value: number) => value.toLocaleString('zh-CN');

export function StudentProgressTable({ progress, onWatch, limit }: { progress: Progress[]; onWatch: (id: string) => void; limit?: number }) {
    const sorted = [...progress].sort((a,b) => b.attention-a.attention || b.active-a.active || Number(b.online)-Number(a.online) || a.studentName.localeCompare(b.studentName));
    const rows = limit ? sorted.slice(0, limit) : sorted;
    return <div className="table-wrap console-table student-progress-table"><table role="table"><colgroup><col className="progress-student"/><col className="progress-position-column"/><col className="progress-number" span={3}/><col className="progress-status-column"/><col className="progress-duration"/><col className="progress-action"/></colgroup><thead><tr><th>学生 / 考试</th><th>当前位置</th><th>已有答案</th><th>AI 核验</th><th>待处理</th><th>状态</th><th>用时</th><th>操作</th></tr></thead><tbody>{rows.map(p => <tr role="row" className="student-row" key={p.assignmentId} onClick={() => { if(p.attemptId) onWatch(p.attemptId); }}>
      <td role="cell" data-label="学生 / 考试"><strong title={p.studentName}>{p.studentName}</strong><span className="table-sub">{p.title}</span></td><td role="cell" data-label="当前位置"><span className="progress-position" title={p.moduleTitle ? p.moduleTitle+(p.currentPosition?' · 第'+p.currentPosition+'题':'') : '尚未进入'}><span className="progress-module-name">{p.moduleTitle || '尚未进入'}</span>{p.moduleTitle && p.currentPosition ? <span className="progress-question">{' · 第'+p.currentPosition+'题'}</span> : null}</span></td><td role="cell" data-label="已有答案">{p.answered} / {p.total}</td><td role="cell" data-label="AI 核验">{p.verified}</td><td role="cell" data-label="待处理">{p.attention ? <span className="badge red">{p.attention} 题</span> : '—'}</td><td role="cell" data-label="状态"><span className="progress-status"><span><i className={'connection-dot'+(p.online?' online':'')}/>{p.online?'在线':'离线'}</span>{p.active>0 && <span className="badge blue">处理中</span>}</span></td><td role="cell" data-label="用时"><ExamClock timing={p.timing} compact/></td><td role="cell" data-label="操作"><button className="quiet" disabled={!p.attemptId} onClick={e => {e.stopPropagation();if(p.attemptId)onWatch(p.attemptId);}}>查看</button></td>
    </tr>)}</tbody></table>{!rows.length && <p className="empty">暂无考试分配</p>}</div>;
}

export function Dashboard({ onWatch, onIssues, onViewAll }: {
    onWatch: (id: string) => void;
    onIssues: (reason?: string, sitting?: string) => void;
    onViewAll?: (sitting: string) => void;
}) {
    const [sitting, setSitting] = useState('');
    const { data, error, errorStatus, loading, refreshing, refreshManually } = usePageResource(
        ExamDashboardSchema,
        '/admin/dashboard' + (sitting ? '?sittingId=' + encodeURIComponent(sitting) : ''),
    );
    useEffect(() => { if (sitting && errorStatus === 404) setSitting(''); }, [sitting, errorStatus]);
    const showIssues = (reason?: string) => onIssues(reason, sitting);

    const issuesPanel = data && <section className="panel issues-panel">
        <div className="section-head">
            <h2>待处理原因</h2>
            <button className="quiet" onClick={() => showIssues()}>查看</button>
        </div>
        <div className="reason-bars">
            {!data.issues.length && <p className="empty">暂无待处理问题</p>}
            {data.issues.map(item => <button key={item.reason} onClick={() => showIssues(item.reason)}>
                <span>{alertLabels[item.reason]}<strong>{item.count}</strong></span>
                <i><b style={{ width: (item.count / Math.max(1, ...data.issues.map(issue => issue.count)) * 100) + '%' }}/></i>
            </button>)}
        </div>
    </section>;
    const modulesPanel = data && <section className="panel modules-panel">
        <div className="section-head"><h2>模块进度</h2></div>
        <div className="module-bars">
            {!data.modules.length && <p className="empty">暂无已开始的模块</p>}
            {data.modules.map(module => <div key={JSON.stringify([module.exam, module.title, module.sectionCode])}>
                <div>
                    <span title={EXAM_LABELS[module.exam] + ' · ' + module.title}>
                        {EXAM_LABELS[module.exam]} · {module.title}
                    </span>
                    <strong>{module.answered} / {module.total}</strong>
                </div>
                <div className="module-track" role="progressbar" aria-valuenow={module.answered}
                    aria-valuemin={0} aria-valuemax={module.total || 1}
                    aria-label={EXAM_LABELS[module.exam] + ' · ' + module.title + '答题进度'}>
                    <i style={{ width: (module.total ? Math.min(100, module.answered / module.total * 100) : 0) + '%' }}/>
                </div>
                {module.attention > 0 && <button className="module-attention feedback-tone-error" onClick={() => showIssues()}>
                    {module.attention} 题待处理
                </button>}
            </div>)}
        </div>
    </section>;
    const studentsPanel = data && <section className="panel students-panel">
        <div className="section-head">
            <h2>学生进度</h2>
            <div className="toolbar">
                <span className="muted">{data.summary.online} 位在线</span>
                {onViewAll && <button className="quiet" onClick={() => onViewAll(sitting)}>查看全部</button>}
            </div>
        </div>
        <StudentProgressTable progress={data.students} onWatch={onWatch} limit={8}/>
    </section>;

    return <section className="dashboard dashboard-home" aria-label="考试数据看板">
        <div className="dashboard-toolbar">
            <div className="dashboard-filter">
                <RemoteSelect label="具体考试" allLabel="全部考试" value={sitting} onChange={setSitting}
                    schema={ExamChoicePageSchema} endpoint="/admin/dashboard/sittings/page"/>
            </div>
            <div className="dashboard-controls">
                {data && <span className="sync-time">更新于 {new Date(data.generatedAt).toLocaleTimeString('zh-CN')}</span>}
                <RefreshButton secondary busy={refreshing} disabled={loading} onRefresh={refreshManually}/>
            </div>
        </div>
        <ErrorText error={error}/>
        {!data && !error && <p className="empty">正在同步看板…</p>}
        {data && <>
            <div className="console-metrics">
                {[
                    { label: '在线学生', value: data.summary.online, extra: '/ ' + data.summary.students, icon: 'users' as const, tone: 'blue' },
                    { label: 'AI 已核验', value: data.summary.verified, icon: 'check' as const, tone: 'green' },
                    { label: '人工确认', value: data.summary.humanConfirmed, icon: 'users' as const, tone: 'green' },
                    { label: '正在处理', value: data.summary.active, icon: 'history' as const, tone: 'blue' },
                ].map(metric => <article className={'console-metric ' + metric.tone} key={metric.label}>
                    <div>
                        <span>{metric.label}</span>
                        <strong>{number(metric.value)}{metric.extra && <small>{metric.extra}</small>}</strong>
                    </div>
                    <span className="metric-icon"><Icon name={metric.icon}/></span>
                </article>)}
            </div>
            <HomeContent data={data}
                trend={<PublicationPanel points={data.throughput} error={error}/>}
                modules={modulesPanel} issues={issuesPanel} students={studentsPanel}
                onIssues={() => showIssues()}/>
        </>}
    </section>;
}
