import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent, type KeyboardEvent } from 'react';
import { PrintImagePerspectiveSchema, type PrintImagePerspective } from '@solveflow/contracts/local';
import { Button } from './ui';

const full = (): PrintImagePerspective => [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }];
const corners = [{ index: 0, label: '左上' }, { index: 1, label: '右上' }, { index: 2, label: '右下' }, { index: 3, label: '左下' }] as const;
type Corner = typeof corners[number]['index'];
const percent = (value: number) => Number.isFinite(value) ? Math.round(value * 1000) / 10 : '';
const bounded = (value: number) => Math.max(-.25, Math.min(1.25, value));
const displayed = (value: number) => (bounded(Number.isFinite(value) ? value : 0) + .25) / 1.5 * 100;

export function PrintPerspectiveEditor({ uri, value, resetToken, busy, onApply }: { uri: string; value: PrintImagePerspective | undefined; resetToken: boolean; busy: boolean; onApply: (value: PrintImagePerspective) => void }) {
  const [open, setOpen] = useState(false), [points, setPoints] = useState(value ?? full());
  const [coordinateDrafts, setCoordinateDrafts] = useState<Record<string, string>>({});
  const [size, setSize] = useState<{ uri: string; ratio: number } | null>(null);
  const [failed, setFailed] = useState(false), [attempt, setAttempt] = useState(0);
  const section = useRef<HTMLDetailsElement>(null), image = useRef<HTMLImageElement>(null);
  const drag = useRef<{ pointer: number; corner: Corner } | null>(null);
  const [topLeft, topRight, bottomRight, bottomLeft] = value ?? full();
  // Equivalent validated arrays preserve pending edits; explicit successful resets use a separate token.
  useEffect(() => {
    setPoints([{ x: topLeft.x, y: topLeft.y }, { x: topRight.x, y: topRight.y }, { x: bottomRight.x, y: bottomRight.y }, { x: bottomLeft.x, y: bottomLeft.y }]);
    setCoordinateDrafts({}); drag.current = null;
  }, [topLeft.x, topLeft.y, topRight.x, topRight.y, bottomRight.x, bottomRight.y, bottomLeft.x, bottomLeft.y, uri, resetToken]);
  useLayoutEffect(() => { if (open) section.current?.scrollIntoView({ block: 'start' }); }, [open]);
  const checked = PrintImagePerspectiveSchema.safeParse(points), ready = size?.uri === uri && !failed;
  const ratio = size?.uri === uri ? size.ratio : 1;
  function update(index: Corner, change: (point: PrintImagePerspective[number]) => PrintImagePerspective[number]) {
    setPoints(current => { const next: PrintImagePerspective = [...current]; next[index] = change(current[index]); return next; });
  }
  function move(event: PointerEvent<HTMLButtonElement>) {
    const current = drag.current, box = image.current?.getBoundingClientRect();
    if (busy || !current || current.pointer !== event.pointerId || !box?.width || !box.height) return;
    update(current.corner, () => ({ x: bounded((event.clientX - box.left) / box.width), y: bounded((event.clientY - box.top) / box.height) }));
  }
  function finish(event: PointerEvent<HTMLButtonElement>) {
    if (drag.current?.pointer !== event.pointerId) return;
    drag.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }
  function key(event: KeyboardEvent<HTMLButtonElement>, index: Corner) {
    if (busy || !['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)) return;
    event.preventDefault(); const step = event.shiftKey ? .02 : .005;
    update(index, point => ({ x: bounded(point.x + (event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0)), y: bounded(point.y + (event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0)) }));
  }
  return <details ref={section} className="pdf-disclosure pdf-perspective-editor" onToggle={event => setOpen(event.currentTarget.open)}>
    <summary>四角校正</summary>
    {open && <div className="pdf-disclosure-content" role="group" aria-label="图示四角校正" aria-busy={busy}>
      <p className="pdf-note">圈定完整图示，可略超出原图留白。应用将替换旋转与裁切，方向键可微调。</p>
      <div className="pdf-perspective-space">
        <div className="pdf-perspective-stage" data-testid="print-perspective-stage" data-ready={ready} style={{ aspectRatio: String(ratio), width: `min(100%, ${Math.round(ratio * 400)}px, calc(46dvh * ${ratio}))` }}>
          <img key={attempt} ref={image} src={uri} alt="四角校正底图" draggable={false} style={{ inset: '16.6666667%', width: '66.6666667%', height: '66.6666667%' }} onLoad={event => { setFailed(false); setSize({ uri, ratio: event.currentTarget.naturalWidth / event.currentTarget.naturalHeight }); }} onError={() => { setFailed(true); setSize(null); }} />
          <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"><polygon points={points.map(point => `${displayed(point.x)},${displayed(point.y)}`).join(' ')} data-invalid={!checked.success} /></svg>
          {corners.map(corner => <button key={corner.index} type="button" className="pdf-perspective-handle" aria-label={`${corner.label}校正点，横向 ${percent(points[corner.index].x)}%，纵向 ${percent(points[corner.index].y)}%`} disabled={busy || !ready} style={{ left: `${displayed(points[corner.index].x)}%`, top: `${displayed(points[corner.index].y)}%` }} onPointerDown={event => {
            if (busy || drag.current || event.button !== 0) return;
            event.preventDefault(); drag.current = { pointer: event.pointerId, corner: corner.index }; event.currentTarget.focus({ preventScroll: true }); event.currentTarget.setPointerCapture(event.pointerId);
          }} onPointerMove={move} onPointerUp={finish} onPointerCancel={finish} onLostPointerCapture={event => { if (drag.current?.pointer === event.pointerId) drag.current = null; }} onKeyDown={event => key(event, corner.index)}>{corner.label}</button>)}
        </div>
      </div>
      {failed && <div className="pdf-actions"><span role="status">校正底图加载失败。</span><Button title="重试加载底图" compact secondary disabled={busy} onPress={() => { setFailed(false); setAttempt(current => current + 1); }} /></div>}
      {!checked.success && <p className="pdf-note" role="status">四角不可交叉、越界或过于接近。</p>}
      <details className="pdf-disclosure"><summary>精确坐标</summary><div className="pdf-perspective-coordinates"><p className="pdf-note">坐标范围为 -25% 至 125%。</p>{corners.map(corner => <div key={corner.index}><strong>{corner.label}</strong>{(['x', 'y'] as const).map(axis => {
        const field = `${corner.index}.${axis}`;
        return <label key={axis} className="pdf-field">{axis === 'x' ? '横向' : '纵向'}（%）<input aria-label={`${corner.label}${axis === 'x' ? '横向' : '纵向'}校正坐标`} type="text" inputMode="text" maxLength={24} aria-invalid={!checked.success} value={coordinateDrafts[field] ?? percent(points[corner.index][axis])} disabled={busy} onChange={event => {
          const raw = event.currentTarget.value; setCoordinateDrafts(current => ({ ...current, [field]: raw }));
          const value = /^[+-]?(?:\d+\.?\d*|\.\d+)$/.test(raw.trim()) ? Number(raw) / 100 : Number.NaN; update(corner.index, point => ({ ...point, [axis]: value }));
        }} onBlur={() => setCoordinateDrafts(current => { const next = { ...current }; delete next[field]; return next; })} /></label>;
      })}</div>)}</div></details>
      <div className="pdf-actions"><Button title="应用四角校正" compact disabled={busy || !ready || !checked.success} onPress={() => { if (checked.success) onApply(checked.data); }} /><Button title="重置四角" compact secondary disabled={busy} onPress={() => { setCoordinateDrafts({}); setPoints(full()); }} /></div>
    </div>}
  </details>;
}
