import { useEffect, useRef, useState } from 'react';
import { clientError } from '@solveflow/client/presentation';
import { movePhoto, orderPhotos, type ImportPhoto, type PhotoOrder } from '../batch-photo-order';
import { releasePhoto } from '../platform';
import type { Photo } from '../platform.types';
import { Image, ScrollView, Text, View, SafeAreaView } from '../theme/primitives';
import { MotionModal } from './motion-modal';
import { PageHeader } from './page-header';
import { Button, Notice, s } from './ui';

/** Preview owns input images; only an explicit commit saves and enqueues them. */
// Decision: .agents/notes/implemented/agent/2026-10-08-explicit-backup-solver.md
export function BatchImport({ photos, onAdd, onClose }: { photos: ImportPhoto[]; onAdd: (photo: Photo) => Promise<string | undefined>; onClose: () => void }) {
  const [rows, setRows] = useState(() => orderPhotos(photos, 'filename'));
  const [order, setOrder] = useState<PhotoOrder | 'manual'>('filename');
  const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [completed, setCompleted] = useState(0);
  const alive = useRef(true); const saving = useRef(false); const stop = useRef(false); const released = useRef(new Set<Photo>());
  const initial = useRef(photos);
  function release(photo: Photo) { if (!released.current.has(photo)) { released.current.add(photo); releasePhoto(photo); } }
  useEffect(() => { alive.current = true; return () => { alive.current = false; stop.current = true; if (!saving.current) initial.current.forEach(row => release(row.photo)); }; }, []);
  function sort(value: PhotoOrder) { setOrder(value); setRows(current => orderPhotos(current, value)); }
  function move(index: number, delta: -1 | 1) { setOrder('manual'); setRows(current => movePhoto(current, index, delta)); }
  function remove(id: number) { const row = rows.find(row => row.id === id); if (!row || saving.current) return; release(row.photo); setRows(current => current.filter(row => row.id !== id)); }
  async function commit() {
    if (saving.current) return;
    saving.current = true; stop.current = false; setBusy(true); setError('');
    let remaining = rows;
    try {
      for (const row of rows) {
        if (stop.current || !alive.current) break;
        const warning = await onAdd(row.photo);
        release(row.photo); remaining = remaining.filter(item => item.id !== row.id);
        if (alive.current) { setRows(remaining); setCompleted(count => count + 1); }
        if (warning) { if (alive.current) setError(warning); break; }
      }
      if (!remaining.length && alive.current) onClose();
    } catch (cause) { if (alive.current) setError(clientError(cause)); }
    finally { saving.current = false; if (alive.current) setBusy(false); else initial.current.forEach(row => release(row.photo)); }
  }
  return <MotionModal animationType="slide" onRequestClose={() => { if (!saving.current) onClose(); }}><SafeAreaView style={{ flex: 1 }}>
    <PageHeader title="确认图片顺序" disabled={busy} onBack={onClose} />
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={s.pageContent}>
      <View style={s.row}><Button title="按文件名排序" secondary compact selected={order === 'filename'} disabled={busy} onPress={() => sort('filename')} /><Button title="按时间排序" secondary compact selected={order === 'time'} disabled={busy || !rows.some(row => row.timestamp !== undefined)} onPress={() => sort('time')} /></View>
      {order === 'time' && <Text style={s.subtitle}>按文件时间从旧到新，可能与拍摄时间不同。</Text>}
      <Text accessibilityLiveRegion="polite" style={s.label}>{order === 'manual' ? '自定义排序' : order === 'time' ? '时间排序' : '文件名排序'} · 剩余 {rows.length} 张{completed ? ` · 已加入 ${completed} 张` : ''}</Text>
      {!!error && <Notice text={error} error />}
      {rows.map((row, index) => <View key={row.id} testID="import-photo-row" style={[s.card, { flexDirection: 'row', alignItems: 'center', gap: 12 }]}>
        <Image source={{ uri: row.photo.uri }} resizeMode="contain" accessibilityLabel={`待导入图片 ${index + 1}`} style={{ width: 64, height: 64, borderRadius: 8 }} />
        <View style={{ flex: 1, minWidth: 0, gap: 6 }}><Text numberOfLines={2} style={s.label}>{index + 1}. {row.fileName}</Text><Text style={s.subtitle}>{row.timestamp === undefined ? '未提供时间' : `${row.timeSource === 'modified' ? '文件修改' : '文件名时间'} · ${new Date(row.timestamp).toLocaleString('zh-CN')}`}</Text>
          <View style={s.row}><Button title={`上移第${index + 1}张`} compact secondary disabled={busy || index === 0} onPress={() => move(index, -1)} /><Button title={`下移第${index + 1}张`} compact secondary disabled={busy || index === rows.length - 1} onPress={() => move(index, 1)} /><Button title={`移除第${index + 1}张`} compact secondary danger disabled={busy} onPress={() => remove(row.id)} /></View>
        </View>
      </View>)}
      <Button title={busy ? '正在加入批次…' : `导入并解题（${rows.length}张）`} disabled={busy || !rows.length} onPress={() => void commit()} />
      {!busy && <Button title="取消导入" secondary onPress={onClose} />}
      {busy && <><Button title="停止导入后续图片" secondary onPress={() => { stop.current = true; }} /><Text style={s.subtitle}>停止后，已加入的题目继续解题；未加入的图片保留在此预览中。</Text></>}
    </ScrollView>
  </SafeAreaView></MotionModal>;
}
