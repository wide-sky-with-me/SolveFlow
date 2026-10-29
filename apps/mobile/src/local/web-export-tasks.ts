// Decision: .agents/notes/implemented/storage/2026-10-14-background-pdf-exports.md
// Decision: .agents/notes/implemented/architecture/2026-10-28-batch-stop-and-export-preflight.md
import { ExportTaskFailure, LocalExportTasks, type ExportArtifact } from '@solveflow/client/local';
import { MAX_BATCH_PRINT_BYTES, type ExportTask, type ExportStorageUsage } from '@solveflow/contracts/local';
import type { Runtime } from '../runtime';
import { createExportTaskStore } from './export-task-store.web';
import { questionsForBatchQuestionPrint, questionsForCapturedBatchQuestionPrint, questionsForCollectedBatchQuestionPrint } from '@solveflow/client/presentation';
import { runCapturedBatchExport, type BatchExportInput } from './run-batch-export.web';
import type { PreparedExportContent } from './prepare-batch-export.web';
import { requireBatchPdfPageCount } from './download-batch-pdfs.web';
import { exportInputBytes } from './export-input-bytes';
import { exportStorageBlock, requireExportQuestions } from './export-preflight';
import { waitForExportInitialization, yieldExportAdmission } from './export-admission.web';

// Decision: .agents/notes/implemented/storage/2026-10-19-pdf-preflight-validation.md
async function collectedQuestionCount(input: BatchExportInput, signal?: AbortSignal): Promise<number> {
  try { const questions = await questionsForCollectedBatchQuestionPrint(input.snapshot, () => yieldExportAdmission(signal)); requireExportQuestions(questions, input.mode, input.layout); return questions.length; }
  finally { signal?.throwIfAborted(); }
}

async function capturedQuestionCount(input: BatchExportInput, signal?: AbortSignal): Promise<number> {
  try { const questions = await questionsForCapturedBatchQuestionPrint(input.snapshot, () => yieldExportAdmission(signal)); requireExportQuestions(questions, input.mode, input.layout); return questions.length; }
  finally { signal?.throwIfAborted(); }
}

const instances = new WeakMap<Runtime, ReturnType<typeof createWebExportTasks>>();
function downloadArtifact(file: ExportArtifact) {
  // Queue reads already return owned bytes; avoid another archive-sized copy before Blob.
  const bytes = file.data.buffer instanceof ArrayBuffer ? new Uint8Array(file.data.buffer, file.data.byteOffset, file.data.byteLength) : Uint8Array.from(file.data);
  const url = URL.createObjectURL(new Blob([bytes], { type: file.mimeType }));
  const link = document.createElement('a'); link.download = file.name; link.href = url; document.body.append(link);
  try { link.click(); } finally { link.remove(); setTimeout(() => URL.revokeObjectURL(url), 30000); }
}
function createWebExportTasks(runtime: Runtime) {
  const listeners = new Set<() => void>();
  let state: { open: boolean; notice: string; error: string; notificationPermission: string; storage: ExportStorageUsage | null; storageError: string; checkingStorage: boolean } = { storage: null, storageError: '', checkingStorage: false, open: false, notice: '', error: '', notificationPermission: typeof Notification === 'undefined' ? 'unsupported' : Notification.permission };
  const update = (change: Partial<typeof state>) => { state = { ...state, ...change }; for (const listener of listeners) listener(); };
  let noticeTimer: ReturnType<typeof setTimeout> | undefined;
  const dismissNotice = () => { clearTimeout(noticeTimer); noticeTimer = undefined; update({ notice: '' }); };
  const showNotice = (notice: string) => { clearTimeout(noticeTimer); update({ notice }); noticeTimer = setTimeout(dismissNotice, 8000); };
  const store = createExportTaskStore();
  const tasks = new LocalExportTasks({
    store, uuid: () => crypto.randomUUID(),
    onSettled(task: Readonly<ExportTask>) {
      if (task.status === 'cancelled') return;
      const title = task.status === 'succeeded' ? '导出已完成' : '导出未完成';
      showNotice(`${title}：${task.title}`);
      if (typeof Notification !== 'undefined' && Notification.permission === 'granted' && document.visibilityState !== 'visible') {
        try { const notification = new Notification(title, { body: '打开 SolveFlow 导出记录查看结果。', tag: `solveflow-export-${task.id}` }); notification.onclick = () => { window.focus(); update({ open: true }); notification.close(); }; }
        catch { showNotice(`${title}：${task.title}（系统通知未发送）`); }
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
  async function checkStorage(signal?: AbortSignal) {
    signal?.throwIfAborted(); update({ checkingStorage: true });
    try {
      const usage = await waitForExportInitialization(store.usage(), signal); signal?.throwIfAborted();
      update({ storage: usage, storageError: '' }); return usage;
    } catch (cause) {
      if (!signal?.aborted) update({ storageError: '无法检查导出缓存，请重试检查。' });
      throw cause;
    } finally { update({ checkingStorage: false }); }
  }
  async function requireStorage(signal?: AbortSignal) {
    const issue = exportStorageBlock(await checkStorage(signal));
    if (issue) throw new ExportTaskFailure(issue);
  }
  return {
    tasks, initialize, checkStorage,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    getSnapshot() { return state; },
    open() { update({ open: true }); void initialize().catch(() => undefined); }, close() { update({ open: false }); }, dismiss: dismissNotice,
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
          const count = preflightToken === collectedSnapshot ? await collectedQuestionCount(input, signal) : (() => { const questions = questionsForBatchQuestionPrint(input.snapshot); requireExportQuestions(questions, input.mode, input.layout); return questions.length; })();
          signal?.throwIfAborted(); if (input.layout !== 'direct') requireBatchPdfPageCount(count);
        }
        await waitForExportInitialization(initialize(), signal);
        await requireStorage(signal);
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
          const questionCount = captured.mode === 'reading' ? captured.snapshot.records.length : await capturedQuestionCount(captured, signal);
          if (captured.mode !== 'reading' && captured.layout !== 'direct') requireBatchPdfPageCount(questionCount);
          await yieldExportAdmission(signal); signal?.throwIfAborted();
          const task = await tasks.enqueue({ batchId: captured.snapshot.batch.id, title: captured.snapshot.batch.title, mode: captured.mode, ...(captured.markIncorrect === undefined ? {} : { markIncorrect: captured.markIncorrect }), layout: captured.mode === 'reading' ? 'saved' : captured.layout, copies: captured.mode === 'answers' ? captured.copies.length : 1, questionCount }, async (signal, progress) => {
            started = true;
            try {
              await requireStorage(signal);
              const prepared = prepare ? await prepare(signal) : captured.prepared;
              // Native captured.snapshot has never escaped this submission/runner closure.
              return await runCapturedBatchExport(runtime, { ...captured, prepared }, signal, progress, () => yieldExportAdmission(signal));
            } catch (cause) {
              if (cause instanceof Error && /^(?:第\d+题|题目整理|导出图片超过|题图来源过多|单题内容)/.test(cause.message)) throw new ExportTaskFailure(cause.message);
              throw cause;
            } finally { release(); stopWatching(); }
          }, signal);
          taskId = task.id; update({ error: '' }); showNotice(`已加入后台导出：${task.title}`); return task;
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
      downloadArtifact(file);
    },
    async downloadPending(id: string, signal?: AbortSignal) {
      signal?.throwIfAborted();
      const file = await tasks.readPendingFile(id);
      signal?.throwIfAborted();
      if (!file || !tasks.pendingFileIds.includes(id)) throw new Error('待保存文件已不可用，请查看导出记录。');
      downloadArtifact(file);
    },
  };
}
export function webExportTasks(runtime: Runtime) {
  let manager = instances.get(runtime);
  if (!manager) { manager = createWebExportTasks(runtime); instances.set(runtime, manager); }
  return manager;
}
