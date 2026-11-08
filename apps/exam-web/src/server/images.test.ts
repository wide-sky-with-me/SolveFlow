import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { prepareActViews, solverImage, SOLVER_IMAGE_QUALITY, SOLVER_IMAGE_WIDTH } from './images.js';

// Decision: .agents/notes/implemented/architecture/2026-11-07-solver-image-budget.md
// Synthetic pixels only: no real question photo enters the repository.
async function page(width: number, height: number) {
  // Pseudo-photographic noise: flat synthetic shapes compress unrealistically well and
  // would make any byte comparison meaningless.
  const pixels = Buffer.alloc(width * height * 3);
  let seed = 7;
  for (let index = 0; index < pixels.length; index += 1) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    pixels[index] = (seed >> 16) & 0xff;
  }
  return sharp(pixels, { raw: { width, height, channels: 3 } }).jpeg({ quality: 96 }).toBuffer();
}

describe('solver image budget', () => {
  it('keeps the model copy inside the solver budget and smaller than the stored page', async () => {
    const source = await page(2048, 1536);
    const bytes = await solverImage(Uint8Array.from(source));
    const info = await sharp(bytes).metadata();
    const previousPolicy = await sharp(source).resize({ width: 2048, height: 2048, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 92 }).toBuffer();
    expect(Math.max(info.width ?? 0, info.height ?? 0)).toBeLessThanOrEqual(SOLVER_IMAGE_WIDTH);
    expect(bytes.length).toBeLessThan(previousPolicy.length);
  });

  it('derives act views from the solver copy at the same quality', async () => {
    const source = await page(1600, 1200);
    const views = await prepareActViews({ image: { bytes: Uint8Array.from(await solverImage(Uint8Array.from(source))), mimeType: 'image/jpeg' } } as never, new AbortController().signal);
    expect(views).toHaveLength(2);
    for (const view of views) {
      const info = await sharp(view.bytes).metadata();
      expect(Math.max(info.width ?? 0, info.height ?? 0)).toBeLessThanOrEqual(SOLVER_IMAGE_WIDTH);
      expect(info.width).toBeLessThan(1600);
    }
    expect(SOLVER_IMAGE_QUALITY).toBeLessThan(92);
  });
});
