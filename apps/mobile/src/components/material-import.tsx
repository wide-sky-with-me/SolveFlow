import { useEffect, useRef, useState } from 'react';
import { clientError } from '@solveflow/client/presentation';
import { orderPhotos, type ImportPhoto } from '../batch-photo-order';
import { releasePhoto, transformPhoto } from '../platform';
import type { Photo } from '../platform.types';
import { Image, ScrollView, Text, View, SafeAreaView } from '../theme/primitives';
import { MotionModal } from './motion-modal';
import { PageHeader } from './page-header';
import { PhotoEditor } from './photo-editor';
import { Button, Notice, layout, s } from './ui';

/** Selection and edits remain drafts until the owner accepts the complete set. */
// Decision: .agents/notes/implemented/storage/2026-10-13-multi-material-import.md
export function MaterialImport({ photos, onApply, onClose }: { photos: ImportPhoto[]; onApply: (photos: Photo[]) => Promise<void>; onClose: () => void }) {
  const [rows, setRows] = useState(() => orderPhotos(photos, 'filename')); const current = useRef(rows); current.current = rows;
  const [editing, setEditing] = useState<number | null>(null); const [busy, setBusy] = useState(false); const [saving, setSaving] = useState(false); const [progress, setProgress] = useState(''); const [error, setError] = useState('');
  const alive = useRef(true); const working = useRef(false); const stop = useRef(false); const owned = useRef(new Set(photos.map(row => row.photo)));
  function release(photo: Photo) { if (owned.current.delete(photo)) releasePhoto(photo); }
  function releaseAll() { [...owned.current].forEach(release); }
  useEffect(() => { alive.current = true; return () => { alive.current = false; stop.current = true; if (!working.current) releaseAll(); }; }, []);
  function replace(id: number, photo: Photo) {
    const row = current.current.find(row => row.id === id);
    if (!alive.current || !row) { releasePhoto(photo); return; }
    owned.current.add(photo); release(row.photo); const next = current.current.map(row => row.id === id ? { ...row, photo } : row); current.current = next; setRows(next); setError('');
  }
  async function rotate(row: ImportPhoto) {
    if (working.current) return; working.current = true; setBusy(true); setError('');
    try { replace(row.id, await transformPhoto(row.photo, undefined, true)); }
    catch (cause) { if (alive.current) setError(clientError(cause)); }
    finally { working.current = false; if (alive.current) setBusy(false); else releaseAll(); }
  }
  function remove(row: ImportPhoto) { if (working.current) return; release(row.photo); const next = current.current.filter(item => item.id !== row.id); current.current = next; setRows(next); setError(''); }
  async function commit() {
    if (working.current || !current.current.length) return;
    working.current = true; stop.current = false; setBusy(true); setError('');
    try {
      for (const [index, row] of [...current.current].entries()) {
        if (stop.current || !alive.current) return;
        setProgress(`整理补图 ${index + 1} / ${current.current.length}`);
        if (!row.photo.normalized) replace(row.id, await transformPhoto(row.photo));
      }
      if (stop.current || !alive.current) return;
      setSaving(true); setProgress('正在保存补图…'); await onApply(current.current.map(row => row.photo));
      if (alive.current) onClose();
    } catch (cause) { if (alive.current) setError(cause instanceof Error && cause.name === 'ZodError' ? '补图超过图片数量或大小上限，请裁剪或移除后重试。' : clientError(cause)); }
    finally { working.current = false; if (alive.current) { setBusy(false); setSaving(false); setProgress(''); } else releaseAll(); }
  }
  const row = rows.find(row => row.id === editing);
  return <MotionModal animationType="slide" onRequestClose={() => { if (!working.current) onClose(); else if (!saving) stop.current = true; }}><SafeAreaView style={{ flex: 1 }}>
    <PageHeader title="确认补图" onBack={onClose} disabled={busy} maxWidth={layout.workspaceWidth} />
    <ScrollView contentContainerStyle={[s.pageContent, { maxWidth: layout.workspaceWidth }]}>
      <Text style={s.label}>已选择 {rows.length} 张补图</Text>{!!error && <Notice text={error} error />}{!!progress && <Text accessibilityLiveRegion="polite" style={s.subtitle}>{progress}</Text>}
      {rows.map((row, index) => <View key={row.id} testID="material-import-row" style={[s.card, { flexDirection: 'row', alignItems: 'center', gap: 14 }]}>
        <Image source={{ uri: row.photo.uri }} resizeMode="contain" accessibilityLabel={`补图预览${index + 1}`} style={{ width: 76, height: 76, borderRadius: 8 }} />
        <View style={{ flex: 1, minWidth: 0, gap: 8 }}><Text numberOfLines={2} style={s.label}>{index + 1}. {row.fileName}</Text><Text style={s.subtitle}>{row.photo.width} × {row.photo.height}</Text>
          <View style={s.row}><Button title={`裁剪第${index + 1}张`} compact secondary disabled={busy} onPress={() => setEditing(row.id)} /><Button title={`旋转第${index + 1}张`} compact secondary disabled={busy} onPress={() => void rotate(row)} /><Button title={`移除第${index + 1}张`} compact secondary danger disabled={busy} onPress={() => remove(row)} /></View>
        </View>
      </View>)}
    </ScrollView>
    <View style={[s.pageContent, { width: '100%', maxWidth: layout.workspaceWidth, alignSelf: 'center', flexShrink: 0, paddingVertical: 12, gap: 8 }]}>
      <Button title={saving ? '正在保存补图…' : `保存补图（${rows.length}张）`} disabled={busy || !rows.length} onPress={() => void commit()} />
      {busy ? <Button title="停止整理" secondary disabled={saving} onPress={() => { stop.current = true; }} /> : <Button title="取消补图" secondary onPress={onClose} />}
    </View>
    {row && <PhotoEditor photo={row.photo} onApply={value => { replace(row.id, value); setEditing(null); }} onClose={() => setEditing(null)} />}
  </SafeAreaView></MotionModal>;
}
