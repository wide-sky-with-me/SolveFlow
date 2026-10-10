import { useEffect, useRef, useState } from 'react';
import * as Crypto from 'expo-crypto';
import { LocalMaterialSchema, MAX_MATERIAL_IMAGES, MAX_QUESTION_IMAGE_BYTES, type LocalImageEdit, type LocalMaterial } from '@solveflow/contracts/local';
import { clientError } from '@solveflow/client/presentation';
import type { Runtime } from '../runtime';
import type { Photo } from '../platform.types';
import { photoData, pickPhoto, releasePhoto } from '../platform';
import { Image, Pressable, Text, View } from '../theme/primitives';
import { Button, Notice, s } from './ui';
import { Camera } from './camera';
import { PhotoEditor } from './photo-editor';
import { ImageViewer } from './image-viewer';

/** Edits stay in this modal until the correction and queued run commit together. */
export function CorrectionImages({ runtime, sessionId, disabled, onChange, onBusy }: {
  runtime: Runtime; sessionId: string; disabled: boolean;
  onChange: (edit: LocalImageEdit) => void; onBusy: (busy: boolean) => void;
}) {
  const [rows, setRows] = useState<LocalMaterial[]>([]);
  const [camera, setCamera] = useState(false); const [photo, setPhoto] = useState<Photo | null>(null);
  const [view, setView] = useState<LocalMaterial | null>(null); const [busy, setBusy] = useState(false); const [ready, setReady] = useState(false); const [error, setError] = useState('');
  const saved = useRef(new Set<string>()); const alive = useRef(true); const working = useRef(false);
  useEffect(() => {
    alive.current = true;
    void runtime.repository.read(sessionId).then(record => {
      if (!alive.current) return;
      const images = [{ ...record.session.upload, image: record.image }, ...(record.materials ?? [])];
      saved.current = new Set(images.map(item => item.id));
      const ids = record.activeImageIds ?? images.map(item => item.id);
      setRows(ids.map(id => { const image = images.find(item => item.id === id); if (!image) throw new Error('题目图片缺失。'); return image; }));
      onChange({ imageIds: ids, additions: [] }); setReady(true);
    }).catch(cause => { if (alive.current) setError(clientError(cause)); });
    return () => { alive.current = false; };
  }, [runtime, sessionId, onChange]);
  useEffect(() => () => releasePhoto(photo), [photo]);
  function update(next: LocalMaterial[]) {
    setRows(next); onChange({ imageIds: next.map(item => item.id), additions: next.filter(item => !saved.current.has(item.id)) });
  }
  function choose(value: Photo) { if (!alive.current) { releasePhoto(value); return; } setCamera(false); setPhoto(value); }
  async function gallery() {
    if (working.current || disabled) return;
    working.current = true; setBusy(true); onBusy(true); setCamera(false); setError('');
    try { const value = await pickPhoto(); if (value) choose(value); }
    catch (cause) { if (alive.current) setError(clientError(cause)); }
    finally { working.current = false; if (alive.current) { setBusy(false); onBusy(false); } }
  }
  async function add(value: Photo) {
    if (working.current || disabled) { releasePhoto(value); return; }
    working.current = true; setBusy(true); onBusy(true); setError('');
    try {
      const image = await photoData(value);
      const item = LocalMaterialSchema.parse({ id: Crypto.randomUUID(), image, width: value.width, height: value.height, bytes: atob(image.slice(image.indexOf(',') + 1)).length });
      if (rows.length >= MAX_MATERIAL_IMAGES + 1 || rows.reduce((sum, row) => sum + row.bytes, item.bytes) > MAX_QUESTION_IMAGE_BYTES) throw new Error('本次最多使用8张图片，总大小不能超过8MiB。');
      if (alive.current) update([...rows, item]);
    } catch (cause) { if (alive.current) setError(clientError(cause)); }
    finally { releasePhoto(value); working.current = false; if (alive.current) { setPhoto(null); setBusy(false); onBusy(false); } }
  }
  const blocked = disabled || busy || !ready;
  return <View style={{ gap: 12 }}>
    <Text style={s.label}>本次解答图片 · {rows.length}/{MAX_MATERIAL_IMAGES + 1}</Text>
    {!!error && <Notice text={error} error />}
    <View style={s.row}>{rows.map((row, index) => <View key={row.id} testID="correction-image" style={{ gap: 6 }}>
      <Pressable accessibilityRole="button" accessibilityLabel={`查看更正图片${index + 1}`} onPress={() => setView(row)}>
        <Image source={{ uri: row.image }} accessibilityLabel={`更正图片${index + 1}`} resizeMode="contain" style={{ width: 112, height: 112, borderRadius: 8 }} />
      </Pressable>
      <Button title={`删除图片${index + 1}`} compact secondary disabled={blocked || rows.length === 1} onPress={() => update(rows.filter(item => item.id !== row.id))} />
    </View>)}</View>
    <View style={s.row}><Button title="拍摄图片" compact secondary disabled={blocked || rows.length >= MAX_MATERIAL_IMAGES + 1} onPress={() => setCamera(true)} /><Button title="添加图片" compact secondary disabled={blocked || rows.length >= MAX_MATERIAL_IMAGES + 1} onPress={() => void gallery()} /></View>
    {camera && <Camera onPhoto={choose} onGallery={() => void gallery()} onClose={() => setCamera(false)} externalBusy={busy} />}
    {photo && <PhotoEditor photo={photo} onApply={value => void add(value)} onClose={() => { if (!busy) setPhoto(null); }} />}
    {view && <ImageViewer uri={view.image} size={view} onClose={() => setView(null)} />}
  </View>;
}
