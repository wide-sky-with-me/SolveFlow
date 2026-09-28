import { Image } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import * as Picker from 'expo-image-picker';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { File, Paths } from 'expo-file-system';
import { cropPixels, type ClientStore, type Crop } from '@solveflow/client';
import type { Photo } from './platform.types';
const keyOf = (key: string) => `solveflow.${Array.from(new TextEncoder().encode(key), byte => byte.toString(16).padStart(2, '0')).join('')}`;
export const store: ClientStore = {
  get: key => SecureStore.getItemAsync(keyOf(key)),
  set: (key, value) => SecureStore.setItemAsync(keyOf(key), value, { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY }),
  remove: key => SecureStore.deleteItemAsync(keyOf(key)),
};
const fromAsset = (asset: Picker.ImagePickerAsset): Photo => ({ uri: asset.uri, width: asset.width, height: asset.height, owned: asset.uri.startsWith(Paths.cache.uri) });
export async function pickPhoto(): Promise<Photo | null> {
  const result = await Picker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsEditing: false, quality: 1, exif: false, base64: false, preferredAssetRepresentationMode: Picker.UIImagePickerPreferredAssetRepresentationMode.Compatible });
  return result.canceled || !result.assets[0] ? null : fromAsset(result.assets[0]);
}
export async function recoverPhoto(): Promise<Photo | null> {
  const result = await Picker.getPendingResultAsync();
  if (!result) return null;
  if ('code' in result) throw new Error('相册选择未完成，请重新选择照片。');
  return result.canceled || !result.assets[0] ? null : fromAsset(result.assets[0]);
}
export async function transformPhoto(photo: Photo, crop?: Crop, rotate = false, maxDimension = 2048): Promise<Photo> {
  if (!Number.isInteger(maxDimension) || maxDimension < 1 || maxDimension > 2048) throw new Error('图片尺寸无效。');
  cropPixels(crop ?? { left: 0, top: 0, right: 100, bottom: 100 }, photo.width, photo.height);
  const context = ImageManipulator.manipulate(photo.nativeImage ?? photo.uri);
  try {
    if (crop) context.crop(cropPixels(crop, photo.width, photo.height));
    if (rotate) context.rotate(90);
    // Camera references already contain oriented pixels and accurate dimensions.
    // URI inputs still read decoded dimensions (including EXIF orientation).
    const interim = photo.nativeImage ? null : await context.renderAsync();
    try {
      const box = cropPixels(crop ?? { left: 0, top: 0, right: 100, bottom: 100 }, photo.width, photo.height);
      const width = interim?.width ?? (rotate ? box.height : box.width);
      const height = interim?.height ?? (rotate ? box.width : box.height);
      if (Math.max(width, height) > maxDimension) context.resize(width >= height ? { width: maxDimension } : { height: maxDimension });
    } finally { interim?.release(); }
    const image = await context.renderAsync();
    try { const result = await image.saveAsync({ format: SaveFormat.JPEG, compress: .92 }); return { uri: result.uri, width: result.width, height: result.height, owned: true }; }
    finally { image.release(); }
  } finally { context.release(); }
}
export async function photoBody(photo: Photo) { const file = new File(photo.uri); if (file.size > 10 * 1024 * 1024) throw new Error('图片超过10MB，请先裁切。'); const form = new FormData(); form.append('file', file, 'problem.jpg'); return form; }
export function releasePhoto(photo: Photo | null) { if (!photo?.owned) return; photo.nativeImage?.release(); if (!photo.uri.startsWith(Paths.cache.uri)) return; const file = new File(photo.uri); if (file.exists) file.delete(); }
export async function samplePhoto(blob: Blob): Promise<Photo> { const file = new File(Paths.cache, `solveflow-sample-${Date.now()}.png`); file.write(new Uint8Array(await blob.arrayBuffer())); const size = await Image.getSize(file.uri); return { uri: file.uri, width: size.width, height: size.height, owned: true }; }
export function initialSession() { return store.get('local-last-session'); }
export function rememberSession(id: string | null) { return id ? store.set('local-last-session', id) : store.remove('local-last-session'); }
export async function photoData(photo: Photo): Promise<string> { const file = new File(photo.uri); if (file.size > 4 * 1024 * 1024) throw new Error('图片超过4MB，请进一步裁切。'); return `data:image/jpeg;base64,${await file.base64()}`; }
