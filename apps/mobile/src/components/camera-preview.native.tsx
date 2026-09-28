import { useEffect, useImperativeHandle, useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { CameraView } from 'expo-camera';
import type { CameraPreviewProps } from './camera-preview.types';
import { batchPictureSize } from './camera-resolution';

export function CameraPreview({ ref, facing, lockFocus = false, onReady, onError }: CameraPreviewProps) {
  const camera = useRef<CameraView>(null);
  const ready = useRef(false); const capturing = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [refocusing, setRefocusing] = useState(false);
  const [pictureSize, setPictureSize] = useState<string>();
  const configuredSize = useRef(false); const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  async function cameraReady() {
    if (lockFocus && !configuredSize.current) {
      configuredSize.current = true;
      try {
        const size = batchPictureSize(await camera.current?.getAvailablePictureSizesAsync() ?? []);
        if (!mounted.current) return;
        if (size) { setPictureSize(size); return; }
      } catch { /* Size discovery is optional; retain the working native default. */ }
    }
    if (mounted.current) { ready.current = true; onReady(); }
  }
  useEffect(() => {
    ready.current = false; setRefocusing(false);
    return () => { ready.current = false; if (timer.current !== null) clearTimeout(timer.current); timer.current = null; };
  }, [facing]);
  useEffect(() => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null; setRefocusing(false);
  }, [lockFocus]);
  function refocus() {
    if (!lockFocus || !ready.current || capturing.current || timer.current !== null) return;
    // Send separate native updates: release the previous lock, then focus and hold again.
    setRefocusing(true);
    timer.current = setTimeout(() => { timer.current = null; setRefocusing(false); }, 80);
  }
  useImperativeHandle(ref, () => ({ async takePictureAsync() {
    if (!camera.current || !ready.current) throw new Error('CAMERA_NOT_READY');
    capturing.current = true;
    try {
      if (lockFocus) {
        // Pass oriented native pixels directly to the normalizer. Avoid encoding a
        // full-resolution temporary JPEG only to decode and re-encode it immediately.
        const picture = await camera.current.takePictureAsync({ pictureRef: true, exif: false, base64: false });
        return { uri: '', width: picture.width, height: picture.height, nativeImage: picture, owned: true };
      }
      const picture = await camera.current.takePictureAsync({ quality: .95, exif: false, base64: false });
      return { uri: picture.uri, width: picture.width, height: picture.height, owned: true };
    } finally { capturing.current = false; }
  } }), [lockFocus]);
  return <View style={StyleSheet.absoluteFill}>
    <CameraView key={pictureSize ?? 'default'} ref={camera} style={StyleSheet.absoluteFill} facing={facing} mode="picture" pictureSize={pictureSize} autofocus={lockFocus && !refocusing ? 'on' : 'off'} onCameraReady={() => void cameraReady()} onMountError={() => { ready.current = false; if (pictureSize) setPictureSize(undefined); else onError(); }} />
    {lockFocus && <Pressable style={StyleSheet.absoluteFill} accessibilityRole="button" accessibilityLabel="重新对焦" onPress={refocus} />}
  </View>;
}
