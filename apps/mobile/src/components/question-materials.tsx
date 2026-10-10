import { MotionModal as Modal } from './motion-modal';
import { useEffect, useRef, useState } from 'react';
import { MAX_MATERIAL_IMAGES, type LocalMaterial, type LocalRecord } from '@solveflow/contracts/local';
import { clientError } from '@solveflow/client/presentation';
import { questionConversations, regenerationContext } from '@solveflow/client/learning';
import type { Runtime } from '../runtime';
import type { Photo } from '../platform.types';
import { photoData, pickPhoto, releasePhoto } from '../platform';
import { Image, Pressable, Text, View, ScrollView, SafeAreaView } from '../theme/primitives';
import { Button, Card, Notice, layout, s } from './ui';
import { Camera } from './camera';
import { PhotoEditor } from './photo-editor';
import { ImageViewer } from './image-viewer';

/** Materials are explicit user evidence; saving never starts or replays a solve. */
export function QuestionMaterials({ id, runtime, disabled }: { id: string; runtime: Runtime; disabled: boolean }) {
  const [open, setOpen] = useState(false);
  const [record, setRecord] = useState<LocalRecord | null>(null);
  const [materials, setMaterials] = useState<LocalMaterial[]>([]);
  const [camera, setCamera] = useState(false);
  const [photo, setPhoto] = useState<Photo | null>(null);
  const [view, setView] = useState<LocalMaterial | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const alive = useRef(true);
  const working = useRef(false);
  useEffect(() => {
    alive.current = true;
    if (!open) return () => { alive.current = false; };
    void runtime.repository.read(id).then(value => {
      if (alive.current) { setRecord(value); setMaterials((value.materials ?? []).filter(item => !value.activeImageIds || value.activeImageIds.includes(item.id))); }
    }).catch(cause => { if (alive.current) setError(clientError(cause)); });
    return () => { alive.current = false; };
  }, [id, runtime, open]);
  useEffect(() => () => releasePhoto(photo), [photo]);
  function choose(value: Photo) {
    if (!alive.current) { releasePhoto(value); return; }
    setCamera(false); setPhoto(value);
  }
  async function gallery() {
    if (working.current || disabled) return;
    working.current = true; setBusy(true); setCamera(false); setError('');
    try { const value = await pickPhoto(); if (value) choose(value); }
    catch (cause) { if (alive.current) setError(clientError(cause)); }
    finally { working.current = false; if (alive.current) setBusy(false); }
  }
  async function save(value: Photo) {
    if (working.current) { releasePhoto(value); return; }
    working.current = true; setBusy(true); setError('');
    try {
      const record = await runtime.engine.addMaterial(id, await photoData(value), value.width, value.height);
      if (alive.current) { setRecord(record); setMaterials((record.materials ?? []).filter(item => !record.activeImageIds || record.activeImageIds.includes(item.id))); setPhoto(null); }
    } catch (cause) { if (alive.current) { setError(clientError(cause)); setPhoto(null); } }
    finally { releasePhoto(value); working.current = false; if (alive.current) setBusy(false); }
  }
  async function continueAnswer(context: Parameters<Runtime['continueWithMaterials']>[1]) {
    if (working.current || disabled) return;
    working.current = true; setBusy(true); setError('');
    try { await runtime.continueWithMaterials(id, context); if (alive.current) setOpen(false); }
    catch (cause) { if (alive.current) setError(clientError(cause)); }
    finally { working.current = false; if (alive.current) setBusy(false); }
  }
  const threads = questionConversations(record?.session.runs ?? []);
  const activeCount = record?.activeImageIds?.length ?? materials.length + 1;
  const blocked = disabled || busy || activeCount >= MAX_MATERIAL_IMAGES + 1;
  return <><View testID="question-materials-entry" style={{ width: '100%', maxWidth: layout.workspaceWidth, alignSelf: 'center', paddingHorizontal: 10, paddingVertical: 4 }}><Button title="同题材料 / 补图" compact secondary disabled={disabled} onPress={() => setOpen(true)} /></View>
    {open && <Modal onRequestClose={() => { if (!busy) setOpen(false); }}><SafeAreaView style={{ flex: 1 }}><ScrollView contentContainerStyle={s.pageContent}>
    <Button title="返回题目" secondary disabled={busy} onPress={() => setOpen(false)} /><Card>
    <Text style={s.label}>同题材料{materials.length ? ` · ${materials.length} 张` : ''}</Text>
    <Text style={s.subtitle}>补图与原图一起用于下一次解答；保存后需提交解答。</Text>
    {!!error && <Notice text={error} error />}
    <View style={s.row}>{materials.map((item, index) => <Pressable key={item.id} accessibilityRole="button" accessibilityLabel={`查看材料 ${index + 1}`} onPress={() => setView(item)}>
      <Image source={{ uri: item.image }} resizeMode="contain" style={{ width: 64, height: 64 }} /><Text style={s.subtitle}>材料 {index + 1}</Text>
    </Pressable>)}</View>
    <View style={s.row}><Button title="拍摄补图" compact secondary disabled={blocked} onPress={() => setCamera(true)} /><Button title="从相册补图" compact secondary disabled={blocked} onPress={() => void gallery()} /></View>
    {!!materials.length && threads.map(thread => {
      const context = regenerationContext(thread);
      return context ? <Button key={thread.key} title={record?.activeImageIds ? thread.number === undefined ? '使用当前图片重新解答' : `使用当前图片重新解答第${thread.number}题` : thread.number === undefined ? '使用原图和全部补图重新解答' : `使用全部补图重新解答第${thread.number}题`} disabled={disabled || busy} onPress={() => void continueAnswer(context)} /> : null;
    })}
    {activeCount >= MAX_MATERIAL_IMAGES + 1 && <Text style={s.subtitle}>已达到 {MAX_MATERIAL_IMAGES + 1} 张同题图片上限。</Text>}
    {camera && <Camera onPhoto={choose} onGallery={() => void gallery()} onClose={() => setCamera(false)} externalBusy={busy} />}
    {photo && <PhotoEditor photo={photo} onApply={value => void save(value)} onClose={() => { if (!busy) setPhoto(null); }} />}
    {view && <ImageViewer uri={view.image} size={view} onClose={() => setView(null)} />}
  </Card></ScrollView></SafeAreaView></Modal>}</>;
}
