import { describe, expect, it } from 'vitest';
import { estimatePrintRotation } from './print-image-deskew';

function textPoints(skew: number): [number, number][] {
  const points: [number, number][] = []; const radians = skew * Math.PI / 180;
  for (let line = 0; line < 4; line++) for (let letter = 0; letter < 28; letter++) for (let y = 0; y < 9; y++) for (let x = 0; x < 5; x++) {
    if (x > 0 && x < 4 && y > 0 && y < 7) continue;
    const px = 40 + letter * 11 + x - 240, py = 65 + line * 45 + y - 160;
    points.push([240 + px * Math.cos(radians) - py * Math.sin(radians), 160 + px * Math.sin(radians) + py * Math.cos(radians)]);
  }
  return points;
}
const signal = () => new AbortController().signal;
describe('bounded text-baseline deskew', () => {
  it.each([-14, -8, 8, 14])('returns the opposite rotation for a %s degree text baseline', async skew => {
    expect(await estimatePrintRotation(textPoints(skew), 480, 320, signal())).toBeCloseTo(-skew, 0);
  });
  it('does not rotate upright, blank, sparse or uniformly distributed samples', async () => {
    expect(await estimatePrintRotation(textPoints(0), 480, 320, signal())).toBe(0);
    expect(await estimatePrintRotation([], 480, 320, signal())).toBe(0);
    expect(await estimatePrintRotation([[4, 4]], 480, 320, signal())).toBe(0);
    const grid: [number, number][] = []; for (let y = 20; y < 300; y += 4) for (let x = 20; x < 460; x += 4) grid.push([x, y]);
    expect(await estimatePrintRotation(grid, 480, 320, signal())).toBe(0);
  });
  it('stops before and during the angle sweep without returning a late angle', async () => {
    const controller = new AbortController(); controller.abort(); await expect(estimatePrintRotation(textPoints(8), 480, 320, controller.signal)).rejects.toThrow();
    const active = new AbortController(); const pending = estimatePrintRotation(textPoints(8), 480, 320, active.signal); setTimeout(() => active.abort(), 0); await expect(pending).rejects.toThrow();
  });
  it('rejects malformed or excessive sample dimensions', async () => {
    for (const [width, height] of [[0, 10], [1.5, 10], [2048, 2048]]) await expect(estimatePrintRotation([], width ?? 0, height ?? 0, signal())).rejects.toThrow('Invalid deskew sample.');
  });
});
