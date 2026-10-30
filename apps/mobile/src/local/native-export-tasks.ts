// Decision: .agents/notes/implemented/storage/2026-10-30-native-quick-pdf.md
import * as Crypto from 'expo-crypto';
import { Paths } from 'expo-file-system';
import { LocalExportTasks, ExportTaskFailure, requireExportActive, type ExportArtifact } from '@solveflow/client/local';
import { NativePdfInputSchema, ExportTaskProgressSchema, MAX_BATCH_PRINT_BYTES, type NativePdfInput } from '@solveflow/contracts/local';
import { questionsForBatchQuestionPrint } from '@solveflow/client/presentation';
import type { Runtime } from '../runtime';
import { NativePdfTransfer } from './native-pdf-transfer';
import { createNativeExportTaskStore } from './export-task-store.native';
import { nativePdfMetadata } from './native-pdf-input';
import { requireExportQuestions } from './export-preflight';
import { exportInputBytes } from './export-input-bytes';

const instances = new WeakMap<Runtime, ReturnType<typeof createNativeExportTasks>>();
function createNativeExportTasks() {
  const listeners = new Set<() => void>();
  let state: { open: boolean; notice: string; error: string; renderId: string | null } = { open: false, notice: '', error: '', renderId: null };
  const update = (change: Partial<typeof state>) => { state = { ...state, ...change }; for (const listener of listeners) listener(); };
  let noticeTimer: ReturnType<typeof setTimeout> | undefined;
  const dismiss = () => { clearTimeout(noticeTimer); update({ notice: '' }); };
  const notice = (value: string) => { clearTimeout(noticeTimer); update({ notice: value }); noticeTimer = setTimeout(dismiss, 8000); };
  const store = createNativeExportTaskStore();
  async function requireStorage() {
    const usage = await store.usage();
    if (!usage.availableBytes) throw new ExportTaskFailure('导出缓存已满，请先保存并删除旧导出记录。');
    const available = Paths.availableDiskSpace;
    if (Number.isFinite(available) && available <= 0) throw new ExportTaskFailure('设备存储空间不足，请释放空间后重试。');
  }
  const tasks = new LocalExportTasks({ store, uuid: Crypto.randomUUID, onSettled: task => { if (task.status !== 'cancelled') notice(`${task.status === 'succeeded' ? '导出已完成' : '导出未完成'}：${task.title}`); } });
  let initialized: Promise<void> | null = null;
  const initialize = () => initialized ??= tasks.initialize().then(() => { update({ error: '' }); }).catch((cause: unknown) => { initialized = null; update({ error: '导出记录暂不可用，请检查设备存储后重试。' }); throw cause; });
  let active: { transfer: NativePdfTransfer; progress: (value: string) => void; finish: (error?: Error, artifact?: ExportArtifact) => void } | null = null;
  let acceptedBytes = 0; let submitting = false;
  const current = (id: string) => { if (!active || active.transfer.id !== id) throw new Error('导出已取消。'); return active; };
  return {
    tasks, store, initialize, dismiss,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; }, getSnapshot: () => state,
    open() { update({ open: true }); void initialize().catch(() => {}); }, close() { update({ open: false, error: '' }); },
    async submit(input: NativePdfInput, signal: AbortSignal) {
      if (submitting) throw new Error('正在加入导出队列，请稍候。');
      submitting = true; let release: (() => void) | undefined;
      try {
        requireExportActive(signal); await initialize(); requireExportActive(signal);
        const problems = questionsForBatchQuestionPrint(input.snapshot); requireExportQuestions(problems, input.mode, 'direct');
        NativePdfInputSchema.parse(input);
        const bytes = exportInputBytes(input);
        if (acceptedBytes + bytes > MAX_BATCH_PRINT_BYTES) throw new Error('等待导出的内容超过128MiB，请先完成当前任务。');
        await requireStorage(); requireExportActive(signal);
        const payload = JSON.stringify(input); acceptedBytes += bytes;
        let released = false; release = () => { if (!released) { released = true; acceptedBytes -= bytes; } };
        const releaseInput = release;
        let taskId: string | null = null; let started = false;
        const stop = tasks.subscribe(() => { if (!started && taskId && tasks.getSnapshot().some(task => task.id === taskId && !['queued', 'running'].includes(task.status))) { releaseInput(); stop(); } });
        try {
          const task = await tasks.enqueue(nativePdfMetadata(input, problems.length), async (signal, progress) => {
            started = true;
            try {
              await requireStorage(); requireExportActive(signal);
              return await new Promise<ExportArtifact>((resolve, reject) => {
                const id = Crypto.randomUUID(); const transfer = new NativePdfTransfer(id, payload);
                const finish = (error?: Error, artifact?: ExportArtifact) => {
                  if (active?.transfer !== transfer) return;
                  active = null; transfer.dispose(); signal.removeEventListener('abort', cancel); clearTimeout(startup); update({ renderId: null });
                  if (error) reject(error); else if (artifact) resolve(artifact); else reject(new Error('导出文件缺失。'));
                };
                const cancel = () => finish(new Error('导出已取消。'));
                const startup = setTimeout(() => finish(new ExportTaskFailure('本地PDF渲染页启动超时，请重试。')), 30000);
                active = { transfer, progress: value => { clearTimeout(startup); progress(value); }, finish };
                signal.addEventListener('abort', cancel, { once: true }); update({ renderId: id });
                if (signal.aborted) cancel();
              });
            } finally { releaseInput(); stop(); }
          }, signal);
          taskId = task.id; update({ error: '' }); notice(`已加入导出：${task.title}`); return task;
        } catch (cause) { stop(); throw cause; }
      } catch (cause) { release?.(); throw cause; }
      finally { submitting = false; }
    },
    async read(id: string, offset: number) { const job = current(id); if (offset === 0) job.progress('正在读取本地导出内容'); return job.transfer.read(id, offset); },
    async progress(id: string, value: string) { current(id).progress(ExportTaskProgressSchema.parse(value)); },
    async header(id: string, value: unknown) { current(id).transfer.begin(id, value); },
    async chunk(id: string, index: number, value: string) { current(id).transfer.append(id, index, value); },
    async complete(id: string) { const job = current(id); const artifact = job.transfer.finish(id); job.finish(undefined, artifact); },
    async fail(id: string, message: string) { if (active?.transfer.id === id) active.finish(new ExportTaskFailure(message.length <= 200 ? message : 'PDF生成失败，请重试。')); },
  };
}
export function nativeExportTasks(runtime: Runtime) {
  let manager = instances.get(runtime);
  if (!manager) { manager = createNativeExportTasks(); instances.set(runtime, manager); }
  return manager;
}
