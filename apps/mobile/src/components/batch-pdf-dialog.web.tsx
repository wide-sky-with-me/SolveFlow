import { useId, type CSSProperties, type ReactNode } from 'react';
import { MotionModal } from './motion-modal';
import { Button } from './ui';
import { useTheme } from '../theme/provider';
import { themeColors } from '../theme/palette';
import './batch-pdf-dialog.web.css';

export function BatchPdfDialog({ title, closeLabel, onClose, onRequestClose = onClose, busy = false, children, footer }: { title: string; closeLabel: string; onClose: () => void; onRequestClose?: () => void; busy?: boolean; children: ReactNode; footer: ReactNode }) {
  const titleId = useId(); const { scheme } = useTheme(); const palette = themeColors[scheme];
  const style: CSSProperties & Record<'--pdf-surface' | '--pdf-ink' | '--pdf-muted' | '--pdf-line' | '--pdf-accent' | '--pdf-background', string> = { colorScheme: scheme, '--pdf-surface': palette.surface, '--pdf-ink': palette.ink, '--pdf-muted': palette.muted, '--pdf-line': palette.line, '--pdf-accent': palette.accent, '--pdf-background': palette.background };
  return <MotionModal transparent animationType="fade" onRequestClose={onRequestClose}>
    <div className="pdf-dialog-backdrop" style={style}><section className="pdf-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId}>
      <header className="pdf-dialog-header"><h2 id={titleId}>{title}</h2><Button title={closeLabel} compact secondary disabled={busy} onPress={onClose} /></header>
      <div className="pdf-dialog-body">{children}</div><footer className="pdf-dialog-footer">{footer}</footer>
    </section></div>
  </MotionModal>;
}
