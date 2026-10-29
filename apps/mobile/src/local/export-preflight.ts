import type { BatchPrintProblem, BatchPrintQuestion, ExportLayout, ExportStorageUsage } from '@solveflow/contracts/local';

export type ExportPreflightIssue = { key: string; ordinal: number; recordId: string; blocking: boolean; messages: string[] };
export function inspectExportQuestions(problems: readonly BatchPrintProblem[], mode: 'answers' | 'questions' | 'reading', layout: ExportLayout, answers: readonly BatchPrintQuestion[] = []): ExportPreflightIssue[] {
  if (mode === 'reading') return [];
  const byKey = new Map(mode === 'answers' ? answers.map(question => [question.key, question]) : []);
  return problems.flatMap(question => {
    const messages: string[] = [], problem = question.problem;
    const missing = !problem || !problem.text.trim();
    if (missing) messages.push(layout === 'direct' ? '缺少已解析题干，需补答或改用其他版式' : '未解析题干，将按原图导出');
    if (problem?.optionsComplete === false) messages.push('选项不完整，需核对原图');
    if (problem?.uncertainties.length) messages.push('题面存在识别疑点');
    const candidate = byKey.get(question.key)?.candidate;
    if (mode === 'answers' && answers.length && (!candidate || !candidate.answer.trim())) messages.push('没有已保存作答');
    if (mode === 'answers' && candidate?.selectedOptions?.some(label => !problem?.options?.some(option => option.label === label))) messages.push('作答选项无法对应题面');
    return messages.length ? [{ key: question.key, ordinal: question.ordinal, recordId: question.recordId, blocking: missing && layout === 'direct', messages }] : [];
  });
}
export function requireExportQuestions(problems: readonly BatchPrintProblem[], mode: 'answers' | 'questions' | 'reading', layout: ExportLayout) {
  const blocked = inspectExportQuestions(problems, mode, layout).filter(issue => issue.blocking);
  if (blocked.length) throw new Error(`第${blocked.slice(0, 8).map(issue => issue.ordinal).join('、')}题尚无已解析题干${blocked.length > 8 ? `等${blocked.length}题` : ''}，请补答或改用其他导出版式。`);
}
export function exportStorageBlock(usage: ExportStorageUsage | null): string | null {
  if (!usage) return null;
  if (!usage.availableBytes) return '导出缓存已满，请先下载并删除旧导出记录。';
  if (usage.browserAvailableBytes === 0) return '当前浏览器存储空间不足，请释放空间后重新检查。';
  return null;
}
