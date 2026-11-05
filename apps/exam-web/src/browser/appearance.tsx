import { useEffect, useRef, useState } from 'react';
import { Icon } from '@solveflow/web-ui/icons';
import { APPEARANCE_KEY, validAppearance, type Appearance } from './appearance-preference.js';

const options = [{ value: 'light', label: '浅色', icon: 'sun' }, { value: 'dark', label: '深色', icon: 'moon' }, { value: 'system', label: '跟随系统', icon: 'monitor' }] as const;
let transientAppearance: Appearance | null = null;
function readAppearance(): Appearance {
    if (transientAppearance !== null) return transientAppearance;
    try { const value = localStorage.getItem(APPEARANCE_KEY); return validAppearance(value) ? value : 'system'; } catch { return 'system'; }
}
function applyAppearance(value: Appearance) {
    if (value === 'system') delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = value;
}
export function AppearanceMenu() {
    const [value, setValue] = useState(readAppearance), [open, setOpen] = useState(false);
    const root = useRef<HTMLDivElement>(null), trigger = useRef<HTMLButtonElement>(null), items = useRef<(HTMLButtonElement | null)[]>([]);
    useEffect(() => {
        applyAppearance(value);
        const sync = (event?: Event) => { const next = event instanceof CustomEvent && validAppearance(event.detail) ? event.detail : readAppearance(); applyAppearance(next); setValue(next); };
        const storage = (event: StorageEvent) => { if (event.key === APPEARANCE_KEY || event.key === null) { transientAppearance = null; sync(); } };
        window.addEventListener('storage', storage); window.addEventListener('exam-appearance', sync);
        return () => { window.removeEventListener('storage', storage); window.removeEventListener('exam-appearance', sync); };
    }, [value]);
    useEffect(() => {
        if (!open) return;
        items.current[options.findIndex(option => option.value === value)]?.focus();
        const outside = (event: PointerEvent) => { if (event.target instanceof Node && !root.current?.contains(event.target)) setOpen(false); };
        document.addEventListener('pointerdown', outside); return () => document.removeEventListener('pointerdown', outside);
    }, [open]);
    function select(next: Appearance) {
        transientAppearance = next;
        applyAppearance(next); setValue(next);
        try { localStorage.setItem(APPEARANCE_KEY, next); } catch { /* Appearance remains usable without persistent browser storage. */ }
        window.dispatchEvent(new CustomEvent('exam-appearance', { detail: next })); setOpen(false); trigger.current?.focus();
    }
    return <div className="appearance-menu" ref={root} onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false); }}><button type="button" ref={trigger} className="icon-button" aria-label="主题设置" aria-haspopup="menu" aria-expanded={open} title="主题设置" onClick={() => setOpen(previous => !previous)}><Icon name={options.find(option => option.value === value)?.icon ?? 'monitor'}/></button>
        {open && <div className="appearance-options" role="menu" aria-label="主题" onKeyDown={event => {
            if (event.key === 'Escape') { event.preventDefault(); setOpen(false); trigger.current?.focus(); }
            else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
                event.preventDefault(); const current = items.current.findIndex(item => item === document.activeElement);
                const next = event.key === 'Home' ? 0 : event.key === 'End' ? 2 : (current + (event.key === 'ArrowDown' ? 1 : -1) + 3) % 3;
                items.current[next]?.focus();
            }
        }}>{options.map((option, index) => <button type="button" tabIndex={-1} key={option.value} ref={node => { items.current[index] = node; }} role="menuitemradio" aria-checked={value === option.value} onClick={() => select(option.value)}><Icon name={option.icon}/><span>{option.label}</span>{value === option.value && <Icon name="check"/>}</button>)}</div>}
    </div>;
}
