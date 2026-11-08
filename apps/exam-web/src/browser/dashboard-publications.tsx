import { useState } from 'react';
import type { ExamDashboard } from '@solveflow/contracts/managed-exam';
import { Icon } from '@solveflow/web-ui/icons';
import { PublicationChart } from './charts.js';
import { Dialog, ErrorText } from './components.js';

const time = (value: string | number) => new Date(value).toLocaleTimeString('zh-CN', {
    hour: '2-digit', minute: '2-digit',
});

export function PublicationPanel({ points, error }: {
    points: ExamDashboard['throughput'];
    error: string;
}) {
    const [mode, setMode] = useState<'area' | 'bar'>('area'),
        [detailsOpen, setDetailsOpen] = useState(false);
    const totals = points.reduce((sum, point) => ({ ai: sum.ai + point.ai, human: sum.human + point.human }), {
        ai: 0, human: 0,
    });

    return <>
        <section className="panel trend-panel">
            <div className="section-head">
                <h2>近1小时答案发布</h2>
                <div className="publication-actions">
                    <div className="chart-mode" role="group" aria-label="发布图类型">
                        <button aria-pressed={mode === 'area'} onClick={() => setMode('area')}>趋势</button>
                        <button aria-pressed={mode === 'bar'} onClick={() => setMode('bar')}>柱图</button>
                    </div>
                    <button className="quiet" onClick={() => setDetailsOpen(true)}>
                        <Icon name="chart"/>发布明细
                    </button>
                </div>
            </div>
            <div className="inline-legend">
                <span><i className="dot-blue"/>AI 答案</span>
                <span><i className="dot-green"/>人工答案</span>
            </div>
            <PublicationChart points={points} mode={mode}/>
        </section>
        {detailsOpen && <Dialog title="发布明细" onClose={() => setDetailsOpen(false)}
            notice={error ? <ErrorText error={error}/> : null}>
            <p className="muted publication-detail-caption">最近1小时 · 每5分钟汇总</p>
            <div className="table-wrap publication-details-table">
                <table aria-label="答案发布明细">
                    <thead>
                        <tr><th scope="col">时间段</th><th scope="col">AI 答案</th><th scope="col">人工答案</th><th scope="col">合计</th></tr>
                    </thead>
                    <tbody>
                        {points.map(point => <tr key={point.at}>
                            <td><time dateTime={point.at}>{time(point.at)}</time> – <time>{time(Date.parse(point.at) + 300000)}</time></td>
                            <td>{point.ai}</td><td>{point.human}</td><td>{point.ai + point.human}</td>
                        </tr>)}
                    </tbody>
                    <tfoot>
                        <tr><th scope="row">合计</th><td>{totals.ai}</td><td>{totals.human}</td><td>{totals.ai + totals.human}</td></tr>
                    </tfoot>
                </table>
            </div>
        </Dialog>}
    </>;
}
