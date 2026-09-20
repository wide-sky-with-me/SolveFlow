"use client";
import { useId, useState } from "react";
import type { Figure } from "@solveflow/contracts/figure";
import { niceTicks, placeLabels } from './figure-layout';
import { MathText } from './math-text';
const colors = { green: "var(--sf-green)", blue: "var(--sf-blue)", orange: "var(--sf-orange)", gray: "var(--sf-gray)" };
export function AnswerFigure({ figure }: { figure: Figure }) {
  const [zoomed, setZoomed] = useState(false);
  const id = useId(); const [xmin, xmax] = figure.xRange; const [ymin, ymax] = figure.yRange;
  const scale = Math.min(440 / (xmax - xmin), 340 / (ymax - ymin));
  const sx = figure.equalAspect === false ? 440 / (xmax - xmin) : scale;
  const sy = figure.equalAspect === false ? 340 / (ymax - ymin) : scale;
  const x = (value: number) => 300 + (value - (xmin + xmax) / 2) * sx;
  const y = (value: number) => 220 - (value - (ymin + ymax) / 2) * sy;
  const plotWidth = (xmax - xmin) * sx;
  const viewWidth = Math.max(340, plotWidth + 120);
  const left = 300 - viewWidth / 2 - 10;
  const labeledPoints = figure.elements.filter(item => item.kind === 'point' && item.label).map((item, index) => {
    if (item.kind !== 'point') throw new Error('POINT_EXPECTED');
    const label = item.label ?? '';
    return { x: x(item.at[0]), y: y(item.at[1]), text: [...label].length > 14 || label.includes('\\') ? `P${index + 1}` : label };
  }).filter(point => point.x >= x(xmin) && point.x <= x(xmax) && point.y >= y(ymax) && point.y <= y(ymin));
  const labels = placeLabels(labeledPoints, { left: left + 6, right: left + viewWidth - 6, top: 28, bottom: 402 });
  return <figure className="answer-figure"><figcaption><strong><MathText text={figure.title} /></strong><MathText text={figure.description} /></figcaption>
    <button type="button" className="figure-zoom" aria-pressed={zoomed} onClick={() => setZoomed(!zoomed)}>{zoomed ? "适应宽度" : "放大图示"}</button>
    <div className={`figure-viewport${zoomed ? " zoomed" : ""}`} tabIndex={0} role="region" aria-label={`${figure.title}，可放大并横向滚动`}>
    <svg viewBox={`${300 - viewWidth / 2 - 10} 0 ${viewWidth} 450`} fill="currentColor" role="img" aria-labelledby={`${id}-title ${id}-desc`}>
      <title id={`${id}-title`}>{figure.title}</title><desc id={`${id}-desc`}>{figure.description}</desc>
      <defs><clipPath id={`${id}-clip`}><rect x={x(xmin)} y={y(ymax)} width={(xmax-xmin)*sx} height={(ymax-ymin)*sy} /></clipPath></defs>
      <rect x={x(xmin)} y={y(ymax)} width={(xmax-xmin)*sx} height={(ymax-ymin)*sy} fill="var(--sf-plot)" stroke="var(--sf-grid)" />
      <g className="figure-grid" fill="var(--sf-muted)" fontSize="24">
        {niceTicks(xmin, xmax).map(value => <g key={`x-${value}`}><line x1={x(value)} x2={x(value)} y1={y(ymin)} y2={y(ymax)} stroke="var(--sf-grid)" /><text x={x(value)} y={y(ymin)+28} textAnchor="middle">{value}</text></g>)}
        {niceTicks(ymin, ymax).map(value => <g key={`y-${value}`}><line x1={x(xmin)} x2={x(xmax)} y1={y(value)} y2={y(value)} stroke="var(--sf-grid)" /><text x={x(xmin)-8} y={y(value)+8} textAnchor="end">{value}</text></g>)}
      </g>
      <text x="300" y="444" textAnchor="middle" fontSize="17">{figure.xLabel ?? "x"}</text>
      <text x={300 - viewWidth / 2 + 4} y="22" fontSize="17">{figure.yLabel ?? "y"}</text>
      <g clipPath={`url(#${id}-clip)`}>
        {ymin <= 0 && ymax >= 0 && <line x1={x(xmin)} x2={x(xmax)} y1={y(0)} y2={y(0)} stroke="var(--sf-axis)" />}
        {xmin <= 0 && xmax >= 0 && <line x1={x(0)} x2={x(0)} y1={y(ymin)} y2={y(ymax)} stroke="var(--sf-axis)" />}
        {[...figure.elements].sort((a, b) => Number(a.kind !== 'polygon') - Number(b.kind !== 'polygon')).map((item, i) => {
          const color = colors[item.color];
          if (item.kind === "point") return null;
          if (item.kind === "segment") return <line key={i} x1={x(item.from[0])} y1={y(item.from[1])} x2={x(item.to[0])} y2={y(item.to[1])} stroke={color} strokeWidth="3"><title>{item.label}</title></line>;
          if (item.kind === "circle") return <ellipse key={i} cx={x(item.center[0])} cy={y(item.center[1])} rx={item.radius * sx} ry={item.radius * sy} fill="none" stroke={color} strokeWidth="3"><title>{item.label}</title></ellipse>;
          if (item.kind === "polyline" || item.kind === "polygon") {
            const Shape = item.kind === "polygon" ? "polygon" : "polyline";
            return <Shape key={i} points={item.points.map(([a, b]) => `${x(a)},${y(b)}`).join(" ")} fill={item.kind === "polygon" ? color : "none"} fillOpacity={0.16} stroke={color} strokeWidth="3"><title>{item.label}</title></Shape>;
          }
          const points = Array.from({ length: 129 }, (_, index) => {
            const a = xmin + (xmax-xmin)*index/128;
            const b = [...item.coefficients].reverse().reduce((sum, coefficient) => sum*a+coefficient, 0);
            return `${x(a)},${y(b)}`;
          }).join(" ");
          return <polyline key={i} points={points} fill="none" stroke={color} strokeWidth="3"><title>{item.label}</title></polyline>;
        })}
      </g>
      <g className="figure-points" clipPath={`url(#${id}-clip)`}>{figure.elements.map((item, i) => item.kind === 'point' && <circle key={i} cx={x(item.at[0])} cy={y(item.at[1])} r="5" fill={colors[item.color]} stroke="var(--sf-surface)" strokeWidth="2" />)}</g>
      <g className="figure-labels">{labels.map((label, i) => <g key={i}>
        <line x1={label.anchor.x} y1={label.anchor.y} x2={Math.max(label.x, Math.min(label.x + label.width, label.anchor.x))} y2={Math.max(label.y, Math.min(label.y + label.height, label.anchor.y))} stroke="var(--sf-muted)" strokeWidth="1" />
        <rect x={label.x} y={label.y} width={label.width} height={label.height} rx="6" fill="var(--sf-surface)" stroke="var(--sf-line)" />
        <text x={label.x + label.width / 2} y={label.y + 25} textAnchor="middle" fontSize="24" fill="var(--sf-ink)">{label.text}</text>
      </g>)}</g>
    </svg></div>
    <ul className="figure-legend">{figure.elements.filter(item => item.label).map((item, i) => <li key={i} style={{ color: colors[item.color] }}><MathText text={(item.kind === 'point' && ([...(item.label ?? '')].length > 14 || item.label?.includes('\\')) ? `P${figure.elements.filter(element => element.kind === 'point' && element.label).indexOf(item) + 1} · ` : '') + (item.label ?? '') + (item.kind === "point" && !(item.label ?? '').replace(/[\s（）]/g, c => c === '（' ? '(' : c === '）' ? ')' : '').includes(`(${item.at.join(',')})`) ? ` (${item.at.join(", ")})` : '')} /></li>)}</ul>
  </figure>;
}
