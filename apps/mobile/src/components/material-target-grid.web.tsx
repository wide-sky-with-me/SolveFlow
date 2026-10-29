import { useEffect, useRef, type PointerEvent as ReactPointerEvent } from 'react';
import type { MaterialTargetGridProps } from './material-target-grid.types';

type Point = { x: number; y: number };
type Gesture = { pointer: number; key: number; start: Point; point: Point; baseline: readonly string[]; visited: Set<string>; select: boolean; active: boolean };

function scrollParent(node: HTMLElement) {
  for (let parent = node.parentElement; parent; parent = parent.parentElement) {
    if (/(auto|scroll)/.test(getComputedStyle(parent).overflowY) && parent.scrollHeight > parent.clientHeight) return parent;
  }
  return null;
}

/** Intersect the pointer segment, so a fast sweep does not skip intervening cells. */
function intersects(a: Point, b: Point, box: { left: number; right: number; top: number; bottom: number }) {
  if (box.left >= box.right || box.top >= box.bottom) return false;
  let low = 0, high = 1;
  for (const [start, delta, min, max] of [[a.x, b.x - a.x, box.left, box.right], [a.y, b.y - a.y, box.top, box.bottom]]) {
    if (start === undefined || delta === undefined || min === undefined || max === undefined) return false;
    if (!delta) { if (start < min || start > max) return false; continue; }
    const first = (min - start) / delta, last = (max - start) / delta;
    low = Math.max(low, Math.min(first, last)); high = Math.min(high, Math.max(first, last));
    if (low > high) return false;
  }
  return true;
}

/** A sweep paints each visited ID once; cancellation restores this supplement's draft. */
export function MaterialTargetGrid(props: MaterialTargetGridProps) {
  const root = useRef<HTMLDivElement>(null); const latest = useRef(props); latest.current = props;
  const gesture = useRef<Gesture | null>(null); const frame = useRef<number | undefined>(undefined);
  const scroll = useRef<HTMLElement | null>(null); const suppressClick = useRef(false); const escapeHeld = useRef(false);

  function stop(commit: boolean, notify = true) {
    const current = gesture.current; gesture.current = null;
    if (!commit && current) suppressClick.current = true;
    if (frame.current !== undefined) cancelAnimationFrame(frame.current); frame.current = undefined; scroll.current = null;
    if (current && root.current?.hasPointerCapture(current.pointer)) root.current.releasePointerCapture(current.pointer);
    if (notify && !commit && current?.active && current.key === latest.current.selectionKey) latest.current.onChange([...current.baseline]);
  }
  function paint(previous: Point, point: Point) {
    const current = gesture.current, surface = root.current; if (!current?.active || !surface) return;
    const viewport = scroll.current?.getBoundingClientRect(); const before = current.visited.size;
    for (const cell of surface.querySelectorAll<HTMLElement>('[data-material-target]')) {
      const id = cell.dataset.materialTarget; if (!id || current.visited.has(id)) continue;
      const box = cell.getBoundingClientRect();
      const visible = { left: Math.max(0, box.left, viewport?.left ?? 0), right: Math.min(innerWidth, box.right, viewport?.right ?? innerWidth), top: Math.max(0, box.top, viewport?.top ?? 0), bottom: Math.min(innerHeight, box.bottom, viewport?.bottom ?? innerHeight) };
      if (intersects(previous, point, visible)) current.visited.add(id);
    }
    if (before === current.visited.size) return;
    const selected = new Set(current.baseline);
    for (const id of current.visited) { if (current.select) selected.add(id); else selected.delete(id); }
    latest.current.onChange(latest.current.ids.filter(id => selected.has(id)));
  }
  function tick() {
    const current = gesture.current; if (!current?.active) return;
    const body = scroll.current;
    if (body) {
      const box = body.getBoundingClientRect(), point = current.point;
      if (point.x >= box.left && point.x <= box.right && point.y >= box.top - 12 && point.y <= box.bottom + 12) {
        const speed = point.y < box.top + 32 ? -Math.min(16, (box.top + 32 - point.y) / 2) : point.y > box.bottom - 32 ? Math.min(16, (point.y - box.bottom + 32) / 2) : 0;
        if (speed) { const old = body.scrollTop; body.scrollTop += speed; if (body.scrollTop !== old) paint(point, point); }
      }
    }
    frame.current = requestAnimationFrame(tick);
  }
  useEffect(() => {
    const keyDown = (event: KeyboardEvent) => { if (event.key === 'Escape' && gesture.current) { escapeHeld.current = true; event.preventDefault(); event.stopImmediatePropagation(); stop(false); } };
    const keyUp = (event: KeyboardEvent) => { if (event.key === 'Escape' && escapeHeld.current) { escapeHeld.current = false; event.preventDefault(); event.stopImmediatePropagation(); } };
    const blur = () => stop(false); const hidden = () => { if (document.hidden) stop(false); };
    window.addEventListener('keydown', keyDown, true); window.addEventListener('keyup', keyUp, true);
    window.addEventListener('blur', blur); document.addEventListener('visibilitychange', hidden);
    return () => { stop(false, false); window.removeEventListener('keydown', keyDown, true); window.removeEventListener('keyup', keyUp, true); window.removeEventListener('blur', blur); document.removeEventListener('visibilitychange', hidden); };
  }, []);
  const version = props.ids.join('|');
  useEffect(() => { stop(false); }, [props.selectionKey, props.disabled, version]);

  function start(event: ReactPointerEvent<HTMLDivElement>) {
    if (gesture.current) stop(false);
    suppressClick.current = false;
    if (latest.current.disabled || !event.isPrimary || event.button !== 0 || event.pointerType === 'touch' || !(event.target instanceof Element)) return;
    const cell = event.target.closest<HTMLElement>('[data-material-target]'); const id = cell?.dataset.materialTarget;
    if (!id || !root.current?.contains(cell) || !latest.current.ids.includes(id)) return;
    const point = { x: event.clientX, y: event.clientY };
    gesture.current = { pointer: event.pointerId, key: latest.current.selectionKey, start: point, point, baseline: [...latest.current.selected], visited: new Set(), select: !latest.current.selected.includes(id), active: false };
  }
  function move(event: ReactPointerEvent<HTMLDivElement>) {
    const current = gesture.current; if (!current || current.pointer !== event.pointerId) return;
    const previous = current.point; current.point = { x: event.clientX, y: event.clientY };
    if (!current.active && Math.hypot(current.point.x - current.start.x, current.point.y - current.start.y) < 5) return;
    if (!current.active) {
      try { root.current?.setPointerCapture(event.pointerId); } catch { stop(false); return; }
      current.active = true; suppressClick.current = true; scroll.current = root.current ? scrollParent(root.current) : null;
      frame.current = requestAnimationFrame(tick);
    }
    event.preventDefault(); paint(previous, current.point);
  }
  return <div ref={root} role="group" aria-label="补图绑定题号" style={{ minWidth: 0, userSelect: 'none', opacity: props.disabled ? .4 : 1 }} onPointerDownCapture={start} onPointerMove={move}
    onPointerUp={event => { const current = gesture.current; if (!current || current.pointer !== event.pointerId) return; if (current.active) { paint(current.point, { x: event.clientX, y: event.clientY }); event.preventDefault(); } stop(true); }}
    onPointerCancel={event => { if (gesture.current?.pointer === event.pointerId) stop(false); }}
    onLostPointerCapture={event => { if (event.target === event.currentTarget && gesture.current?.pointer === event.pointerId) stop(false); }}
    onClickCapture={event => { if (suppressClick.current && event.detail > 0) { suppressClick.current = false; event.preventDefault(); event.stopPropagation(); } }}>
    {props.children}
  </div>;
}
