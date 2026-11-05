import { expect, it } from 'vitest';
import { imagePreviewSize, rasterSize, rasterOrientation } from './formats.js';
import { readFile } from 'node:fs/promises';
it('accepts 24/48MP originals but produces a bounded proportional preview', () => {
  expect(imagePreviewSize(5712, 4284)).toEqual({ width: 4096, height: 3072 });
  expect(imagePreviewSize(8064, 6048)).toEqual({ width: 4096, height: 3072 });
  expect(imagePreviewSize(6048, 8064)).toEqual({ width: 3072, height: 4096 });
  expect(imagePreviewSize(480, 320)).toEqual({ width: 480, height: 320 });
  for (const [w, h] of [[0, 1], [NaN, 1], [10000, 10000]]) expect(() => imagePreviewSize(w!, h!)).toThrow();
});
it('reads bounded raster metadata and rejects truncated segments', () => {
  const jpeg = new Uint8Array([255,216,255,192,0,11,8,23,160,31,128,3,1,1,0]);
  expect(rasterSize(jpeg)).toEqual({ width: 8064, height: 6048 }); expect(rasterSize(jpeg.subarray(0, 10))).toBeNull();
});
it('reads JPEG EXIF orientation without following invalid or truncated TIFF offsets', async () => {
  expect(rasterOrientation(await readFile('tests/fixtures/images/24mp-rotated.jpg'))).toBe(6);
  expect(rasterOrientation(await readFile('tests/fixtures/images/24mp.jpg'))).toBe(1);
  const jpeg = new Uint8Array([255,216,255,225,0,28,69,120,105,102,0,0,73,73,42,0,8,0,0,0,1,0,18,1,3,0,1,0,0,0,6,0,0,0]);
  // The declared segment excludes the entry value; metadata cannot escape it.
  expect(rasterOrientation(jpeg)).toBe(1);
  for (const size of [0, 10, 19, 25]) expect(rasterOrientation(jpeg.subarray(0, size))).toBe(1);
  jpeg[16] = 255; jpeg[17] = 255; jpeg[18] = 255; jpeg[19] = 255; expect(rasterOrientation(jpeg)).toBe(1);
});
it('respects endian order and axis-swapping orientation in JPEG, PNG and WebP headers', () => {
  for (const little of [false,true]) for (let orientation=1;orientation<=8;orientation++) {
    const tiff=new Uint8Array(26),data=new DataView(tiff.buffer);
    tiff.set(little?[73,73]:[77,77]);data.setUint16(2,42,little);data.setUint32(4,8,little);data.setUint16(8,1,little);
    data.setUint16(10,274,little);data.setUint16(12,3,little);data.setUint32(14,1,little);data.setUint16(18,orientation,little);
    const jpeg=new Uint8Array(38);jpeg.set([255,216,255,225,0,34,69,120,105,102,0,0]);jpeg.set(tiff,12);
    const png=new Uint8Array(46);png.set([137,80,78,71,13,10,26,10,0,0,0,26,101,88,73,102]);png.set(tiff,16);
    const webp=new Uint8Array(46);webp.set([82,73,70,70,38,0,0,0,87,69,66,80,69,88,73,70,26,0,0,0]);webp.set(tiff,20);
    for (const bytes of [jpeg,png,webp]) expect(rasterOrientation(bytes)).toBe(orientation);
  }
});
