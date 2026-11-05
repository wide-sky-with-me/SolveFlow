import type { ReactNode } from 'react';
import { Icon } from './icons.js';
import './feedback.css';

export type FeedbackTone = 'info' | 'success' | 'warning' | 'error';

export function Feedback({ children, tone = 'info', onDismiss, className = '' }: {
  children: ReactNode;
  tone?: FeedbackTone;
  onDismiss?: () => void;
  className?: string;
}) {
  return <div className={`feedback feedback-tone-${tone} ${className}`} role={tone === 'error' ? 'alert' : 'status'} aria-atomic="true">
    <span className="feedback-icon"><Icon name={tone === 'success' ? 'check' : tone === 'info' ? 'info' : 'alert'}/></span>
    <div className="feedback-content">{children}</div>
    {onDismiss && <button type="button" className="feedback-dismiss" aria-label="关闭提示" onClick={onDismiss}><Icon name="close"/></button>}
  </div>;
}
