import type { ReactNode } from 'react';
import type { ExamDashboard } from '@solveflow/contracts/managed-exam';
import { Icon } from '@solveflow/web-ui/icons';
import { Distribution, CoverageOrbit } from './charts.js';

const number = (value: number) => value.toLocaleString('zh-CN');


function WallStudents({ data, onWatch, onViewAll }: { data: ExamDashboard; onWatch: (id: string) => void; onViewAll?:()=>void }) {
    const sorted = [...data.students].sort((a,b)=>b.attention-a.attention || b.active-a.active || Number(b.online)-Number(a.online) || a.studentName.localeCompare(b.studentName));
    return <section className="panel students-panel"><div className="section-head"><h2>学生进度</h2><div className="toolbar"><span className="muted">{number(data.summary.online)} 位在线</span>{onViewAll&&<button className="quiet" onClick={onViewAll}>查看全部</button>}</div></div>
      {!sorted.length ? <p className="empty">暂无考试分配</p> : <ul className="wall-students">{sorted.map(student=><li key={student.assignmentId}>
        <div className="wall-student-identity"><span className={'connection-dot'+(student.online?' online':'')} aria-label={student.online?'在线':'离线'}/><strong title={student.studentName}>{student.studentName}</strong><span className="wall-student-position" title={student.moduleTitle??student.title}>{student.moduleTitle ? student.moduleTitle+(student.currentPosition?' · '+student.currentPosition:'') : '尚未进入'}</span></div>
        <div className="wall-student-progress"><span>{number(student.answered)}<small> / {number(student.total)}</small></span>{student.attention>0 && <span className="badge red">{number(student.attention)} 题</span>}<button className="quiet" disabled={!student.attemptId} aria-description={student.studentName} onClick={()=>{if(student.attemptId)onWatch(student.attemptId);}}>查看</button></div>
      </li>)}</ul>}
    </section>;
}

export function WallContent({ data, trend, modules, issues, onWatch, onIssues, onViewAll }: { data: ExamDashboard; trend: ReactNode; modules: ReactNode; issues: ReactNode; onWatch: (id: string) => void; onIssues: () => void; onViewAll?:()=>void }) {
    const { summary } = data;
    return <div className="wall-grid">
      {modules}
      <section className="panel wall-overview"><div className="section-head"><h2>全场答题进度</h2><span className={'wall-activity'+(summary.active>0?' is-active':'')}><i/>{summary.active>0 ? `${number(summary.active)} 题处理中` : '暂无活动任务'}</span></div>
        <div className="wall-overview-body"><div className="wall-totals"><span>已有答案</span><strong>{number(summary.answered)}</strong><span>全部题目 <b>{number(summary.total)}</b></span></div>
          <CoverageOrbit summary={summary}/>
          <div className="wall-confirmations"><div><Icon name="check"/><span>AI 已核验<strong>{number(summary.verified)}</strong></span></div><div><Icon name="users"/><span>人工确认<strong>{number(summary.humanConfirmed)}</strong></span></div></div>
        </div>
        <div className="wall-status-strip">{data.distribution.filter(item=>item.state==='unphotographed'||item.state==='processing'||item.state==='waiting').map(item=><div key={item.state}><span>{item.state==='unphotographed'?'未拍摄':item.state==='processing'?'处理中':'待解答'}</span><strong>{number(item.count)}</strong></div>)}</div>
      </section>
      <div className="wall-attention"><button className={'wall-attention-total'+(summary.attention?' has-issues feedback-tone-error':'')} onClick={onIssues}><span className="wall-attention-icon"><Icon name={summary.attention?'alert':'check'}/></span><span>待处理题<strong>{number(summary.attention)}</strong></span><Icon name="chevron-right"/></button>{issues}</div>
      <section className="panel distribution-panel"><div className="section-head"><h2>题目状态</h2></div><Distribution data={data.distribution}/></section>
      {trend}
      <WallStudents data={data} onWatch={onWatch} {...(onViewAll?{onViewAll}:{})}/>
    </div>;
}
