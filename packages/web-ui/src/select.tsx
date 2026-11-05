// Decision: .agents/notes/implemented/architecture/2026-11-03-exam-navigation-and-tracking.md
// Decision: .agents/notes/implemented/architecture/2026-11-04-sitting-allocations.md
import { useEffect, useId, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react';
import { Icon } from './icons.js';
export type SelectOption = { value: string; label: string; group?: string };
/** The native control owns form data/required validation; the visible list shares the app theme. */
export function Select({ label, name, options, value, defaultValue, onChange, disabled = false, required = false, menuHeader, menuFooter, onOpenChange, selection, placeholder }: {
    label: string; name?: string; options: readonly SelectOption[]; value?: string; defaultValue?: string;
    onChange?: (value: string) => void; disabled?: boolean; required?: boolean;
    menuHeader?: ReactNode; menuFooter?: ReactNode; onOpenChange?: (open: boolean) => void;
    selection?: { values: readonly string[]; onChange: (values: string[]) => void; max: number }; placeholder?: string;
}) {
    const [local, setLocal] = useState(defaultValue ?? ''), [open, setOpen] = useState(false), [focused, setFocused] = useState(0), [above, setAbove] = useState(false), [height, setHeight] = useState(280), [invalid, setInvalid] = useState(false);
    const [popup,setPopup]=useState<CSSProperties>({});
    const root = useRef<HTMLDivElement>(null), trigger = useRef<HTMLButtonElement>(null), buttons = useRef<(HTMLButtonElement | null)[]>([]);
    const id = useId(), selected = value ?? (options.some(o => o.value === local) ? local : options[0]?.value ?? '');
    const current = options.find(o => o.value === selected);
    const selectedLabel = selection ? options.filter(o=>selection.values.includes(o.value)).map(o=>o.label).join('、') : current?.label;
    const isSelected = (value: string) => selection ? selection.values.includes(value) : value===selected;
    const unavailable = (value: string) => !!selection && selection.values.length>=selection.max && !isSelected(value);
    function choose(value: string) {
        setInvalid(false);
        if(selection){
            const search=root.current?.querySelector('input[type=search]');
            // A deselected item outside the current page may unmount immediately. Preserve a stable focus owner.
            (search instanceof HTMLInputElement?search:trigger.current)?.focus({preventScroll:true});
            selection.onChange(isSelected(value)?selection.values.filter(item=>item!==value):[...selection.values,value]);return;
        }
        setLocal(value);onChange?.(value);close(true);
    }
    function close(restore = false) { setOpen(false); onOpenChange?.(false); if (restore) trigger.current?.focus(); }
    function position() {
        const box = trigger.current?.getBoundingClientRect(), parent = root.current?.closest('.dialog-body')?.getBoundingClientRect();
        if(!box)return;
        const view=window.visualViewport,viewTop=view?.offsetTop??0,viewBottom=viewTop+(view?.height??window.innerHeight);
        let bottom=Math.min(viewBottom-12,parent?.bottom??Infinity)-box.bottom-6,top=box.top-Math.max(viewTop+12,parent?.top??0)-6;
        // A short edit dialog cannot contain a searchable list. Fixed positioning escapes its scrolling body.
        if(Math.max(top,bottom)<(menuHeader||menuFooter?220:180)){bottom=viewBottom-12-box.bottom-6;top=box.top-viewTop-12-6;}
        const desired=menuHeader||menuFooter?300:180;
        const up=bottom<desired&&top>bottom;setAbove(up);setHeight(Math.max(80,Math.min(300,up?top:bottom)));
        const width=Math.min(box.width,window.innerWidth-24),left=Math.max(12,Math.min(box.left,window.innerWidth-width-12));
        setPopup({position:'fixed',left,width,right:'auto',top:up?'auto':box.bottom+6,bottom:up?window.innerHeight-box.top+6:'auto'});
    }
    function show() {
        if (disabled || (!options.length && !menuHeader)) return;
        position();
        setFocused(Math.max(0, options.findIndex(o => o.value === selected))); setOpen(true); onOpenChange?.(true);
    }
    useEffect(() => { if (disabled) setOpen(false); }, [disabled]);
    useEffect(() => {
        if (!open) return;
        const option = buttons.current[focused];
        option?.focus({ preventScroll: true });
        const list=option?.closest('.select-option-list,.select-options');
        if(option&&list instanceof HTMLElement){
            // Only reveal inside this list. Scrolling ancestors can move the anchor of a fixed popup.
            const item=option.getBoundingClientRect(),bounds=list.getBoundingClientRect();
            if(item.top<bounds.top)list.scrollTop-=bounds.top-item.top;
            else if(item.bottom>bounds.bottom)list.scrollTop+=item.bottom-bounds.bottom;
        }
    }, [focused, open]);
    useEffect(()=>{if(open&&menuHeader){const search=root.current?.querySelector('input[type=search]');if(search instanceof HTMLInputElement)search.focus({preventScroll:true});}},[open,!!menuHeader]);
    useEffect(()=>{
        if(!open)return;
        const move=()=>position(),scroll=(event:Event)=>{if(event.target instanceof Node&&root.current?.contains(event.target))return;position();};
        window.addEventListener('resize',move);document.addEventListener('scroll',scroll,true);window.visualViewport?.addEventListener('resize',move);
        return()=>{window.removeEventListener('resize',move);document.removeEventListener('scroll',scroll,true);window.visualViewport?.removeEventListener('resize',move);};
    },[open]);
    useEffect(() => {
        if (!open) return;
        const outside = (e: PointerEvent) => { if (e.target instanceof Node && !root.current?.contains(e.target)) close(); };
        const blurred = () => close();
        document.addEventListener('pointerdown', outside); window.addEventListener('blur',blurred);
        return () => { document.removeEventListener('pointerdown', outside);window.removeEventListener('blur',blurred); };
    }, [open]);
    function keyboard(e: KeyboardEvent) {
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(true); return; }
        if (e.key === 'Tab') { if(!menuHeader && !menuFooter){trigger.current?.focus();close();} return; }
        if(!options.length)return;
        let next: number | undefined;
        if (e.key === 'ArrowDown') next = (focused + 1) % options.length;
        if (e.key === 'ArrowUp') next = (focused + options.length - 1) % options.length;
        if (e.key === 'Home') next = 0;
        if (e.key === 'End') next = options.length - 1;
        if (next !== undefined) { e.preventDefault(); for(let n=0;n<options.length&&unavailable(options[next]?.value??'');n++)next=(next+(e.key==='ArrowUp'||e.key==='End'?-1:1)+options.length)%options.length;setFocused(next);buttons.current[next]?.focus({preventScroll:true}); }
    }
    const optionNodes = options.map((o, i) => <div key={o.value}>{o.group && o.group !== options[i - 1]?.group && <div className="select-group">{o.group}</div>}<button ref={node => { buttons.current[i] = node; }} type="button" role="option" aria-selected={isSelected(o.value)} disabled={unavailable(o.value)} tabIndex={i === focused ? 0 : -1} onClick={() => choose(o.value)}><span>{o.label}</span>{isSelected(o.value) && <Icon name="check"/>}</button></div>);
    return <div className="select-field"><span id={id + '-label'} className="field-label">{label}</span><div ref={root} className={'select-control' + (open ? ' is-open' : '')} onKeyDown={e=>{if(e.key==='Escape'&&open){e.preventDefault();e.stopPropagation();close(true);}else if(open&&e.target instanceof HTMLInputElement&&['ArrowDown','ArrowUp'].includes(e.key)&&options.length){e.preventDefault();const next=e.key==='ArrowUp'?options.length-1:0;setFocused(next);buttons.current[next]?.focus({preventScroll:true});}}} onBlur={e => {
        if(e.relatedTarget){if(!e.currentTarget.contains(e.relatedTarget))close();return;}
        // Pagination can disable its focused button. Keep the menu and keyboard focus instead of closing it.
        requestAnimationFrame(()=>{if(root.current?.classList.contains('is-open')&&!root.current.contains(document.activeElement))trigger.current?.focus({preventScroll:true});});
    }}>
      <select name={name} className="select-native" multiple={!!selection} value={selection?[...selection.values]:selected} disabled={disabled} required={required} tabIndex={-1} aria-hidden="true" onChange={e => { if(selection)selection.onChange([...e.target.selectedOptions].map(o=>o.value));else{setLocal(e.target.value);onChange?.(e.target.value);}setInvalid(false); }} onInvalid={e => { e.preventDefault(); setInvalid(true); trigger.current?.focus(); }}>{!selection&&<option value="" disabled/>}{options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}</select>
      <button ref={trigger} type="button" role="combobox" className="select-trigger" aria-labelledby={id + '-label'} aria-haspopup="listbox" aria-expanded={open} aria-controls={open ? id + '-list' : undefined} aria-invalid={invalid || undefined} aria-required={required || undefined} disabled={disabled || (!options.length && !menuHeader)} onClick={() => open ? close(true) : show()} onKeyDown={e => { if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) { if(open)keyboard(e);else{e.preventDefault();show();} } }}><span>{selectedLabel || (placeholder??(menuHeader?'请选择':'暂无可选项'))}</span><Icon name="chevron-down"/></button>
      {open && (menuHeader||menuFooter ? <div className={'select-options has-tools'+(above?' above':'')} style={{...popup,maxHeight:height}}>{menuHeader}<div id={id+'-list'} role="listbox" aria-multiselectable={selection?true:undefined} aria-labelledby={id+'-label'} className="select-option-list" onKeyDown={keyboard}>{optionNodes}</div>{menuFooter}</div> : <div id={id+'-list'} role="listbox" aria-multiselectable={selection?true:undefined} aria-labelledby={id+'-label'} className={'select-options'+(above?' above':'')} style={{...popup,maxHeight:height}} onKeyDown={keyboard}>{optionNodes}</div>)}
    </div></div>;
}
