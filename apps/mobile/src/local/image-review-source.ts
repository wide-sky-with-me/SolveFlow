import { ImageReviewRegionSchema, type ImageReviewRegion, type SolverInput } from '@solveflow/contracts/agent';

export function imageReviewSource(input: SolverInput, region: ImageReviewRegion): string {
  const selection = ImageReviewRegionSchema.parse(region);
  const image = selection.imageIndex === 0 ? input.image : input.materials?.[selection.imageIndex - 1]?.image;
  if (!image) throw new Error('复读区域没有对应原图。');
  let binary = '';
  for (let offset = 0; offset < image.bytes.length; offset += 8192) binary += String.fromCharCode(...image.bytes.subarray(offset, offset + 8192));
  return `data:${image.mimeType};base64,${btoa(binary)}`;
}

export function imageReviewPixels(region: ImageReviewRegion, width: number, height: number) {
  ImageReviewRegionSchema.parse(region);
  if (![width, height].every(value => Number.isInteger(value) && value > 0 && value <= 2048)) throw new Error('复读原图尺寸无效。');
  const originX = Math.floor(region.x * width + 1e-7), originY = Math.floor(region.y * height + 1e-7);
  const cropWidth = Math.min(width, Math.ceil((region.x + region.width) * width - 1e-7)) - originX;
  const cropHeight = Math.min(height, Math.ceil((region.y + region.height) * height - 1e-7)) - originY;
  const scale = Math.min(3, 2048 / Math.max(cropWidth, cropHeight));
  return { crop: { originX, originY, width: cropWidth, height: cropHeight }, size: { width: Math.max(1, Math.round(cropWidth * scale)), height: Math.max(1, Math.round(cropHeight * scale)) } };
}
