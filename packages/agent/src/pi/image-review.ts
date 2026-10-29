import { z } from 'zod';
import { ImageReviewRegionSchema, MAX_IMAGE_REVIEW_REGIONS, NormalizedImageSchema, type ImageReviewRegion, type NormalizedImage, type SolverInput, type Verification } from '@solveflow/contracts/agent';
import { MAX_QUESTION_IMAGE_BYTES } from '@solveflow/contracts/local';

export type PrepareImageReviewViews = (input: SolverInput, regions: ImageReviewRegion[], signal: AbortSignal) => Promise<NormalizedImage[]>;
export type ImageReviewViews = { views: NormalizedImage[]; regions: ImageReviewRegion[] };
const visualCodes = new Set(['TRANSCRIPTION', 'DIAGRAM', 'INSUFFICIENT_EVIDENCE']);

/** A small margin retains table row labels, punctuation and nearby diagram context. */
export function imageReviewRegions(input: SolverInput, issues: Verification['issues']): ImageReviewRegion[] {
  const result: ImageReviewRegion[] = []; const seen = new Set<string>();
  for (const issue of issues) {
    if (!visualCodes.has(issue.code) || !issue.imageRegion) continue;
    const parsed = ImageReviewRegionSchema.safeParse(issue.imageRegion);
    if (!parsed.success || parsed.data.imageIndex > (input.materials?.length ?? 0)) continue;
    const value = parsed.data; const key = JSON.stringify(value);
    if (seen.has(key)) continue; seen.add(key);
    const x = Math.max(0, value.x - .03), y = Math.max(0, value.y - .03);
    result.push({ imageIndex: value.imageIndex, x, y, width: Math.min(1, value.x + value.width + .03) - x, height: Math.min(1, value.y + value.height + .03) - y });
    if (result.length === MAX_IMAGE_REVIEW_REGIONS) break;
  }
  return result;
}

/** Preparation is optional, bounded and has no model/network capability. */
export async function prepareImageReview(input: SolverInput, regions: ImageReviewRegion[], prepare: PrepareImageReviewViews, signal: AbortSignal): Promise<ImageReviewViews> {
  signal.throwIfAborted();
  const controller = new AbortController(); const abort = () => controller.abort();
  signal.addEventListener('abort', abort, { once: true });
  let rejectAbort: () => void = () => {};
  const aborted = new Promise<never>((_resolve, reject) => { rejectAbort = () => reject(new Error('IMAGE_REVIEW_ABORTED')); controller.signal.addEventListener('abort', rejectAbort, { once: true }); });
  const timer = setTimeout(abort, 10_000);
  try {
    if (signal.aborted) abort();
    const prepared = z.array(NormalizedImageSchema).max(MAX_IMAGE_REVIEW_REGIONS).parse(await Promise.race([prepare(input, regions, controller.signal), aborted]));
    signal.throwIfAborted();
    if (prepared.length && prepared.length !== regions.length) throw new Error('IMAGE_REVIEW_REGION_MISMATCH');
    let bytes = input.image.bytes.length + (input.materials ?? []).reduce((total, material) => total + material.image.bytes.length, 0);
    const result: ImageReviewViews = { views: [], regions: [] };
    prepared.forEach((view, index) => {
      if (bytes + view.bytes.length > MAX_QUESTION_IMAGE_BYTES) return;
      bytes += view.bytes.length; result.views.push(view); result.regions.push(regions[index]!);
    });
    return result;
  } finally { clearTimeout(timer); signal.removeEventListener('abort', abort); controller.signal.removeEventListener('abort', rejectAbort); }
}
