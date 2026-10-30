// Decision: .agents/notes/implemented/storage/2026-10-25-continuous-capture-buffer.md
import { useEffect, useRef, useState } from 'react';
import { MAX_BATCH_PHOTOS, type LocalBatch, type LocalBatchInsertion } from '@solveflow/contracts/local';
import { clientError } from '@solveflow/client/presentation';
import type { Runtime } from '../runtime';
import type { Photo } from '../platform.types';
import { photoData, pickPhotos, releasePhoto, transformPhoto } from '../platform';
import type { ImportPhoto } from '../batch-photo-order';
import { BatchCaptureBuffer } from '../batch-capture-buffer';
import { useCaptureExitGuard } from '../use-capture-exit-guard';
import { BatchImport } from './batch-import';
import { Camera } from './camera';
import { BatchName } from './batch-name';
import { BatchEditor } from './batch-editor';
import { MotionModal } from './motion-modal';
import { DialogSurface } from './dialog-surface';
import { Text } from '../theme/primitives';
import { Button, Notice, s } from './ui';
export type BatchIdentity = Omit<LocalBatch, 'position'>;
async function persistNormalizedBatchPhoto(runtime: Runtime, batch: BatchIdentity, photo: Photo, position: number, insertion?: LocalBatchInsertion) {
  if (position > MAX_BATCH_PHOTOS) throw new Error(`每批最多${MAX_BATCH_PHOTOS}张，请新建批次。`);
  const record = await runtime.engine.create(await photoData(photo), photo.width, photo.height, batch.exam, { ...batch, position }, insertion?.beforeId ? insertion : undefined);
  return record.session.id;
}
/** Return after durable capture and enqueue, without waiting for model completion. */
export async function addBatchPhoto(runtime: Runtime, batch: BatchIdentity, photo: Photo, knownPosition?: number, insertion?: LocalBatchInsertion) {
  try { const id = await saveBatchPhoto(runtime, batch, photo, knownPosition, undefined, insertion); await runtime.enqueueBatch(id); return id; }
  finally { releasePhoto(photo); }
}
/** Import previews retain their input until durable save, then release it themselves. */
export async function saveBatchPhoto(runtime: Runtime, batch: BatchIdentity, photo: Photo, knownPosition?: number, prepare?: () => Promise<Photo>, insertion?: LocalBatchInsertion) {
  let position = knownPosition;
  if (position === undefined) {
    const rows = (await runtime.repository.listHistory()).filter(row => row.batch?.id === batch.id);
    position = insertion?.beforeId ? rows.length + 1 : Math.max(0, ...rows.map(row => row.batch!.position)) + 1;
  }
  if (position > MAX_BATCH_PHOTOS) throw new Error(`每批最多${MAX_BATCH_PHOTOS}张，请新建批次。`);
  const normalized = await (prepare ? prepare() : transformPhoto(photo));
  try {
    return await persistNormalizedBatchPhoto(runtime, batch, normalized, position, insertion);
  } finally { releasePhoto(normalized); }
}
export function CaptureFlow({ runtime, initialBatch, insertion, onPhoto, onGallery, onClose }: { runtime: Runtime; initialBatch?: BatchIdentity; insertion?: LocalBatchInsertion; onPhoto: (photo: Photo) => void; onGallery: () => void; onClose: (batch?: BatchIdentity) => void }) {
  const [batch, setBatch] = useState<BatchIdentity | null>(initialBatch ?? null); const [continuous, setContinuous] = useState(!!initialBatch);
  const [count, setCount] = useState(0); const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [rename, setRename] = useState(false);
  const [importPhotos, setImportPhotos] = useState<ImportPhoto[] | null>(null);
  const [importExisting, setImportExisting] = useState(false);
  const [review, setReview] = useState(false); const [discard, setDiscard] = useState(false);
  const [loadingBatch, setLoadingBatch] = useState(!!initialBatch);
  const [pending, setPending] = useState(0); const [captureBlocked, setCaptureBlocked] = useState(false); const [captureFailed, setCaptureFailed] = useState(false);
  const [discardPending, setDiscardPending] = useState(false); const [finishing, setFinishing] = useState(false);
  useCaptureExitGuard(pending > 0);
  const saving = useRef(false); const alive = useRef(true); const positionRef = useRef(0); const countRef = useRef(0);
  const finishingRef = useRef(false); const buffer = useRef<BatchCaptureBuffer | null>(null); const batchRef = useRef(batch); batchRef.current = batch;
  function captures() {
    buffer.current ??= new BatchCaptureBuffer({
      prepare: transformPhoto,
      async persist(photo) { const current = batchRef.current; if (!current) throw new Error('批次尚未就绪。'); return persistNormalizedBatchPhoto(runtime, current, photo, (insertion?.beforeId ? countRef.current : positionRef.current) + 1, insertion); },
      async enqueue(id) { await runtime.enqueueBatch(id); },
      saved() { countRef.current++; positionRef.current = insertion?.beforeId ? countRef.current : positionRef.current + 1; if (alive.current) setCount(countRef.current); },
      release: releasePhoto,
      failed(cause, saved) { if (alive.current) setError(saved ? `题图已保存，但后续处理已暂停：${clientError(cause)}。可在批次中继续待解题。` : clientError(cause)); },
      changed() { const current = buffer.current; if (alive.current && current) { setPending(current.pending); setCaptureBlocked(current.blocked); setCaptureFailed(current.failed); } },
    });
    return buffer.current;
  }
  useEffect(() => { alive.current = true; return () => { alive.current = false; void buffer.current?.dispose().catch(() => console.warn('BATCH_CAPTURE_CLEANUP_FAILED')); }; }, []);
  useEffect(() => {
    let active = true;
    if (batch) { setLoadingBatch(true); void runtime.repository.listHistory().then(rows => {
      if (active) {
        const current = rows.filter(row => row.batch?.id === batch.id);
        positionRef.current = Math.max(0, ...current.map(row => row.batch?.position ?? 0)); countRef.current = current.length;
        setCount(current.length);
      }
    }).catch(() => { if (active) setError('无法读取批次，请重试。'); }).finally(() => { if (active) setLoadingBatch(false); }); }
    return () => { active = false; };
  }, [runtime, batch]);
  async function mode(value: boolean) {
    if (saving.current || buffer.current?.pending || finishingRef.current) return; saving.current = true; setBusy(true); setError('');
    try { if (value && !await runtime.configured()) throw new Error('请先在“我的 → 设置”配置模型服务。'); if (value && !batch) setBatch(await runtime.newBatch()); setContinuous(value); }
    catch (cause) { setError(clientError(cause)); } finally { saving.current = false; if (alive.current) setBusy(false); }
  }
  function capture(photo: Photo) {
    if (importPhotos) { releasePhoto(photo); return; }
    if (!continuous || !batch) { onPhoto(photo); return; }
    const queue = captures();
    if (saving.current || finishingRef.current || countRef.current + queue.pending >= MAX_BATCH_PHOTOS || !queue.add(photo)) {
      releasePhoto(photo); setError('拍摄缓冲已满或暂停，请等待已拍照片保存后重试本张。'); return;
    }
    setError('');
  }
  async function gallery() {
    if (!continuous) { onGallery(); return; } if (saving.current || importPhotos || buffer.current?.pending || finishingRef.current) return;
    saving.current = true; setBusy(true); setError('');
    try { const photos = await pickPhotos(MAX_BATCH_PHOTOS - countRef.current); if (alive.current) { if (photos.length) { setImportExisting(countRef.current > 0); setImportPhotos(photos); } } else photos.forEach(row => releasePhoto(row.photo)); }
    catch (cause) { if (alive.current) setError(clientError(cause)); }
    finally { saving.current = false; if (alive.current) setBusy(false); }
  }
  async function importPhoto(photo: Photo, prepare?: () => Promise<Photo>, placement?: LocalBatchInsertion) {
    if (!batch || !alive.current) throw new Error('批量导入已关闭。');
    const target = placement ?? insertion;
    const next = (target?.beforeId ? countRef.current : positionRef.current) + 1;
    const id = await saveBatchPhoto(runtime, batch, photo, next, prepare, target);
    countRef.current++; positionRef.current = target?.beforeId ? countRef.current : next;
    if (alive.current) setCount(countRef.current);
    else return '题图已保存，导入已关闭，未开始解题。';
    try { await runtime.enqueueBatch(id); }
    catch (cause) { return `题图已保存，但尚未开始解题：${clientError(cause)}。关闭预览后可在批次中手动继续待解题。`; }
  }
  async function refreshCount() {
    if (!batch) return;
    const rows = (await runtime.repository.listHistory()).filter(row => row.batch?.id === batch.id);
    positionRef.current = Math.max(0, ...rows.map(row => row.batch?.position ?? 0)); countRef.current = rows.length;
    if (alive.current) setCount(rows.length);
  }
  async function discardBatch() {
    if (saving.current || buffer.current?.pending || finishingRef.current) return; saving.current = true; setBusy(true); setError('');
    try { if (batch) await runtime.removeBatch(batch.id); onClose(); }
    catch (cause) { if (alive.current) setError(clientError(cause)); }
    finally { saving.current = false; if (alive.current) setBusy(false); }
  }
  async function finish() {
    if (saving.current || finishingRef.current) return;
    finishingRef.current = true; setFinishing(true);
    try {
      if (buffer.current && !await buffer.current.flush()) { if (alive.current) setError(current => current || '还有照片未保存，请重试保存或明确放弃未保存照片。'); return; }
      if (alive.current) onClose(continuous && batch && positionRef.current > 0 ? batch : undefined);
    } finally { finishingRef.current = false; if (alive.current) setFinishing(false); }
  }
  async function retryCaptures() {
    if (saving.current || finishingRef.current) return; saving.current = true; setBusy(true); setError('');
    try { await captures().retry(); } finally { saving.current = false; if (alive.current) setBusy(false); }
  }
  async function discardCaptures() {
    if (saving.current) return; saving.current = true; setBusy(true);
    try { await captures().discard(); if (alive.current) { setDiscardPending(false); setError(''); } }
    catch (cause) { if (alive.current) setError(clientError(cause)); }
    finally { saving.current = false; if (alive.current) setBusy(false); }
  }
  return <Camera continuous={continuous} count={count} pendingCount={pending} captureBlocked={captureBlocked} limit={MAX_BATCH_PHOTOS} externalBusy={busy || finishing || loadingBatch || rename || !!importPhotos || review || discard || discardPending} suspended={review || discard || discardPending || !!importPhotos} message={error} batchTitle={continuous ? batch?.title : undefined} onModeChange={initialBatch ? undefined : value => void mode(value)} onRename={() => setRename(true)} onPhoto={capture} onGallery={() => void gallery()} onReview={() => setReview(true)} onDiscard={() => { if (count) { setError(''); setDiscard(true); } else onClose(); }} onClose={() => void finish()}>
    {captureFailed && <><Button title={pending ? '重试保存待存照片' : '继续拍摄'} secondary disabled={busy || finishing} onPress={() => void retryCaptures()} />{pending > 0 && <Button title="放弃未保存照片" secondary danger disabled={busy || finishing} onPress={() => setDiscardPending(true)} />}</>}
    {discardPending && <MotionModal transparent animationType="fade" onRequestClose={() => { if (!busy) setDiscardPending(false); }}><DialogSurface>
      <Text style={s.title}>放弃 {pending} 张未保存照片？</Text><Text style={s.subtitle}>这些照片尚未加入批次，放弃后需要重新拍摄。已经保存的题图保留。</Text>
      <Button title="确认放弃未保存照片" danger disabled={busy} onPress={() => void discardCaptures()} /><Button title="保留照片" secondary disabled={busy} onPress={() => setDiscardPending(false)} />
    </DialogSurface></MotionModal>}
    {importPhotos && <BatchImport photos={importPhotos} {...(importExisting && batch ? { placement: { runtime, batchId: batch.id, ...(insertion ? { initial: insertion } : {}) } } : {})} onAdd={importPhoto} onClose={() => setImportPhotos(null)} />}
    {rename && batch && <BatchName title={batch.title} onClose={() => setRename(false)} onSave={async title => { if (count) await runtime.repository.renameBatch(batch.id, title); setBatch({ ...batch, title }); }} />}
    {review && batch && <BatchEditor runtime={runtime} batchId={batch.id} onClose={() => setReview(false)} onApplied={() => { void refreshCount().catch(cause => setError(clientError(cause))); }} />}
    {discard && <MotionModal transparent animationType="fade" onRequestClose={() => { if (!busy) setDiscard(false); }}><DialogSurface>
      <Text style={s.title}>删除整个批次？</Text><Text style={s.subtitle}>本批 {count} 张题图及解答将永久删除，本批任务会停止。其他批次和单题保留。</Text>
      {!!error && <Notice text={error} error />}
      <Button title="确认删除本批" danger disabled={busy} onPress={() => void discardBatch()} /><Button title="保留本批" secondary disabled={busy} onPress={() => setDiscard(false)} />
    </DialogSurface></MotionModal>}
  </Camera>;
}
