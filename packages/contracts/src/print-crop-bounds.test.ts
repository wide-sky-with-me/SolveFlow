import { describe, expect, it } from 'vitest';
import { PrintImageAdjustmentSchema } from './print-image-adjustment.js';

const crop = (left: number, right: number, top = 0, bottom = 100) => ({ rotation: 0, crop: { left: left / 100, right: right / 100, top: top / 100, bottom: bottom / 100 }, enhance: true });

describe('print crop decimal minimum', () => {
  it('accepts an exact five-percent rectangle at every tenth-percent offset', () => {
    for (let offset = 0; offset <= 950; offset++) {
      const start = offset / 10, end = (offset + 50) / 10;
      expect(PrintImageAdjustmentSchema.safeParse(crop(start, end)).success, `horizontal ${start}..${end}`).toBe(true);
      expect(PrintImageAdjustmentSchema.safeParse(crop(0, 100, start, end)).success, `vertical ${start}..${end}`).toBe(true);
    }
  });
  it('still rejects actual under-size, inverted and out-of-range rectangles', () => {
    for (const value of [crop(0, 4.99), crop(0, 4.99999999), crop(0, 100, 0, 4.99), crop(50, 40), crop(-.1, 5), crop(95, 100.1)]) expect(PrintImageAdjustmentSchema.safeParse(value).success).toBe(false);
  });
});
