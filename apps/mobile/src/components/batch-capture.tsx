import { useEffect, useRef, useState } from 'react';
import { MAX_BATCH_PHOTOS, type LocalBatch } from '@solveflow/contracts/local';
import { clientError } from '@solveflow/client/presentation';
import type { Runtime } from '../runtime';
import type { Photo } from '../platform.types';
import { photoData, pickPhotos, releasePhoto, transformPhoto } from '../platform';
import type { ImportPhoto } from '../batch-photo-order';
import { BatchImport } from './batch-import';
import { Camera } from './camera';
import { BatchName } from './batch-name';
export type BatchIdentity = Omit<LocalBatch, 'position'>;
/** Return after durable capture and enqueue, without waiting for model completion. */
export async function addBatchPhoto(runtime: Runtime, batch: BatchIdentity, photo: Photo, knownPosition?: number) {
  try { const id = await saveBatchPhoto(runtime, batch, photo, knownPosition); await runtime.enqueueBatch(id); return id; }
  finally { releasePhoto(photo); }
}
/** Import previews retain their input until durable save, then release it themselves. */
export async function saveBatchPhoto(runtime: Runtime, batch: BatchIdentity, photo: Photo, knownPosition?: number) {
  let position = knownPosition;
  if (position === undefined) {
    const rows = (await runtime.repository.listHistory()).filter(row => row.batch?.id === batch.id);
    position = Math.max(0, ...rows.map(row => row.batch!.position)) + 1;
  }
  if (position > MAX_BATCH_PHOTOS) throw new Error(`每批最多${MAX_BATCH_PHOTOS}张，请新建批次。`);
  const normalized = await transformPhoto(photo);
  try {
    const record = await runtime.engine.create(await photoData(normalized), normalized.width, normalized.height, batch.exam, { ...batch, position });
    return record.session.id;
  } finally { releasePhoto(normalized); }
}
export function CaptureFlow({ runtime, initialBatch, onPhoto, onGallery, onClose }: { runtime: Runtime; initialBatch?: BatchIdentity; onPhoto: (photo: Photo) => void; onGallery: () => void; onClose: (batch?: BatchIdentity) => void }) {
  const [batch, setBatch] = useState<BatchIdentity | null>(initialBatch ?? null); const [continuous, setContinuous] = useState(!!initialBatch);
  const [count, setCount] = useState(0); const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [rename, setRename] = useState(false);
  const [importPhotos, setImportPhotos] = useState<ImportPhoto[] | null>(null);
  const saving = useRef(false); const alive = useRef(true); const positionRef = useRef(0);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => {
    let active = true;
    if (batch) void runtime.repository.listHistory().then(rows => {
      if (active) {
        const current = rows.filter(row => row.batch?.id === batch.id);
        positionRef.current = Math.max(0, ...current.map(row => row.batch?.position ?? 0));
        setCount(current.length);
      }
    }).catch(() => { if (active) setError('无法读取批次，请重试。'); });
    return () => { active = false; };
  }, [runtime, batch]);
  async function mode(value: boolean) {
    if (saving.current) return; saving.current = true; setBusy(true); setError('');
    try { if (value && !await runtime.configured()) throw new Error('请先在“我的 → 设置”配置模型服务。'); if (value && !batch) setBatch(await runtime.newBatch()); setContinuous(value); }
    catch (cause) { setError(clientError(cause)); } finally { saving.current = false; if (alive.current) setBusy(false); }
  }
  async function capture(photo: Photo) {
    if (importPhotos) { releasePhoto(photo); return; }
    if (!continuous || !batch) { onPhoto(photo); return; }
    if (saving.current) { releasePhoto(photo); return; }
    saving.current = true; setBusy(true); setError('');
    const nextPos = positionRef.current + 1;
    positionRef.current = nextPos;
    setCount(nextPos);
    try {
      await addBatchPhoto(runtime, batch, photo, nextPos);
    } catch (cause) {
      positionRef.current = Math.max(0, positionRef.current - 1);
      if (alive.current) {
        setCount(positionRef.current);
        setError(clientError(cause));
      }
    } finally {
      saving.current = false;
      if (alive.current) setBusy(false);
    }
  }
  async function gallery() {
    if (!continuous) { onGallery(); return; } if (saving.current || importPhotos) return;
    saving.current = true; setBusy(true); setError('');
    try { const photos = await pickPhotos(MAX_BATCH_PHOTOS - positionRef.current); if (alive.current) { if (photos.length) setImportPhotos(photos); } else photos.forEach(row => releasePhoto(row.photo)); }
    catch (cause) { if (alive.current) setError(clientError(cause)); }
    finally { saving.current = false; if (alive.current) setBusy(false); }
  }
  async function importPhoto(photo: Photo) {
    if (!batch || !alive.current) throw new Error('批量导入已关闭。');
    const next = positionRef.current + 1;
    const id = await saveBatchPhoto(runtime, batch, photo, next);
    positionRef.current = next;
    if (alive.current) setCount(next);
    else return '题图已保存，导入已关闭，未开始解题。';
    try { await runtime.enqueueBatch(id); }
    catch (cause) { return `题图已保存，但尚未开始解题：${clientError(cause)}。关闭预览后可在批次中手动继续待解题。`; }
  }
  return <Camera continuous={continuous} count={count} limit={MAX_BATCH_PHOTOS} externalBusy={busy || rename || !!importPhotos} message={error} batchTitle={continuous ? batch?.title : undefined} onModeChange={initialBatch ? undefined : value => void mode(value)} onRename={() => setRename(true)} onPhoto={capture} onGallery={() => void gallery()} onClose={() => { if (!saving.current) onClose(continuous && batch && count > 0 ? batch : undefined); }}>
    {importPhotos && <BatchImport photos={importPhotos} onAdd={importPhoto} onClose={() => setImportPhotos(null)} />}
    {rename && batch && <BatchName title={batch.title} onClose={() => setRename(false)} onSave={async title => { if (count) await runtime.repository.renameBatch(batch.id, title); setBatch({ ...batch, title }); }} />}
  </Camera>;
}
