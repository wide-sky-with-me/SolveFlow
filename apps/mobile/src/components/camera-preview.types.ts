import type { Ref } from 'react';
import type { Photo } from '../platform.types';

export interface CameraHandle { takePictureAsync(): Promise<Photo> }
export interface CameraPreviewProps {
  ref?: Ref<CameraHandle>;
  facing: 'back' | 'front';
  lockFocus?: boolean;
  onReady: () => void;
  onError: () => void;
}
