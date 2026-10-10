'use dom';
import { useEffect, useMemo, useRef, useState, type PointerEvent } from 'react';
import { decodeHistoryDocument, formatHistoryTime } from '@solveflow/client/presentation';
import { subjectLabel } from '@solveflow/contracts/http';
import { MathText } from './math-text';
import '../../.generated/katex.css';
import './answer.css';
import './theme.css';
import { useDocumentTheme, type DocumentTheme } from './document-theme';
import './history.css';
import { historyGestureIntent, historyGestureOpen } from './history-gesture';
type Entry = ReturnType<typeof decodeHistoryDocument>['entries'][number];
type Actions = { onOpen: (id: string) => Promise<void>; onFavorite: (id: string) => Promise<void>; onRemove: (id: string) => Promise<void> };
/** One local DOM document for the entire list. */
export default function HistoryDocument({ viewport = false, theme = 'light', historyPayload, onOpen, onFavorite, onRemove, onReady }: Actions & {
  viewport?: boolean; dom?: import('expo/dom').DOMProps; historyPayload: string; theme?: DocumentTheme; onReady: () => Promise<void>;
}) {
  useDocumentTheme(theme);
  const { entries, currentId, disabled, offset } = useMemo(() => decodeHistoryDocument(historyPayload), [historyPayload]);
  const surface = useRef<HTMLDivElement>(null);
  useEffect(() => { surface.current?.scrollTo({ top: 0 }); setOpenId(null); }, [offset]);
  useEffect(() => { if (!viewport || !('ReactNativeWebView' in window)) return; const elements = [document.documentElement, document.body, document.getElementById('root')]; for (const element of elements) if (element) element.style.height = '100%'; }, [viewport]);
  const [openId, setOpenId] = useState<string | null>(null);
  useEffect(() => { void onReady(); }, [onReady, historyPayload]);
  return <div key={offset} ref={surface} className={`answer-document history-document${viewport ? " history-viewport" : ""}`}>{entries.map((entry, index) => <HistoryRow key={entry.id} entry={entry} ordinal={offset + index + 1} current={entry.id === currentId} disabled={disabled} open={openId === entry.id} setOpen={value => setOpenId(value ? entry.id : null)} {...{ onOpen, onFavorite, onRemove }} />)}</div>;
}
function HistoryRow({ entry, ordinal, current, disabled, open, setOpen, onOpen, onFavorite, onRemove }: Actions & { entry: Entry; ordinal: number; current: boolean; disabled: boolean; open: boolean; setOpen: (open: boolean) => void }) {
  const gesture = useRef<{ x: number; y: number; time: number; origin: number; horizontal: boolean; dx: number } | null>(null);
  const suppressClick = useRef(false); const [drag, setDrag] = useState<number | null>(null);
  const width = 144; const surface = useRef<HTMLDivElement>(null);
  useEffect(() => { const node = surface.current; if (!node) return; const move = (event: TouchEvent) => { if (gesture.current?.horizontal && event.cancelable) event.preventDefault(); }; node.addEventListener('touchmove', move, { passive: false }); return () => node.removeEventListener('touchmove', move); }, []);
  function move(event: PointerEvent<HTMLDivElement>) {
    const start = gesture.current; if (!start) return;
    const dx = event.clientX - start.x; start.dx = dx; const dy = event.clientY - start.y;
    const intent = historyGestureIntent(dx, dy);
    if (!start.horizontal && intent === 'vertical') { suppressClick.current = true; gesture.current = null; return; }
    if (!start.horizontal && intent === 'horizontal') { start.horizontal = true; suppressClick.current = true; event.currentTarget.setPointerCapture(event.pointerId); }
    if (start.horizontal) setDrag(Math.max(-width, Math.min(0, start.origin + dx)));
  }
  function end(event: PointerEvent<HTMLDivElement>) {
    const start = gesture.current;
    if (start?.horizontal) setOpen(historyGestureOpen(start.origin < 0, event.clientX - start.x, event.timeStamp - start.time));
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    gesture.current = null; setDrag(null);
  }
  const status = entry.answerState ? { verified: '校验通过', answered: '待确认', failed: '未完成', unanswered: '未作答' }[entry.answerState] : null;
  return <div className={`history-entry${current ? ' history-current' : ''}`} data-session-id={entry.id}>
    <div className="history-actions" aria-hidden={!open}>
      <button className="favorite-action" disabled={disabled || !open} tabIndex={open ? 0 : -1} onClick={() => { setOpen(false); void onFavorite(entry.id); }}>{entry.favorite ? '取消收藏' : '收藏'}</button>
      <button className="remove-action" disabled={disabled || !open} tabIndex={open ? 0 : -1} onClick={() => { setOpen(false); void onRemove(entry.id); }}>移除</button>
    </div>
    <div ref={surface} className="history-foreground" style={{ transform: `translateX(${drag ?? (open ? -width : 0)}px)`, transition: drag === null ? undefined : 'none' }}
      onPointerDown={event => { if (disabled || event.button !== 0 || (event.target instanceof Element && event.target.closest('.history-more'))) return; suppressClick.current = false; gesture.current = { x: event.clientX, y: event.clientY, time: event.timeStamp, origin: open ? -width : 0, horizontal: false, dx: 0 }; }} onPointerMove={move} onPointerUp={end} onPointerCancel={event => { const start = gesture.current; if (start?.horizontal) setOpen(historyGestureOpen(start.origin < 0, start.dx, event.timeStamp - start.time)); suppressClick.current = true; gesture.current = null; setDrag(null); }}>
      <div className="history-ordinal" aria-label={`序号 ${ordinal}`}>{String(ordinal).padStart(2, '0')}</div>
      <div className="history-details">
        <div className="history-meta"><span className="history-subject">{subjectLabel(entry.subject)}</span>{status && <span className={`history-state history-state-${entry.answerState}`}>{status}</span>}{current && <span className="history-current-label">当前题目</span>}{entry.favorite && <span className="favorite-star" role="img" aria-label="已收藏">★</span>}</div>
        <div className="history-preview" inert><MathText text={entry.text} /></div>
        <time className="history-time" dateTime={entry.createdAt}>保存于 {formatHistoryTime(entry.createdAt)}</time>
      </div>
      <button className="history-open" disabled={disabled} aria-label={`打开${subjectLabel(entry.subject)}题目 ${entry.id}`} onClick={() => { if (suppressClick.current) return; if (open) setOpen(false); else void onOpen(entry.id); }} onKeyDown={event => { if (event.key === 'ArrowLeft') { event.preventDefault(); setOpen(true); } if (event.key === 'Escape') setOpen(false); }} />
      <button className="history-more" disabled={disabled} aria-label="题目操作" aria-expanded={open} onClick={() => setOpen(!open)}>•••</button>
    </div>
  </div>;
}
