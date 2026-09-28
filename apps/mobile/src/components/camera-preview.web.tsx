import { useEffect, useImperativeHandle, useRef } from 'react';
import type { CameraPreviewProps } from './camera-preview.types';

// A browser media stream cannot be aborted while the permission prompt is open.
// Always stop a late stream after closing, changing lens, or entering background.
export function CameraPreview({ ref, facing, onReady, onError }: CameraPreviewProps) {
  const video = useRef<HTMLVideoElement>(null);
  const callbacks = useRef({ onReady, onError }); callbacks.current = { onReady, onError };
  useEffect(() => {
    let disposed = false; let stream: MediaStream | undefined;
    const element = video.current;
    async function start() {
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error('CAMERA_UNAVAILABLE');
        const next = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: facing === 'back' ? 'environment' : 'user' } } });
        if (disposed) { next.getTracks().forEach(track => track.stop()); return; }
        stream = next;
        if (element) { element.srcObject = next; await element.play(); }
      } catch { stream?.getTracks().forEach(track => track.stop()); if (!disposed) callbacks.current.onError(); }
    }
    void start();
    return () => { disposed = true; stream?.getTracks().forEach(track => track.stop()); if (element) element.srcObject = null; };
  }, [facing]);
  useImperativeHandle(ref, () => ({ async takePictureAsync() {
    const element = video.current;
    if (!element || element.readyState < 2 || element.videoWidth < 1 || element.videoHeight < 1) throw new Error('CAMERA_NOT_READY');
    const scale = Math.min(1, 2048 / Math.max(element.videoWidth, element.videoHeight));
    const canvas = document.createElement('canvas'); canvas.width = Math.max(1, Math.round(element.videoWidth * scale)); canvas.height = Math.max(1, Math.round(element.videoHeight * scale));
    const context = canvas.getContext('2d'); if (!context) throw new Error('CAMERA_CAPTURE_FAILED');
    context.drawImage(element, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error('CAMERA_CAPTURE_FAILED')), 'image/jpeg', .95));
    return { uri: URL.createObjectURL(blob), width: canvas.width, height: canvas.height, blob, owned: true };
  } }), []);
  return <video ref={video} autoPlay muted playsInline aria-label="相机预览" onCanPlay={() => callbacks.current.onReady()} onError={() => callbacks.current.onError()} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'contain', background: '#172338' }} />;
}
