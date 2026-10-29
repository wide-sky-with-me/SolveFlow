import { useEffect, useRef, useState } from 'react';
import { MAX_BATCH_PHOTOS, LocalBatchMaterialsSchema } from '@solveflow/contracts/local';
import { clientError } from '@solveflow/client/presentation';
import type { Runtime } from '../runtime';
import type { ImportPhoto } from '../batch-photo-order';
import { pickPhotos, photoData, releasePhoto } from '../platform';
import type { MaterialTarget } from '../batch-material-selection';
import { Text, View } from '../theme/primitives';
import { BatchImportDialog } from './batch-import-dialog';
import { BatchMaterialWorkbench } from './batch-material-workbench';
import { MaterialImport } from './material-import';
import { ImageViewer } from './image-viewer';
import { Button, Notice, s } from './ui';

export function BatchMaterials({ runtime, batchId, onClose, onApplied }: { runtime: Runtime; batchId: string; onClose: () => void; onApplied: (message: string) => void }) {
  const [targets, setTargets] = useState<MaterialTarget[]>([]); const [ready, setReady] = useState(false);
  const [photos, setPhotos] = useState<ImportPhoto[] | null>(null); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const [assignments, setAssignments] = useState<Record<number, string[]>>({});
  const [view, setView] = useState<{ uri: string; width: number; height: number } | null>(null);
  const alive = useRef(true); const working = useRef(false); const controller = useRef(new AbortController());
  useEffect(() => {
    alive.current = true;
    void runtime.repository.listHistory({ cached: true }).then(rows => {
      if (alive.current) { setTargets(rows.filter(row => row.batch?.id === batchId).sort((a, b) => (a.batch?.position ?? 0) - (b.batch?.position ?? 0)).map(row => ({ id: row.id, position: row.batch!.position, text: row.text }))); setReady(true); }
    }).catch(cause => { if (alive.current) setError(clientError(cause)); });
    return () => { alive.current = false; controller.current.abort(); };
  }, [runtime, batchId]);
  async function choose() {
    if (working.current) return; working.current = true; setBusy(true); setError('');
    try {
      const values = await pickPhotos(MAX_BATCH_PHOTOS);
      if (!alive.current) values.forEach(row => releasePhoto(row.photo));
      else if (values.length) setPhotos(values);
    } catch (cause) { if (alive.current) setError(clientError(cause)); }
    finally { working.current = false; if (alive.current) setBusy(false); }
  }
  function recipientIds(rows: readonly ImportPhoto[]) { return [...new Set(rows.flatMap(row => assignments[row.id] ?? []))]; }
  function summary(rows: readonly ImportPhoto[]) {
    const ids = recipientIds(rows);
    const active = new Set(runtime.engine.actives.filter(run => ids.includes(run.sessionId)).map(run => run.sessionId)).size;
    return `已分配 ${rows.filter(row => assignments[row.id]?.length).length} / ${rows.length} 张补图 · ${ids.length} 张题图将重新解答${active ? `；其中 ${active} 题将停止旧任务` : ''}`;
  }
  async function save(rows: readonly ImportPhoto[]) {
    if (controller.current.signal.aborted) controller.current = new AbortController();
    controller.current.signal.throwIfAborted();
    const images = [];
    for (const row of rows) {
      controller.current.signal.throwIfAborted();
      images.push({ image: await photoData(row.photo), width: row.photo.width, height: row.photo.height, sessionIds: assignments[row.id] ?? [] });
    }
    const plan = LocalBatchMaterialsSchema.parse({ batchId, images });
    const result = await runtime.addBatchMaterials(plan, controller.current.signal);
    if (alive.current) onApplied(result.queuedIds.length ? `已为 ${result.savedIds.length} 张题图保存补图，并加入重新解答队列。` : `已为 ${result.savedIds.length} 张题图保存补图；本次已停止，未开始重新解答。`);
  }
  async function preview(id: string) {
    try { const record = await runtime.repository.read(id); if (alive.current) setView({ uri: record.image, width: record.session.upload.width, height: record.session.upload.height }); }
    catch (cause) { if (alive.current) setError(clientError(cause)); }
  }
  if (!photos) return <BatchImportDialog testID="batch-material-entry" title="批量补图" closeTitle="关闭补图" busy={busy} onClose={onClose}
    footer={<Button title="取消补图" secondary onPress={onClose} disabled={busy} />}>
    <View style={{ padding: 20, gap: 16 }}>
      {!!error && <Notice text={error} error />}
      <Button title={busy ? '正在选择图片…' : '选择批量补图'} disabled={busy || !ready || !targets.length} onPress={() => void choose()} />
    </View>
  </BatchImportDialog>;
  return <>
    <MaterialImport photos={photos} onApplyRows={save} onClose={onClose} title="批量补图分配" submitTitle="保存补图并自动重答"
      pickMore={pickPhotos} maxPhotos={MAX_BATCH_PHOTOS}
      onRemovePhoto={id => setAssignments(current => { const next = { ...current }; delete next[id]; return next; })}
      onCancelSave={() => controller.current.abort()}
      canApply={rows => rows.every(row => (assignments[row.id]?.length ?? 0) > 0)}
      summary={summary}
      workbench={(rows, blocked, actions) => <>
        {!!error && <Notice text={error} error />}
        <BatchMaterialWorkbench rows={rows} targets={targets} assignments={assignments} busy={blocked} actions={actions}
          onAssign={(id, ids) => setAssignments(current => ({ ...current, [id]: ids }))} onPreview={id => void preview(id)} />
      </>} />
    {view && <ImageViewer uri={view.uri} size={view} onClose={() => setView(null)} />}
  </>;
}
