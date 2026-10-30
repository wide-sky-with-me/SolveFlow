import { useEffect, useRef, useState } from 'react';
import type { LocalHistorySummary } from '@solveflow/contracts/local';
import { clientError } from '@solveflow/client/presentation';
import { FlatList, useWindowDimensions } from 'react-native';
import type { Photo } from '../platform.types';
import type { Runtime } from '../runtime';
import { Text, View, Image, Pressable, ScrollView } from '../theme/primitives';
import { MotionModal } from './motion-modal';
import { DialogSurface } from './dialog-surface';
import { BatchImportDialog } from './batch-import-dialog';
import { SavedPhotoPreview, SavedPhotoPreviewProvider } from './saved-photo-preview';
import { PhotoCard, PHOTO_CARD_HEIGHT } from './import-photo-card';
import { ImageViewer } from './image-viewer';
import { Button, Notice, layout, s } from './ui';

export function BatchEditor({ runtime, batchId, onClose, onApplied }: { runtime: Runtime; batchId: string; onClose: () => void; onApplied: () => void }) {
  const [rows, setRows] = useState<LocalHistorySummary[]>([]); const [expectedIds, setExpectedIds] = useState<string[]>([]);
  const [ready, setReady] = useState(false); const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [confirm, setConfirm] = useState(false);
  const [selected, setSelected] = useState<string>(); const [toolsId, setToolsId] = useState<string>();
  const alive = useRef(true); const saving = useRef(false); const { width } = useWindowDimensions();
  const columns = Math.max(1, Math.min(6, Math.floor((Math.min(width - (width < 600 ? 24 : 48), 760) - 32) / 118)));
  useEffect(() => { alive.current = true; void runtime.repository.listHistory().then(values => {
    const batch = values.filter(row => row.batch?.id === batchId).sort((a, b) => (a.batch?.position ?? 0) - (b.batch?.position ?? 0));
    if (alive.current) { setRows(batch); setExpectedIds(batch.map(row => row.id)); setReady(true); }
  }).catch(cause => { if (alive.current) setError(clientError(cause)); }); return () => { alive.current = false; }; }, [runtime, batchId]);
  function move(index: number, delta: number) { if (busy || index + delta < 0 || index + delta >= rows.length) return; setRows(current => { const next = [...current]; const row = next.splice(index, 1)[0]; if (row) next.splice(index + delta, 0, row); return next; }); }
  async function save() {
    if (saving.current) return; saving.current = true; setBusy(true); setError('');
    try { await runtime.editBatch({ batchId, expectedIds, orderedIds: rows.map(row => row.id) }); onApplied(); onClose(); }
    catch (cause) { if (alive.current) { setError(clientError(cause)); setConfirm(false); } }
    finally { saving.current = false; if (alive.current) setBusy(false); }
  }
  const toolsIndex = rows.findIndex(row => row.id === toolsId); const tools = rows[toolsIndex];
  return <SavedPhotoPreviewProvider repository={runtime.repository} ids={rows.map(row => row.id)}>
    <BatchImportDialog title="调整批次图片" testID="batch-edit-workbench" closeTitle="关闭调整" busy={busy} onClose={onClose} footer={<>
      <Button title="保存批次调整" disabled={!ready || busy || !expectedIds.length || rows.map(row => row.id).join() === expectedIds.join()} onPress={() => setConfirm(true)} />
      <Button title="取消调整" secondary disabled={busy} onPress={onClose} />
    </>}>
      {!!error && <View style={{ padding: 20 }}><Notice text={error} error /></View>}
      <FlatList key={columns} numColumns={columns} data={rows} keyExtractor={row => row.id} initialNumToRender={2} maxToRenderPerBatch={2} windowSize={3} style={{ flexShrink: 1, minHeight: 0 }} keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 20, gap: 12 }} columnWrapperStyle={columns > 1 ? { gap: 8 } : undefined}
        getItemLayout={(_data, index) => ({ length: PHOTO_CARD_HEIGHT + 12, offset: 20 + index * (PHOTO_CARD_HEIGHT + 12), index })}
        renderItem={({ item: row, index }) => <PhotoCard testID="batch-edit-row" preview={<SavedPhotoPreview id={row.id} />} summary={`第 ${index + 1} 张`} selected={row.id === (selected ?? rows[0]?.id)} disabled={busy}
          selectLabel={`选择第${index + 1}张题图`} editLabel={`调整第${index + 1}张位置`} removeLabel={`移除第${index + 1}张`} editTitle="调整位置" onSelect={() => setSelected(row.id)} onEdit={() => { setSelected(row.id); setToolsId(row.id); }} onRemove={() => setRows(current => current.filter(value => value.id !== row.id))} />}
      />
    </BatchImportDialog>
    {tools && <SavedPhotoTools runtime={runtime} id={tools.id} index={toolsIndex} count={rows.length} onClose={() => setToolsId(undefined)} onMove={delta => move(toolsIndex, delta)} />}
    {confirm && <MotionModal transparent animationType="fade" onRequestClose={() => { if (!busy) setConfirm(false); }}><DialogSurface>
      <Text style={s.title}>确认调整批次？</Text>
      <Text style={s.subtitle}>保留 {rows.length} 张，永久删除 {expectedIds.length - rows.length} 张及其解答。本批任务将停止，保留已有答案，不自动重新解题。</Text>
      <Button title="确认批次调整" danger={rows.length < expectedIds.length} disabled={busy} onPress={() => void save()} />
      <Button title="返回调整" secondary disabled={busy} onPress={() => setConfirm(false)} />
    </DialogSurface></MotionModal>}
  </SavedPhotoPreviewProvider>;
}

function SavedPhotoTools({ runtime, id, index, count, onClose, onMove }: { runtime: Runtime; id: string; index: number; count: number; onClose: () => void; onMove: (delta: number) => void }) {
  const [source, setSource] = useState<Photo>(); const [error, setError] = useState(''); const [view, setView] = useState(false);
  useEffect(() => { let alive = true; setSource(undefined); setError(''); void runtime.repository.readPrimaryImage(id).then(photo => { if (alive) setSource({ uri: photo.image, width: photo.width, height: photo.height }); }).catch(cause => { if (alive) setError(clientError(cause)); }); return () => { alive = false; }; }, [runtime, id]);
  return <>
    <BatchImportDialog title={`第 ${index + 1} 张题图`} closeTitle="关闭图片操作" testID="batch-edit-tools" maxWidth={layout.dialogWidth} busy={false} onClose={onClose} footer={<View style={s.row}>
      <Button title={`上移第${index + 1}张`} compact secondary disabled={!index} onPress={() => onMove(-1)} /><Button title={`下移第${index + 1}张`} compact secondary disabled={index === count - 1} onPress={() => onMove(1)} />
    </View>}>
      <ScrollView style={{ flexShrink: 1, minHeight: 0 }} contentContainerStyle={{ padding: 20, gap: 12 }}>
        {error ? <Notice text={error} error /> : source ? <Pressable accessibilityRole="button" accessibilityLabel={`查看第${index + 1}张题图`} onPress={() => setView(true)}><Image source={{ uri: source.uri }} accessibilityLabel="调整题图预览" resizeMode="contain" style={{ height: 160, width: '100%' }} /></Pressable> : <Text style={s.subtitle}>正在读取题图…</Text>}
      </ScrollView>
    </BatchImportDialog>
    {view && source && <ImageViewer uri={source.uri} size={source} onClose={() => setView(false)} />}
  </>;
}
