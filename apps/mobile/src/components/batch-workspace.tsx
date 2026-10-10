import { useCallback, useEffect, useRef, useState } from 'react';
import { MotionModal as Modal } from './motion-modal';
import type { QuestionAnswerState } from '@solveflow/contracts/http';
import { isAuxiliaryContext } from '@solveflow/contracts/http';
import { MAX_BATCH_PHOTOS, type LocalBatch } from '@solveflow/contracts/local';
import { batchPages, type BatchPage } from './batch-pages';
import { clientError } from '@solveflow/client/presentation';
import type { Runtime } from '../runtime';
import type { Photo } from '../platform.types';
import { pickPhotos, releasePhoto } from '../platform';
import type { ImportPhoto } from '../batch-photo-order';
import { Pressable, SafeAreaView, ScrollView, Text, View } from '../theme/primitives';
import { CaptureFlow, addBatchPhoto, saveBatchPhoto } from './batch-capture';
import { BatchImport } from './batch-import';
import { BatchName } from './batch-name';
import { QuestionPager } from './question-pager';
import { BatchQuestion } from './batch-question';
import { Button, Notice, layout, s } from './ui';
export type BatchView = Omit<LocalBatch, 'position'> & { selectedId?: string };
export function BatchWorkspace({ runtime, batch, available, active = true, jumpGridTrigger }: { runtime: Runtime; batch: BatchView; available: boolean; active?: boolean; jumpGridTrigger?: number | undefined }) {
  const [title, setTitle] = useState(batch.title); const [rename, setRename] = useState(false); const [actions, setActions] = useState(false);
  const [states, setStates] = useState<ReadonlyMap<string, QuestionAnswerState>>(new Map());
  const [pages, setPages] = useState<BatchPage[]>([]); const [selected, setSelected] = useState(batch.selectedId ?? '');
  useEffect(() => { setSelected(batch.selectedId ?? ''); setActions(false); }, [batch]);
  const [camera, setCamera] = useState(false); const [busy, setBusy] = useState(false); const [queueBusy, setQueueBusy] = useState(runtime.batch.busy); const [error, setError] = useState('');
  const [importPhotos, setImportPhotos] = useState<ImportPhoto[] | null>(null);
  useEffect(() => { if (!active) setImportPhotos(null); }, [active]);
  const [queueMessage, setQueueMessage] = useState(runtime.batch.message);
  const saving = useRef(false); const selecting = useRef(false); const alive = useRef(true); const revision = useRef(0);
  const activeView = useRef(active); const viewRevision = useRef(0);
  if (activeView.current !== active) { activeView.current = active; viewRevision.current++; }
  const refresh = useCallback(async () => {
    const ticket = ++revision.current;
    try {
      const values = (await runtime.repository.listHistory({ cached: true })).filter(row => row.batch?.id === batch.id).sort((a, b) => (a.batch?.position ?? 0) - (b.batch?.position ?? 0));
      if (alive.current && ticket === revision.current) {
        setPages(previous => batchPages(previous, values));
        setStates(new Map(values.map(value => [value.id, value.answerState ?? 'unanswered'])));
        if (values[0]?.batch) setTitle(values[0].batch.title);
        setQueueBusy(runtime.batch.busy);
      }
    } catch (cause) { if (alive.current) setError(clientError(cause)); }
  }, [runtime, batch.id]);
  useEffect(() => { alive.current = true; void refresh(); const off = runtime.batch.subscribe(() => { setQueueBusy(runtime.batch.busy); setQueueMessage(runtime.batch.message); }); const stop = runtime.repository.subscribeHistory(() => { void refresh(); }); return () => { alive.current = false; off(); stop(); }; }, [runtime, refresh]);
  async function add(photo: Photo) {
    if (saving.current) { releasePhoto(photo); return; } saving.current = true; setBusy(true); setError('');
    try {
      const { selectedId: _selected, ...identity } = batch;
      const nextPos = Math.max(0, ...pages.map(page => page.number)) + 1;
      const id = await addBatchPhoto(runtime, { ...identity, title }, photo, nextPos); if (alive.current) setSelected(id);
      await refresh();
    } catch (cause) { if (alive.current) setError(clientError(cause)); await refresh(); }
    finally { saving.current = false; if (alive.current) setBusy(false); }
  }
  async function gallery() {
    if (saving.current || selecting.current || importPhotos) return;
    selecting.current = true; setBusy(true); const ticket = viewRevision.current;
    try { const photos = await pickPhotos(MAX_BATCH_PHOTOS - Math.max(0, ...pages.map(page => page.number))); if (alive.current && activeView.current && ticket === viewRevision.current) { if (photos.length) setImportPhotos(photos); } else photos.forEach(row => releasePhoto(row.photo)); }
    catch (cause) { if (alive.current) setError(clientError(cause)); }
    finally { selecting.current = false; if (alive.current) setBusy(false); }
  }
  async function importPhoto(photo: Photo) {
    if (!alive.current || !activeView.current) throw new Error('批量导入已关闭。');
    const ticket = viewRevision.current;
    const { selectedId: _selected, ...identity } = batch;
    const id = await saveBatchPhoto(runtime, { ...identity, title }, photo);
    if (!alive.current || !activeView.current || ticket !== viewRevision.current) return '题图已保存，导入已关闭，未开始解题。';
    if (alive.current) setSelected(id);
    await refresh();
    if (!alive.current || !activeView.current || ticket !== viewRevision.current) return '题图已保存，导入已关闭，未开始解题。';
    try { await runtime.enqueueBatch(id); }
    catch (cause) { return `题图已保存，但尚未开始解题：${clientError(cause)}。关闭预览后可手动继续待解题。`; }
  }
  async function resume(retry = false) {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const failures: string[] = [];
      for (const page of pages) {
        if (!alive.current) break;
        try {
          const record = await runtime.repository.readMetadata(page.key);
          const last = record.session.runs.at(-1);
          if (!last || (retry && ['failed', 'cancelled'].includes(last.status) && !isAuxiliaryContext(last.context?.kind))) await runtime.enqueueBatch(page.key, retry);
        } catch (cause) { failures.push(clientError(cause)); }
      }
      if (failures.length && alive.current) setError(failures.join('；'));
    } finally {
      if (alive.current) { setBusy(false); await refresh(); }
    }
  }
  const renderPage = useCallback((page: { key: string }) => <BatchQuestion key={page.key} id={page.key} runtime={runtime} queueBusy={queueBusy} available={available} />, [runtime, queueBusy, available]); const current = pages.some(row => row.key === selected) ? selected : pages[0]?.key ?? '';
  return <View style={{ flex: 1 }} testID="current-batch">
    {importPhotos && <BatchImport photos={importPhotos} onAdd={importPhoto} onClose={() => setImportPhotos(null)} />}
    <View testID="batch-header" style={{ paddingHorizontal: 14, paddingVertical: 6, gap: 4 }}><View style={[s.row, { flexWrap: 'nowrap', gap: 8 }]}>
      <Pressable accessibilityRole="button" accessibilityLabel="重命名批次" onPress={() => setRename(true)} disabled={busy} style={{ flex: 1, minWidth: 0, minHeight: 44, justifyContent: 'center' }}><Text numberOfLines={1} style={s.label}>{title} <Text style={s.subtitle}>✎</Text></Text><Text style={[s.subtitle, { fontSize: 12 }]}>{pages.length} 张题图{queueBusy ? ' · 后台处理中' : ''}</Text></Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel="批次操作" accessibilityState={{ expanded: actions }} onPress={() => setActions(value => !value)} style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}><Text style={{ fontSize: 24 }}>⋯</Text></Pressable>
    </View>
      {actions && (
        <Modal visible={actions} transparent animationType="fade" onRequestClose={() => setActions(false)}>
          <SafeAreaView style={{ flex: 1, backgroundColor: '#00000066' }}>
            <View style={{ flex: 1, minHeight: 0, justifyContent: 'flex-end' }}>
              <Pressable accessibilityRole="button" accessibilityLabel="关闭批次操作" style={{ position: 'absolute', top: 0, bottom: 0, left: 0, right: 0 }} onPress={() => setActions(false)} />
              <View style={{ width: '100%', maxWidth: layout.formWidth, alignSelf: 'center', maxHeight: '100%', backgroundColor: '#fff', borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, gap: 12 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, flexShrink: 0 }}>
                  <Text accessibilityRole="header" numberOfLines={2} style={[s.label, { flex: 1, minWidth: 0 }]}>批次操作 · {title}</Text>
                  <View style={{ flexShrink: 0 }}><Button title="关闭" compact secondary onPress={() => setActions(false)} /></View>
                </View>
                <ScrollView style={{ flexGrow: 0, flexShrink: 1, minHeight: 0 }} contentContainerStyle={{ gap: 8 }} keyboardShouldPersistTaps="handled">
                  <Button title="继续拍摄" disabled={busy || pages.length >= MAX_BATCH_PHOTOS} onPress={() => { setActions(false); setCamera(true); }} />
                  <Button title="添加相册题图" secondary disabled={busy || pages.length >= MAX_BATCH_PHOTOS} onPress={() => { setActions(false); void gallery(); }} />
                  <Button title="继续待解题" secondary disabled={busy || !pages.length} onPress={() => { setActions(false); void resume(); }} />
                  <Button title="重试未完成" secondary disabled={busy || !pages.length} onPress={() => { setActions(false); void resume(true); }} />
                  {queueBusy && (
                    <Button title="停止批量解题" danger disabled={busy} onPress={() => { setActions(false); setBusy(true); void runtime.batch.stop(batch.id).catch(cause => setError(clientError(cause))).finally(() => { setBusy(false); void refresh(); }); }} />
                  )}
                </ScrollView>
              </View>
            </View>
          </SafeAreaView>
        </Modal>
      )}
      {(error || queueMessage) && <Notice text={error || queueMessage!} error />}
    </View>
    {!!pages.length && <QuestionPager states={states} showNavigation jumpGridTrigger={jumpGridTrigger} threads={pages} selected={current} onSelect={setSelected} retainPages scrollPages={false} render={renderPage} />}
    {camera && <CaptureFlow runtime={runtime} initialBatch={{ id: batch.id, createdAt: batch.createdAt, exam: batch.exam, title }} onPhoto={() => {}} onGallery={() => {}} onClose={() => { setCamera(false); void refresh(); }} />}
    {rename && <BatchName title={title} onClose={() => setRename(false)} onSave={async value => { await runtime.repository.renameBatch(batch.id, value); setTitle(value); await refresh(); }} />}
  </View>;
}
