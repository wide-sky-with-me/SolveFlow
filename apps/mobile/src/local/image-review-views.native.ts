import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { File, Paths } from 'expo-file-system';
import { MAX_IMAGE_REVIEW_REGIONS, type ImageReviewRegion, type SolverInput } from '@solveflow/contracts/agent';
import { imageReviewPixels, imageReviewSource } from './image-review-source';

export async function prepareImageReviewViews(input: SolverInput, regions: ImageReviewRegion[], signal: AbortSignal): Promise<SolverInput['image'][]> {
  if (regions.length > MAX_IMAGE_REVIEW_REGIONS) throw new Error('局部复读区域过多。');
  const views: SolverInput['image'][] = [];
  for (const region of regions) {
    signal.throwIfAborted(); const context = ImageManipulator.manipulate(imageReviewSource(input, region));
    try {
      const source = await context.renderAsync();
      try { signal.throwIfAborted(); const { crop, size } = imageReviewPixels(region, source.width, source.height); context.crop(crop); context.resize(size); }
      finally { source.release(); }
      const cropped = await context.renderAsync(); let uri: string | undefined;
      try {
        signal.throwIfAborted(); const saved = await cropped.saveAsync({ format: SaveFormat.JPEG, compress: .96, base64: true }); uri = saved.uri;
        signal.throwIfAborted(); if (!saved.base64) throw new Error('局部复读图片编码失败。');
        views.push({ mimeType: 'image/jpeg', bytes: Uint8Array.from(atob(saved.base64), value => value.charCodeAt(0)) });
      } finally { cropped.release(); if (uri?.startsWith(Paths.cache.uri)) { const file = new File(uri); if (file.exists) file.delete(); } }
    } finally { context.release(); }
  }
  signal.throwIfAborted(); return views;
}
