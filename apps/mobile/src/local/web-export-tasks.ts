// Decision: .agents/notes/implemented/storage/2026-10-14-background-pdf-exports.md
import { ExportTaskFailure, LocalExportTasks } from '@solveflow/client/local';
import { MAX_BATCH_PRINT_BYTES, type ExportTask } from '@solveflow/contracts/local';
import type { Runtime } from '../runtime';
import { createExportTaskStore } from './export-task-store.web';
import { questionsForBatchQuestionPrint, questionsForCapturedBatchQuestionPrint, questionsForCollectedBatchQuestionPrint } from '@solveflow/client/presentation';
import { runCapturedBatchExport, type BatchExportInput } from './run-batch-export.web';
import type { PreparedExportContent } from './prepare-batch-export.web';
import { requireBatchPdfPageCount } from './download-batch-pdfs.web';
import { exportInputBytes } from './export-input-bytes';
import { waitForExportInitialization, yieldExportAdmission } from './export-admission.web';

// Decision: .agents/notes/implemented/storage/2026-10-19-pdf-preflight-validation.md
async function collectedQuestionCount(snapshot: unknown, signal?: AbortSignal): Promise<number> {
  try { return (await questionsForCollectedBatchQuestionPrint(snapshot, () => yieldExportAdmission(signal))).length; }
  finally { signal?.throwIfAborted(); }
}

async function capturedQuestionCount(snapshot: unknown, signal?: AbortSignal): Promise<number> {
  try { return (await questionsForCapturedBatchQuestionPrint(snapshot, () => yieldExportAdmission(signal))).length; }
  finally { signal?.throwIfAborted(); }
}

const instances = new WeakMap<Runtime, ReturnType<typeof createWebExportTasks>>();
function createWebExportTasks(runtime: Runtime) {
  const listeners = new Set<() => void>();
  let state: { open: boolean; notice: string; error: string; notificationPermission: string } = { open: false, notice: '', error: '', notificationPermission: typeof Notification === 'undefined' ? 'unsupported' : Notification.permission };
  const update = (change: Partial<typeof state>) => { state = { ...state, ...change }; for (const listener of listeners) listener(); };
  const tasks = new LocalExportTasks({
    store: createExportTaskStore(), uuid: () => crypto.randomUUID(),
    onSettled(task: Readonly<ExportTask>) {
      if (task.status === 'cancelled') return;
      const title = task.status === 'succeeded' ? '导出已完成' : '导出未完成';
      update({ notice: `${title}：${task.title}` });
      if (typeof Notification !== 'undefined' && Notification.permission === 'granted' && document.visibilityState !== 'visible') {
        try { const notification = new Notification(title, { body: '打开 SolveFlow 导出记录查看结果。', tag: `solveflow-export-${task.id}` }); notification.onclick = () => { window.focus(); update({ open: true }); notification.close(); }; }
        catch { update({ notice: `${title}：${task.title}（系统通知未发送）` }); }
      }
    },
  });
  let initializing: Promise<void> | null = null;
  let acceptedBytes = 0; let submitting = false;
  const collectedSnapshot = Symbol();
  const initialize = () => {
    initializing ??= tasks.initialize().then(() => { if (!tasks.storageBlocked) update({ error: '' }); }).catch((error: unknown) => { initializing = null; update({ error: '导出记录库暂不可用，请检查浏览器存储空间后重试。' }); throw error; });
    return initializing;
  };
  return {
    tasks, initialize,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    getSnapshot() { return state; },
    open() { update({ open: true }); void initialize().catch(() => undefined); }, close() { update({ open: false }); }, dismiss() { update({ notice: '' }); },
    async enableNotifications() {
      if (typeof Notification === 'undefined' || !window.isSecureContext) { update({ notificationPermission: 'unsupported' }); return; }
      try { const permission = await Notification.requestPermission(); update({ notificationPermission: permission }); }
      catch { update({ notificationPermission: 'unsupported' }); }
    },
    async submit(input: BatchExportInput, prepare?: (signal: AbortSignal) => Promise<PreparedExportContent>, signal?: AbortSignal, preflightToken?: symbol) {
      if (submitting) throw new Error('正在加入导出队列，请稍候。');
      submitting = true;
      try {
        await yieldExportAdmission(signal); signal?.throwIfAborted();
        if (input.mode !== 'reading') {
          const count = preflightToken === collectedSnapshot ? await collectedQuestionCount(input.snapshot, signal) : questionsForBatchQuestionPrint(input.snapshot).length;
          signal?.throwIfAborted(); requireBatchPdfPageCount(count);
        }
        await waitForExportInitialization(initialize(), signal);
        await yieldExportAdmission(signal); signal?.throwIfAborted();
        // Accounting and capture must see the same input, without a task boundary.
        const bytes = exportInputBytes(input);
        if (acceptedBytes + bytes > MAX_BATCH_PRINT_BYTES) throw new Error('等待导出的内容超过128MiB，请先完成当前任务。');
        // Freeze the accepted copy plan and images; later dialog edits cannot change this job.
        const captured = structuredClone(input); acceptedBytes += bytes;
        let released = false;
        const release = () => { if (!released) { released = true; acceptedBytes -= bytes; } };
        let taskId: string | null = null; let started = false;
        const stopWatching = tasks.subscribe(() => { if (!started && taskId && tasks.getSnapshot().some(task => task.id === taskId && !['queued', 'running'].includes(task.status))) { release(); stopWatching(); } });
        try {
          await yieldExportAdmission(signal); signal?.throwIfAborted();
          const questionCount = captured.mode === 'reading' ? captured.snapshot.records.length : await capturedQuestionCount(captured.snapshot, signal);
          if (captured.mode !== 'reading') requireBatchPdfPageCount(questionCount);
          await yieldExportAdmission(signal); signal?.throwIfAborted();
          const task = await tasks.enqueue({ batchId: captured.snapshot.batch.id, title: captured.snapshot.batch.title, mode: captured.mode, layout: captured.mode === 'reading' ? 'saved' : captured.layout, copies: captured.mode === 'answers' ? captured.copies.length : 1, questionCount }, async (signal, progress) => {
            started = true;
            try {
              const prepared = prepare ? await prepare(signal) : captured.prepared;
              // Native captured.snapshot has never escaped this submission/runner closure.
              return await runCapturedBatchExport(runtime, { ...captured, prepared }, signal, progress, () => yieldExportAdmission(signal));
            } catch (cause) {
              if (cause instanceof Error && /^(?:第\d+题|题目整理|导出图片超过|题图来源过多|单题内容)/.test(cause.message)) throw new ExportTaskFailure(cause.message);
              throw cause;
            } finally { release(); stopWatching(); }
          }, signal);
          taskId = task.id; update({ notice: `已加入后台导出：${task.title}`, error: '' }); return task;
        } catch (error) { release(); stopWatching(); throw error; }
      } finally { submitting = false; }
    },
    /** Only for inert plain snapshots produced by collectBatchPrint, not general caller objects. */
    submitCollected(input: BatchExportInput, prepare?: (signal: AbortSignal) => Promise<PreparedExportContent>, signal?: AbortSignal): Promise<ExportTask> {
      return this.submit(input, prepare, signal, collectedSnapshot);
    },
    async download(id: string, signal?: AbortSignal) {
      signal?.throwIfAborted();
      const file = await tasks.readFile(id);
      signal?.throwIfAborted();
      if (!file) throw new Error('导出文件已不存在，请重新导出。');
      const url = URL.createObjectURL(new Blob([Uint8Array.from(file.data)], { type: file.mimeType }));
      const link = document.createElement('a'); link.download = file.name; link.href = url; document.body.append(link);
      try { link.click(); } finally { link.remove(); setTimeout(() => URL.revokeObjectURL(url), 30000); }
    },
  };
}
export function webExportTasks(runtime: Runtime) {
  let manager = instances.get(runtime);
  if (!manager) { manager = createWebExportTasks(runtime); instances.set(runtime, manager); }
  return manager;
}
