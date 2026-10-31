import sharp from 'sharp';
import type { NormalizedImage, SolverInput } from '@solveflow/contracts/agent';
/** Match the device ACT capture's two overlapping views; the intact original stays first. */
export async function preparePhotoActViews(input: SolverInput, signal: AbortSignal): Promise<NormalizedImage[]> {
  signal.throwIfAborted();
  const metadata = await sharp(input.image.bytes, { limitInputPixels: 16777216 }).metadata();
  if (!metadata.width || !metadata.height) return [];
  const width = Math.max(1, Math.floor(metadata.width * .65)); const views: NormalizedImage[] = [];
  for (const fraction of [0, .35]) {
    signal.throwIfAborted();
    const left = Math.min(metadata.width - width, Math.floor(metadata.width * fraction));
    const bytes = await sharp(input.image.bytes, { limitInputPixels: 16777216 }).extract({ left, top: 0, width, height: metadata.height }).resize({ width: 2048, height: 2048, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 96 }).toBuffer();
    signal.throwIfAborted(); if (bytes.length <= 4 * 1024 * 1024) views.push({ bytes: Uint8Array.from(bytes), mimeType: 'image/jpeg' });
  }
  return views;
}
