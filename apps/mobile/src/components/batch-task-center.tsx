import { useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { FlatList } from 'react-native';
import type { LocalHistorySummary } from '@solveflow/contracts/local';
import { clientError } from '@solveflow/client/presentation';
import type { Runtime } from '../runtime';
import { summarizeBatchTasks, type BatchTaskSummary } from '../batch-task-summary';
import { resumeBatchTasks } from '../batch-task-actions';
import { Pressable, Text, View } from '../theme/primitives';
import type { BatchView } from './batch-workspace';
import { BatchImportDialog } from './batch-import-dialog';
import { BatchPdfExport, batchPdfAvailable } from './batch-pdf-export';
import { Button, Notice, colors, s } from './ui';

export function BatchTaskCenter({ runtime, sessions, available, onOpen, onClose }: { runtime: Runtime; sessions: readonly LocalHistorySummary[]; available: boolean; onOpen: (batch: BatchView) => void; onClose: () => void }) {
  const queue = useSyncExternalStore(runtime.batch.subscribe, runtime.batch.getSnapshot, runtime.batch.getSnapshot);
  const groups = useMemo(() => summarizeBatchTasks(sessions, queue), [sessions, queue]);
  const [onlyActive, setOnlyActive] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [working, setWorking] = useState<ReadonlySet<string>>(new Set());
  const [errors, setErrors] = useState<ReadonlyMap<string, string>>(new Map());
  const [exportId, setExportId] = useState<string | null>(null);
  const pending = useRef(new Set<string>());
  async function operate(id: string, action: () => Promise<unknown>) {
    if (pending.current.has(id)) return;
    pending.current.add(id); setWorking(new Set(pending.current));
    setErrors(previous => { const next = new Map(previous); next.delete(id); return next; });
    try { await action(); }
    catch (cause) { setErrors(previous => new Map(previous).set(id, clientError(cause))); }
    finally { pending.current.delete(id); setWorking(new Set(pending.current)); }
  }
  async function resume(id: string, retry: boolean) {
    const failures = await resumeBatchTasks(runtime, id, retry);
    if (failures.length) throw new Error(failures.join('；'));
  }
  function renderRow({ item: row }: { item: BatchTaskSummary }) {
    const id = row.batch.id, locked = working.has(id), open = expanded === id;
    const chips = [row.preparing && `准备中 ${row.preparing}`, row.waiting && `等待 ${row.waiting}`, row.solving && `答题中 ${row.solving}`, row.verifying && `校验中 ${row.verifying}`, row.verified && `已校验 ${row.verified}`, row.answered && `待确认 ${row.answered}`, row.cancelled && `已停止 ${row.cancelled}`, row.needsClarification && `待补充 ${row.needsClarification}`, row.failed && `失败 ${row.failed}`, row.unanswered && `待解题 ${row.unanswered}`].filter(Boolean);
    return <View testID={`batch-task-${id}`} style={{ borderWidth: 1, borderColor: colors.line, borderRadius: 14, padding: 16, gap: 12, backgroundColor: '#fff' }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Pressable accessibilityRole="button" accessibilityLabel={`查看批次：${row.batch.title}`} onPress={() => onOpen(row.batch)} style={{ flex: 1, minWidth: 0, minHeight: 44, justifyContent: 'center', gap: 4 }}>
          <Text style={s.label} numberOfLines={2}>{row.batch.title}</Text>
          <Text style={s.subtitle}>{row.stopping ? '正在停止' : `已出答案 ${row.answersReady} / ${row.total} 张题图`}</Text>
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel={`任务操作：${row.batch.title}`} accessibilityState={{ expanded: open }} onPress={() => setExpanded(open ? null : id)} style={{ width: 44, height: 44, justifyContent: 'center', alignItems: 'center' }}><Text style={{ fontSize: 24, color: colors.muted }}>⋯</Text></Pressable>
      </View>
      <View accessibilityRole="progressbar" accessibilityLabel={`${row.batch.title}已出答案题图`} accessibilityValue={{ min: 0, max: row.total, now: row.answersReady }} style={{ height: 4, backgroundColor: '#eef2f7', borderRadius: 2, overflow: 'hidden' }}><View style={{ width: `${row.total ? row.answersReady / row.total * 100 : 0}%`, height: 4, backgroundColor: colors.blue }} /></View>
      <View style={[s.row, { gap: 8 }]}>{chips.map(text => <View key={String(text)} style={{ backgroundColor: '#f5f7fb', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 5 }}><Text>{text}</Text></View>)}</View>
      {!!(errors.get(id) || row.error) && <Notice error text={errors.get(id) || row.error!} />}
      {open && <View style={s.row}>
        {row.active && <Button title="停止本批" compact secondary danger disabled={locked || row.stopping} onPress={() => void operate(id, () => runtime.batch.stop(id))} />}
        {row.unanswered > 0 && <Button title="继续待解题" compact secondary disabled={locked || row.stopping || !available} onPress={() => void operate(id, () => resume(id, false))} />}
        {row.failed + row.cancelled > 0 && <Button title="重试未完成" compact secondary disabled={locked || row.stopping || !available} onPress={() => void operate(id, () => resume(id, true))} />}
        {batchPdfAvailable && <Button title="导出 PDF" compact secondary disabled={locked || row.active} onPress={() => setExportId(id)} />}
      </View>}
    </View>;
  }
  if (exportId) return <BatchPdfExport runtime={runtime} batchId={exportId} onReviewQuestion={id => { const batch = sessions.find(row => row.id === id)?.batch; if (batch) { const { position: _position, ...identity } = batch; onOpen({ ...identity, selectedId: id }); } }} onClose={() => setExportId(null)} />;
  return <BatchImportDialog title="批量任务" testID="batch-task-center" busy={false} closeTitle="关闭任务" onClose={onClose}>
    <View style={[s.row, { paddingHorizontal: 20, paddingVertical: 12 }]}>
      <Button title={`全部 ${groups.length}`} selected={!onlyActive} compact secondary={onlyActive} onPress={() => setOnlyActive(false)} />
      <Button title={`进行中 ${groups.filter(row => row.active).length}`} selected={onlyActive} compact secondary={!onlyActive} onPress={() => setOnlyActive(true)} />
    </View>
    <FlatList data={onlyActive ? groups.filter(row => row.active) : groups} keyExtractor={row => row.batch.id} renderItem={renderRow} extraData={{ expanded, working, errors }} initialNumToRender={8} windowSize={3} style={{ flexShrink: 1, minHeight: 0 }} contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 20, gap: 12 }} keyboardShouldPersistTaps="handled" ListEmptyComponent={<Text style={[s.subtitle, { paddingVertical: 24, textAlign: 'center' }]}>{onlyActive ? '没有进行中的批次' : '暂无批次'}</Text>} />
  </BatchImportDialog>;
}
