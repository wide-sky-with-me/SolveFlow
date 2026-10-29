import type { MaterialTargetControlProps } from './material-target-control.types';

/** A native button keeps Space and Enter behavior while exposing checkbox semantics. */
export function MaterialTargetControl({ id, label, checked, disabled, onPress, onPreview, onFocus, onBlur, children }: MaterialTargetControlProps) {
  return <button type="button" role="checkbox" data-material-target={id} aria-label={label} aria-checked={checked} disabled={disabled} title="双击查看原图；Alt+Enter 查看原图" onClick={onPress} onFocus={onFocus} onBlur={onBlur}
    onDoubleClick={event => { event.preventDefault(); event.stopPropagation(); onPreview(); }}
    onKeyDown={event => { if (event.altKey && event.key === 'Enter') { event.preventDefault(); event.stopPropagation(); onPreview(); } }}
    style={{ display: 'flex', flex: 1, minWidth: 0, minHeight: 52, alignItems: 'center', gap: 12, padding: 0, border: 0, background: 'transparent', color: 'inherit', font: 'inherit', textAlign: 'left', outline: 'none', cursor: disabled ? 'default' : 'pointer', touchAction: 'manipulation', userSelect: 'none' }}>{children}</button>;
}
