import { describe, expect, it } from 'vitest';
import { PrintImageAdjustmentSchema } from './print-image-adjustment.js';

const base = { rotation: 0, crop: { left: 0, top: 0, right: 1, bottom: 1 }, enhance: true };
const corners = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }];

describe('explicit print perspective', () => {
  it('keeps legacy adjustments byte-compatible without a new default', () => {
    expect(PrintImageAdjustmentSchema.parse(base)).toEqual(base);
  });
  it.each([
    corners,
    [{ x: .1, y: .2 }, { x: .8, y: .1 }, { x: .9, y: .85 }, { x: .2, y: .9 }],
    [{ x: -.25, y: -.25 }, { x: 1.25, y: -.25 }, { x: 1.25, y: 1.25 }, { x: -.25, y: 1.25 }],
  ])('accepts a clockwise convex source quadrilateral: %j', (...perspective) => {
    expect(PrintImageAdjustmentSchema.safeParse({ ...base, perspective }).success).toBe(true);
  });
  it.each([
    [corners[0], corners[2], corners[1], corners[3]],
    [corners[0], corners[1], corners[1], corners[3]],
    [{ x: -.3, y: 0 }, corners[1], corners[2], corners[3]],
    [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: .001 }, { x: 0, y: .001 }],
    [{ x: 0, y: 0 }, { x: .5, y: .5 }, { x: .6, y: .6 }, { x: 0, y: 1 }],
    [{ x: 0, y: 0 }, { x: Number.NaN, y: 0 }, corners[2], corners[3]],
  ])('rejects crossing, degenerate, out-of-range or non-finite corners: %j', (...perspective) => {
    expect(PrintImageAdjustmentSchema.safeParse({ ...base, perspective }).success).toBe(false);
  });
});
