'use dom';
import { useEffect, useMemo, useRef, useState, type PointerEvent } from 'react';
import { decodeHistoryDocument } from '@solveflow/client';
import { subjectLabel } from '@solveflow/contracts/http';
import { MathText } from './math-text';
import '../../.generated/katex.css';
import './answer.css';
import './theme.css';
import { useDocumentTheme, type DocumentTheme } from './document-theme';
import './history.css';
type Entry = ReturnType<typeof decodeHistoryDocument>['entries'][number];
type Actions = { onOpen: (id: string) => Promise<void>; onFavorite: (id: string) => Promise<void>; onRemove: (id: string) => Promise<void> };
/** One local DOM document for the entire list. */
export default function HistoryDocument({ theme = 'light', historyPayload, onOpen, onFavorite, onRemove, onReady }: Actions & {
  dom?: import('expo/dom').DOMProps; historyPayload: string; theme?: DocumentTheme; onReady: () => Promise<void>;
}) {
  useDocumentTheme(theme);
  const { entries, currentId, disabled } = useMemo(() => decodeHistoryDocument(historyPayload), [historyPayload]);
  const [openId, setOpenId] = useState<string | null>(null);
  useEffect(() => { void onReady(); }, [onReady, historyPayload]);
  return <div className="answer-document history-document">{entries.map(entry => <HistoryRow key={entry.id} entry={entry} current={entry.id === currentId} disabled={disabled} open={openId === entry.id} setOpen={value => setOpenId(value ? entry.id : null)} {...{ onOpen, onFavorite, onRemove }} />)}</div>;
}
function HistoryRow({ entry, current, disabled, open, setOpen, onOpen, onFavorite, onRemove }: Actions & { entry: Entry; current: boolean; disabled: boolean; open: boolean; setOpen: (open: boolean) => void }) {
  const gesture = useRef<{ x: number; y: number; origin: number; horizontal: boolean } | null>(null);
  const suppressClick = useRef(false); const [drag, setDrag] = useState<number | null>(null);
  const width = 144;
  function move(event: PointerEvent<HTMLDivElement>) {
    const start = gesture.current; if (!start) return;
    const dx = event.clientX - start.x; const dy = event.clientY - start.y;
    if (!start.horizontal && Math.abs(dy) > Math.abs(dx) && Math.abs(dy) > 8) { gesture.current = null; return; }
    if (Math.abs(dx) > 8 && Math.abs(dx) > Math.abs(dy)) { start.horizontal = true; suppressClick.current = true; event.currentTarget.setPointerCapture(event.pointerId); }
    if (start.horizontal) setDrag(Math.max(-width, Math.min(0, start.origin + dx)));
  }
  function end(event: PointerEvent<HTMLDivElement>) {
    const start = gesture.current;
    if (start?.horizontal) setOpen(start.origin + event.clientX - start.x < -36);
    gesture.current = null; setDrag(null);
  }
  return <div className="history-entry" data-session-id={entry.id}>
    <div className="history-actions" aria-hidden={!open}>
      <button className="favorite-action" disabled={disabled || !open} tabIndex={open ? 0 : -1} onClick={() => { setOpen(false); void onFavorite(entry.id); }}>{entry.favorite ? '取消收藏' : '收藏'}</button>
      <button className="remove-action" disabled={disabled || !open} tabIndex={open ? 0 : -1} onClick={() => { setOpen(false); void onRemove(entry.id); }}>移除</button>
    </div>
    <div className="history-foreground" style={{ transform: `translateX(${drag ?? (open ? -width : 0)}px)`, transition: drag === null ? undefined : 'none' }}
      onPointerDown={event => { if (disabled || event.button !== 0 || (event.target instanceof Element && event.target.closest('.history-more'))) return; suppressClick.current = false; gesture.current = { x: event.clientX, y: event.clientY, origin: open ? -width : 0, horizontal: false }; }} onPointerMove={move} onPointerUp={end} onPointerCancel={() => { gesture.current = null; setDrag(null); }}>
      <div className="history-preview" inert><MathText text={entry.text} /></div>
      <div className="history-meta">{entry.favorite && <span className="favorite-star" role="img" aria-label="已收藏">★ </span>}{subjectLabel(entry.subject)} · {new Date(entry.createdAt).toLocaleDateString('zh-CN')}{current ? ' · 当前题目' : ''}</div>
      <button className="history-open" disabled={disabled} aria-label={`打开${subjectLabel(entry.subject)}题目 ${entry.id}`} onClick={() => { if (suppressClick.current) return; if (open) setOpen(false); else void onOpen(entry.id); }} onKeyDown={event => { if (event.key === 'ArrowLeft') { event.preventDefault(); setOpen(true); } if (event.key === 'Escape') setOpen(false); }} />
      <button className="history-more" disabled={disabled} aria-label="题目操作" aria-expanded={open} onClick={() => setOpen(!open)}>•••</button>
    </div>
  </div>;
}
