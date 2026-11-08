import type { ExamAssignment } from '@solveflow/contracts/managed-exam';

/** The server decides eligibility and expiration; the browser only describes it. */
export function assignmentDisplay(item: ExamAssignment, available = false) {
    const entry = item.entryState ?? (item.state === 'revoked' ? 'revoked' : item.expired ? 'expired' : item.attemptEnded ? 'ended' : available ? 'available' : 'unavailable');
    const ongoing = entry === 'available' && !!item.attemptId;
    const tone = ongoing ? 'warning' : entry === 'available' ? 'success' : 'neutral';
    const label = ongoing ? '进行中' : {available:'可进入',upcoming:'待开始',ended:'已结束',expired:'已过期',revoked:'已撤回',unavailable:'暂不可进入'}[entry];
    return { entry, tone, label, canOpen: entry !== 'revoked' && (!!item.attemptId || entry === 'available'), action: ongoing ? '继续考试' : item.attemptId ? '查看记录' : entry === 'available' ? item.closesAt === null ? '开始考试' : '进入考试' : label };
}
export function formatExamWindow(opensAt: string, closesAt: string | null) {
    return new Date(opensAt).toLocaleString('zh-CN') + (closesAt ? ' — ' + new Date(closesAt).toLocaleString('zh-CN') : ' · 不限时');
}
export function localExamTime(value: string) {
    const date = new Date(value);
    return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0,16);
}
/** A name-only save must retain precision hidden by the minute-based picker. */
export function editedExamTime(value: string, original?: string | null) {
    return original && value === localExamTime(original) ? original : new Date(value).toISOString();
}
