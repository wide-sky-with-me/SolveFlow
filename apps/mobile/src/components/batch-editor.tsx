import { useEffect, useRef, useState } from 'react';
import type { LocalHistorySummary } from '@solveflow/contracts/local';
import { clientError } from '@solveflow/client/presentation';
import { FlatList } from 'react-native';
import { photoData, transformPhoto, releasePhoto } from '../platform';
import type { Runtime } from '../runtime';
import { Text, View, Image, SafeAreaView } from '../theme/primitives';
import { MotionModal } from './motion-modal';
import { DialogSurface } from './dialog-surface';
import { PageHeader } from './page-header';
import { Button, Notice, s } from './ui';

export function BatchEditor({ runtime, batchId, onClose, onApplied }: { runtime: Runtime; batchId: string; onClose: () => void; onApplied: () => void }) {
  const [rows, setRows] = useState<LocalHistorySummary[]>([]); const [expectedIds, setExpectedIds] = useState<string[]>([]);
  const [ready, setReady] = useState(false); const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [confirm, setConfirm] = useState(false);
  const alive = useRef(true); const saving = useRef(false);
  useEffect(() => { alive.current = true; void runtime.repository.listHistory().then(values => {
    const batch = values.filter(row => row.batch?.id === batchId).sort((a, b) => (a.batch?.position ?? 0) - (b.batch?.position ?? 0));
    if (alive.current) { setRows(batch); setExpectedIds(batch.map(row => row.id)); setReady(true); }
  }).catch(cause => { if (alive.current) setError(clientError(cause)); }); return () => { alive.current = false; }; }, [runtime, batchId]);
  function move(index: number, delta: number) { setRows(current => { const next = [...current]; const row = next.splice(index, 1)[0]; if (row) next.splice(index + delta, 0, row); return next; }); }
  async function save() {
    if (saving.current) return; saving.current = true; setBusy(true); setError('');
    try { await runtime.editBatch({ batchId, expectedIds, orderedIds: rows.map(row => row.id) }); onApplied(); onClose(); }
    catch (cause) { if (alive.current) { setError(clientError(cause)); setConfirm(false); } }
    finally { saving.current = false; if (alive.current) setBusy(false); }
  }
  return <MotionModal animationType="slide" onRequestClose={() => { if (!saving.current) onClose(); }}><SafeAreaView style={{ flex: 1 }}>
    <PageHeader title="调整批次图片" disabled={busy} onBack={onClose} />
    <FlatList data={rows} keyExtractor={row => row.id} initialNumToRender={6} maxToRenderPerBatch={6} windowSize={3} keyboardShouldPersistTaps="handled" contentContainerStyle={s.pageContent}
      ListHeaderComponent={error ? <Notice text={error} error /> : null}
      renderItem={({ item: row, index }) => <View testID="batch-edit-row" style={[s.card, { marginBottom: 12 }]}>
        <View style={s.row}><BatchThumbnail runtime={runtime} id={row.id} /><Text numberOfLines={2} style={[s.label, { flex: 1 }]}>第 {index + 1} 张 · {row.text || '题图'}</Text></View>
        <View style={[s.row, { flexWrap: 'wrap' }]}><Button title={`上移第${index + 1}张`} compact secondary disabled={busy || !index} onPress={() => move(index, -1)} /><Button title={`下移第${index + 1}张`} compact secondary disabled={busy || index === rows.length - 1} onPress={() => move(index, 1)} /><Button title={`移除第${index + 1}张`} compact secondary danger disabled={busy} onPress={() => setRows(current => current.filter(value => value.id !== row.id))} /></View>
      </View>} ListFooterComponent={<View style={{ gap: 12 }}>
      <Button title="保存批次调整" disabled={!ready || busy || !expectedIds.length || rows.map(row => row.id).join() === expectedIds.join()} onPress={() => setConfirm(true)} />
      <Button title="取消调整" secondary disabled={busy} onPress={onClose} />
    </View>} />
    {confirm && <MotionModal transparent animationType="fade" onRequestClose={() => { if (!busy) setConfirm(false); }}><DialogSurface>
      <Text style={s.title}>确认调整批次？</Text>
      <Text style={s.subtitle}>保留 {rows.length} 张，永久删除 {expectedIds.length - rows.length} 张及其解答。本批任务将停止，保留已有答案，不自动重新解题。</Text>
      <Button title="确认批次调整" danger={rows.length < expectedIds.length} disabled={busy} onPress={() => void save()} />
      <Button title="返回调整" secondary disabled={busy} onPress={() => setConfirm(false)} />
    </DialogSurface></MotionModal>}
  </SafeAreaView></MotionModal>;
}

function BatchThumbnail({ runtime, id }: { runtime: Runtime; id: string }) {
  const [image, setImage] = useState<string>();
  const [error, setError] = useState(false);
  useEffect(() => { let alive = true; void (async () => {
    const record = await runtime.repository.read(id);
    if (!alive) return;
    const thumbnail = await transformPhoto({ uri: record.image, width: record.session.upload.width, height: record.session.upload.height }, undefined, false, 160);
    try { const image = await photoData(thumbnail); if (alive) setImage(image); } finally { releasePhoto(thumbnail); }
  })().catch(() => { if (alive) setError(true); }); return () => { alive = false; }; }, [runtime, id]);
  return image ? <Image source={{ uri: image }} accessibilityLabel="批次题图缩略图" resizeMode="contain" style={{ width: 80, height: 64 }} /> : <Text style={s.subtitle}>{error ? '题图无法读取' : '载入题图'}</Text>;
}
