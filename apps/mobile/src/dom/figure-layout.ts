/** 1/2/5 × powers of ten, following the conventional D3 tick family. */
export function niceTicks(min: number, max: number, count = 5): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min) return [];
  const rough = (max - min) / Math.max(2, Math.min(10, count));
  const power = 10 ** Math.floor(Math.log10(rough)); const ratio = rough / power;
  const step = (ratio >= Math.sqrt(50) ? 10 : ratio >= Math.sqrt(10) ? 5 : ratio >= Math.sqrt(2) ? 2 : 1) * power;
  const first = Math.ceil(min / step - 1e-10); const last = Math.floor(max / step + 1e-10);
  return Array.from({ length: Math.min(12, Math.max(0, last - first + 1)) }, (_, index) => Number(((first + index) * step).toPrecision(12)));
}
type Box = { x: number; y: number; width: number; height: number };
type Bounds = { left: number; top: number; right: number; bottom: number };
type Anchor = { x: number; y: number; text: string };
const overlap = (a: Box, b: Box) => Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
/** Bounded candidate search; badges remain above shapes and within the SVG. */
export function placeLabels(anchors: Anchor[], bounds: Bounds): (Box & { text: string; anchor: Anchor })[] {
  const occupied: Box[] = anchors.map(p => ({ x: p.x - 6, y: p.y - 6, width: 12, height: 12 }));
  return anchors.map(anchor => {
    const width = Math.min(bounds.right - bounds.left, Math.max(34, [...anchor.text].reduce((sum, char) => sum + (/[^\x00-\x7f]/.test(char) ? 24 : 13), 16)));
    const height = 36;
    const candidates = [ [12, -44], [-width - 12, -44], [12, 12], [-width - 12, 12], [-width / 2, -80], [-width / 2, 52], [24, -14], [-width - 24, -14] ].map(([dx, dy]) => ({ x: Math.max(bounds.left, Math.min(bounds.right - width, anchor.x + dx!)), y: Math.max(bounds.top, Math.min(bounds.bottom - height, anchor.y + dy!)), width, height }));
    // Fall back to a bounded grid for crowded diagrams, with leaders to true points.
    for (let row = 0; row < 8; row++) for (let column = 0; column < 6; column++) candidates.push({ x: bounds.left + (bounds.right - bounds.left - width) * column / 5, y: bounds.top + (bounds.bottom - bounds.top - height) * row / 7, width, height });
    const score = (box: Box) => occupied.reduce((sum, other) => sum + overlap(box, other), 0) * 100 + Math.hypot(box.x + width / 2 - anchor.x, box.y + height / 2 - anchor.y);
    const best = candidates.reduce((best, candidate) => score(candidate) < score(best) ? candidate : best);
    occupied.push({ x: best.x - 3, y: best.y - 3, width: best.width + 6, height: best.height + 6 });
    return { ...best, text: anchor.text, anchor };
  });
}
