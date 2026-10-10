import { imageLongPress } from './image-long-press';
import { useImageShare } from './use-image-share';
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { Image, Platform, Pressable, Text, View, type GestureResponderEvent, type ViewStyle } from 'react-native';
import { MotionModal as Modal } from './motion-modal';
import { SafeAreaView } from 'react-native-safe-area-context';
import { boundImage, fitImage, INITIAL_IMAGE_TRANSFORM, MAX_IMAGE_SCALE, MIN_IMAGE_SCALE, moveImage, type ImageSize, type ImageTouch, type ImageTransform } from './image-zoom';

// Prevent browser page zoom/scroll only inside the image gesture surface.
const viewportStyle: ViewStyle & { touchAction?: 'none' } = {
  flex: 1, overflow: 'hidden', backgroundColor: '#000',
  ...(Platform.OS === 'web' ? { touchAction: 'none' } : {}),
};
type Tap = { x: number; y: number; time: number };
export function ImageViewer({ uri, size, onClose }: { uri: string; size: ImageSize; onClose: () => void }) {
  const { share, error } = useImageShare(uri);
  const longPress = useMemo(() => imageLongPress(() => { tap.current = null; lastTap.current = null; void share(); }), [share]);
  useEffect(() => () => longPress.cancel(), [longPress]);
  const [viewport, setViewport] = useState<ImageSize>({ width: 0, height: 0 });
  const [transform, setTransform] = useState(INITIAL_IMAGE_TRANSFORM);
  const current = useRef(transform);
  const touches = useRef<ImageTouch[]>([]);
  const tap = useRef<Tap | null>(null);
  const lastTap = useRef<Tap | null>(null);
  const fitted = fitImage(size, viewport);
  function update(value: ImageTransform) { current.current = value; setTransform(value); }
  function cancelGesture() { longPress.cancel(); touches.current = []; tap.current = null; lastTap.current = null; }
  useEffect(() => { longPress.cancel(); touches.current = []; tap.current = null; lastTap.current = null; current.current = INITIAL_IMAGE_TRANSFORM; setTransform(INITIAL_IMAGE_TRANSFORM); }, [uri, size.width, size.height, viewport.width, viewport.height]);
  function readTouches(event: GestureResponderEvent): ImageTouch[] {
    return event.nativeEvent.touches.map(touch => ({ id: String(touch.identifier), x: touch.locationX, y: touch.locationY })).sort((a, b) => a.id.localeCompare(b.id)).slice(0, 2);
  }
  function start(event: GestureResponderEvent) {
    touches.current = readTouches(event);
    if (touches.current.length > 1) { longPress.cancel(); tap.current = null; lastTap.current = null; }
  }
  function grant(event: GestureResponderEvent) {
    start(event);
    const point = touches.current[0];
    tap.current = point && touches.current.length === 1 ? { ...point, time: Date.now() } : null;
    if (point && touches.current.length === 1) longPress.start(point.x, point.y);
  }
  function move(event: GestureResponderEvent) {
    const next = readTouches(event);
    const point = next[0];
    if (point && next.length === 1) longPress.move(point.x, point.y); else longPress.cancel();
    if (tap.current && (!point || next.length !== 1 || Math.hypot(point.x - tap.current.x, point.y - tap.current.y) > 8)) { tap.current = null; lastTap.current = null; }
    update(moveImage(current.current, touches.current, next, fitted, viewport));
    touches.current = next;
  }
  function zoomTo(scale: number, x = viewport.width / 2, y = viewport.height / 2) {
    scale = Math.min(MAX_IMAGE_SCALE, Math.max(MIN_IMAGE_SCALE, scale));
    const ratio = scale / current.current.scale;
    update(boundImage({ scale, x: (x - viewport.width / 2) * (1 - ratio) + current.current.x * ratio, y: (y - viewport.height / 2) * (1 - ratio) + current.current.y * ratio }, fitted, viewport));
  }
  function keyboard(event: KeyboardEvent<HTMLElement>) {
    const { key } = event;
    if (!['+', '=', '-', '0', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(key)) return;
    event.preventDefault(); cancelGesture();
    if (key === '+' || key === '=') zoomTo(current.current.scale + .5);
    else if (key === '-') zoomTo(current.current.scale - .5);
    else if (key === '0') update(INITIAL_IMAGE_TRANSFORM);
    else {
      // Arrow keys move the reading window towards that edge of the image.
      const x = key === 'ArrowLeft' ? 40 : key === 'ArrowRight' ? -40 : 0;
      const y = key === 'ArrowUp' ? 40 : key === 'ArrowDown' ? -40 : 0;
      update(boundImage({ ...current.current, x: current.current.x + x, y: current.current.y + y }, fitted, viewport));
    }
  }
  function release() {
    longPress.end();
    const point = tap.current; const previous = lastTap.current; const now = Date.now();
    touches.current = []; tap.current = null;
    if (!point || now - point.time > 250) { lastTap.current = null; return; }
    if (previous && now - previous.time < 320 && Math.hypot(point.x - previous.x, point.y - previous.y) < 28) {
      lastTap.current = null;
      zoomTo(current.current.scale > MIN_IMAGE_SCALE ? MIN_IMAGE_SCALE : 2, point.x, point.y);
    } else lastTap.current = { ...point, time: now };
  }
  return <Modal animationType="fade" onRequestClose={onClose}>
    <SafeAreaView style={{ flex: 1, backgroundColor: '#000' }}>
      <View testID="image-zoom-viewport" style={viewportStyle} collapsable={false}
        accessible accessibilityRole="adjustable" accessibilityLabel="题目图片" accessibilityHint={Platform.OS === 'web' ? '双指缩放，放大后拖动；键盘加减键缩放，方向键平移，0还原；长按分享图片' : '双指缩放，放大后拖动；双击放大或还原，长按分享图片'}
        aria-valuemin={100} aria-valuemax={400} aria-valuenow={Math.round(transform.scale * 100)}
        {...(Platform.OS === 'web' ? { tabIndex: 0, onKeyDown: keyboard } : {})}
        accessibilityValue={{ min: 100, max: 400, now: Math.round(transform.scale * 100), text: `${Math.round(transform.scale * 100)}%` }}
        accessibilityActions={[{ name: 'increment', label: '放大' }, { name: 'decrement', label: '缩小' }, { name: 'share', label: '分享图片' }]}
        onAccessibilityAction={event => { if (event.nativeEvent.actionName === 'increment') zoomTo(current.current.scale + .5); else if (event.nativeEvent.actionName === 'share') void share(); else if (event.nativeEvent.actionName === 'decrement') zoomTo(current.current.scale - .5); }}
        onLayout={event => { const { width, height } = event.nativeEvent.layout; setViewport(previous => previous.width === width && previous.height === height ? previous : { width, height }); }}
        onStartShouldSetResponder={() => true} onMoveShouldSetResponder={() => true}
        onResponderGrant={grant} onResponderStart={start} onResponderMove={move} onResponderEnd={start}
        onResponderRelease={release} onResponderTerminate={cancelGesture} onResponderTerminationRequest={() => false}>
        <View pointerEvents="none" style={{ position: 'absolute', left: (viewport.width - fitted.width) / 2, top: (viewport.height - fitted.height) / 2, width: fitted.width, height: fitted.height, transform: [{ translateX: transform.x }, { translateY: transform.y }, { scale: transform.scale }] }}>
          <Image source={{ uri }} accessibilityLabel="原始题图大图" resizeMode="contain" style={{ width: '100%', height: '100%' }} />
        </View>
      </View>
      {!!error && <Text accessibilityRole="alert" style={{ color: '#fff', padding: 12 }}>{error}</Text>}
      <SafeAreaView pointerEvents="box-none" style={{ position: 'absolute', top: 0, left: 0, right: 0, alignItems: 'flex-end', flexDirection: 'row', justifyContent: 'flex-end' }}>
        <Pressable accessibilityRole="button" accessibilityLabel="分享题目图片" onPress={() => void share()} style={{ padding: 14, margin: 12, backgroundColor: '#292929', borderRadius: 24 }}><Text style={{ color: '#fff' }}>分享</Text></Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="关闭大图" onPress={onClose} style={{ margin: 12, width: 48, height: 48, alignItems: 'center', justifyContent: 'center', backgroundColor: '#292929', borderRadius: 24 }}>
          <Text style={{ color: '#fff', fontSize: 30, lineHeight: 34 }}>×</Text>
        </Pressable>
      </SafeAreaView>
    </SafeAreaView>
  </Modal>;
}
