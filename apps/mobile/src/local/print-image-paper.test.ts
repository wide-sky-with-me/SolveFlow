import { describe, expect, it } from 'vitest';
import { normalizePrintPaperPixels } from './print-image-paper';

type Pixel = readonly [number, number, number, number];
function image(width: number, height: number, colour: (x: number, y: number) => Pixel) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) data.set(colour(x, y), (y * width + x) * 4);
  return data;
}
function rgb(data: Uint8ClampedArray, width: number, x: number, y: number) { return [...data.slice((y * width + x) * 4, (y * width + x) * 4 + 3)]; }
const signal = () => new AbortController().signal;

describe('conservative paper illumination correction', () => {
  it('normalizes smoothly across the former colour-cast cutoff instead of producing white blocks', async () => {
    const data = image(256, 128, x => [210, 152 + x * 24 / 256, 218, 255]);
    await normalizePrintPaperPixels(data, 256, 128, signal());
    for (let x = 8; x < 248; x++) {
      expect(Math.min(...rgb(data, 256, x, 64))).toBeGreaterThan(245);
      const previous = rgb(data, 256, x - 1, 64); expect(Math.max(...rgb(data, 256, x, 64).map((value, index) => Math.abs(value - (previous[index] ?? 0))))).toBeLessThan(4);
    }
  });
  it('keeps a neutral filled diagram region visibly darker than its paper', async () => {
    const data = image(512, 256, (x, y) => x >= 96 && x < 256 && y >= 64 && y < 224 ? [150, 150, 150, 255] : [240, 240, 240, 255]);
    await normalizePrintPaperPixels(data, 512, 256, signal());
    expect(Math.max(...rgb(data, 512, 160, 128))).toBeLessThan(190);
    expect(Math.min(...rgb(data, 512, 32, 32))).toBeGreaterThan(245);
  });
  it('retains a large grey fill even when several complete sampling cells are covered', async () => {
    const data = image(640, 480, (x, y) => x >= 160 && x < 480 && y >= 80 && y < 400 ? [150, 150, 150, 255] : [240, 240, 240, 255]);
    await normalizePrintPaperPixels(data, 640, 480, signal());
    expect(Math.max(...rgb(data, 640, 320, 240))).toBeLessThan(210);
    expect(Math.min(...rgb(data, 640, 32, 32))).toBeGreaterThan(245);
  });
  it.each([190, 210, 220, 230, 238])('retains low-contrast filled cells instead of whitening shade %i', async shade => {
    const data = image(640, 480, (x, y) => x >= 160 && x < 480 && y >= 80 && y < 400 ? [shade, shade, shade, 255] : [240, 240, 240, 255]);
    await normalizePrintPaperPixels(data, 640, 480, signal());
    const paper = Math.min(...rgb(data, 640, 32, 32));
    expect(paper).toBeGreaterThan(245);
    expect(paper - Math.max(...rgb(data, 640, 320, 240))).toBeGreaterThanOrEqual((240 - shade) / 2);
  });
  it('retains a light filled region with the same colour cast as the surrounding paper', async () => {
    const data = image(640, 480, (x, y) => x >= 160 && x < 480 && y >= 80 && y < 400 ? [220, 205, 223, 255] : [240, 224, 243, 255]);
    await normalizePrintPaperPixels(data, 640, 480, signal());
    expect(Math.min(...rgb(data, 640, 32, 32)) - Math.max(...rgb(data, 640, 320, 240))).toBeGreaterThanOrEqual(5);
  });
  it('stops after cancellation during pixel writes rather than publishing a completed correction', async () => {
    const controller = new AbortController(), data = image(256, 256, () => [210, 166, 218, 255]);
    const pending = normalizePrintPaperPixels(data, 256, 256, controller.signal), rejected = expect(pending).rejects.toThrow();
    for (let tick = 0; tick < 8 && data[0] === 210; tick++) await new Promise<void>(resolve => setTimeout(resolve, 0));
    const started = data[0] !== 210, tailUntouched = data[200 * 256 * 4] === 210;
    controller.abort(); await rejected;
    expect(started).toBe(true); expect(tailUntouched).toBe(true);
    const stopped = data.slice(); await new Promise<void>(resolve => setTimeout(resolve, 0)); expect(data).toEqual(stopped);
  });
  it('retains faint dashed strokes on tinted paper without changing alpha', async () => {
    const data = image(256, 128, (x, y) => y >= 60 && y <= 62 && x % 24 < 12 ? [190, 146, 198, 203] : [210, 166, 218, 203]);
    await normalizePrintPaperPixels(data, 256, 128, signal());
    expect((data[(55 * 256 + 100) * 4] ?? 0) - (data[(61 * 256 + 100) * 4] ?? 0)).toBeGreaterThan(15);
    for (let p = 3; p < data.length; p += 4) expect(data[p]).toBe(203);
  });
  it('preserves saturated diagram colours exactly rather than treating them as paper', async () => {
    const colours: Pixel[] = [[220, 30, 50, 255], [20, 180, 40, 255], [30, 70, 210, 255]];
    const data = image(256, 128, (x, y) => y >= 48 && y < 80 ? colours[Math.floor(x / 90)] ?? colours[2] ?? [0, 0, 0, 255] : [210, 166, 218, 255]); const before = data.slice();
    await normalizePrintPaperPixels(data, 256, 128, signal());
    for (const x of [40, 130, 220]) expect(rgb(data, 256, x, 64)).toEqual(rgb(before, 256, x, 64));
  });
  it('leaves fully transparent pixels and a completely coloured image untouched', async () => {
    const transparent = image(64, 64, () => [180, 180, 180, 0]); const before = transparent.slice();
    await normalizePrintPaperPixels(transparent, 64, 64, signal()); expect(transparent).toEqual(before);
    const colour = image(64, 64, () => [30, 70, 210, 255]); const original = colour.slice();
    await normalizePrintPaperPixels(colour, 64, 64, signal()); expect(colour).toEqual(original);
  });
  it('honours pre-abort and cancellation during processing', async () => {
    const controller = new AbortController(); controller.abort(); const small = image(8, 8, () => [220, 220, 220, 255]); const before = small.slice();
    await expect(normalizePrintPaperPixels(small, 8, 8, controller.signal)).rejects.toThrow(); expect(small).toEqual(before);
    const active = new AbortController(); const data = image(256, 256, () => [210, 166, 218, 255]);
    const pending = normalizePrintPaperPixels(data, 256, 256, active.signal); setTimeout(() => active.abort(), 0); await expect(pending).rejects.toThrow();
  });
  it('rejects malformed and oversized pixel buffers', async () => {
    for (const [width, height] of [[0, 1], [2, 2], [1.5, 1], [5000, 5000]]) await expect(normalizePrintPaperPixels(new Uint8ClampedArray(4), width ?? 0, height ?? 0, signal())).rejects.toThrow();
  });
});
