// Decision: .agents/notes/implemented/rendering/2026-11-05-managed-student-presentation.md
import './slot-state.css';
import type { ExamSlot } from '@solveflow/contracts/managed-exam';
import { activeStatuses, statusLabels } from './components.js';

/** Current task and presentation take precedence over historical completion/skip markers. */
export function slotState(slot: ExamSlot) {
    if (activeStatuses.has(slot.status)) return { label: statusLabels[slot.status] ?? '处理中', tone: 'working' };
    if (slot.presentation) return { label: '已有答案', tone: 'answered' };
    if (['failed', 'needs_clarification', 'interrupted'].includes(slot.status)) return { label: statusLabels[slot.status] ?? '待处理', tone: 'failed' };
    if (slot.status === 'cancelled') return { label: '已停止', tone: 'paused' };
    if (slot.revision > 0 || slot.images.length) return { label: '待解答', tone: 'paused' };
    if (slot.skipped) return { label: '已跳过', tone: 'skipped' };
    return { label: '未拍', tone: 'empty' };
}

export function slotClass(slot: ExamSlot) {
    const { tone } = slotState(slot);
    const feedback: Record<string, string> = { working: 'info', answered: slot.presentation?.verified && !slot.presentation.simulated ? 'success' : 'warning', failed: 'error', paused: 'warning', skipped: 'warning' };
    return 'slot-state-' + tone + (feedback[tone] ? ' feedback-tone-' + feedback[tone] : '');
}

export const overviewLabels = { unanswered: '未答', answering: '正在回答', checking: '校验', passed: '通过', error: '出错' } as const;
type OverviewState = { state: keyof typeof overviewLabels; label: string; detail: string };
function overview(state: OverviewState['state'], detail: string = overviewLabels[state]): OverviewState {
    return { state, label: overviewLabels[state], detail };
}
export const overviewLegend = [overview('unanswered'), overview('answering'), overview('checking'), overview('passed'), overview('error')];

/** An old answer must not hide a running retry or its current failure. */
export function overviewState(slot: ExamSlot, flagged = false): OverviewState {
    if (slot.status === 'verifying') return overview('checking', '校验中');
    if (activeStatuses.has(slot.status)) return overview('answering', statusLabels[slot.status]);
    if (flagged || ['failed', 'needs_clarification', 'interrupted'].includes(slot.status)) return overview('error', flagged ? '待处理' : statusLabels[slot.status]);
    if (slot.presentation?.verified && !slot.presentation.simulated) return overview('passed', 'AI 已核验');
    if (slot.presentation?.humanConfirmed) return overview('passed', '老师已确认');
    // “校验” also includes a published answer awaiting review; it does not imply a live request.
    if (slot.presentation) return overview('checking', '待核验');
    return overview('unanswered', slotState(slot).label);
}

export function overviewClass(state: OverviewState) {
    const feedback = { unanswered: '', answering: 'info', checking: 'warning', passed: 'success', error: 'error' } as const;
    return 'slot-overview slot-overview-' + state.state + (feedback[state.state] ? ' feedback-tone-' + feedback[state.state] : '');
}
