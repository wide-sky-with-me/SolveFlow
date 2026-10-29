import { MAX_IMAGE_REVIEW_REGIONS, type ImageReviewRegion, type SolverInput } from '@solveflow/contracts/agent';
import { imageReviewPixels, imageReviewSource } from './image-review-source';

export async function prepareImageReviewViews(input: SolverInput, regions: ImageReviewRegion[], signal: AbortSignal): Promise<SolverInput['image'][]> {
  if (regions.length > MAX_IMAGE_REVIEW_REGIONS) throw new Error('局部复读区域过多。');
  const views: SolverInput['image'][] = [];
  for (const region of regions) {
    signal.throwIfAborted(); const uri = imageReviewSource(input, region); const image = new Image(); const canvas = document.createElement('canvas');
    try {
      await new Promise<void>((resolve, reject) => {
        const finish = (error?: Error) => { clearTimeout(timer); signal.removeEventListener('abort', abort); image.onload = image.onerror = null; error ? reject(error) : resolve(); };
        const abort = () => { image.src = ''; finish(new Error('CANCELLED')); };
        const timer = setTimeout(() => finish(new Error('局部复读图片加载超时。')), 10_000);
        image.onload = () => finish(); image.onerror = () => finish(new Error('局部复读图片读取失败。'));
        signal.addEventListener('abort', abort, { once: true }); image.src = uri; if (signal.aborted) abort();
      });
      signal.throwIfAborted();
      const { crop, size } = imageReviewPixels(region, image.naturalWidth, image.naturalHeight);
      canvas.width = size.width; canvas.height = size.height; const context = canvas.getContext('2d');
      if (!context) throw new Error('局部复读画布不可用。');
      context.imageSmoothingQuality = 'high'; context.drawImage(image, crop.originX, crop.originY, crop.width, crop.height, 0, 0, size.width, size.height);
      const data = canvas.toDataURL('image/jpeg', .96); const binary = atob(data.slice(data.indexOf(',') + 1));
      views.push({ mimeType: 'image/jpeg', bytes: Uint8Array.from(binary, value => value.charCodeAt(0)) });
      await new Promise<void>(resolve => setTimeout(resolve, 0));
    } finally { image.onload = image.onerror = null; image.src = ''; canvas.width = 0; canvas.height = 0; }
  }
  signal.throwIfAborted(); return views;
}
