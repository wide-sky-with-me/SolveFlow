// Decision: .agents/notes/implemented/agent/2026-10-04-subject-presentation.md
import type { Figure } from './figure.js';
type Point = [number, number];
type Element = Figure['elements'][number];
const close = (a: number, b: number) => Math.abs(a - b) <= 1e-7 * Math.max(1, Math.abs(a), Math.abs(b));
const cross = (a: Point, b: Point, c: Point) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
function onSegment(p: Point, a: Point, b: Point): boolean {
  const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
  if (!length) return close(p[0], a[0]) && close(p[1], a[1]);
  return Math.abs(cross(a, b, p)) / length <= 1e-7 && p[0] >= Math.min(a[0], b[0]) - 1e-7 && p[0] <= Math.max(a[0], b[0]) + 1e-7 && p[1] >= Math.min(a[1], b[1]) - 1e-7 && p[1] <= Math.max(a[1], b[1]) + 1e-7;
}
function onCurve(p: Point, curve: Element | undefined): boolean {
  if (!curve) return false;
  switch (curve.kind) {
    case 'polynomial': return close(p[1], [...curve.coefficients].reverse().reduce((sum, coefficient) => sum * p[0] + coefficient, 0));
    case 'circle': return close(Math.hypot(p[0] - curve.center[0], p[1] - curve.center[1]), curve.radius);
    case 'segment': return onSegment(p, curve.from, curve.to);
    case 'polyline': return curve.points.slice(1).some((b, i) => onSegment(p, curve.points[i]!, b));
    default: return false;
  }
}
function intersects(a: Point, b: Point, c: Point, d: Point): boolean {
  return onSegment(c, a, b) || onSegment(d, a, b) || onSegment(a, c, d) || onSegment(b, c, d)
    || Math.sign(cross(a, b, c)) * Math.sign(cross(a, b, d)) < 0 && Math.sign(cross(c, d, a)) * Math.sign(cross(c, d, b)) < 0;
}
function simpleArea(points: Point[]): number | null {
  for (let i = 0; i < points.length; i++) {
    const a = points[i]!; const b = points[(i + 1) % points.length]!;
    if (close(a[0], b[0]) && close(a[1], b[1])) return null;
    for (let j = i + 2; j < points.length; j++) {
      if (i === 0 && j === points.length - 1) continue;
      if (intersects(a, b, points[j]!, points[(j + 1) % points.length]!)) return null;
    }
  }
  const area = Math.abs(points.reduce((sum, a, i) => { const b = points[(i + 1) % points.length]!; return sum + a[0] * b[1] - b[0] * a[1]; }, 0)) / 2;
  return area > 0 ? area : null;
}

/** Checks only declared numerical relationships, not the problem's assumptions. */
export function figureCheckErrors(figure: Figure): string[] {
  const errors: string[] = []; const byId = new Map<string, Element>();
  for (const element of figure.elements) {
    if (!element.id) continue;
    if (byId.has(element.id)) errors.push('图元 id 不能重复');
    byId.set(element.id, element);
  }
  if (figure.purpose === 'economics' && (!figure.xLabel || !figure.yLabel)) errors.push('经济图须标明两轴的变量与单位');
  for (const check of figure.checks ?? []) {
    if (check.kind === 'polygon-area') {
      const polygon = byId.get(check.polygonId);
      const area = polygon?.kind === 'polygon' ? simpleArea(polygon.points) : null;
      if (area === null || !close(area, check.expected)) errors.push('区域面积不符、边界自交或引用无效');
    } else {
      const point = byId.get(check.pointId);
      const curves = check.kind === 'intersection' ? check.curveIds : [check.curveId];
      if (point?.kind !== 'point' || point.at[0] < figure.xRange[0] || point.at[0] > figure.xRange[1] || point.at[1] < figure.yRange[0] || point.at[1] > figure.yRange[1]
        || new Set(curves).size !== curves.length || curves.some(id => !onCurve(point.at, byId.get(id)))) errors.push('关键点不在所引用的曲线上、超出坐标范围或引用无效');
    }
  }
  return errors;
}
