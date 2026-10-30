import { nativePdfError } from '../local/native-pdf-error';
import { requireExportActive } from '@solveflow/client/local';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { isExportTaskTerminal } from '@solveflow/contracts/local';
import type { Runtime } from '../runtime';
import { nativeExportTasks } from '../local/native-export-tasks';
import { saveNativeExport, shareNativeExport } from '../local/save-export.native';
import NativePdfDocument from '../dom/native-pdf-document';
import { documentProps } from '../document-props';
import { ScrollView, Text, TextInput, View, Pressable } from '../theme/primitives';
import { BatchImportDialog } from './batch-import-dialog';
import { BatchPdfExport } from './batch-pdf-export';
import { Button, MenuLabel, MenuAccessory, Notice, s } from './ui';

const labels = { queued: '等待导出', running: '正在导出', succeeded: '已完成', failed: '失败', cancelled: '已取消', interrupted: '已中断' };
export function ExportRecordsEntry({ runtime }: { runtime: Runtime }) {
  const manager = nativeExportTasks(runtime); const tasks = useSyncExternalStore(manager.tasks.subscribe, manager.tasks.getSnapshot);
  const active = tasks.filter(task => !isExportTaskTerminal(task.status)).length;
  return <Pressable accessibilityRole="button" accessibilityLabel="导出记录" onPress={() => manager.open()} style={{ minHeight: 64, padding: 14, flexDirection: 'row', alignItems: 'center', gap: 12 }}><MenuLabel>导出记录</MenuLabel><MenuAccessory value={manager.tasks.pendingSaveIds.length ? '待保存' : active || undefined} /></Pressable>;
}
/** Workspace lifetime owns the local renderer and queue; closing a dialog keeps jobs alive. */
export function ExportRecordsHost({ runtime, hideNotice = false, onReviewQuestion }: { runtime: Runtime; hideNotice?: boolean; onReviewQuestion?: (id: string) => void }) {
  const manager = nativeExportTasks(runtime); const ui = useSyncExternalStore(manager.subscribe, manager.getSnapshot);
  const tasks = useSyncExternalStore(manager.tasks.subscribe, manager.tasks.getSnapshot);
  const [error, setError] = useState(''); const [query, setQuery] = useState(''); const [confirm, setConfirm] = useState<string | null>(null);
  const [batchId, setBatchId] = useState<string | null>(null); const [busy, setBusy] = useState(false); const working = useRef(false);
  const action = useRef<AbortController | null>(null);
  useEffect(() => { void manager.initialize().catch(() => {}); return () => action.current?.abort(); }, [manager]);
  useEffect(() => { if (!ui.open) setConfirm(null); }, [ui.open]);
  async function run(work: (signal: AbortSignal) => Promise<void>) {
    if (working.current) return;
    working.current = true; setBusy(true); setError(''); const controller = new AbortController(); action.current = controller;
    try { await work(controller.signal); }
    catch (cause) { if (!controller.signal.aborted) setError(nativePdfError(cause)); }
    finally { working.current = false; setBusy(false); }
  }
  const pending = manager.tasks.pendingSaveIds; const generated = manager.tasks.pendingFileIds;
  const filtered = tasks.filter(task => `${task.title} ${task.file?.name ?? ''}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  return <>
    {ui.renderId && <View pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={{ position: 'absolute', width: 1, height: 1, opacity: 0, overflow: 'hidden' }}><NativePdfDocument key={ui.renderId} id={ui.renderId} onRead={manager.read} onProgress={manager.progress} onHeader={manager.header} onChunk={manager.chunk} onComplete={manager.complete} onFailure={manager.fail} dom={{ ...documentProps, matchContents: false, containerStyle: { width: 760, height: 80 }, onError: () => { if (ui.renderId) void manager.fail(ui.renderId, '本地PDF渲染页加载失败，请重试。'); }, onContentProcessDidTerminate: () => { if (ui.renderId) void manager.fail(ui.renderId, '本地PDF渲染进程中断，请重新导出。'); } }} /></View>}
    {((!hideNotice && !!ui.notice) || pending.length > 0 || !!ui.error) && !ui.open && <View style={{ padding: 12, gap: 8 }}><Notice text={ui.notice || ui.error || '导出等待保存，请查看导出记录。'} {...(ui.notice ? { onDismiss: manager.dismiss } : {})} /><Button title="查看导出记录" compact secondary onPress={manager.open} /></View>}
    {ui.open && !batchId && <BatchImportDialog title="导出记录" closeTitle="关闭导出记录" busy={false} testID="native-export-records" avoidKeyboard onClose={manager.close} footer={busy ? <Button title="取消文件操作" secondary onPress={() => action.current?.abort()} /> : <Button title="关闭" secondary compact onPress={manager.close} />}>
      <ScrollView keyboardDismissMode="on-drag" keyboardShouldPersistTaps="handled" style={{ flexShrink: 1, minHeight: 0 }} contentContainerStyle={{ padding: 20, gap: 16 }}>
        <TextInput accessibilityLabel="搜索导出记录" placeholder="搜索批次或文件名" value={query} onChangeText={setQuery} style={[s.input, { minHeight: 48 }]} />
        {!!(error || ui.error) && <Notice text={error || ui.error} error />}
        {!tasks.length && <Text style={s.subtitle}>暂无导出记录</Text>}
        {filtered.map(task => <View key={task.id} testID={`native-export-record-${task.status}`} style={[s.card, { gap: 8 }]}>
          <Text style={s.label}>{task.title} · {pending.includes(task.id) ? '等待保存' : labels[task.status]}</Text>
          <Text style={s.subtitle}>{task.mode === 'answers' ? '题目与作答' : '纯题目'} · {task.questionCount}题 · {task.copies}份</Text>
          {task.file && <Text style={s.subtitle}>{task.file.name} · {(task.file.bytes / 1024 / 1024).toFixed(1)} MiB</Text>}
          {task.status === 'running' && <Text>{task.progress}</Text>}
          {!!task.error && <Notice text={task.error} error />}
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {(task.status === 'succeeded' || generated.includes(task.id)) && <>
              <Button title="保存文件" compact disabled={busy} onPress={() => void run(async signal => { const file = generated.includes(task.id) ? await manager.tasks.readPendingFile(task.id) : await manager.tasks.readFile(task.id); requireExportActive(signal); if (!file) throw new Error('导出文件不存在，请重新导出。'); await saveNativeExport(file, signal); })} />
              <Button title="分享文件" compact secondary disabled={busy} onPress={() => void run(async signal => { const file = generated.includes(task.id) ? await manager.tasks.readPendingFile(task.id) : await manager.tasks.readFile(task.id); requireExportActive(signal); if (!file) throw new Error('导出文件不存在，请重新导出。'); await shareNativeExport(file, signal, task.id); })} />
            </>}
            {pending.includes(task.id) && <Button title="重试保存" compact disabled={busy} onPress={() => void run(async () => manager.tasks.retrySave(task.id))} />}
            {!isExportTaskTerminal(task.status) && <Button title="取消任务" compact secondary onPress={() => { void manager.tasks.cancel(task.id).catch((cause: unknown) => setError(nativePdfError(cause))); }} />}
            {isExportTaskTerminal(task.status) && <>
              <Button title="重新导出" compact secondary disabled={busy} onPress={() => setBatchId(task.batchId)} />
              <Button title={confirm === task.id ? '确认删除文件和记录' : '删除记录'} compact secondary disabled={busy} onPress={() => { if (confirm !== task.id) setConfirm(task.id); else void run(async () => { await manager.tasks.remove(task.id); setConfirm(null); }); }} />
              {confirm === task.id && <Button title="保留" compact secondary onPress={() => setConfirm(null)} />}
            </>}
          </View>
        </View>)}
      </ScrollView>
    </BatchImportDialog>}
    {batchId && <BatchPdfExport runtime={runtime} batchId={batchId} onClose={() => setBatchId(null)} {...(onReviewQuestion ? { onReviewQuestion } : {})} />}
  </>;
}
