import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const mock = vi.hoisted(() => ({ picker: vi.fn(), fileSize: 1, removeFile: vi.fn(), bitmap: vi.fn() }));
vi.mock('react-native', () => ({ Image: {} }));
vi.mock('expo-secure-store', () => ({}));
vi.mock('expo-image-picker', () => ({ launchImageLibraryAsync: mock.picker, UIImagePickerPreferredAssetRepresentationMode: { Compatible: 'compatible' } }));
vi.mock('expo-image-manipulator', () => ({ ImageManipulator: {}, SaveFormat: { JPEG: 'jpeg' } }));
vi.mock('expo-file-system', () => ({ File: class { get size() { return mock.fileSize; } exists = true; delete = mock.removeFile; }, Paths: { cache: { uri: 'file:///cache/' } } }));
import { pickPhotos as webPick, releasePhoto as webRelease } from './platform.web';
import { pickPhotos as nativePick } from './platform.native';
const mib = 1024 * 1024;
const originalSizes = (total: number) => Array.from({ length: 100 }, (_, index) => Math.floor(total * mib / 100) + (index === 99 ? total * mib % 100 : 0));
function webSelection(sizes: number[]) {
  const files = sizes.map((size, index) => {
    const file = new File(['synthetic-image'], `question-${index + 1}.jpg`, { type: 'image/jpeg' });
    Object.defineProperty(file, 'size', { value: size }); return file;
  });
  const input: { files: File[]; style: Record<string, string>; onchange?: () => void; remove: () => void; click: () => void } = {
    files, style: {}, remove: vi.fn(), click: () => input.onchange?.(),
  };
  vi.stubGlobal('document', { createElement: () => input, body: { append: vi.fn() } });
}
function nativeSelection(sizes: (number | undefined)[]) {
  mock.picker.mockResolvedValue({ canceled: false, assets: sizes.map((fileSize, index) => ({ uri: `file:///cache/question-${index}.jpg`, fileName: `question-${index}.jpg`, width: 300, height: 200, fileSize })) });
}
beforeEach(() => {
  mock.fileSize = 1;
  mock.bitmap.mockImplementation(async () => ({ width: 300, height: 200, close: vi.fn() }));
  vi.stubGlobal('createImageBitmap', mock.bitmap);
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.clearAllMocks(); });
it.each([101, 500])('Web accepts %i MiB of originals within the photo limit', async total => {
  webSelection(originalSizes(total));
  const photos = await webPick(100);
  try { expect(photos).toHaveLength(100); expect(mock.bitmap).toHaveBeenCalledTimes(100); }
  finally { photos.forEach(row => webRelease(row.photo)); }
});
it.each([101, 500])('native accepts %i MiB of originals within the photo limit', async total => {
  nativeSelection(originalSizes(total));
  await expect(nativePick(100)).resolves.toHaveLength(100);
});
it('Web rejects one byte above 500 MiB before image decoding', async () => {
  webSelection([...Array(99).fill(5 * mib), 5 * mib + 1]);
  await expect(webPick(100)).rejects.toThrow('超过500MB');
  expect(mock.bitmap).not.toHaveBeenCalled();
});
it('native rejects one byte above 500 MiB and releases temporary selections', async () => {
  nativeSelection([...Array(99).fill(5 * mib), 5 * mib + 1]);
  await expect(nativePick(100)).rejects.toThrow('500MB');
  expect(mock.removeFile).toHaveBeenCalledTimes(100);
});
it('native applies the same limit when asset sizes need filesystem lookup', async () => {
  mock.fileSize = 5 * mib; nativeSelection(Array(100).fill(undefined));
  await expect(nativePick(100)).resolves.toHaveLength(100);
  mock.fileSize++; nativeSelection(Array(100).fill(undefined));
  await expect(nativePick(100)).rejects.toThrow('500MB');
});
it('Web keeps the 10 MiB per-image limit and remaining photo capacity', async () => {
  webSelection([10 * mib + 1]); await expect(webPick(100)).rejects.toThrow('图片超过10MB');
  webSelection([1, 1]); await expect(webPick(1)).rejects.toThrow('本批还可添加1张');
  expect(mock.bitmap).not.toHaveBeenCalled();
});
it('native keeps the remaining photo capacity and releases rejected selections', async () => {
  nativeSelection([1, 1]); await expect(nativePick(1)).rejects.toThrow('本批剩余数量');
  expect(mock.removeFile).toHaveBeenCalledTimes(2);
});
