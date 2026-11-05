import { useEffect, useId, useRef, useState } from 'react';
import type { ExamDashboard } from '@solveflow/contracts/managed-exam';

export const stateLabels = { unphotographed: '未拍摄', processing: '处理中', attention: '待处理', answered: '已完成', waiting: '待解答' };
export const stateColors = { unphotographed: '#a6b5cb', processing: '#4d8df7', attention: '#e87570', answered: '#37b38c', waiting: '#dfa74b' };
const time = (value: string) => new Date(value).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });

export function PublicationChart({ points, mode }: { points: ExamDashboard['throughput']; mode: 'area' | 'bar' }) {
    const root = useRef<HTMLDivElement>(null), [width, setWidth] = useState(620), [selected, setSelected] = useState<number | null>(null);
    const id = useId().replaceAll(':', '');
    useEffect(() => { const observer=new ResizeObserver(entries=>{const next=entries[0]?.contentRect.width;if(next)setWidth(Math.max(240,Math.round(next)));});if(root.current)observer.observe(root.current);return()=>observer.disconnect(); }, []);
    const ceiling = Math.max(4, Math.ceil(Math.max(0, ...points.map(point => point.ai + point.human)) / 4) * 4);
    const step = (width - 64) / Math.max(1, points.length - 1), x = (index: number) => 42 + index * step, y = (value: number) => 174 - value / ceiling * 144;
    const line = (key: 'ai' | 'human') => points.map((point, index) => `${index ? 'L' : 'M'}${x(index)},${y(point[key])}`).join(' ');
    const current = selected === null ? null : points[selected], empty = points.every(point => !point.ai && !point.human);
    return <div className="publication-frame" ref={root} tabIndex={0} role="group" aria-label="答案发布趋势，方向键查看时间段" onKeyDown={event => {
        if (event.key === 'Escape') setSelected(null);
        if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault();setSelected(previous=>Math.max(0,Math.min(points.length-1,(previous??0)+(event.key==='ArrowRight'?1:-1)))); }
    }} onPointerMove={event => { const box=event.currentTarget.getBoundingClientRect();setSelected(Math.max(0,Math.min(points.length-1,Math.round((event.clientX-box.left-42)/step)))); }} onPointerLeave={()=>setSelected(null)} onBlur={()=>setSelected(null)}>
        <svg className="publication-chart" viewBox={`0 0 ${width} 215`} role="img" aria-label="近一小时答案发布图">
            <defs>{['ai','human'].map(key=><linearGradient key={key} id={id+key} x1="0" y1="0" x2="0" y2="1"><stop stopColor={key==='ai'?'#4d8df7':'#37b38c'} stopOpacity=".28"/><stop offset="1" stopColor={key==='ai'?'#4d8df7':'#37b38c'} stopOpacity="0"/></linearGradient>)}</defs>
            {[0,1,2,3,4].map(n=><g key={n}><line x1="40" x2={width-12} y1={174-n*36} y2={174-n*36} className="chart-grid"/><text x="28" y={178-n*36} textAnchor="end">{ceiling*n/4}</text></g>)}
            {mode==='area' ? <g className="chart-lines">{(['ai','human'] as const).map(key=><g key={key}><path d={line(key)+` L${x(points.length-1)},174 L42,174 Z`} fill={`url(#${id+key})`}/><path className="trend-line" pathLength="1" d={line(key)} stroke={key==='ai'?'#4d8df7':'#37b38c'} fill="none" strokeWidth="2.5" strokeLinejoin="round"/>{points.map((point,index)=>point[key]>0&&<circle key={point.at} cx={x(index)} cy={y(point[key])} r={selected===index?4:2.8} fill={key==='ai'?'#4d8df7':'#37b38c'}><title>{time(point.at)} · {key==='ai'?'AI':'人工'} {point[key]}</title></circle>)}</g>)}</g> : <g>{points.map((point,index)=>{const ai=point.ai/ceiling*144,human=point.human/ceiling*144,bw=Math.min(24,step*.55);return <g key={point.at}><title>{time(point.at)} · AI {point.ai} · 人工 {point.human}</title><rect className="chart-bar" x={x(index)-bw/2} y={174-ai} width={bw} height={ai} rx="3" fill="#4d8df7"/><rect className="chart-bar" x={x(index)-bw/2} y={174-ai-human} width={bw} height={human} rx="3" fill="#37b38c"/></g>;})}</g>}
            {selected!==null && <line className="chart-crosshair" x1={x(selected)} x2={x(selected)} y1="24" y2="180"/>}
            {points.map((point,index)=>(index===0||index===points.length-1||index%(width<400?6:3)===0)&&<text key={point.at} x={x(index)} y="203" textAnchor={index===0?'start':index===points.length-1?'end':'middle'}>{time(point.at)}</text>)}
            {empty&&<text x={width/2} y="95" textAnchor="middle">暂无发布记录</text>}
        </svg>
        {current&&selected!==null&&<div className="chart-tooltip" style={{left:Math.max(8,Math.min(width-165,x(selected)-75))}}><strong>{time(current.at)}</strong><span><i className="dot-blue"/>AI 答案 <b>{current.ai}</b></span><span><i className="dot-green"/>人工答案 <b>{current.human}</b></span></div>}
    </div>;
}

export function Distribution({ data }: { data: ExamDashboard['distribution'] }) {
    const total=data.reduce((sum,item)=>sum+item.count,0);let offset=0;
    return <div className="distribution-chart"><svg viewBox="0 0 180 180" role="img" aria-label="题目状态分布图"><circle cx="90" cy="90" r="67" fill="none" stroke="var(--line)" strokeWidth="15"/><g className="donut-segments">{data.map(item=>{const size=total?item.count/total*100:0,start=offset;offset+=size;return <circle className="donut-segment" key={item.state} cx="90" cy="90" r="67" pathLength="100" fill="none" stroke={stateColors[item.state]} strokeWidth="15" strokeDasharray={size+' '+(100-size)} strokeDashoffset={-start} transform="rotate(-90 90 90)"><title>{stateLabels[item.state]} {item.count} 题</title></circle>;})}</g><text x="90" y="88" className="donut-number" textAnchor="middle">{total.toLocaleString('zh-CN')}</text><text x="90" y="111" textAnchor="middle">题目总数</text></svg><ul className="chart-legend">{data.map(item=><li key={item.state}><span><i style={{background:stateColors[item.state]}}/>{stateLabels[item.state]}</span><strong>{item.count.toLocaleString('zh-CN')}</strong></li>)}</ul></div>;
}


export function CoverageOrbit({ summary }: { summary: ExamDashboard['summary'] }) {
    const gradient = useId().replaceAll(':', '');
    const percent = summary.total ? Math.min(100, Math.round(summary.answered / summary.total * 100)) : 0;
    return <div className="coverage-orbit">
      <svg viewBox="0 0 320 320" role="img" aria-label={`答案覆盖率 ${percent}%`}>
        <defs><linearGradient id={gradient} x1="0" y1="1" x2="1" y2="0"><stop stopColor="#37b38c"/><stop offset="1" stopColor="#4d8df7"/></linearGradient></defs>
        <circle className="orbit-guide" cx="160" cy="160" r="150"/>
        {Array.from({length:60},(_,index)=><line key={index} className="orbit-tick" x1="160" x2="160" y1="9" y2={index%5===0?'18':'13'} transform={`rotate(${index*6} 160 160)`}/>)}
        <circle className="orbit-track" cx="160" cy="160" r="128"/>
        <circle className="orbit-value" cx="160" cy="160" r="128" pathLength="100" stroke={`url(#${gradient})`} strokeDasharray={`${percent} 100`} opacity={percent?1:0} transform="rotate(-90 160 160)"/>
        <circle className="orbit-inner" cx="160" cy="160" r="106"/>
      </svg>
      <div className="orbit-label" aria-hidden="true"><strong className="orbit-number">{percent}<small>%</small></strong><span className="orbit-caption">答案覆盖率</span></div>
    </div>;
}
