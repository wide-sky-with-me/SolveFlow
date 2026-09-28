import { Image, Text, View, SafeAreaView } from '../theme/primitives';
import { useEffect, useRef, useState } from 'react';
import { Modal, Platform, type GestureResponderEvent, type ViewStyle } from 'react-native';
import { Button, s } from './ui';
import { boundImage, fitImage, INITIAL_IMAGE_TRANSFORM, MAX_IMAGE_SCALE, MIN_IMAGE_SCALE, moveImage, type ImageSize, type ImageTouch, type ImageTransform } from './image-zoom';

// Prevent browser page zoom/scroll only inside the image gesture surface.
const viewportStyle: ViewStyle & { touchAction?: 'none' } = {
  flex: 1, overflow: 'hidden', backgroundColor: '#f5f7fb', borderRadius: 12,
  ...(Platform.OS === 'web' ? { touchAction: 'none' } : {}),
};

export function ImageViewer({ uri, size, onClose }: { uri: string; size: ImageSize; onClose: () => void }) {
  const [viewport, setViewport] = useState<ImageSize>({ width: 0, height: 0 });
  const [transform, setTransform] = useState(INITIAL_IMAGE_TRANSFORM);
  const current = useRef(transform);
  const touches = useRef<ImageTouch[]>([]);
  const fitted = fitImage(size, viewport);
  function update(value: ImageTransform) { current.current = value; setTransform(value); }
  function reset() { touches.current = []; update(INITIAL_IMAGE_TRANSFORM); }
  useEffect(() => { touches.current = []; current.current = INITIAL_IMAGE_TRANSFORM; setTransform(INITIAL_IMAGE_TRANSFORM); }, [uri, size.width, size.height, viewport.width, viewport.height]);
  function readTouches(event: GestureResponderEvent): ImageTouch[] {
    return event.nativeEvent.touches.map(touch => ({ id: String(touch.identifier), x: touch.locationX, y: touch.locationY })).sort((a, b) => a.id.localeCompare(b.id)).slice(0, 2);
  }
  function start(event: GestureResponderEvent) { touches.current = readTouches(event); }
  function move(event: GestureResponderEvent) {
    const next = readTouches(event);
    update(moveImage(current.current, touches.current, next, fitted, viewport));
    touches.current = next;
  }
  function zoomBy(amount: number) {
    const scale = Math.min(MAX_IMAGE_SCALE, Math.max(MIN_IMAGE_SCALE, current.current.scale + amount));
    const ratio = scale / current.current.scale;
    touches.current = [];
    update(boundImage({ scale, x: current.current.x * ratio, y: current.current.y * ratio }, fitted, viewport));
  }
  return <Modal animationType="slide" onRequestClose={onClose}>
    <SafeAreaView style={{ flex: 1, padding: 16, backgroundColor: '#fff', gap: 12 }}>
      <View style={s.row}><Text style={[s.title, { flex: 1 }]}>原始题图</Text><Button title="关闭大图" compact secondary onPress={onClose} /></View>
      <View style={s.row}>
        <Button title="缩小" compact secondary disabled={transform.scale <= MIN_IMAGE_SCALE} onPress={() => zoomBy(-0.5)} />
        <Text testID="image-zoom-scale" style={s.subtitle}>{Math.round(transform.scale * 100)}%</Text>
        <Button title="放大" compact secondary disabled={transform.scale >= MAX_IMAGE_SCALE} onPress={() => zoomBy(0.5)} />
        <Button title="适应屏幕" compact secondary onPress={reset} />
      </View>
      <Text style={s.subtitle}>双指缩放（1～4 倍），放大后可拖动查看</Text>
      <View testID="image-zoom-viewport" style={viewportStyle} collapsable={false}
        onLayout={event => { const { width, height } = event.nativeEvent.layout; setViewport(previous => previous.width === width && previous.height === height ? previous : { width, height }); }}
        onStartShouldSetResponder={() => true} onMoveShouldSetResponder={() => true}
        onResponderGrant={start} onResponderStart={start} onResponderMove={move} onResponderEnd={start}
        onResponderRelease={() => { touches.current = []; }} onResponderTerminate={() => { touches.current = []; }}
        onResponderTerminationRequest={() => false}>
        <View pointerEvents="none" style={{ position: 'absolute', left: (viewport.width - fitted.width) / 2, top: (viewport.height - fitted.height) / 2, width: fitted.width, height: fitted.height, transform: [{ translateX: transform.x }, { translateY: transform.y }, { scale: transform.scale }] }}>
          <Image source={{ uri }} accessibilityLabel="原始题图大图" resizeMode="contain" style={{ width: '100%', height: '100%' }} />
        </View>
      </View>
    </SafeAreaView>
  </Modal>;
}
