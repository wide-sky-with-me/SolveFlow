import { useState } from 'react';
import { Icon } from '@solveflow/web-ui/icons';

/** Keep the result query stable while the user combines conditions. */
export function useStagedFilters(initial: Record<string, string>) {
    const [defaults] = useState(initial);
    const [applied, setApplied] = useState(initial), [draft, setDraft] = useState(initial);
    const normalized: Record<string, string> = { ...draft, q: (draft.q ?? '').trim() };
    const keys = new Set([...Object.keys(applied), ...Object.keys(normalized)]);
    const pending = [...keys].filter(key => (applied[key] ?? '') !== (normalized[key] ?? '')).length;
    const active = Object.keys(applied).some(key => (applied[key] ?? '') !== (defaults[key] ?? ''));
    return {
        applied, draft, pending, active,
        setField: (key: string, value: string) => setDraft(values => ({ ...values, [key]: value })),
        apply: () => { setDraft(normalized); setApplied(normalized); },
        reset: () => { setDraft(defaults); setApplied(defaults); },
    };
}

export function FilterActions({ pending, active, onApply, onReset }: {
    pending: number; active: boolean; onApply: () => void; onReset: () => void;
}) {
    return <div className="list-filter-actions">
        {pending > 0 && <span className="filter-pending" role="status">{pending} 项条件待应用</span>}
        <button type="button" className="secondary" disabled={!pending} onClick={onApply}><Icon name="search"/>查询</button>
        <button type="button" className="quiet" disabled={!pending && !active} onClick={onReset}>重置</button>
    </div>;
}
