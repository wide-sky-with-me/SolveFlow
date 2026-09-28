import { afterEach, expect, it, vi } from 'vitest';
const mock = vi.hoisted(() => ({ manipulate: vi.fn(), bitmap: vi.fn(), size: 3, base64: vi.fn(async () => 'YWJj') }));
vi.mock('react-native', () => ({ Image: {} }));
vi.mock('expo-secure-store', () => ({}));
vi.mock('expo-image-picker', () => ({}));
vi.mock('expo-image-manipulator', () => ({ ImageManipulator: { manipulate: mock.manipulate }, SaveFormat: { JPEG: 'jpeg' } }));
vi.mock('expo-file-system', () => ({ File: class { get size() { return mock.size; } base64 = mock.base64; }, Paths: { cache: { uri: 'file:///cache/' } } }));
vi.mock('expo-camera', () => ({ PictureRef: class { release = vi.fn(); } }));
import { PictureRef } from 'expo-camera';
import { releasePhoto, photoData, transformPhoto as nativeTransform } from './platform.native';
import { transformPhoto as webTransform } from './platform.web';
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });
it('rejects dimensions above the upload contract before allocating image decoders on either platform', async () => {
  vi.stubGlobal('createImageBitmap', mock.bitmap);
  const photo = { uri: 'file:///cache/photo.jpg', width: 4096, height: 4096, blob: new Blob() };
  for (const transform of [nativeTransform, webTransform]) {
    for (const dimension of [2049, 4096, Number.MAX_SAFE_INTEGER, NaN, Infinity, 0, -1, 1.5]) {
      await expect(transform(photo, undefined, false, dimension)).rejects.toThrow('图片尺寸无效');
    }
  }
  expect(mock.manipulate).not.toHaveBeenCalled(); expect(mock.bitmap).not.toHaveBeenCalled();
});
it('keeps native thumbnail and full-size resizing available with released intermediate images', async () => {
  for (const dimension of [256, 2048]) {
    const interim = { width: 4000, height: 3000, release: vi.fn() };
    const image = { saveAsync: vi.fn(async () => ({ uri: 'file:///cache/resized.jpg', width: dimension, height: dimension * .75 })), release: vi.fn() };
    const context = { renderAsync: vi.fn().mockResolvedValueOnce(interim).mockResolvedValueOnce(image), resize: vi.fn(), release: vi.fn() };
    mock.manipulate.mockReturnValueOnce(context);
    const result = await nativeTransform({ uri: 'file:///cache/photo.jpg', width: 4000, height: 3000 }, undefined, false, dimension);
    expect(result.width).toBe(dimension); expect(context.resize).toHaveBeenCalledWith({ width: dimension });
    expect(interim.release).toHaveBeenCalledOnce(); expect(image.release).toHaveBeenCalledOnce(); expect(context.release).toHaveBeenCalledOnce();
  }
});

it('encodes JPEG in the native file module and rejects oversize before reading', async () => {
  const photo = { uri: 'file:///cache/photo.jpg', width: 10, height: 10 };
  expect(await photoData(photo)).toBe('data:image/jpeg;base64,YWJj');
  expect(mock.base64).toHaveBeenCalledOnce();
  mock.size = 4 * 1024 * 1024 + 1;
  try { await expect(photoData(photo)).rejects.toThrow('图片超过4MB'); expect(mock.base64).toHaveBeenCalledOnce(); }
  finally { mock.size = 3; }
});

it.each([false, true])('passes native camera pixels directly, applies crop/rotation and releases on save failure=%s', async fail => {
  const nativeImage = new PictureRef();
  const photo = { uri: '', width: 4000, height: 3000, nativeImage, owned: true };
  const image = { saveAsync: vi.fn(async () => { if (fail) throw new Error('disk full'); return { uri: 'file:///cache/final.jpg', width: 1536, height: 2048 }; }), release: vi.fn() };
  const context = { renderAsync: vi.fn(async () => image), crop: vi.fn(), rotate: vi.fn(), resize: vi.fn(), release: vi.fn() };
  mock.manipulate.mockReturnValueOnce(context);
  try {
    const pending = nativeTransform(photo, { left: 0, top: 0, right: 100, bottom: 100 }, true);
    if (fail) await expect(pending).rejects.toThrow('disk full'); else await expect(pending).resolves.toMatchObject({ width: 1536, height: 2048 });
    expect(mock.manipulate).toHaveBeenCalledWith(nativeImage);
    expect(context.renderAsync).toHaveBeenCalledOnce(); expect(context.resize).toHaveBeenCalledWith({ height: 2048 });
    expect(context.rotate).toHaveBeenCalledWith(90); expect(image.release).toHaveBeenCalledOnce(); expect(context.release).toHaveBeenCalledOnce();
    expect(nativeImage.release).not.toHaveBeenCalled();
  } finally { releasePhoto(photo); }
  expect(nativeImage.release).toHaveBeenCalledOnce();
});
