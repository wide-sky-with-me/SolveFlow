import { useEffect, useRef, useState } from 'react';
import { clientError } from '@solveflow/client/presentation';
import type { LocalBatchInsertion } from '@solveflow/contracts/local';
import { movePhoto, orderPhotos, type ImportPhoto, type PhotoOrder } from '../batch-photo-order';
import { batchImportLayout, type BatchImportSlot, type ExistingBatchImage } from '../batch-import-placement';
import { moveBatchImportPhotos, type BatchImportDragRequest } from '../batch-import-drag';
import type { Runtime } from '../runtime';
import { releasePhoto, transformPhoto } from '../platform';
import { prepareBatchPhotos } from '../batch-photo-preparation';
import type { Photo } from '../platform.types';
import { ScrollView, Text, View } from '../theme/primitives';
import { BatchImportDialog } from './batch-import-dialog';
import { BatchImportWorkbench } from './batch-import-workbench';
import { PhotoEditor } from './photo-editor';
import { Button, Notice, s } from './ui';

/** Preview owns input images; only an explicit commit saves and enqueues them. */
// Decision: .agents/notes/implemented/agent/2026-10-08-explicit-backup-solver.md
export function BatchImport({ photos, placement, onAdd, onClose }: {
  photos: ImportPhoto[]; placement?: { runtime: Runtime; batchId: string; initial?: LocalBatchInsertion };
  onAdd: (photo: Photo, prepare?: () => Promise<Photo>, insertion?: LocalBatchInsertion) => Promise<string | undefined>; onClose: () => void;
}) {
  const [rows, setRows] = useState(() => orderPhotos(photos, 'filename'));
  const [existing, setExisting] = useState<ExistingBatchImage[] | null>(placement ? null : []);
  const [placements, setPlacements] = useState<ReadonlyMap<number, string | null>>(new Map());
  const [selectedId, setSelectedId] = useState<number>();
  const fallback = useRef(placement?.initial?.beforeId ?? null);
  const runtime = placement?.runtime; const batchId = placement?.batchId;
  const [order, setOrder] = useState<PhotoOrder | 'manual'>('filename');
  const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [completed, setCompleted] = useState(0);
  const [positionDragging, setPositionDragging] = useState(false);
  const [imageBusy, setImageBusy] = useState(false); const [editingId, setEditingId] = useState<number | null>(null);
  const imageWorking = useRef(false);
  const blocked = busy || positionDragging || imageBusy || editingId !== null;
  const alive = useRef(true); const saving = useRef(false); const stop = useRef(false); const released = useRef(new WeakSet<Photo>());
  const owned = useRef(new Set(photos.map(row => row.photo)));
  async function readExisting() {
    if (!runtime || !batchId) return [];
    return (await runtime.repository.listHistory({ cached: true })).filter(row => row.batch?.id === batchId).sort((a, b) => (a.batch?.position ?? 0) - (b.batch?.position ?? 0)).map(row => ({ id: row.id, position: row.batch!.position, text: row.text }));
  }
  useEffect(() => { let active = true; void readExisting().then(values => { if (active) setExisting(values); }).catch(cause => { if (active) setError(clientError(cause)); }); return () => { active = false; }; }, [runtime, batchId]);
  let layout: BatchImportSlot[] = []; let placementError = '';
  try { if (existing) layout = batchImportLayout(existing, rows, placements, fallback.current); }
  catch (cause) { placementError = clientError(cause); }
  const selected = rows.find(row => row.id === selectedId) ?? rows[0];
  const beforeId = selected && placements.has(selected.id) ? placements.get(selected.id) ?? null : fallback.current;
  function place(beforeId: string | null, all = false) {
    if (saving.current || imageWorking.current || !selected) return;
    setPlacements(current => { const next = new Map(current); for (const row of all ? rows : [selected]) next.set(row.id, beforeId); return next; });
  }
  function drop(request: BatchImportDragRequest) {
    if (saving.current || imageWorking.current) return;
    try {
      const plan = moveBatchImportPhotos(rows, layout, request.photoIds, request.target); if (!plan) return;
      const byId = new Map(rows.map(row => [row.id, row]));
      const next = plan.orderedIds.map(id => { const photo = byId.get(id); if (!photo) throw new Error('待加入题图已变化，请重试。'); return photo; });
      setRows(next); setPlacements(plan.placements); setOrder('manual'); setSelectedId(request.photoIds[0]); setError('');
    } catch (cause) { setError(clientError(cause)); }
  }
  function release(photo: Photo) { owned.current.delete(photo); if (!released.current.has(photo)) { released.current.add(photo); releasePhoto(photo); } }
  function releaseAll() { [...owned.current].forEach(release); }
  useEffect(() => { alive.current = true; return () => { alive.current = false; stop.current = true; if (!saving.current && !imageWorking.current) releaseAll(); }; }, []);
  function sort(value: PhotoOrder) { setOrder(value); setRows(current => orderPhotos(current, value)); }
  function move(index: number, delta: -1 | 1) { setOrder('manual'); setRows(current => movePhoto(current, index, delta)); }
  function remove(id: number) { const row = rows.find(row => row.id === id); if (!row || saving.current || imageWorking.current) return; release(row.photo); setRows(current => current.filter(row => row.id !== id)); }
  function replace(id: number, photo: Photo) {
    const previous = rows.find(row => row.id === id);
    if (!alive.current || !previous) { releasePhoto(photo); return; }
    owned.current.add(photo); if (previous.photo !== photo) release(previous.photo);
    setRows(current => current.map(row => row.id === id ? { ...row, photo } : row)); setError('');
  }
  async function rotate(row: ImportPhoto) {
    if (saving.current || imageWorking.current || positionDragging) return;
    imageWorking.current = true; setImageBusy(true); setError('');
    try { replace(row.id, await transformPhoto(row.photo, undefined, true)); }
    catch (cause) { if (alive.current) setError(clientError(cause)); }
    finally { imageWorking.current = false; if (alive.current) setImageBusy(false); else releaseAll(); }
  }
  async function commit() {
    if (saving.current || imageWorking.current || editingId !== null || !existing || placementError) return;
    saving.current = true; stop.current = false; setBusy(true); setError('');
    let remaining = rows;
    const inputs = layout.flatMap(slot => { const row = slot.kind === 'new' ? rows.find(row => row.id === slot.photoId) : undefined; return row && slot.kind === 'new' ? [{ row, insertion: { beforeId: slot.beforeId } }] : []; });
    const preparation = prepareBatchPhotos(inputs.map(item => item.row.photo));
    try {
      for (const [index, { row, insertion }] of inputs.entries()) {
        if (stop.current || !alive.current) break;
        // Edited JPEGs are borrowed until this row completes; preview retains ownership.
        const prepare = row.photo.normalized ? async () => ({ ...row.photo, owned: false }) : preparation.get(index);
        const warning = await onAdd(row.photo, prepare, placement ? insertion : undefined);
        await preparation.discard(index);
        release(row.photo); remaining = remaining.filter(item => item.id !== row.id);
        if (alive.current) { setRows(remaining); setCompleted(count => count + 1); }
        if (warning) { if (alive.current) setError(warning); break; }
      }
      if (!remaining.length && alive.current) onClose();
    } catch (cause) { if (alive.current) setError(clientError(cause)); }
    finally {
      try { await preparation.dispose(); } catch (cause) { if (alive.current) setError(clientError(cause)); else console.warn('BATCH_IMPORT_CLEANUP_FAILED'); }
      if (alive.current && remaining.length && placement) {
        try { const values = await readExisting(); if (alive.current) setExisting(values); } catch (cause) { if (alive.current) { setExisting(null); setError(clientError(cause)); } }
      }
      saving.current = false; if (alive.current) setBusy(false); else releaseAll();
    }
  }
  const editing = rows.find(row => row.id === editingId);
  return <BatchImportDialog title={placement ? '新增题图工作台' : '确认图片顺序'} busy={blocked} onClose={() => { if (!saving.current && !imageWorking.current && !positionDragging && editingId === null) onClose(); }} footer={<>
    <View style={[s.row, { justifyContent: 'flex-end' }]}>
      {!busy && <Button title="取消导入" compact secondary disabled={blocked} onPress={onClose} />}
      {busy && <Button title="停止导入后续图片" compact secondary onPress={() => { stop.current = true; }} />}
      <Button title={busy ? '正在加入批次…' : `导入并解题（${rows.length}张）`} compact disabled={blocked || !rows.length || !existing || !!placementError} onPress={() => void commit()} />
    </View>
    {busy && <Text style={s.subtitle}>停止后，已加入的题目继续解题；未加入的图片保留在此预览中。</Text>}
  </>}>
    <ScrollView testID="batch-import-scroll" style={{ flexGrow: 0, flexShrink: 1, minHeight: 0 }} keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 20, gap: 16 }}>
      {!existing && <Text style={s.subtitle}>正在读取批次位置…</Text>}
      <View style={[s.row, { justifyContent: 'space-between' }]}>
        <Text accessibilityLiveRegion="polite" style={s.label}>{order === 'manual' ? '自定义排序' : order === 'time' ? '时间排序' : '文件名排序'} · 剩余 {rows.length} 张{completed ? ` · 已加入 ${completed} 张` : ''}</Text>
        {rows.length > 1 && <View style={s.row}><Button title="按文件名排序" secondary compact selected={order === 'filename'} disabled={blocked} onPress={() => sort('filename')} /><Button title="按时间排序" secondary compact selected={order === 'time'} disabled={blocked || !rows.some(row => row.timestamp !== undefined)} onPress={() => sort('time')} /></View>}
      </View>
      {order === 'time' && <Text style={s.subtitle}>按文件时间从旧到新，可能与拍摄时间不同。</Text>}
      {!!error && <Notice text={error} error />}
      {!!placementError && <Notice text={placementError} error />}
      {!busy && placement && existing && <BatchImportWorkbench existing={existing} photos={rows} layout={layout} selectedId={selected?.id ?? -1} beforeId={beforeId} dragging={positionDragging} busy={imageBusy || editingId !== null} onSelect={setSelectedId} onPlace={place} onMove={move} onRemove={remove} onCrop={setEditingId} onRotate={row => void rotate(row)} onDrop={drop} onDragActive={setPositionDragging} />}
      {!busy && !placement && rows.map((row, index) => <View key={row.id} testID="import-photo-row" style={[s.card, { flexDirection: 'row', alignItems: 'center', gap: 12 }]}>
        <View style={{ flex: 1, minWidth: 0, gap: 6 }}><Text numberOfLines={2} style={s.label}>{index + 1}. {row.fileName}</Text><Text style={s.subtitle}>{row.timestamp === undefined ? '未提供时间' : `${row.timeSource === 'modified' ? '文件修改' : '文件名时间'} · ${new Date(row.timestamp).toLocaleString('zh-CN')}`}</Text>
          <View style={s.row}>{rows.length > 1 && <><Button title={`上移第${index + 1}张`} compact secondary disabled={busy || index === 0} onPress={() => move(index, -1)} /><Button title={`下移第${index + 1}张`} compact secondary disabled={busy || index === rows.length - 1} onPress={() => move(index, 1)} /></>}<Button title={`移除第${index + 1}张`} compact secondary danger disabled={busy} onPress={() => remove(row.id)} /></View>
        </View>
      </View>)}
    </ScrollView>
    {editing && <PhotoEditor photo={editing.photo} onApply={photo => { replace(editing.id, photo); setEditingId(null); }} onClose={() => setEditingId(null)} onBusyChange={value => { imageWorking.current = value; if (alive.current) setImageBusy(value); else if (!value) releaseAll(); }} />}
  </BatchImportDialog>;
}
