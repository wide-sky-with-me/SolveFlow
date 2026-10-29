import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { isExportTaskTerminal } from '@solveflow/contracts/local';
import { clientError, formatHistoryTime } from '@solveflow/client/presentation';
import { webExportTasks } from '../local/web-export-tasks';
import type { Runtime } from '../runtime';
import { BatchPdfDialog } from './batch-pdf-dialog.web';
import { BatchPdfExport } from './batch-pdf-export.web';
import { Button, MenuLabel, MenuAccessory, Notice } from './ui';
import { Pressable } from '../theme/primitives';
import { useTheme } from '../theme/provider';
import { themeColors } from '../theme/palette';
import './export-records.web.css';

const labels = { queued: '等待导出', running: '正在导出', succeeded: '已完成', failed: '失败', cancelled: '已取消', interrupted: '已中断' };
const modes = { answers: '题目与作答', questions: '题目', reading: '原始记录' };

export function ExportRecordsEntry({ runtime }: { runtime: Runtime }) {
  const manager = webExportTasks(runtime);
  const tasks = useSyncExternalStore(manager.tasks.subscribe, manager.tasks.getSnapshot);
  const active = tasks.filter(task => !isExportTaskTerminal(task.status)).length;
  const pending = manager.tasks.pendingSaveIds.length;
  return <Pressable accessibilityRole="button" accessibilityLabel={`导出记录${pending ? '（待保存）' : active ? `（${active}）` : ''}`} onPress={() => manager.open()} style={({ pressed }) => [{ minHeight: 64, paddingVertical: 14, paddingHorizontal: 14, borderRadius: 12, flexDirection: 'row', alignItems: 'center', gap: 12 }, pressed && { backgroundColor: '#f1f5fc' }]}><MenuLabel>导出记录</MenuLabel><MenuAccessory value={pending ? '待保存' : active || undefined} /></Pressable>;
}

/** Mounted at workspace lifetime, so navigation and dialog close never cancel a submitted job. */
export function ExportRecordsHost({ runtime, hideNotice = false, onReviewQuestion }: { runtime: Runtime; hideNotice?: boolean; onReviewQuestion?: (id: string) => void }) {
  const manager = webExportTasks(runtime);
  const ui = useSyncExternalStore(manager.subscribe, manager.getSnapshot);
  const tasks = useSyncExternalStore(manager.tasks.subscribe, manager.tasks.getSnapshot);
  const [query, setQuery] = useState(''); const [status, setStatus] = useState('all');
  const [error, setError] = useState(''); const [working, setWorking] = useState<string | null>(null);
  const workingRef = useRef<string | null>(null); const cancellingRef = useRef(new Set<string>());
  const [cancelling, setCancelling] = useState<ReadonlySet<string>>(() => new Set());
  const [errorVersion, setErrorVersion] = useState(0); const feedback = useRef<HTMLDivElement>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [batchId, setBatchId] = useState<string | null>(null);
  const { scheme } = useTheme(); const palette = themeColors[scheme];
  const fileSignature = tasks.filter(task => task.file).map(task => `${task.id}:${task.file!.bytes}`).join('|');
  useEffect(() => { if (ui.open) void manager.checkStorage().catch(() => undefined); }, [manager, ui.open, fileSignature]);
  useEffect(() => { void manager.initialize().catch(() => undefined); }, [manager]);
  useEffect(() => { if (!ui.open || batchId) setConfirmDelete(null); }, [ui.open, batchId]);
  const feedbackText = error || ui.error;
  useLayoutEffect(() => {
    if (!ui.open || batchId || !feedbackText || !feedback.current) return;
    feedback.current.focus({ preventScroll: true }); feedback.current.scrollIntoView({ block: 'start' });
  }, [ui.open, batchId, feedbackText, errorVersion]);
  const pending = new Set(manager.tasks.pendingSaveIds);
  const generated = new Set(manager.tasks.pendingFileIds);
  const active = tasks.filter(task => !isExportTaskTerminal(task.status));
  const filtered = tasks.filter(task => (status === 'all' || task.status === status) && `${task.title} ${task.file?.name ?? ''}`.toLocaleLowerCase().includes(query.toLocaleLowerCase().trim()));
  const blocked = !!working || cancelling.size > 0;
  function reportError(cause: unknown) { setError(clientError(cause)); setErrorVersion(value => value + 1); }
  async function action(id: string, operation: () => Promise<void>) {
    if (workingRef.current || cancellingRef.current.size) return;
    workingRef.current = id; setWorking(id); setError('');
    try { await operation(); setConfirmDelete(null); } catch (cause) { reportError(cause); }
    finally { workingRef.current = null; setWorking(null); }
  }
  async function cancel(id: string) {
    if (cancellingRef.current.has(id)) return;
    cancellingRef.current.add(id); setCancelling(new Set(cancellingRef.current)); setError('');
    // Register cancellation before an in-flight storage action releases the queue's I/O lock.
    try { await manager.tasks.cancel(id); } catch (cause) { reportError(cause); }
    finally { cancellingRef.current.delete(id); setCancelling(new Set(cancellingRef.current)); }
  }
  return <>
    {(!hideNotice || ui.open) && (ui.notice || pending.size > 0 || ui.error) && <aside className="export-task-notice" style={{ color: palette.ink, background: palette.surface, borderColor: palette.line }} aria-label="导出任务通知">
      <div role="status" aria-live="polite">{ui.notice || ui.error || '导出等待保存，请查看导出记录。'}</div>
      <div className="export-task-notice-actions"><Button title="查看导出记录" compact onPress={() => manager.open()} />{ui.notice && <Button title="关闭通知" compact secondary onPress={() => manager.dismiss()} />}</div>
    </aside>}
    {ui.open && !batchId && <BatchPdfDialog title="导出记录" closeLabel="关闭导出记录" onClose={() => { manager.close(); setConfirmDelete(null); }} footer={<>
      {ui.notificationPermission === 'default' && <Button title="开启系统通知" compact secondary onPress={() => void manager.enableNotifications()} />}
      <Button title="关闭" compact secondary onPress={() => manager.close()} />
    </>}>
      {ui.storage && <div className="pdf-actions" data-testid="export-record-storage"><span>导出缓存 {(ui.storage.usedBytes / 1024 / 1024).toFixed(1)} / {(ui.storage.limitBytes / 1024 / 1024).toFixed(1)} MiB</span><Button title="重新检查缓存" compact secondary disabled={ui.checkingStorage} onPress={() => void manager.checkStorage().catch(() => undefined)} /></div>}
      {!!ui.storageError && <Notice text={ui.storageError} error />}
      <div className="export-records-tools"><input aria-label="搜索导出记录" placeholder="搜索批次或文件名" value={query} onChange={event => setQuery(event.target.value)} /><select aria-label="筛选导出状态" value={status} onChange={event => setStatus(event.target.value)}><option value="all">全部状态</option>{Object.entries(labels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></div>
      {feedbackText && <div ref={feedback} tabIndex={-1} data-testid="export-records-feedback"><Notice text={feedbackText} error /></div>}
      {ui.notificationPermission === 'denied' && <p className="pdf-note">系统通知未开启；导出完成仍会在应用内通知。</p>}
      {ui.notificationPermission === 'granted' && <p className="pdf-note">系统通知已开启。</p>}
      {active.length > 0 && <p className="pdf-note">关闭弹窗或切换页面可继续导出；关闭或刷新浏览器会中断任务。</p>}
      <div className="export-records-list" data-testid="export-records-list">{filtered.length ? filtered.map(task => <article className="export-record" key={task.id} data-testid="export-record" data-export-id={task.id} data-status={task.status}>
        <header><h3>{task.title}</h3><span className={`export-record-status ${task.status}`}>{pending.has(task.id) ? '等待保存' : labels[task.status]}</span></header>
        <p>{task.markIncorrect ? '题目与作答（标记错题）' : modes[task.mode]} · {task.layout === 'direct' ? '快速原文' : task.layout === 'clean' ? '严格试卷版' : task.layout === 'paper' ? '整理后的试卷' : '已保存内容'} · {task.questionCount} 题 · {task.copies} 份</p>
        <p>{formatHistoryTime(task.createdAt)}{task.finishedAt ? ` · 完成 ${formatHistoryTime(task.finishedAt)}` : ''}</p>
        {task.file && <p className="export-record-filename">{task.file.name} · {(task.file.bytes / 1024 / 1024).toFixed(1)} MiB</p>}
        {task.status === 'running' && <p role="status">{task.progress}</p>}
        {task.error && <p className="export-record-error">{task.error}</p>}
        {generated.has(task.id) && <p className="pdf-note">文件已生成，可先下载。尚未存入导出记录，刷新或关闭浏览器后无法恢复。</p>}
        <div className="export-record-actions">
          {generated.has(task.id) && <Button title="下载已生成文件" compact disabled={blocked} onPress={() => void action(task.id, () => manager.downloadPending(task.id))} />}
          {pending.has(task.id) && <Button title="重试保存" compact disabled={blocked} onPress={() => void action(task.id, () => manager.tasks.retrySave(task.id))} />}
          {task.status === 'succeeded' && <Button title="下载文件" compact disabled={blocked} onPress={() => void action(task.id, () => manager.download(task.id))} />}
          {!isExportTaskTerminal(task.status) && <Button title={cancelling.has(task.id) ? '正在取消…' : '取消任务'} compact secondary disabled={cancelling.has(task.id)} onPress={() => void cancel(task.id)} />}
          {isExportTaskTerminal(task.status) && <><Button title="重新导出" compact secondary disabled={blocked} onPress={() => setBatchId(task.batchId)} />{confirmDelete === task.id ? <><Button title="确认删除文件和记录" compact danger disabled={blocked} onPress={() => void action(task.id, () => manager.tasks.remove(task.id))} /><Button title="保留" compact secondary onPress={() => setConfirmDelete(null)} /></> : <Button title="删除记录" compact secondary disabled={blocked} onPress={() => setConfirmDelete(task.id)} />}</>}
        </div>
      </article>) : <p className="pdf-note">{query || status !== 'all' ? '没有匹配的导出记录。' : '暂无导出记录。'}</p>}</div>
    </BatchPdfDialog>}
    {batchId && <BatchPdfExport runtime={runtime} batchId={batchId} {...(onReviewQuestion ? { onReviewQuestion: (id: string) => { manager.close(); onReviewQuestion(id); } } : {})} onClose={() => setBatchId(null)} />}
  </>;
}
