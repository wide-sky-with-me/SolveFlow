import { useEffect, useRef, useState } from 'react';
import { MAX_BATCH_PHOTOS, type LocalBatch } from '@solveflow/contracts/local';
import { clientError } from '@solveflow/client';
import type { Runtime } from '../runtime';
import type { Photo } from '../platform.types';
import { photoData, pickPhoto, releasePhoto, transformPhoto } from '../platform';
import { Camera } from './camera';
import { BatchName } from './batch-name';
export type BatchIdentity = Omit<LocalBatch, 'position'>;
/** Return after durable capture and enqueue, without waiting for model completion. */
export async function addBatchPhoto(runtime: Runtime, batch: BatchIdentity, photo: Photo) {
  try {
    const rows = (await runtime.repository.listHistory()).filter(row => row.batch?.id === batch.id);
    const position = Math.max(0, ...rows.map(row => row.batch!.position)) + 1;
    if (position > MAX_BATCH_PHOTOS) throw new Error(`每批最多${MAX_BATCH_PHOTOS}张，请新建批次。`);
    const normalized = await transformPhoto(photo);
    try {
      const record = await runtime.engine.create(await photoData(normalized), normalized.width, normalized.height, batch.exam, { ...batch, position });
      await runtime.enqueueBatch(record.session.id); return record.session.id;
    } finally { releasePhoto(normalized); }
  } finally { releasePhoto(photo); }
}
export function CaptureFlow({ runtime, initialBatch, onPhoto, onGallery, onClose }: { runtime: Runtime; initialBatch?: BatchIdentity; onPhoto: (photo: Photo) => void; onGallery: () => void; onClose: (batch?: BatchIdentity) => void }) {
  const [batch, setBatch] = useState<BatchIdentity | null>(initialBatch ?? null); const [continuous, setContinuous] = useState(!!initialBatch);
  const [count, setCount] = useState(0); const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [rename, setRename] = useState(false);
  const saving = useRef(false); const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => { let active = true; if (batch) void runtime.repository.listHistory().then(rows => { if (active) setCount(rows.filter(row => row.batch?.id === batch.id).length); }).catch(() => { if (active) setError('无法读取批次，请重试。'); }); return () => { active = false; }; }, [runtime, batch]);
  async function mode(value: boolean) {
    if (saving.current) return; saving.current = true; setBusy(true); setError('');
    try { if (value && !await runtime.configured()) throw new Error('请先在“我的 → 设置”配置模型服务。'); if (value && !batch) setBatch(await runtime.newBatch()); setContinuous(value); }
    catch (cause) { setError(clientError(cause)); } finally { saving.current = false; if (alive.current) setBusy(false); }
  }
  async function capture(photo: Photo) {
    if (!continuous || !batch) { onPhoto(photo); return; }
    if (saving.current) { releasePhoto(photo); return; } saving.current = true; setBusy(true); setError('');
    try { await addBatchPhoto(runtime, batch, photo); }
    catch (cause) { if (alive.current) setError(clientError(cause)); }
    finally {
      try { const rows = await runtime.repository.listHistory(); if (alive.current) setCount(rows.filter(row => row.batch?.id === batch.id).length); }
      catch { if (alive.current) setError('无法刷新已保存张数，请到历史记录查看。'); }
      saving.current = false; if (alive.current) setBusy(false);
    }
  }
  async function gallery() {
    if (!continuous) { onGallery(); return; } if (saving.current) return;
    try { const photo = await pickPhoto(); if (photo) { if (alive.current) await capture(photo); else releasePhoto(photo); } } catch { if (alive.current) setError('无法读取相册，请重试。'); }
  }
  return <Camera continuous={continuous} count={count} limit={MAX_BATCH_PHOTOS} externalBusy={busy || rename} message={error} batchTitle={continuous ? batch?.title : undefined} onModeChange={initialBatch ? undefined : value => void mode(value)} onRename={() => setRename(true)} onPhoto={capture} onGallery={() => void gallery()} onClose={() => { if (!saving.current) onClose(continuous && batch && count > 0 ? batch : undefined); }}>
    {rename && batch && <BatchName title={batch.title} onClose={() => setRename(false)} onSave={async title => { if (count) await runtime.repository.renameBatch(batch.id, title); setBatch({ ...batch, title }); }} />}
  </Camera>;
}
