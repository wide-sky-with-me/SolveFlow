import { describe, expect, it } from 'vitest';
import type { PrintImagePerspective } from '@solveflow/contracts/local';
import { warpPrintPerspective } from './print-image-perspective.js';

const full: PrintImagePerspective = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }];
function gradient(w: number, h: number) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) data.set([x * 10, y * 10, 73, 255], (y * w + x) * 4);
  return data;
}
const signal = () => new AbortController().signal;

describe('print perspective pixels', () => {
  it('keeps an identity image, every channel and the source unchanged', async () => {
    const data = gradient(12, 9), before = data.slice();
    const result = await warpPrintPerspective(data, 12, 9, full, signal());
    expect(result).toEqual({ data: before, width: 12, height: 9 });
    expect(data).toEqual(before);
  });
  it('uses projective rather than affine interpolation for a trapezoid', async () => {
    const trapezoid: PrintImagePerspective = [{ x: .2, y: 0 }, { x: .8, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }];
    const result = await warpPrintPerspective(gradient(21, 21), 21, 21, trapezoid, signal());
    expect([result.width, result.height]).toEqual([21, 21]);
    expect(Array.from(result.data.slice((10 * 21 + 10) * 4, (10 * 21 + 10) * 4 + 4))).toEqual([100, 75, 73, 255]);
    expect(Array.from(result.data.slice(0, 4))).toEqual([40, 0, 73, 255]);
    expect(Array.from(result.data.slice(-4))).toEqual([200, 200, 73, 255]);
  });
  it('retains a one-pixel image without division by zero', async () => {
    const result = await warpPrintPerspective(gradient(1, 1), 1, 1, full, signal());
    expect(Array.from(result.data)).toEqual([0, 0, 73, 255]);
  });
  it('bounds even diagonally extended output to the existing edge limit', async () => {
    const diagonal: PrintImagePerspective = [{ x: 0, y: 0 }, { x: 1, y: .9 }, { x: .95, y: 1 }, { x: 0, y: .05 }];
    const result = await warpPrintPerspective(new Uint8ClampedArray(2048 * 2048 * 4).fill(255), 2048, 2048, diagonal, signal());
    expect(Math.max(result.width, result.height)).toBe(2048);
    expect(result.data.every(value => value === 255)).toBe(true);
  });
  it('fills missing source corners white instead of stretching edge pixels', async () => {
    const padding: PrintImagePerspective = [{ x: -.25, y: -.25 }, { x: 1.25, y: -.25 }, { x: 1.25, y: 1.25 }, { x: -.25, y: 1.25 }];
    const result = await warpPrintPerspective(gradient(5, 5), 5, 5, padding, signal());
    expect([result.width, result.height]).toEqual([7, 7]);
    expect(Array.from(result.data.slice(0, 4))).toEqual([255, 255, 255, 255]);
    expect(Array.from(result.data.slice((3 * 7 + 3) * 4, (3 * 7 + 3) * 4 + 4))).toEqual([20, 20, 73, 255]);
  });
  it('rejects malformed dimensions and short buffers before processing', async () => {
    await expect(warpPrintPerspective(new Uint8ClampedArray(4), 2, 2, full, signal())).rejects.toThrow('像素尺寸');
    await expect(warpPrintPerspective(new Uint8ClampedArray(4), 2049, 1, full, signal())).rejects.toThrow('像素尺寸');
  });
  it('stops before allocation when already cancelled', async () => {
    const controller = new AbortController(); controller.abort(new Error('stopped'));
    await expect(warpPrintPerspective(gradient(2, 2), 2, 2, full, controller.signal)).rejects.toThrow('stopped');
  });
  it('yields to cancellation while scanning and never mutates its input', async () => {
    const data = gradient(128, 128), before = data.slice(), controller = new AbortController();
    const work = warpPrintPerspective(data, 128, 128, full, controller.signal);
    setTimeout(() => controller.abort(new Error('stopped')), 0);
    await expect(work).rejects.toThrow('stopped');
    expect(data).toEqual(before);
  });
  it.each([{ width: 1, height: 5 }, { width: 5, height: 1 }, { width: 1, height: 1 }])('fills an outside selection white for a $width by $height source', async ({ width, height }) => {
    const outside: PrintImagePerspective = width === 1
      ? [{ x: -.25, y: 0 }, { x: -.1, y: 0 }, { x: -.1, y: 1 }, { x: -.25, y: 1 }]
      : [{ x: 0, y: -.25 }, { x: 1, y: -.25 }, { x: 1, y: -.1 }, { x: 0, y: -.1 }];
    const data = gradient(width, height), before = data.slice();
    const result = await warpPrintPerspective(data, width, height, outside, signal());
    expect(result.data.every(value => value === 255)).toBe(true);
    expect(data).toEqual(before);
  });
  it('samples the centre when a padded source collapses to one output pixel', async () => {
    const padding: PrintImagePerspective = [{ x: -.25, y: -.25 }, { x: 1.25, y: -.25 }, { x: 1.25, y: 1.25 }, { x: -.25, y: 1.25 }];
    const result = await warpPrintPerspective(gradient(1, 1), 1, 1, padding, signal());
    expect(result).toEqual({ width: 1, height: 1, data: gradient(1, 1) });
  });
});
