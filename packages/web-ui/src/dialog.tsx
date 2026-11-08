import { Icon } from './icons.js';
import { useEffect, useId, useRef, type ReactNode, type RefObject } from 'react';

/** The browser owns modal focus containment and inert background content. */
export function Dialog({ title, children, onClose, size = 'default', notice, actions, className, initialFocus, returnFocus }: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  size?: 'default' | 'wide';
  notice?: ReactNode;
  actions?: ReactNode;
  className?: string;
  initialFocus?: RefObject<HTMLElement | null>;
  returnFocus?: RefObject<HTMLElement | null>;
}) {
  const ref = useRef<HTMLDialogElement>(null), close = useRef(onClose), label = useId();
  close.current = onClose;
  useEffect(() => {
    const prior = document.activeElement, dialog = ref.current;
    dialog?.showModal(); initialFocus?.current?.focus({ preventScroll: true });
    const cancel = (event: Event) => { event.preventDefault(); close.current(); };
    dialog?.addEventListener('cancel', cancel);
    return () => {
      dialog?.removeEventListener('cancel', cancel); dialog?.close();
      const target = prior instanceof HTMLElement && prior !== document.body && prior.isConnected ? prior : returnFocus?.current;
      if (target?.isConnected) target.focus({ preventScroll: true });
    };
  }, [initialFocus, returnFocus]);
  const classes = [size === 'wide' ? 'dialog-wide' : '', className].filter(Boolean).join(' ') || undefined;
  return <dialog ref={ref} className={classes} aria-labelledby={label} onClick={event => {
    if (event.target !== event.currentTarget) return;
    const box = event.currentTarget.getBoundingClientRect();
    if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) close.current();
  }}>
    <header className="dialog-head"><h2 id={label}>{title}</h2>{actions}<button className="icon-button" onClick={onClose} aria-label="关闭"><Icon name="close"/></button></header>
    {notice && <div className="dialog-notice">{notice}</div>}
    <div className="dialog-body">{children}</div>
  </dialog>;
}
