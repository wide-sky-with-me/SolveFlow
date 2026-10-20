import { z } from 'zod';

const PointSchema = z.strictObject({ x: z.number().min(-.25).max(1.25), y: z.number().min(-.25).max(1.25) });
/** Clockwise raw-image corners: top-left, top-right, bottom-right, bottom-left. */
export const PrintImagePerspectiveSchema = z.tuple([PointSchema, PointSchema, PointSchema, PointSchema]).refine(points => {
  let area = 0;
  for (let index = 0; index < 4; index++) {
    const a = points[index], b = points[(index + 1) % 4], c = points[(index + 2) % 4];
    if (!a || !b || !c || Math.hypot(b.x - a.x, b.y - a.y) < .05 || (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x) < .0001) return false;
    area += a.x * b.y - a.y * b.x;
  }
  return area >= .005;
}, '请按左上、右上、右下、左下圈定完整图示，四角不可交叉或过于接近。');
export type PrintImagePerspective = z.infer<typeof PrintImagePerspectiveSchema>;
// Account for cancellation error at an exact decimal 5% extent, not actual under-size crops.
const minimumCropSpan = .05 - Number.EPSILON;
export const PrintImageAdjustmentSchema = z.strictObject({ rotation: z.number().min(-15).max(15), crop: z.strictObject({ left: z.number().min(0).max(1), top: z.number().min(0).max(1), right: z.number().min(0).max(1), bottom: z.number().min(0).max(1) }).refine(value => value.right - value.left >= minimumCropSpan && value.bottom - value.top >= minimumCropSpan, '裁切范围过小。'), enhance: z.boolean(), perspective: PrintImagePerspectiveSchema.optional() });
export type PrintImageAdjustment = z.infer<typeof PrintImageAdjustmentSchema>;
