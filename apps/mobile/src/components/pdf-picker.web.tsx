import { useEffect, useId, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { useTheme } from '../theme/provider';
import { themeColors } from '../theme/palette';

export function PdfPicker({ label, value, options, onChange, disabled = false }: { label: string; value: string; options: { value: string; label: string; disabled?: boolean }[]; onChange: (value: string) => void; disabled?: boolean }) {
  const [open, setOpen] = useState(false); const trigger = useRef<HTMLButtonElement>(null); const menu = useRef<HTMLDivElement>(null); const escaped = useRef(false); const id = useId(); const { scheme } = useTheme(); const palette = themeColors[scheme];
  const [position, setPosition] = useState<CSSProperties>({});
  function positionMenu() {
    const rect = trigger.current?.getBoundingClientRect(); if (!rect) return;
    const height = Math.min(240, options.length * 44 + 12); const below = innerHeight - rect.bottom - 12;
    setPosition({ left: Math.max(8, Math.min(rect.left, innerWidth - rect.width - 8)), width: rect.width, maxHeight: Math.min(height, Math.max(below, rect.top - 12)), ...(below >= height || below >= rect.top ? { top: rect.bottom + 6 } : { bottom: innerHeight - rect.top + 6 }) });
  }
  function show() { positionMenu(); setOpen(true); }
  useEffect(() => {
    if (!open) return;
    const dismiss = (event: PointerEvent) => { if (event.target instanceof Node && !trigger.current?.contains(event.target) && !menu.current?.contains(event.target)) setOpen(false); };
    let frame = 0;
    const hide = () => setOpen(false); const scroll = (event: Event) => { if (event.target instanceof Node && menu.current?.contains(event.target)) return; cancelAnimationFrame(frame); frame = requestAnimationFrame(positionMenu); };
    document.addEventListener('pointerdown', dismiss); window.addEventListener('resize', hide); window.addEventListener('scroll', scroll, true);
    const selected = menu.current?.querySelector<HTMLButtonElement>('[aria-selected="true"]') ?? menu.current?.querySelector<HTMLButtonElement>('button:not(:disabled)'); selected?.focus({ preventScroll: true });
    return () => { cancelAnimationFrame(frame); document.removeEventListener('pointerdown', dismiss); window.removeEventListener('resize', hide); window.removeEventListener('scroll', scroll, true); };
  }, [open]);
  useEffect(() => { if (disabled) setOpen(false); }, [disabled]);
  const chosen = options.find(option => option.value === value);
  return <div className="pdf-field"><span id={`${id}-label`}>{label}</span><button ref={trigger} className="pdf-picker-trigger" type="button" aria-label={label} aria-haspopup="listbox" aria-expanded={open} aria-controls={open ? id : undefined} disabled={disabled} onClick={() => open ? setOpen(false) : show()} onKeyDown={event => { if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); show(); } }} onKeyUp={event => { if (event.key === 'Escape' && escaped.current) { event.stopPropagation(); escaped.current = false; } }}><span>{chosen?.label ?? '请选择'}</span><svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="m4 6 4 4 4-4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" /></svg></button>
    {open && createPortal(<div id={id} ref={menu} className="pdf-picker-menu" role="listbox" aria-label={label} style={{ ...position, colorScheme: scheme, color: palette.ink, background: palette.surface, borderColor: palette.line }} onKeyDown={event => {
      if (event.key === 'Escape' || event.key === 'Tab') { if (event.key === 'Escape') { event.preventDefault(); escaped.current = true; } event.stopPropagation(); setOpen(false); trigger.current?.focus(); return; }
      const items = [...(menu.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])]; const index = items.findIndex(item => item === document.activeElement);
      const next = event.key === 'ArrowDown' ? (index + 1) % items.length : event.key === 'ArrowUp' ? (index - 1 + items.length) % items.length : event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : -1;
      if (next >= 0) { event.preventDefault(); items[next]?.focus(); }
    }}>{options.map(option => <button key={option.value} type="button" role="option" aria-selected={option.value === value} disabled={option.disabled} style={{ '--pdf-accent': palette.accent } as CSSProperties} onClick={() => { onChange(option.value); setOpen(false); trigger.current?.focus({ preventScroll: true }); }}><span>{option.label}</span><span aria-hidden="true">{option.value === value ? '✓' : ''}</span></button>)}</div>, trigger.current?.closest('.pdf-dialog-backdrop') ?? document.body)}
  </div>;
}
