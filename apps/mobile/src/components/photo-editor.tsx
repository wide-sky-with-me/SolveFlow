import { Image, ScrollView, Text, View, SafeAreaView } from '../theme/primitives';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Modal, PanResponder, Platform, StyleSheet, useWindowDimensions, type ViewStyle } from 'react-native';

import { dragCrop, fullCrop, type Crop, type CropDragTarget } from '@solveflow/client';
import { Button, Notice, s } from './ui';
import { releasePhoto, transformPhoto } from '../platform';
import type { Photo } from '../platform.types';
const edges = { left: '左边界', top: '上边界', right: '右边界', bottom: '下边界' };
const corners = ['top-left', 'top-right', 'bottom-left', 'bottom-right'] as const;
const labels = { 'top-left': '左上角', 'top-right': '右上角', 'bottom-left': '左下角', 'bottom-right': '右下角', move: '移动裁切选框', ...edges };
// RN Web supports CSS touchAction; native claims the responder without CSS props.
const gestureStyle: ViewStyle & { touchAction?: 'none'; userSelect?: 'none' } = Platform.OS === 'web' ? { touchAction: 'none', userSelect: 'none' } : {};
function CropHandle(props: { target: CropDragTarget; crop: Crop; onChange: (value: Crop) => void; width: number; height: number; style: ViewStyle; disabled: boolean }) {
  const latest = useRef(props); latest.current = props;
  const start = useRef(props);
  // Keep responder identity throughout a drag; render updates must not restart the gesture.
  const responder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: event => !latest.current.disabled && event.nativeEvent.touches.length === 1,
    onMoveShouldSetPanResponder: (_event, gesture) => !latest.current.disabled && gesture.numberActiveTouches === 1,
    onPanResponderGrant: () => { start.current = latest.current; },
    onPanResponderMove: (_event, gesture) => {
      if (latest.current.disabled || gesture.numberActiveTouches !== 1) return;
      const initial = start.current;
      latest.current.onChange(dragCrop(initial.crop, initial.target, gesture.dx, gesture.dy, initial.width, initial.height));
    },
    onPanResponderTerminationRequest: () => false,
    onShouldBlockNativeResponder: () => true,
  }), []);
  return <View {...responder.panHandlers} accessible accessibilityLabel={props.target === 'move' ? labels.move : `拖动${labels[props.target]}`} accessibilityHint="按住并拖动以调整题目范围" style={[styles.touch, gestureStyle, props.style]}>
    {props.target !== 'move' && <View pointerEvents="none" style={props.target.includes('-') ? styles.corner : styles.edge} />}
  </View>;
}
export function PhotoEditor({ photo, onApply, onClose }: { photo: Photo; onApply: (value: Photo) => void; onClose: () => void }) {
  const window = useWindowDimensions();
  const [crop, setCrop] = useState<Crop>(fullCrop); const [viewport, setViewport] = useState({ width: 300, height: 300 });
  const [busy, setBusy] = useState(false); const [fine, setFine] = useState(false); const [error, setError] = useState(''); const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const ratio = photo.width / photo.height;
  const width = Math.max(1, Math.min(680, viewport.width - 48, (viewport.height - 48) * ratio)); const height = width / ratio;
  const left = crop.left / 100 * width; const top = crop.top / 100 * height;
  const right = crop.right / 100 * width; const bottom = crop.bottom / 100 * height;
  const box = { position: 'absolute', left, top, width: right - left, height: bottom - top } satisfies ViewStyle;
  const handleProps = { crop, width, height, onChange: setCrop, disabled: busy };
  function close() { if (busy) return; alive.current = false; onClose(); }
  async function apply() {
    if (busy) return; setBusy(true); setError('');
    try { const value = await transformPhoto(photo, crop); if (alive.current) onApply(value); else releasePhoto(value); }
    catch { if (alive.current) setError('裁切失败，请调整范围后重试。'); }
    finally { if (alive.current) setBusy(false); }
  }
  return <Modal animationType="slide" onRequestClose={close}><SafeAreaView style={styles.screen}>
    <View style={styles.header}><View style={s.row}><Text style={[s.title, { flex: 1 }]}>确认与裁切题图</Text><Button title="取消裁切" compact secondary disabled={busy} onPress={close} /></View>
      <Text style={s.subtitle}>拖动四角或边线调整范围，按住框内移动。</Text>{error ? <Notice text={error} error /> : null}</View>
    <View style={styles.viewport} onLayout={event => setViewport(event.nativeEvent.layout)}>
      <View style={{ width, height }}>
        <Image source={{ uri: photo.uri }} accessibilityLabel="裁切预览" style={StyleSheet.absoluteFill} resizeMode="contain" />
        <View pointerEvents="none" style={[styles.shade, { left: 0, top: 0, width, height: top }]} />
        <View pointerEvents="none" style={[styles.shade, { left: 0, top: bottom, width, height: height - bottom }]} />
        <View pointerEvents="none" style={[styles.shade, { left: 0, top, width: left, height: bottom - top }]} />
        <View pointerEvents="none" style={[styles.shade, { left: right, top, width: width - right, height: bottom - top }]} />
        <View pointerEvents="none" style={[box, styles.outline]} />
        <CropHandle {...handleProps} target="move" style={box} />
        {(['left', 'right'] as const).map(edge => <CropHandle key={edge} {...handleProps} target={edge} style={{ position: 'absolute', left: (edge === 'left' ? left : right) - 22, top: top + 22, width: 44, height: Math.max(0, bottom - top - 44) }} />)}
        {(['top', 'bottom'] as const).map(edge => <CropHandle key={edge} {...handleProps} target={edge} style={{ position: 'absolute', left: left + 22, top: (edge === 'top' ? top : bottom) - 22, width: Math.max(0, right - left - 44), height: 44 }} />)}
        {corners.map(target => <CropHandle key={target} {...handleProps} target={target} style={{ position: 'absolute', left: (target.includes('left') ? left : right) - 24, top: (target.includes('top') ? top : bottom) - 24, width: 48, height: 48 }} />)}
      </View>
    </View>
    <View style={[styles.footer, window.height < 500 && window.width > window.height && styles.landscapeFooter]}>
      <View style={s.row}><Button title="恢复完整图片" compact secondary disabled={busy} onPress={() => setCrop(fullCrop)} /><Button title={fine ? '收起微调' : '精细调整'} compact secondary disabled={busy} onPress={() => setFine(value => !value)} /></View>
      {fine && <ScrollView style={{ maxHeight: window.height < 500 ? 60 : 160 }} contentContainerStyle={{ gap: 8 }}>
        {(Object.keys(edges) as (keyof Crop)[]).map(edge => <View key={edge} style={s.row}><Text style={[s.label, { flex: 1 }]}>{edges[edge]} {Math.round(crop[edge])}%</Text>{([-2, 2] as const).map(delta => <Button key={delta} title={`${edges[edge]}${delta < 0 ? '减小' : '增大'}`} secondary disabled={busy} onPress={() => setCrop(value => dragCrop(value, edge, delta, delta, 100, 100))} />)}</View>)}
      </ScrollView>}
      <Button title={busy ? '正在裁切…' : '使用这张题图'} disabled={busy} onPress={() => void apply()} />
    </View>
  </SafeAreaView></Modal>;
}
const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#fff' }, header: { paddingHorizontal: 18, paddingTop: 8, gap: 8 },
  viewport: { flex: 1, minHeight: 80, alignItems: 'center', justifyContent: 'center', backgroundColor: '#eef2f7', marginTop: 12 },
  footer: { paddingHorizontal: 18, paddingVertical: 12, gap: 10 },
  landscapeFooter: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap' },
  shade: { position: 'absolute', backgroundColor: '#17233888' }, outline: { borderWidth: 2, borderColor: '#2867dd' },
  touch: { alignItems: 'center', justifyContent: 'center' },
  corner: { width: 20, height: 20, borderRadius: 5, borderColor: '#fff', borderWidth: 2, backgroundColor: '#2867dd' },
  edge: { width: 10, height: 10, borderRadius: 5, backgroundColor: '#2867dd', borderWidth: 1, borderColor: '#fff' },
});
