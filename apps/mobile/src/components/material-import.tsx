import { useEffect, useRef, useState, type ReactNode } from 'react';
import { clientError } from '@solveflow/client/presentation';
import { MAX_BATCH_IMPORT_BYTES } from '@solveflow/contracts/local';
import { orderPhotos, type ImportPhoto } from '../batch-photo-order';
import { releasePhoto, transformPhoto } from '../platform';
import type { Photo } from '../platform.types';
import { ScrollView, Text, View } from '../theme/primitives';
import { PhotoEditor } from './photo-editor';
import { MaterialPhotoWorkbench } from './material-photo-workbench';
import { BatchImportDialog } from './batch-import-dialog';
import { ImportPhotoPreviewProvider } from './import-photo-preview';
import type { MaterialWorkbench } from './material-import.types';
import { Button, Notice, s } from './ui';

/** Selection and edits remain drafts until the owner accepts the complete set. */
// Decision: .agents/notes/implemented/storage/2026-10-13-multi-material-import.md
// Decision: .agents/notes/implemented/storage/2026-10-27-material-workbench-append.md
export function MaterialImport({ photos, onApply, onApplyRows, onClose, title = '确认补图', submitTitle, assignment, canApply, summary, workbench, onCancelSave, pickMore, maxPhotos = photos.length, onRemovePhoto }: {
  photos: ImportPhoto[]; onClose: () => void;
  title?: string; submitTitle?: string; assignment?: (row: ImportPhoto, index: number, busy: boolean) => ReactNode;
  canApply?: (rows: readonly ImportPhoto[]) => boolean; summary?: (rows: readonly ImportPhoto[]) => string;
  workbench?: MaterialWorkbench;
  onCancelSave?: () => void;
  pickMore?: (remaining: number) => Promise<ImportPhoto[]>; maxPhotos?: number;
  onRemovePhoto?: (id: number) => void;
} & ({ onApply: (photos: Photo[]) => Promise<void>; onApplyRows?: never } | { onApplyRows: (rows: readonly ImportPhoto[]) => Promise<void>; onApply?: never })) {
  const [rows, setRows] = useState(() => orderPhotos(photos, 'filename')); const current = useRef(rows); current.current = rows;
  const [editing, setEditing] = useState<number | null>(null); const [busy, setBusy] = useState(false); const [saving, setSaving] = useState(false); const [progress, setProgress] = useState(''); const [error, setError] = useState('');
  const alive = useRef(true); const working = useRef(false); const stop = useRef(false); const owned = useRef(new Set(photos.map(row => row.photo)));
  const nextId = useRef(Math.max(-1, ...photos.map(row => row.id)) + 1); const [addedId, setAddedId] = useState<number>();
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
  function remove(row: ImportPhoto) { if (working.current) return; release(row.photo); const next = current.current.filter(item => item.id !== row.id); current.current = next; setRows(next); onRemovePhoto?.(row.id); setError(''); }
  async function append() {
    if (!pickMore || working.current || current.current.length >= maxPhotos) return;
    working.current = true; setBusy(true); setError(''); let selected: ImportPhoto[] = [];
    try {
      selected = await pickMore(maxPhotos - current.current.length);
      if (!alive.current || !selected.length) return;
      if (current.current.length + selected.length > maxPhotos) throw new Error('补图数量超过本批上限，请减少选择。');
      const bytes = [...current.current, ...selected].reduce((sum, row) => sum + (row.sourceBytes ?? row.photo.blob?.size ?? 0), 0);
      if (bytes > MAX_BATCH_IMPORT_BYTES) throw new Error(`本次补图累计超过${MAX_BATCH_IMPORT_BYTES / 1024 / 1024}MB，请减少图片后重试。`);
      // Picker IDs restart at zero; never reuse a removed row's assignment key.
      const incoming = orderPhotos(selected, 'filename').map(row => ({ ...row, id: nextId.current++ }));
      for (const row of incoming) owned.current.add(row.photo);
      selected = [];
      const next = [...current.current, ...incoming]; current.current = next; setRows(next); setAddedId(incoming[0]?.id);
    } catch (cause) { if (alive.current) setError(clientError(cause)); }
    finally { selected.forEach(row => releasePhoto(row.photo)); working.current = false; if (alive.current) setBusy(false); else releaseAll(); }
  }
  async function commit() {
    if (working.current || !current.current.length || canApply && !canApply(current.current)) return;
    working.current = true; stop.current = false; setBusy(true); setError('');
    try {
      for (const [index, row] of [...current.current].entries()) {
        if (stop.current || !alive.current) return;
        setProgress(`整理补图 ${index + 1} / ${current.current.length}`);
        if (!row.photo.normalized) replace(row.id, await transformPhoto(row.photo));
      }
      if (stop.current || !alive.current) return;
      setSaving(true); setProgress('正在保存补图…');
      if (onApplyRows) await onApplyRows(current.current);
      else if (onApply) await onApply(current.current.map(row => row.photo));
      if (alive.current) onClose();
    } catch (cause) { if (alive.current) setError(cause instanceof Error && cause.name === 'AbortError' ? '本次补图已停止。已保存的补图会保留，未开始的重答不再派发。' : cause instanceof Error && cause.name === 'ZodError' ? '补图超过图片数量或大小上限，请裁剪或移除后重试。' : clientError(cause)); }
    finally { working.current = false; if (alive.current) { setBusy(false); setSaving(false); setProgress(''); } else releaseAll(); }
  }
  const row = rows.find(row => row.id === editing);
  const actions = { crop: setEditing, rotate: (row: ImportPhoto) => void rotate(row), remove, ...(addedId === undefined ? {} : { addedId }) };
  const content = <ScrollView style={{ flexGrow: 0, flexShrink: 1, minHeight: 0 }} contentContainerStyle={{ padding: 20, gap: 16 }}>
    <View style={s.row}><Text style={[s.label, { flex: 1 }]}>已选择 {rows.length} 张补图</Text>{pickMore && <Button title="继续添加补图" compact secondary disabled={busy || rows.length >= maxPhotos} onPress={() => void append()} />}</View>
    {!!error && <Notice text={error} error />}{!!progress && <Text accessibilityLiveRegion="polite" style={s.subtitle}>{progress}</Text>}
    {workbench ? workbench(rows, busy, actions) : <MaterialPhotoWorkbench rows={rows} busy={busy} actions={actions} />}
    {assignment && rows.map((row, index) => <View key={row.id}>{assignment(row, index, busy)}</View>)}
  </ScrollView>;
  const footer = <View style={{ gap: 8 }}>
      {summary && <Text style={s.subtitle} accessibilityLiveRegion="polite">{summary(rows)}</Text>}
      <Button title={saving ? '正在保存补图…' : submitTitle ?? `保存补图（${rows.length}张）`} disabled={busy || !rows.length || !!canApply && !canApply(rows)} onPress={() => void commit()} />
      {busy ? <Button title={saving && onCancelSave ? '停止本次补图' : '停止整理'} secondary disabled={saving && !onCancelSave} onPress={() => { stop.current = true; if (saving) onCancelSave?.(); }} /> : <Button title="取消补图" secondary onPress={onClose} />}
    </View>;
  const editor = row && <PhotoEditor photo={row.photo} onApply={value => { replace(row.id, value); setEditing(null); }} onClose={() => setEditing(null)} />;
  return <ImportPhotoPreviewProvider photos={rows.map(row => row.photo)}><BatchImportDialog testID={workbench ? "batch-material-workbench" : "single-material-workbench"} title={title} closeTitle="关闭补图" busy={busy} onClose={onClose} footer={footer}>{content}{editor}</BatchImportDialog></ImportPhotoPreviewProvider>;
}
