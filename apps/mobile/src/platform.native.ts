import { imagePreviewSize, MAX_SOURCE_IMAGE_BYTES } from '@solveflow/image-input/formats';
import { Image } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import * as Picker from 'expo-image-picker';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { File, Paths } from 'expo-file-system';
import { cropPixels, type Crop } from '@solveflow/client/presentation';
import { type ClientStore } from '@solveflow/client/remote';
import type { Photo } from './platform.types';
import { MAX_BATCH_PHOTOS, MAX_BATCH_IMPORT_BYTES } from '@solveflow/contracts/local';
import { fileNameTime, type ImportPhoto } from './batch-photo-order';
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
export async function pickPhotos(limit: number): Promise<ImportPhoto[]> {
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_BATCH_PHOTOS) throw new Error('批次已满，请新建批次。');
  const result = await Picker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsMultipleSelection: true, selectionLimit: limit, orderedSelection: true, quality: 1, exif: false, base64: false, preferredAssetRepresentationMode: Picker.UIImagePickerPreferredAssetRepresentationMode.Compatible });
  if (result.canceled) return [];
  try {
    const sizes = result.assets.map(asset => asset.fileSize ?? new File(asset.uri).size);
    if (result.assets.length > limit || sizes.reduce((sum, size) => sum + size, 0) > MAX_BATCH_IMPORT_BYTES) throw new Error(`选择的图片超过本批剩余数量或${MAX_BATCH_IMPORT_BYTES / 1024 / 1024}MB，请分次导入。`);
    return result.assets.map((asset, id) => {
      const fileName = (asset.fileName || `图片${id + 1}`).slice(0, 160); const timestamp = fileNameTime(fileName);
      return { id, photo: fromAsset(asset), fileName, sourceBytes: sizes[id] ?? 0, ...(timestamp === undefined ? {} : { timestamp, timeSource: 'filename' as const }) };
    });
  } catch (cause) {
    for (const asset of result.assets) releasePhoto(fromAsset(asset));
    throw cause;
  }
}
export async function recoverPhoto(): Promise<Photo | null> {
  const result = await Picker.getPendingResultAsync();
  if (!result) return null;
  if ('code' in result) throw new Error('相册选择未完成，请重新选择照片。');
  return result.canceled || !result.assets[0] ? null : fromAsset(result.assets[0]);
}
export async function transformPhoto(photo: Photo, crop?: Crop, rotate = false, maxDimension = 2048): Promise<Photo> {
  if (!Number.isInteger(maxDimension) || maxDimension < 1 || maxDimension > 2048) throw new Error('图片尺寸无效。');
  if (!photo.nativeImage && photo.uri.startsWith('file:') && new File(photo.uri).size > MAX_SOURCE_IMAGE_BYTES) throw new Error('原图超过32MiB，请先缩小。');
  const preview = imagePreviewSize(photo.width, photo.height);
  const large = photo.width * photo.height > 20_000_000;
  const width = large ? preview.width : photo.width, height = large ? preview.height : photo.height;
  cropPixels(crop ?? { left: 0, top: 0, right: 100, bottom: 100 }, width, height);
  const context = ImageManipulator.manipulate(photo.nativeImage ?? photo.uri);
  try {
    if (large) context.resize({ width, height });
    if (crop) context.crop(cropPixels(crop, width, height));
    if (rotate) context.rotate(90);
    // Camera references already contain oriented pixels and accurate dimensions.
    // URI inputs still read decoded dimensions (including EXIF orientation).
    const interim = photo.nativeImage ? null : await context.renderAsync();
    try {
      const box = cropPixels(crop ?? { left: 0, top: 0, right: 100, bottom: 100 }, width, height);
      const renderWidth = interim?.width ?? (rotate ? box.height : box.width);
      const renderHeight = interim?.height ?? (rotate ? box.width : box.height);
      if (Math.max(renderWidth, renderHeight) > maxDimension) context.resize(renderWidth >= renderHeight ? { width: maxDimension } : { height: maxDimension });
    } finally { interim?.release(); }
    const image = await context.renderAsync();
    try { const result = await image.saveAsync({ format: SaveFormat.JPEG, compress: .92 }); return { uri: result.uri, width: result.width, height: result.height, owned: true, normalized: true }; }
    finally { image.release(); }
  } finally { context.release(); }
}
export async function photoBody(photo: Photo) { const file = new File(photo.uri); if (file.size > 10 * 1024 * 1024) throw new Error('图片超过10MB，请先裁切。'); const form = new FormData(); form.append('file', file, 'problem.jpg'); return form; }
export function releasePhoto(photo: Photo | null) { if (!photo?.owned) return; photo.nativeImage?.release(); if (!photo.uri.startsWith(Paths.cache.uri)) return; const file = new File(photo.uri); if (file.exists) file.delete(); }
export async function samplePhoto(blob: Blob): Promise<Photo> { const file = new File(Paths.cache, `solveflow-sample-${Date.now()}.png`); file.write(new Uint8Array(await blob.arrayBuffer())); const size = await Image.getSize(file.uri); return { uri: file.uri, width: size.width, height: size.height, owned: true }; }
export function initialSession() { return store.get('local-last-session'); }
export function rememberSession(id: string | null) { return id ? store.set('local-last-session', id) : store.remove('local-last-session'); }
export async function photoData(photo: Photo): Promise<string> { const file = new File(photo.uri); if (file.size > 4 * 1024 * 1024) throw new Error('图片超过4MB，请进一步裁切。'); return `data:image/jpeg;base64,${await file.base64()}`; }
