import type { PictureRef } from 'expo-camera';
/** nativeImage is short-lived, batch-only, and must be normalized before display or persistence. */
/** normalized is transient, set only by transformPhoto after crop/EXIF removal and size limiting. */
export interface Photo { uri: string; width: number; height: number; owned?: boolean; blob?: Blob; nativeImage?: PictureRef; normalized?: true }
