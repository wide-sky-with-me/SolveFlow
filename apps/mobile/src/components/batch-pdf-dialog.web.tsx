import { useId, useLayoutEffect, useRef, type CSSProperties, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Button } from './ui';
import { useTheme } from '../theme/provider';
import { themeColors } from '../theme/palette';
import './batch-pdf-dialog.web.css';

export function BatchPdfDialog({ title, closeLabel, onClose, onRequestClose = onClose, busy = false, children, footer }: { title: string; closeLabel: string; onClose: () => void; onRequestClose?: () => void; busy?: boolean; children: ReactNode; footer: ReactNode }) {
  const titleId = useId(); const { scheme } = useTheme(); const palette = themeColors[scheme];
  const panel = useRef<HTMLElement>(null); const close = useRef(onRequestClose); close.current = onRequestClose;
  useLayoutEffect(() => {
    const previous = document.activeElement; panel.current?.focus({ preventScroll: true });
    const keyboard = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close.current(); return; }
      if (event.key !== 'Tab') return;
      const items = [...(panel.current?.querySelectorAll<HTMLElement>('button,input,select,textarea,summary,[tabindex="0"]') ?? [])].filter(item => !item.hasAttribute('disabled') && item.getClientRects().length);
      const first = items[0]; const last = items.at(-1);
      if (!first) { event.preventDefault(); panel.current?.focus(); }
      else if (event.shiftKey && (document.activeElement === first || document.activeElement === panel.current)) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', keyboard);
    return () => { document.removeEventListener('keydown', keyboard); if (previous instanceof HTMLElement && previous.isConnected) previous.focus({ preventScroll: true }); };
  }, []);
  const style: CSSProperties & Record<'--pdf-surface' | '--pdf-ink' | '--pdf-muted' | '--pdf-line' | '--pdf-accent' | '--pdf-background', string> = { colorScheme: scheme, '--pdf-surface': palette.surface, '--pdf-ink': palette.ink, '--pdf-muted': palette.muted, '--pdf-line': palette.line, '--pdf-accent': palette.accent, '--pdf-background': palette.background };
  // Decision: .agents/notes/implemented/storage/2026-10-14-exam-style-pdf-export.md
  return createPortal(<div className="pdf-dialog-backdrop" style={style}><section ref={panel} tabIndex={-1} className="pdf-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId}>
    <header className="pdf-dialog-header"><h2 id={titleId}>{title}</h2><Button title={closeLabel} compact secondary disabled={busy} onPress={onClose} /></header>
    <div className="pdf-dialog-body">{children}</div><footer className="pdf-dialog-footer">{footer}</footer>
  </section></div>, document.body);
}
