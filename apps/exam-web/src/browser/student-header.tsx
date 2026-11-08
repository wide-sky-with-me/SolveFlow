import { createContext, useContext, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import type { ExamTiming } from '@solveflow/contracts/managed-exam';
import { Icon } from '@solveflow/web-ui/icons';
import { Dialog } from './components.js';
import { EndExamButton } from './exam-clock.js';

// Decision: .agents/notes/implemented/architecture/2026-11-05-student-manual-navigation.md

export const StudentHeaderSlot = createContext<HTMLElement | null>(null);

export type StudentNavigation = { version: number; view: 'home' | 'history' };

export function StudentExamStatus({ id, title, timing, onDeadline }: { id: string; title: string; timing: ExamTiming; onDeadline: () => Promise<unknown> }) {
    const host = useContext(StudentHeaderSlot);
    const [open, setOpen] = useState(false);
    useEffect(() => { if (timing.endedAt) setOpen(false); }, [timing.endedAt]);
    useEffect(() => {
        if (!timing.startedAt || timing.endedAt || timing.remainingSeconds === null) return;
        const timer = setTimeout(() => onDeadline(), Math.min(timing.remainingSeconds * 1000, 2147483647));
        return () => clearTimeout(timer);
    }, [timing, onDeadline]);
    const ended = !!timing.endedAt || timing.remainingSeconds === 0;
    const state = ended ? '已结束' : timing.startedAt ? '进行中' : '未开始';
    const heading = <button className={'student-exam-status' + (ended ? ' ended' : '')} aria-label="考试状态" aria-haspopup="dialog" onClick={() => setOpen(true)}><span className="exam-status-dot"/><span className="exam-status-label">考试状态</span><strong>{state}</strong><Icon name="chevron-down"/></button>;
    return <>{host ? createPortal(heading, host) : <div className="student-status-fallback">{heading}</div>}
      {open && <Dialog title="考试状态" onClose={() => setOpen(false)}><dl className="exam-state-details"><div><dt>当前考试</dt><dd>{title}</dd></div><div><dt>状态</dt><dd>{state}</dd></div><div><dt>结束方式</dt><dd>{timing.endedBy ? ({student:'学生结束',teacher:'老师结束',deadline:'时间已到',system:'系统结束'}[timing.endedBy]) : timing.remainingSeconds === null ? '手动结束' : '到达截止时间自动结束'}</dd></div></dl><div className="dialog-footer"><button onClick={() => setOpen(false)}>返回答题</button>{!ended&&<EndExamButton id={id} timing={timing} title={title} onEnded={onDeadline}/>}</div></Dialog>}
    </>;
}
