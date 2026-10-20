// Decision: .agents/notes/implemented/storage/2026-10-14-persistent-paper-preparation.md
/** Bounded unsharp masking preserves colour, faint strokes and alpha; it adds no synthetic detail. */
export async function sharpenPrintPixels(pixels: Uint8ClampedArray, width: number, height: number, signal: AbortSignal): Promise<void> {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width * height > 16_000_000 || pixels.length !== width * height * 4) throw new Error('题图像素尺寸无效。');
  signal.throwIfAborted(); const original = pixels.slice(); const weights = [1, 2, 1];
  for (let y = 0; y < height; y++) {
    if (y % 64 === 0) { await new Promise<void>(resolve => setTimeout(resolve, 0)); signal.throwIfAborted(); }
    for (let x = 0; x < width; x++) for (let channel = 0; channel < 3; channel++) {
      let blurred = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const xx = Math.max(0, Math.min(width - 1, x + dx)); const yy = Math.max(0, Math.min(height - 1, y + dy));
        blurred += (original[(yy * width + xx) * 4 + channel] ?? 0) * (weights[dx + 1] ?? 0) * (weights[dy + 1] ?? 0);
      }
      const index = (y * width + x) * 4 + channel; const value = original[index] ?? 0; const difference = value - blurred / 16;
      if (Math.abs(difference) >= 2) pixels[index] = value + Math.max(-12, Math.min(12, difference * .4));
    }
  }
  signal.throwIfAborted();
}
