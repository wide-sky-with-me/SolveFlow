import type { ReactNode } from 'react';
import type { ExamDashboard } from '@solveflow/contracts/managed-exam';
import { Icon } from '@solveflow/web-ui/icons';
import { CoverageOrbit, Distribution, stateLabels } from './charts.js';

const number = (value: number) => value.toLocaleString('zh-CN');

export function HomeContent({ data, trend, modules, issues, students, onIssues }: {
    data: ExamDashboard;
    trend: ReactNode;
    modules: ReactNode;
    issues: ReactNode;
    students: ReactNode;
    onIssues: () => void;
}) {
    const { summary } = data;
    return <div className="home-content">
      <div className="home-overview-grid">
        <section className="panel home-progress">
          <div className="section-head"><h2>全场答题进度</h2><Icon name="pulse"/></div>
          <div className="home-progress-body">
            <div className="home-answer-total"><span>已有答案</span><strong>{number(summary.answered)}</strong><span>共 {number(summary.total)} 题</span></div>
            <CoverageOrbit summary={summary}/>
          </div>
          <div className="home-statuses">{data.distribution.filter(item=>item.state==='unphotographed'||item.state==='processing'||item.state==='waiting').map(item=><div key={item.state}><span>{stateLabels[item.state]}</span><strong>{number(item.count)}</strong></div>)}</div>
        </section>
        <section className="home-attention" aria-label="学生待处理问题">
          <button className={'home-attention-total'+(summary.attention?' feedback-tone-error':' feedback-tone-success')} aria-label="查看待处理题" onClick={onIssues}>
            <span className="home-attention-icon"><Icon name={summary.attention?'alert':'check'}/></span>
            <span><span>待处理题</span><strong>{number(summary.attention)}<small>题</small></strong></span><Icon name="chevron-right"/>
          </button>
          {issues}
        </section>
      </div>
      <div className="home-chart-grid">
        {trend}
        <section className="panel distribution-panel"><div className="section-head"><h2>题目状态</h2></div><Distribution data={data.distribution}/></section>
      </div>
      <div className="home-detail-grid">{modules}{students}</div>
    </div>;
}
