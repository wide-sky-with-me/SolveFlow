import type { ExamAnswerRevision, ExamAttempt, ExamResolution, ExamSlot } from '@solveflow/contracts/managed-exam';
import type { ReactNode } from 'react';
export { Dialog } from '@solveflow/web-ui/dialog';
import { Icon } from '@solveflow/web-ui/icons';
import { Feedback } from '@solveflow/web-ui/feedback';
export { Feedback } from '@solveflow/web-ui/feedback';
export function Brand() { return <span className="brand"><span className="brand-mark"><Icon name="camera"/></span><span className="brand-name">SolveFlow</span></span>; }
export function Notice({ message, onClose }: {
    message: string;
    onClose: () => void;
}) { return <Feedback onDismiss={onClose}>{message}</Feedback>; }
export function ErrorText({ error }: {
    error: string;
}) { return error ? <Feedback tone="error" className="error">{error}</Feedback> : null; }
export function RefreshButton({ busy, disabled = false, onRefresh, secondary = false }: { busy: boolean; disabled?: boolean; onRefresh: () => Promise<unknown>; secondary?: boolean }) {
    return <button type="button" className={(secondary?'secondary':'quiet')+' refresh-button'} disabled={disabled||busy} aria-busy={busy} onClick={()=>void onRefresh()}><Icon name="history"/>刷新</button>;
}
export const statusLabels: Record<string, string> = { empty: '待拍摄', queued: '排队中', understanding: '识别中', solving: '解答中', verifying: '校验中', revising: '修正中', completed: '已有答案', needs_clarification: '需要补图', failed: '解答失败', cancelled: '已停止', interrupted: '任务中断' };
export const activeStatuses = new Set(['queued', 'understanding', 'solving', 'verifying', 'revising']);

export const alertLabels: Record<ExamAttempt['alerts'][number]['reason'], string> = { verification_failed: '核验未通过', verification_unknown: '无法确认', verification_unavailable: '核验未完成', answer_failed: '解答失败', image_incomplete: '题图不完整', interrupted: '任务中断', response_mismatch: '作答与模块不符' };
export function QuestionNotices({ label, title, tone, children, emphasis = false }: { label: string; title: string; tone: 'error' | 'success' | 'warning' | 'info'; children: ReactNode; emphasis?: boolean }) {
    return <section className={`question-notices feedback-tone-${tone} ${tone === 'error' ? 'verification-alerts' : 'resolved-answers'}${emphasis ? ' student-notice' : ''}`} aria-label={label}>
        <details><summary><span className="feedback-icon"><Icon name={tone === 'info' ? 'info' : tone === 'error' || tone === 'warning' ? 'alert' : 'check'}/></span><strong aria-live="polite" aria-atomic="true">{title}</strong><Icon name="chevron-down" className="notice-chevron"/></summary><div className="alert-links">{children}</div></details>
    </section>;
}
export function VerificationAlerts({ attempt, onSelect, disabled = false, emphasis = false }: { attempt: ExamAttempt; onSelect: (slot: ExamSlot) => void; disabled?: boolean; emphasis?: boolean }) {
    if (!attempt.alerts.length) return null;
    return <QuestionNotices label="待处理核验问题" title={`待处理 · ${attempt.alerts.length} 题`} tone="error" emphasis={emphasis}>{attempt.alerts.map(alert => <button key={alert.id} disabled={disabled} onClick={() => { const slot = attempt.slots.find(s => s.id === alert.slotId); if (slot) onSelect(slot); }}><span className="notice-question">{alert.moduleTitle} · 第{alert.position}题<span>{alertLabels[alert.reason]}</span></span><Icon name="chevron-right"/></button>)}</QuestionNotices>;
}

export function AttemptOverview({ attempt, compact = false }: { attempt: ExamAttempt; compact?: boolean }) {
    const counts = [
        ['已有答案', attempt.slots.filter(s => s.presentation).length],
        ['处理中', attempt.slots.filter(s => activeStatuses.has(s.status)).length],
        ['待处理', attempt.alerts.length],
        ['未拍', attempt.slots.filter(s => !s.revision).length],
    ] as const;
    return <section className={'card attempt-overview'+(compact?' compact':'')} aria-label="题目状态总览"><div className="section-head"><h2>题目总览</h2><span className="muted">共 {attempt.slots.length} 题</span></div><dl>{counts.map(([label, count]) => <div key={label} className={label === '待处理' && count ? 'attention-count' : ''}><dt>{label}</dt><dd>{count}</dd></div>)}</dl></section>;
}

export function ResolutionLinks({ resolutions, onSelect, disabled = false }: { resolutions: ExamResolution[]; onSelect: (notice: ExamResolution) => void; disabled?: boolean }) {
    return resolutions.map(notice => <button key={notice.id} disabled={disabled} onClick={() => onSelect(notice)}><span className="notice-question">{notice.moduleTitle} · 第{notice.position}题<span>{notice.resolution === 'human_confirmed' ? '老师已处理' : 'AI 核验通过'} · 查看答案</span></span><Icon name="chevron-right"/></button>);
}
export function ResolvedAnswers({ resolutions, onSelect, disabled }: { resolutions: ExamResolution[]; onSelect: (notice: ExamResolution) => void; disabled: boolean }) {
    if (!resolutions.length) return null;
    return <QuestionNotices label="已解决题目" title={`已解决 · ${resolutions.length} 题`} tone="success"><ResolutionLinks resolutions={resolutions} onSelect={onSelect} disabled={disabled}/></QuestionNotices>;
}

export function AnswerRevisions({ notices, onSelect, disabled }: { notices: ExamAnswerRevision[]; onSelect: (notice: ExamAnswerRevision) => void; disabled: boolean }) {
    if (!notices.length) return null;
    return <QuestionNotices label="答案已修正" title={`答案已修正 · ${notices.length} 题`} tone="warning" emphasis>{notices.map(notice => <button key={notice.id} disabled={disabled} onClick={() => onSelect(notice)}><span className="notice-question">{notice.moduleTitle} · 第{notice.position}题<span>校验后答案有调整 · 查看最新答案</span></span><Icon name="chevron-right"/></button>)}</QuestionNotices>;
}
