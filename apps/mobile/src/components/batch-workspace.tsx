import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { MotionModal as Modal } from './motion-modal';
import type { QuestionAnswerState } from '@solveflow/contracts/http';
import { resumeBatchTasks } from '../batch-task-actions';
import { MAX_BATCH_PHOTOS, type LocalBatch, type LocalBatchInsertion } from '@solveflow/contracts/local';
import { batchPages, type BatchPage } from './batch-pages';
import { clientError } from '@solveflow/client/presentation';
import type { Runtime } from '../runtime';
import type { Photo } from '../platform.types';
import { pickPhotos, releasePhoto } from '../platform';
import type { ImportPhoto } from '../batch-photo-order';
import { Pressable, SafeAreaView, ScrollView, Text, View } from '../theme/primitives';
import { CaptureFlow, saveBatchPhoto } from './batch-capture';
import { BatchImport } from './batch-import';
import { BatchName } from './batch-name';
import { BatchEditor } from './batch-editor';
import { BatchMaterials } from './batch-materials';
import { BatchPdfExport, batchPdfAvailable } from './batch-pdf-export';
import { DialogSurface } from './dialog-surface';
import { QuestionPager } from './question-pager';
import { BatchQuestion } from './batch-question';
import { useExpiringNotice } from './use-expiring-notice';
import { Button, Notice, layout, s } from './ui';
export type BatchView = Omit<LocalBatch, 'position'> & { selectedId?: string };
export function BatchWorkspace({ runtime, batch, available, active = true, jumpGridTrigger }: { runtime: Runtime; batch: BatchView; available: boolean; active?: boolean; jumpGridTrigger?: number | undefined }) {
  const [title, setTitle] = useState(batch.title); const [rename, setRename] = useState(false); const [actions, setActions] = useState(false);
  const [states, setStates] = useState<ReadonlyMap<string, QuestionAnswerState>>(new Map());
  const [pages, setPages] = useState<BatchPage[]>([]); const [selected, setSelected] = useState(batch.selectedId ?? '');
  useEffect(() => { setSelected(batch.selectedId ?? ''); setActions(false); }, [batch]);
  const [camera, setCamera] = useState(false); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const [importPhotos, setImportPhotos] = useState<ImportPhoto[] | null>(null);
  const [review, setReview] = useState(false); const [discard, setDiscard] = useState(false);
  const [pdfExport, setPdfExport] = useState(false);
  const [materials, setMaterials] = useState(false);
  const { message: materialMessage, show: showMaterialMessage, clear: clearMaterialMessage } = useExpiringNotice(batch.id, active);
  useSyncExternalStore(runtime.batch.subscribe, runtime.batch.getSnapshot, runtime.batch.getSnapshot);
  const queueBusy = runtime.batch.isBusy(batch.id);
  const queueMessage = runtime.batch.messageFor(batch.id);
  const saving = useRef(false); const selecting = useRef(false); const alive = useRef(true); const revision = useRef(0);
  // Decision: .agents/notes/implemented/storage/2026-10-23-batch-import-preparation.md
  const importing = useRef(false); const importPosition = useRef(0); const importCount = useRef(0); const lastImported = useRef<string | null>(null);
  const activeView = useRef(active); const viewRevision = useRef(0);
  if (activeView.current !== active) { activeView.current = active; viewRevision.current++; }
  const refresh = useCallback(async () => {
    if (importing.current) return;
    const ticket = ++revision.current;
    try {
      const values = (await runtime.repository.listHistory({ cached: true })).filter(row => row.batch?.id === batch.id).sort((a, b) => (a.batch?.position ?? 0) - (b.batch?.position ?? 0));
      if (alive.current && ticket === revision.current) {
        setPages(previous => batchPages(previous, values));
        setStates(new Map(values.map(value => [value.id, value.answerState ?? 'unanswered'])));
        if (values[0]?.batch) setTitle(values[0].batch.title);
      }
    } catch (cause) { if (alive.current) setError(clientError(cause)); }
  }, [runtime, batch.id]);
  useEffect(() => { if (!active) { importing.current = false; setImportPhotos(null); setMaterials(false); void refresh(); } }, [active, refresh]);
  useEffect(() => { alive.current = true; void refresh(); const stop = runtime.repository.subscribeHistory(() => { void refresh(); }); return () => { alive.current = false; stop(); }; }, [runtime, refresh]);
  async function gallery() {
    if (saving.current || selecting.current || importPhotos) return;
    selecting.current = true; setBusy(true); const ticket = viewRevision.current;
    try {
      const rows = (await runtime.repository.listHistory({ cached: true })).filter(row => row.batch?.id === batch.id);
      const position = Math.max(0, ...rows.map(row => row.batch?.position ?? 0));
      const photos = await pickPhotos(MAX_BATCH_PHOTOS - rows.length);
      if (alive.current && activeView.current && ticket === viewRevision.current) {
        if (photos.length) { importPosition.current = position; importCount.current = rows.length; lastImported.current = null; importing.current = true; setImportPhotos(photos); }
      } else photos.forEach(row => releasePhoto(row.photo));
    }
    catch (cause) { if (alive.current) setError(clientError(cause)); }
    finally { selecting.current = false; if (alive.current) setBusy(false); }
  }
  async function importPhoto(photo: Photo, prepare?: () => Promise<Photo>, placement?: LocalBatchInsertion) {
    if (!alive.current || !activeView.current) throw new Error('批量导入已关闭。');
    const ticket = viewRevision.current;
    const { selectedId: _selected, ...identity } = batch;
    const target = placement ?? { beforeId: null };
    const next = (target.beforeId ? importCount.current : importPosition.current) + 1;
    const id = await saveBatchPhoto(runtime, { ...identity, title }, photo, next, prepare, target);
    importCount.current++; importPosition.current = target.beforeId ? importCount.current : next; lastImported.current = id;
    if (!alive.current || !activeView.current || ticket !== viewRevision.current) return '题图已保存，导入已关闭，未开始解题。';
    try { await runtime.enqueueBatch(id); }
    catch (cause) { return `题图已保存，但尚未开始解题：${clientError(cause)}。关闭预览后可手动继续待解题。`; }
  }
  function closeImport() {
    importing.current = false;
    setImportPhotos(null);
    if (lastImported.current) setSelected(lastImported.current);
    void refresh();
  }
  async function resume(retry = false) {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const failures = await resumeBatchTasks(runtime, batch.id, retry, () => alive.current);
      if (failures.length && alive.current) setError(failures.join('；'));
    } catch (cause) { if (alive.current) setError(clientError(cause)); }
    finally {
      if (alive.current) { setBusy(false); await refresh(); }
    }
  }
  async function discardBatch() {
    if (saving.current) return; saving.current = true; setBusy(true); setError('');
    try { await runtime.removeBatch(batch.id); if (alive.current) { setDiscard(false); await refresh(); } }
    catch (cause) { if (alive.current) setError(clientError(cause)); }
    finally { saving.current = false; if (alive.current) setBusy(false); }
  }
  const renderPage = useCallback((page: { key: string }) => <BatchQuestion key={page.key} id={page.key} runtime={runtime} queueBusy={runtime.batch.busy} available={available} />, [runtime, runtime.batch.busy, available]); const current = pages.some(row => row.key === selected) ? selected : pages[0]?.key ?? '';
  return <View style={{ flex: 1 }} testID="current-batch">
    {importPhotos && <BatchImport photos={importPhotos} placement={{ runtime, batchId: batch.id }} onAdd={importPhoto} onClose={closeImport} />}
    <View testID="batch-header" style={{ paddingHorizontal: 14, paddingVertical: 6, gap: 4 }}><View style={[s.row, { flexWrap: 'nowrap', gap: 8 }]}>
      <View testID="batch-details" style={{ flex: 1, minWidth: 0, alignItems: 'flex-start' }}>
        <Pressable testID="batch-rename" accessibilityRole="button" accessibilityLabel="重命名批次" onPress={() => setRename(true)} disabled={busy} style={{ flexShrink: 1, minWidth: 0, maxWidth: '100%', minHeight: 44, justifyContent: 'center' }}>
          <View testID="batch-title-row" style={{ flexDirection: 'row', alignItems: 'center', gap: 6, minWidth: 0 }}><Text testID="batch-title" numberOfLines={1} style={[s.label, { flexShrink: 1 }]}>{title}</Text><View testID="batch-edit-icon" pointerEvents="none" accessible={false} accessibilityElementsHidden><Text style={s.subtitle}>✎</Text></View></View>
        </Pressable>
        <Text testID="batch-photo-count" style={[s.subtitle, { fontSize: 12 }]}>{pages.length} 张题图{queueBusy ? ' · 后台处理中' : ''}</Text>
      </View>
      <Pressable testID="batch-more" accessibilityRole="button" accessibilityLabel="批次操作" accessibilityState={{ expanded: actions }} onPress={() => setActions(value => !value)} style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}><Text style={{ fontSize: 24 }}>⋯</Text></Pressable>
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
                  <Button title="调整批次图片" secondary disabled={busy || !pages.length} onPress={() => { setActions(false); setReview(true); }} />
                  <Button title="批量补图并重答" secondary disabled={busy || !available || !pages.length} onPress={() => { setActions(false); clearMaterialMessage(); setMaterials(true); }} />
                  {batchPdfAvailable && <Button title="导出本批 PDF" secondary disabled={busy || queueBusy || !pages.length || runtime.engine.actives.some(run => pages.some(page => page.key === run.sessionId))} onPress={() => { setActions(false); setPdfExport(true); }} />}
                  <Button title="继续待解题" secondary disabled={busy || !pages.length} onPress={() => { setActions(false); void resume(); }} />
                  <Button title="重试未完成" secondary disabled={busy || !pages.length} onPress={() => { setActions(false); void resume(true); }} />
                  {queueBusy && (
                    <Button title="停止批量解题" danger disabled={busy} onPress={() => { setActions(false); setBusy(true); void runtime.batch.stop(batch.id).catch(cause => setError(clientError(cause))).finally(() => { setBusy(false); void refresh(); }); }} />
                  )}
                  <Button title="删除本批" secondary danger disabled={busy || !pages.length} onPress={() => { setActions(false); setError(''); setDiscard(true); }} />
                </ScrollView>
              </View>
            </View>
          </SafeAreaView>
        </Modal>
      )}
      {(error || queueMessage) && <Notice text={error || queueMessage!} error />}
      {!!materialMessage && <Notice text={materialMessage} onDismiss={clearMaterialMessage} />}
    </View>
    {!!pages.length && <QuestionPager states={states} showNavigation jumpGridTrigger={jumpGridTrigger} threads={pages} selected={current} onSelect={setSelected} retainPages scrollPages={false} render={renderPage} />}
    {camera && <CaptureFlow runtime={runtime} initialBatch={{ id: batch.id, createdAt: batch.createdAt, exam: batch.exam, title }} onPhoto={() => {}} onGallery={() => {}} onClose={() => { setCamera(false); void refresh(); }} />}
    {rename && <BatchName title={title} onClose={() => setRename(false)} onSave={async value => { await runtime.repository.renameBatch(batch.id, value); setTitle(value); await refresh(); }} />}
    {review && <BatchEditor runtime={runtime} batchId={batch.id} onClose={() => setReview(false)} onApplied={() => void refresh()} />}
    {materials && <BatchMaterials runtime={runtime} batchId={batch.id} onClose={() => { setMaterials(false); void refresh(); }} onApplied={showMaterialMessage} />}
    {pdfExport && <BatchPdfExport runtime={runtime} batchId={batch.id} onReviewQuestion={setSelected} onClose={() => setPdfExport(false)} />}
    {discard && <Modal transparent animationType="fade" onRequestClose={() => { if (!busy) setDiscard(false); }}><DialogSurface>
      <Text style={s.title}>删除整个批次？</Text><Text style={s.subtitle}>本批 {pages.length} 张题图及解答将永久删除，本批任务会停止。其他批次和单题保留。</Text>
      {!!error && <Notice text={error} error />}
      <Button title="确认删除本批" danger disabled={busy} onPress={() => void discardBatch()} /><Button title="保留本批" secondary disabled={busy} onPress={() => setDiscard(false)} />
    </DialogSurface></Modal>}
  </View>;
}
