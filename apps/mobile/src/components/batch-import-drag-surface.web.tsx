import { useEffect, useRef, useState, type ReactNode, type PointerEvent as ReactPointerEvent } from 'react';
import { createPortal } from 'react-dom';
import { batchImportSlotKey, type BatchImportDragRequest, type BatchImportDropTarget } from '../batch-import-drag';
import { useTheme } from '../theme/provider';
import { themeColors } from '../theme/palette';
import type { ImportDragItemProps, ImportDragSurfaceProps } from './batch-import-drag-surface.types';

export const batchImportDragAvailable = true;
type Gesture = { pointer: number; startX: number; startY: number; x: number; y: number; photoIds: readonly number[]; version: string; active: boolean; intent: BatchImportDropTarget | null };
function scrollParent(node: HTMLElement) {
  for (let parent = node.parentElement; parent; parent = parent.parentElement) {
    if (/(auto|scroll)/.test(getComputedStyle(parent).overflowY) && parent.scrollHeight > parent.clientHeight) return parent;
  }
  return null;
}

/** Pointer capture belongs to this stable root, never to a tile that preview moves. */
// Decision: .agents/notes/implemented/storage/2026-10-27-batch-import-pointer-drag.md
export function BatchImportDragSurface(props: ImportDragSurfaceProps) {
  const root = useRef<HTMLDivElement>(null); const latest = useRef(props); latest.current = props;
  const gesture = useRef<Gesture | null>(null); const frame = useRef<number | undefined>(undefined);
  const scroll = useRef<HTMLElement | null>(null); const detachScroll = useRef<(() => void) | null>(null);
  const alive = useRef(true); const suppressClick = useRef(false); const escapeHeld = useRef(false);
  const [ghost, setGhost] = useState<{ x: number; y: number; count: number } | null>(null);
  const { scheme } = useTheme(); const palette = themeColors[scheme];
  const version = props.layout.map(batchImportSlotKey).join('|') + '/' + props.photoIds.join(',') + '/' + props.group;

  function stop(commit: boolean, notify = true) {
    const current = gesture.current; gesture.current = null;
    if (frame.current !== undefined) cancelAnimationFrame(frame.current); frame.current = undefined;
    detachScroll.current?.(); detachScroll.current = null; scroll.current = null;
    if (current && root.current?.hasPointerCapture(current.pointer)) root.current.releasePointerCapture(current.pointer);
    if (notify && alive.current) {
      setGhost(null); latest.current.onPreview(null); latest.current.onActiveChange(false);
      if (commit && current?.active && current.intent) latest.current.onDrop({ photoIds: current.photoIds, target: current.intent });
    }
  }
  function targetAt(x: number, y: number): BatchImportDropTarget | null | undefined {
    const surface = root.current; const current = gesture.current;
    const grid = surface?.querySelector<HTMLElement>('[data-import-grid]');
    const hit = surface?.ownerDocument.elementFromPoint(x, y);
    if (!surface || !current || !grid || !hit || !grid.contains(hit)) return null;
    const keys = new Set([...latest.current.layout.map(batchImportSlotKey), 'end']);
    const cells = [...grid.querySelectorAll<HTMLElement>('[data-import-slot]')].filter(node => keys.has(node.dataset.importSlot ?? ''));
    let target = hit.closest<HTMLElement>('[data-import-slot]');
    if (!target || !grid.contains(target)) {
      let best = Infinity; target = null;
      for (const cell of cells) {
        const box = cell.getBoundingClientRect();
        const dx = Math.max(box.left - x, 0, x - box.right), dy = Math.max(box.top - y, 0, y - box.bottom);
        const distance = dx * dx + dy * dy;
        if (distance < best) { best = distance; target = cell; }
      }
    }
    const key = target?.dataset.importSlot;
    if (!target || !key || !keys.has(key)) return null;
    if (current.photoIds.some(id => key === `new:${id}`)) return undefined;
    if (key === 'end') return { key: 'end', side: 'before' };
    const box = target.getBoundingClientRect();
    // Preview moves records under the pointer. Resolve the visible slot against
    // the base sequence without the moving group, so crossing cells advances
    // the insertion cursor instead of chasing displaced record IDs.
    const index = cells.indexOf(target) + (x < box.left + box.width / 2 ? 0 : 1);
    const remaining = latest.current.layout.filter(row => row.kind !== 'new' || !current.photoIds.includes(row.photoId));
    const destination = remaining[index];
    return { key: destination ? batchImportSlotKey(destination) : 'end', side: 'before' };
  }
  function updateTarget() {
    const current = gesture.current; if (!current?.active) return;
    const target = targetAt(current.x, current.y);
    if (target === undefined) return;
    if (current.intent?.key === target?.key && current.intent?.side === target?.side) return;
    current.intent = target;
    latest.current.onPreview(target ? { photoIds: current.photoIds, target } : null);
  }
  function tick() {
    const current = gesture.current; if (!current?.active) return;
    const body = scroll.current;
    if (body) {
      const box = body.getBoundingClientRect(); let speed = 0;
      if (current.x >= box.left && current.x <= box.right && current.y >= box.top - 12 && current.y <= box.bottom + 12) {
        if (current.y < box.top + 36) speed = -Math.min(18, (box.top + 36 - current.y) / 2);
        else if (current.y > box.bottom - 36) speed = Math.min(18, (current.y - box.bottom + 36) / 2);
      }
      if (speed) { const previous = body.scrollTop; body.scrollTop += speed; if (body.scrollTop !== previous) updateTarget(); }
    }
    frame.current = requestAnimationFrame(tick);
  }
  useEffect(() => {
    alive.current = true;
    const keyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && gesture.current) { escapeHeld.current = true; event.preventDefault(); event.stopImmediatePropagation(); stop(false); }
    };
    const keyUp = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && escapeHeld.current) { escapeHeld.current = false; event.preventDefault(); event.stopImmediatePropagation(); }
    };
    const blur = () => stop(false); const hidden = () => { if (document.hidden) stop(false); };
    window.addEventListener('keydown', keyDown, true); window.addEventListener('keyup', keyUp, true);
    window.addEventListener('blur', blur); document.addEventListener('visibilitychange', hidden);
    return () => {
      alive.current = false; stop(false, false);
      window.removeEventListener('keydown', keyDown, true); window.removeEventListener('keyup', keyUp, true);
      window.removeEventListener('blur', blur); document.removeEventListener('visibilitychange', hidden);
    };
  }, []);
  useEffect(() => { if (gesture.current && gesture.current.version !== version) stop(false); }, [version]);

  function start(event: ReactPointerEvent<HTMLDivElement>) {
    if (gesture.current && gesture.current.pointer !== event.pointerId) { stop(false); return; }
    if (!event.isPrimary || event.button !== 0 || !(event.target instanceof Element)) return;
    // A new press is intentional even if a prevented touch drag emitted no click.
    suppressClick.current = false;
    const source = event.target.closest<HTMLElement>('[data-import-source]');
    if (!source || !root.current?.contains(source)) return;
    const raw = source.dataset.importSource;
    const photoIds = raw === 'all' || latest.current.group ? latest.current.photoIds : latest.current.photoIds.filter(id => String(id) === raw);
    if (!photoIds.length) return;
    const first = photoIds[0]; if (first !== undefined) latest.current.onSelect(first);
    gesture.current = { pointer: event.pointerId, startX: event.clientX, startY: event.clientY, x: event.clientX, y: event.clientY, photoIds: [...photoIds], version, active: false, intent: null };
  }
  function move(event: ReactPointerEvent<HTMLDivElement>) {
    const current = gesture.current; if (!current || current.pointer !== event.pointerId) return;
    current.x = event.clientX; current.y = event.clientY;
    if (!current.active && Math.hypot(current.x - current.startX, current.y - current.startY) < 6) return;
    if (!current.active) {
      current.active = true; suppressClick.current = true;
      try { root.current?.setPointerCapture(event.pointerId); } catch { stop(false); return; }
      root.current?.focus({ preventScroll: true }); latest.current.onActiveChange(true);
      scroll.current = root.current ? scrollParent(root.current) : null;
      const body = scroll.current;
      if (body) { body.addEventListener('scroll', updateTarget, { passive: true }); detachScroll.current = () => body.removeEventListener('scroll', updateTarget); }
      frame.current = requestAnimationFrame(tick);
    }
    event.preventDefault(); event.stopPropagation();
    setGhost({ x: current.x, y: current.y, count: current.photoIds.length }); updateTarget();
  }
  return <div ref={root} role="group" aria-label="题图拖动工作区" tabIndex={-1} style={{ minWidth: 0, outline: 'none' }}
    onPointerDownCapture={start} onPointerMove={move}
    onPointerUp={event => {
      const current = gesture.current; if (!current || current.pointer !== event.pointerId) return;
      if (current.active) { current.x = event.clientX; current.y = event.clientY; updateTarget(); event.preventDefault(); event.stopPropagation(); }
      stop(current.active);
    }} onPointerCancel={event => { if (gesture.current?.pointer === event.pointerId) stop(false); }}
    onLostPointerCapture={event => { if (event.target === event.currentTarget && gesture.current?.pointer === event.pointerId) stop(false); }}
    onClickCapture={event => { if (suppressClick.current && event.detail > 0) { suppressClick.current = false; event.preventDefault(); event.stopPropagation(); } }}>
    {props.children}
    {ghost && createPortal(<div aria-hidden="true" data-testid="batch-import-drag-ghost" style={{ position: 'fixed', left: ghost.x + 12, top: ghost.y + 12, pointerEvents: 'none', zIndex: 10000, padding: '8px 12px', borderRadius: 10, background: palette.surface, border: `2px solid ${palette.accent}`, color: palette.accent, font: '600 14px system-ui', boxShadow: '0 8px 24px #0003' }}>{ghost.count > 1 ? `${ghost.count} 张` : '移动新图'}</div>, document.body)}
  </div>;
}

export function BatchImportDragItem({ source, target, children }: ImportDragItemProps) {
  return <div data-import-source={source} data-import-slot={target === undefined ? undefined : target === null ? 'end' : batchImportSlotKey(target)}
    style={{ display: 'flex', flexShrink: 0, minWidth: 0, ...(source === undefined ? {} : { touchAction: 'none', userSelect: 'none', cursor: 'grab' }) }}>{children}</div>;
}
export function BatchImportDragGrid({ children }: { children: ReactNode }) { return <div data-import-grid="" style={{ minWidth: 0 }}>{children}</div>; }
