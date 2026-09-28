import { useCallback, useEffect, useRef, useState } from 'react';
import { MAX_BATCH_PHOTOS, type LocalBatch, type LocalHistorySummary } from '@solveflow/contracts/local';
import { clientError } from '@solveflow/client';
import type { Runtime } from '../runtime';
import type { Photo } from '../platform.types';
import { pickPhoto, releasePhoto } from '../platform';
import { Pressable, Text, View } from '../theme/primitives';
import { CaptureFlow, addBatchPhoto } from './batch-capture';
import { BatchName } from './batch-name';
import { QuestionPager } from './question-pager';
import { BatchQuestion } from './batch-question';
import { Button, Notice, s } from './ui';
export type BatchView = Omit<LocalBatch, 'position'> & { selectedId?: string };
export function BatchWorkspace({ runtime, batch, active = true }: { runtime: Runtime; batch: BatchView; active?: boolean }) {
  const [title, setTitle] = useState(batch.title); const [rename, setRename] = useState(false); const [actions, setActions] = useState(false);
  const [rows, setRows] = useState<LocalHistorySummary[]>([]); const [selected, setSelected] = useState(batch.selectedId ?? '');
  useEffect(() => { setSelected(batch.selectedId ?? ''); setActions(false); }, [batch]);
  const [camera, setCamera] = useState(false); const [busy, setBusy] = useState(false); const [queueBusy, setQueueBusy] = useState(runtime.batch.busy); const [error, setError] = useState('');
  const saving = useRef(false); const selecting = useRef(false); const alive = useRef(true); const revision = useRef(0);
  const activeView = useRef(active); const viewRevision = useRef(0);
  if (activeView.current !== active) { activeView.current = active; viewRevision.current++; }
  const refresh = useCallback(async () => { const ticket = ++revision.current; try { const values = (await runtime.repository.listHistory()).filter(row => row.batch?.id === batch.id).sort((a, b) => (a.batch?.position ?? 0) - (b.batch?.position ?? 0)); if (alive.current && ticket === revision.current) { setRows(values); if (values[0]?.batch) setTitle(values[0].batch.title); setQueueBusy(runtime.batch.busy); } } catch (cause) { if (alive.current) setError(clientError(cause)); } }, [runtime, batch.id]);
  useEffect(() => { alive.current = true; void refresh(); const off = runtime.batch.subscribe(() => { setQueueBusy(runtime.batch.busy); void refresh(); }); const stop = runtime.engine.subscribe(() => void refresh()); return () => { alive.current = false; off(); stop(); }; }, [runtime, refresh]);
  async function add(photo: Photo) {
    if (saving.current) { releasePhoto(photo); return; } saving.current = true; setBusy(true); setError('');
    try {
      const { selectedId: _selected, ...identity } = batch;
      const id = await addBatchPhoto(runtime, { ...identity, title }, photo); if (alive.current) setSelected(id);
      await refresh();
    } catch (cause) { if (alive.current) setError(clientError(cause)); await refresh(); }
    finally { saving.current = false; if (alive.current) setBusy(false); }
  }
  async function gallery() {
    if (saving.current || selecting.current) return;
    selecting.current = true; setBusy(true); const ticket = viewRevision.current;
    try { const photo = await pickPhoto(); if (photo) { if (alive.current && activeView.current && ticket === viewRevision.current) await add(photo); else releasePhoto(photo); } }
    catch (cause) { if (alive.current) setError(clientError(cause)); }
    finally { selecting.current = false; if (alive.current) setBusy(false); }
  }
  async function resume(retry = false) {
    if (busy) return; setBusy(true); setError('');
    try { for (const row of rows) { const record = await runtime.repository.read(row.id); const last = record.session.runs.at(-1); if (!last || retry && ['failed', 'cancelled'].includes(last.status)) await runtime.enqueueBatch(row.id, retry); } }
    catch (cause) { setError(clientError(cause)); } finally { if (alive.current) { setBusy(false); await refresh(); } }
  }
  const pages = rows.map(row => ({ key: row.id, number: row.batch!.position })); const current = pages.some(row => row.key === selected) ? selected : pages[0]?.key ?? '';
  return <View style={{ flex: 1 }} testID="current-batch">
    <View style={{ paddingHorizontal: 14, paddingVertical: 6, gap: 4 }}><View style={[s.row, { flexWrap: 'nowrap', gap: 8 }]}>
      <Pressable accessibilityRole="button" accessibilityLabel="重命名批次" onPress={() => setRename(true)} disabled={busy} style={{ flex: 1, minWidth: 0, minHeight: 44, justifyContent: 'center' }}><Text numberOfLines={1} style={s.label}>{title} <Text style={s.subtitle}>✎</Text></Text><Text style={[s.subtitle, { fontSize: 12 }]}>{rows.length} 张题图{queueBusy ? ' · 后台处理中' : ''}</Text></Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel="批次操作" accessibilityState={{ expanded: actions }} onPress={() => setActions(value => !value)} style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}><Text style={{ fontSize: 24 }}>⋯</Text></Pressable>
    </View>
      {actions && <View style={[s.row, { paddingVertical: 6 }]}><Button title="继续拍摄" compact disabled={busy || rows.length >= MAX_BATCH_PHOTOS} onPress={() => { setActions(false); setCamera(true); }} /><Button title="添加相册题图" secondary compact disabled={busy || rows.length >= MAX_BATCH_PHOTOS} onPress={() => void gallery()} /><Button title="继续待解题" secondary compact disabled={busy || !rows.length} onPress={() => void resume()} /><Button title="重试未完成" secondary compact disabled={busy || queueBusy || !rows.length} onPress={() => void resume(true)} />{queueBusy && <Button title="停止批量解题" danger compact disabled={busy} onPress={() => { setBusy(true); void runtime.batch.stop(batch.id).catch(cause => setError(clientError(cause))).finally(() => { setBusy(false); void refresh(); }); }} />}</View>}
      {(error || runtime.batch.message) && <Notice text={error || runtime.batch.message!} error />}
    </View>
    {!!pages.length && <QuestionPager threads={pages} selected={current} onSelect={setSelected} retainPages={false} scrollPages={false} render={page => <BatchQuestion key={page.key} id={page.key} runtime={runtime} queueBusy={queueBusy} />} />}
    {camera && <CaptureFlow runtime={runtime} initialBatch={{ id: batch.id, createdAt: batch.createdAt, exam: batch.exam, title }} onPhoto={() => {}} onGallery={() => {}} onClose={() => { setCamera(false); void refresh(); }} />}
    {rename && <BatchName title={title} onClose={() => setRename(false)} onSave={async value => { await runtime.repository.renameBatch(batch.id, value); setTitle(value); await refresh(); }} />}
  </View>;
}
