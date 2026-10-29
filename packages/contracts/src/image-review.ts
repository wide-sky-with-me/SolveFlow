import { z } from 'zod';
import { MAX_MATERIAL_IMAGES } from './material.js';

export const MAX_IMAGE_REVIEW_REGIONS = 2;
/** Indexes only the unchanged main image (0) and ordered materials (1..7). */
export const ImageReviewRegionSchema = z.strictObject({
  imageIndex: z.number().int().min(0).max(MAX_MATERIAL_IMAGES),
  x: z.number().finite().min(0).max(1), y: z.number().finite().min(0).max(1),
  width: z.number().finite().min(.01).max(1), height: z.number().finite().min(.01).max(1),
}).superRefine((value, ctx) => {
  if (value.x + value.width > 1.000001 || value.y + value.height > 1.000001) ctx.addIssue({ code: 'custom', message: '复读区域超出对应原图' });
});
export type ImageReviewRegion = z.infer<typeof ImageReviewRegionSchema>;
