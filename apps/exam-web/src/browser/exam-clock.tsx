// Decision: .agents/notes/implemented/architecture/2026-11-04-exam-timing.md
import { useEffect, useRef, useState } from 'react';
import { z } from 'zod';
import type { ExamTiming } from '@solveflow/contracts/managed-exam';
import { api, idResponse } from './api.js';
import { Dialog, ErrorText } from './components.js';

export function formatExamDuration(seconds: number) {
  const value = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0));
  return [Math.floor(value / 3600), Math.floor(value / 60) % 60, value % 60].map(part => String(part).padStart(2, '0')).join(':');
}
const endLabels = { student: '学生已结束', teacher: '老师已结束', deadline: '时间已到', system: '已结束' };
const AckList = z.array(z.string().max(120)).max(64);
function readAcks(studentId: string) {
  try { const value: unknown = JSON.parse(sessionStorage.getItem('solveflow-end-acks:' + studentId) ?? '[]'); const parsed = AckList.safeParse(value); return parsed.success ? parsed.data : []; }
  catch { return []; }
}
export function ExamEndNotice({ id, studentId, timing }: { id: string; studentId: string; timing: ExamTiming }) {
  const [open, setOpen] = useState(false), seen = useRef(new Set<string>());
  const key = id + ':' + timing.endedAt;
  useEffect(() => {
    if (!timing.endedAt || !['teacher','deadline'].includes(timing.endedBy ?? '') || seen.current.has(key) || readAcks(studentId).includes(key)) return;
    setOpen(true);
  }, [key, studentId, timing.endedAt, timing.endedBy]);
  function acknowledge() {
    seen.current.add(key); setOpen(false);
    try { sessionStorage.setItem('solveflow-end-acks:' + studentId, JSON.stringify([...readAcks(studentId).filter(item => item !== key), key].slice(-64))); }
    catch { /* The notice remains acknowledged in this mounted page. */ }
  }
  if (!open) return null;
  return <Dialog title="考试已结束" onClose={acknowledge}><p>{timing.endedBy === 'teacher' ? '老师已结束本场考试。' : '考试时间已到，本场考试已自动结束。'}</p><p>本次用时 <strong>{formatExamDuration(timing.elapsedSeconds)}</strong>，已保存的题目和答案可继续查看。</p><div className="dialog-footer"><button className="primary" onClick={acknowledge}>我已知晓</button></div></Dialog>;
}
export function ExamClock({ timing, compact = false, onDeadline }: { timing: ExamTiming; compact?: boolean; onDeadline?: () => void }) {
  const anchor = useRef({ timing, at: performance.now() });
  const deadlineNotified = useRef(false);
  if (anchor.current.timing !== timing) anchor.current = { timing, at: performance.now() };
  const [, tick] = useState(0);
  useEffect(() => {
    if (!timing.startedAt || timing.endedAt) return;
    const timer = setInterval(() => tick(value => value + 1), 1000);
    return () => clearInterval(timer);
  }, [timing.startedAt, timing.endedAt]);
  const delta = Math.floor(Math.max(0, performance.now() - anchor.current.at) / 1000);
  const running = timing.startedAt && !timing.endedAt;
  const extra = running ? Math.min(delta, timing.remainingSeconds ?? Infinity) : 0;
  const remaining = timing.remainingSeconds === null ? null : Math.max(0, timing.remainingSeconds - delta);
  useEffect(() => {
    if (remaining === 0 && timing.startedAt && !timing.endedAt && !deadlineNotified.current) {
      deadlineNotified.current = true; onDeadline?.();
    }
  }, [remaining, timing.startedAt, timing.endedAt, onDeadline]);
  return <div className={'exam-clock' + (compact ? ' compact' : '') + (timing.endedAt ? ' ended' : '')} aria-label="考试用时">
    {(!compact||!timing.startedAt)&&<span>{timing.startedAt ? '已用时' : '未进入'}</span>}{(!compact||timing.startedAt)&&<time dateTime={'PT' + (timing.elapsedSeconds + extra) + 'S'}>{timing.startedAt ? formatExamDuration(timing.elapsedSeconds + extra) : '—'}</time>}
    {!compact && <span className="clock-status">{timing.endedBy ? endLabels[timing.endedBy] : timing.startedAt ? remaining === null ? '不限时' : '剩余 ' + formatExamDuration(remaining) : ''}</span>}
  </div>;
}

export function EndExamButton({ id, timing, title, studentName, onEnded }: { id: string; timing: ExamTiming; title: string; studentName?: string; onEnded: () => Promise<unknown> }) {
  const [open, setOpen] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const current = useRef<AbortController | null>(null);
  useEffect(() => () => current.current?.abort(), []);
  async function finish() {
    if (busy) return;
    const controller = new AbortController(); current.current = controller;
    setBusy(true); setError('');
    try {
      await api('/attempts/' + id + '/finish', idResponse, { method: 'POST', signal: controller.signal });
      if (controller.signal.aborted) return;
      await onEnded();
      if (!controller.signal.aborted) setOpen(false);
    } catch (error) { if (!controller.signal.aborted) setError(error instanceof Error ? error.message : '结束失败，请重试。'); }
    finally { if (!controller.signal.aborted) setBusy(false); }
  }
  return <>{!timing.endedAt && timing.startedAt && <button className="quiet end-exam-button" onClick={() => { setOpen(true); setError(''); }}>结束考试</button>}
    {open && !timing.endedAt && <Dialog title="结束本场考试？" onClose={() => { if (!busy) setOpen(false); }}>
      <p><strong>{studentName ? studentName + ' · ' : ''}{title}</strong></p><p>结束后停止未完成的答题，保留已保存的题目和答案，不能继续拍题。用时将固定保存。</p>
      <ErrorText error={error}/><div className="dialog-footer"><button disabled={busy} onClick={() => setOpen(false)}>继续考试</button><button className="primary" disabled={busy} onClick={() => void finish()}>{busy ? '正在结束…' : '确认结束'}</button></div>
    </Dialog>}
  </>;
}
