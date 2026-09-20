import { useImperativeHandle, useRef } from 'react';
import { StyleSheet } from 'react-native';
import { CameraView } from 'expo-camera';
import type { CameraPreviewProps } from './camera-preview.types';

export function CameraPreview({ ref, facing, onReady, onError }: CameraPreviewProps) {
  const camera = useRef<CameraView>(null);
  useImperativeHandle(ref, () => ({ async takePictureAsync() {
    if (!camera.current) throw new Error('CAMERA_NOT_READY');
    const picture = await camera.current.takePictureAsync({ quality: .95, exif: false, base64: false });
    return { uri: picture.uri, width: picture.width, height: picture.height, owned: true };
  } }), []);
  return <CameraView ref={camera} style={StyleSheet.absoluteFill} facing={facing} mode="picture" onCameraReady={onReady} onMountError={onError} />;
}
