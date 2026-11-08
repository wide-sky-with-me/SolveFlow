import { useEffect, useId, useRef, useState } from 'react';
import { Icon } from '@solveflow/web-ui/icons';
import { ModelServiceChoice } from './model-service-choice.js';

export function AccountMenu({ name, busy, onHistory, onLogout, onManagement }: { name: string; busy: boolean; onHistory: () => void; onLogout: () => void; onManagement?: () => void }) {
    const [open, setOpen] = useState(false);
    const [servicesOpen, setServicesOpen] = useState(false);
    const root = useRef<HTMLDivElement>(null), trigger = useRef<HTMLButtonElement>(null), items = useRef<(HTMLButtonElement | null)[]>([]), menuId = useId();
    useEffect(() => {
        if (!open) return;
        items.current[0]?.focus();
        const outside = (event: PointerEvent) => { if (event.target instanceof Node && !root.current?.contains(event.target)) setOpen(false); };
        document.addEventListener('pointerdown', outside);
        return () => document.removeEventListener('pointerdown', outside);
    }, [open]);
    function choose(action: () => void) { setOpen(false); trigger.current?.focus(); action(); }
    return <div className="account-menu" ref={root} onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false); }}>
      <button ref={trigger} className="account-trigger" aria-label="账户菜单" aria-haspopup="menu" aria-controls={menuId} aria-expanded={open} title={name} disabled={busy} onClick={() => setOpen(value => !value)}><span className="user-avatar" aria-hidden="true">{name.slice(0, 1)}</span><span className="user-name">{name}</span><Icon name="chevron-down"/></button>
      {open && <div id={menuId} className="account-options" role="menu" aria-label="账户" onKeyDown={event => {
          if (event.key === 'Escape') { event.preventDefault(); setOpen(false); trigger.current?.focus(); }
          else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
              event.preventDefault();
              const current = items.current.findIndex(item => item === document.activeElement);
              const count = onManagement ? 4 : 3;
              items.current[event.key === 'Home' ? 0 : event.key === 'End' ? count - 1 : (current + (event.key === 'ArrowDown' ? 1 : -1) + count) % count]?.focus();
          }
      }}>
        <button role="menuitem" tabIndex={-1} ref={node => { items.current[0] = node; }} onClick={() => choose(onHistory)}><Icon name="history"/>考试记录</button>
        <button role="menuitem" tabIndex={-1} ref={node => { items.current[1] = node; }} onClick={() => choose(()=>setServicesOpen(true))}><Icon name="pulse"/>服务方案</button>
        {onManagement && <button role="menuitem" tabIndex={-1} ref={node => { items.current[2] = node; }} onClick={() => choose(onManagement)}><Icon name="monitor"/>管理端</button>}
        <button role="menuitem" tabIndex={-1} ref={node => { items.current[onManagement ? 3 : 2] = node; }} onClick={() => choose(onLogout)} disabled={busy}><Icon name="logout"/>退出登录</button>
      </div>}
      {servicesOpen&&<ModelServiceChoice onClose={()=>setServicesOpen(false)}/>}
    </div>;
}
