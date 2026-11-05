import { useEffect, useState } from 'react';
import type { ExamResolution } from '@solveflow/contracts/managed-exam';
import { Icon } from '@solveflow/web-ui/icons';
import { Dialog, ResolutionLinks } from './components.js';

/** Delivery acknowledgement stays in this view; only opening an answer can mark it read. */
export function ResolutionReminder({ resolutions, ready, onSelect }: {
    resolutions: ExamResolution[];
    ready: boolean;
    onSelect: (notice: ExamResolution) => void;
}) {
    const [acknowledged, setAcknowledged] = useState<Set<string>>(() => new Set());
    const [foreground, setForeground] = useState(() => document.visibilityState === 'visible');
    useEffect(() => {
        const visible = () => setForeground(document.visibilityState === 'visible');
        document.addEventListener('visibilitychange', visible);
        return () => document.removeEventListener('visibilitychange', visible);
    }, []);
    useEffect(() => {
        // Bound the acknowledgement set to notifications still present in the snapshot.
        const ids = new Set(resolutions.map(notice => notice.id));
        setAcknowledged(previous => [...previous].some(id => !ids.has(id)) ? new Set([...previous].filter(id => ids.has(id))) : previous);
    }, [resolutions]);
    const pending = resolutions.filter(notice => !acknowledged.has(notice.id));
    if (!ready || !foreground || !pending.length) return null;
    function acknowledge() {
        setAcknowledged(previous => new Set([...previous, ...pending.map(notice => notice.id)]));
    }
    const teachers = pending.filter(notice => notice.resolution === 'human_confirmed').length;
    return <Dialog title="答案已更新" className="resolution-reminder" onClose={acknowledge}>
        <div className="resolution-heading feedback-tone-success"><span className="resolution-mark"><Icon name="check"/></span><div><h3>{pending.length} 道题已解决</h3><p>{teachers === pending.length ? '老师已处理' : teachers ? '老师处理与 AI 核验已完成' : 'AI 重新核验通过'}</p></div></div>
        <div className="question-notices feedback-tone-success resolution-choices"><div className="alert-links"><ResolutionLinks resolutions={pending} onSelect={notice => { acknowledge(); onSelect(notice); }}/></div></div>
        <div className="dialog-footer"><button onClick={acknowledge}>稍后查看</button></div>
    </Dialog>;
}
