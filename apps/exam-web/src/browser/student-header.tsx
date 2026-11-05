import { createContext, useContext } from 'react';
import { createPortal } from 'react-dom';
import type { ExamTiming } from '@solveflow/contracts/managed-exam';
import { ExamClock } from './exam-clock.js';

export const StudentHeaderSlot = createContext<HTMLElement | null>(null);

export function StudentExamHeading({ title, timing, onDeadline }: { title: string; timing: ExamTiming; onDeadline: () => void }) {
    const host = useContext(StudentHeaderSlot);
    const heading = <div className="student-exam-meta"><h1 title={title}>{title}</h1><ExamClock timing={timing} onDeadline={onDeadline}/></div>;
    return host ? createPortal(heading, host) : heading;
}
