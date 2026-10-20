import { describe, expect, it } from 'vitest';
import { sharpenPrintPixels } from './print-image-sharpen';

function pixels(values: number[]) { return new Uint8ClampedArray(values.flatMap(value => [value, value, value, 203])); }
describe('conservative print sharpening', () => {
  it('keeps uniform paper and colour unchanged', async () => {
    const data = new Uint8ClampedArray(Array.from({ length: 16 }, () => [80, 150, 210, 203]).flat()); const before = data.slice();
    await sharpenPrintPixels(data, 4, 4, new AbortController().signal); expect(data).toEqual(before);
  });
  it('improves a stroke without removing a faint dashed line or changing alpha', async () => {
    const data = pixels([245,245,245,245, 245,190,245,245, 245,245,80,245, 245,245,245,245]); const before = data.slice();
    await sharpenPrintPixels(data, 4, 4, new AbortController().signal);
    expect(data[20]).toBeLessThan(before[20] ?? 0); expect(data[40]).toBeLessThan(before[40] ?? 0);
    for (let index = 0; index < data.length; index++) expect(Math.abs((data[index] ?? 0) - (before[index] ?? 0))).toBeLessThanOrEqual(12);
    for (let index = 3; index < data.length; index += 4) expect(data[index]).toBe(203);
  });
  it('honours cancellation before changing any pixels and between rows', async () => {
    const cancelled = new AbortController(); cancelled.abort(); const data = pixels([245,190,245,245]); const before = data.slice();
    await expect(sharpenPrintPixels(data, 2, 2, cancelled.signal)).rejects.toThrow(); expect(data).toEqual(before);
    const controller = new AbortController(); const large = pixels(Array.from({ length: 256 * 256 }, (_, index) => index % 2 ? 170 : 240));
    const pending = sharpenPrintPixels(large, 256, 256, controller.signal); setTimeout(() => controller.abort(), 0); await expect(pending).rejects.toThrow();
  });
  it('rejects malformed or oversized pixel buffers', async () => {
    for (const [width, height] of [[0, 1], [2, 2], [1.5, 1], [5000, 5000]]) await expect(sharpenPrintPixels(new Uint8ClampedArray(4), width ?? 0, height ?? 0, new AbortController().signal)).rejects.toThrow();
  });
});
