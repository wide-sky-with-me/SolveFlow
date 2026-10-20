// Decision: .agents/notes/implemented/storage/2026-10-15-explicit-print-enhancement.md
type PaperPoint = readonly [number, number, number];
const light = (point: PaperPoint) => (point[0] + point[1] + point[2]) / 3;
const clamp = (value: number) => Math.max(0, Math.min(1, value));

/** Estimate paper before geometric padding; coloured marks and alpha remain intact. */
export async function normalizePrintPaperPixels(pixels: Uint8ClampedArray, width: number, height: number, signal: AbortSignal): Promise<void> {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width * height > 16_000_000 || pixels.length !== width * height * 4) throw new Error('题图像素尺寸无效。');
  signal.throwIfAborted(); const size = 64; const columns = Math.ceil(width / size); const rows = Math.ceil(height / size);
  const measured: (PaperPoint | undefined)[] = new Array<PaperPoint | undefined>(columns * rows); const candidates: PaperPoint[] = [];
  for (let row = 0; row < rows; row++) {
    if (row % 4 === 0) { await new Promise<void>(resolve => setTimeout(resolve, 0)); signal.throwIfAborted(); }
    for (let column = 0; column < columns; column++) {
      const samples: PaperPoint[] = [];
      for (let y = row * size; y < Math.min(height, (row + 1) * size); y += 4) for (let x = column * size; x < Math.min(width, (column + 1) * size); x += 4) {
        const p = (y * width + x) * 4; const point: PaperPoint = [pixels[p] ?? 0, pixels[p + 1] ?? 0, pixels[p + 2] ?? 0];
        if ((pixels[p + 3] ?? 0) >= 128 && Math.min(...point) >= 85 && Math.max(...point) - Math.min(...point) < 85) samples.push(point);
      }
      samples.sort((a, b) => light(a) - light(b)); const point = samples[Math.floor(samples.length * .9)];
      if (point) { measured[row * columns + column] = point; candidates.push(point); }
    }
  }
  if (!candidates.length) return;
  candidates.sort((a, b) => light(a) - light(b)); const fallback = candidates[Math.floor(candidates.length * .9)]; if (!fallback) return;
  const background = new Float32Array(columns * rows * 3);
  for (let row = 0; row < rows; row++) for (let column = 0; column < columns; column++) {
    const local = measured[row * columns + column] ?? fallback; let upper = local;
    for (let yy = Math.max(0, row - 1); yy <= Math.min(rows - 1, row + 1); yy++) for (let xx = Math.max(0, column - 1); xx <= Math.min(columns - 1, column + 1); xx++) {
      const point = measured[yy * columns + xx]; if (point && light(point) > light(upper)) upper = point;
    }
    // A filled grey region must not redefine the paper white point and disappear.
    const mix = clamp((light(upper) - light(local) - 20) / 30);
    const component = (c: number) => (local[c] ?? 255) * (1 - mix) + (upper[c] ?? 255) * mix;
    const point: PaperPoint = [component(0), component(1), component(2)];
    // Decision: .agents/notes/implemented/storage/2026-10-17-print-paper-contrast.md
    // Preserve pale fills without mistaking a change in paper colour cast for grey ink.
    const ratios = point.map((value, channel) => value / Math.max(85, fallback[channel] ?? 255));
    const neutral = clamp((.12 - (Math.max(...ratios) - Math.min(...ratios))) / .08);
    const reference = Math.max(light(fallback) - 40, light(point) + (light(fallback) - light(point)) * neutral / 2);
    const minimum = Math.max(1, reference / Math.max(85, light(point)));
    for (let c = 0; c < 3; c++) background[(row * columns + column) * 3 + c] = Math.min(255, (point[c] ?? 255) * minimum);
  }
  for (let y = 0; y < height; y++) {
    if (y % 64 === 0) { await new Promise<void>(resolve => setTimeout(resolve, 0)); signal.throwIfAborted(); }
    const gy = Math.max(0, Math.min(rows - 1, y / size - .5)); const y0 = Math.floor(gy); const y1 = Math.min(rows - 1, y0 + 1); const fy = gy - y0;
    for (let x = 0; x < width; x++) {
      const p = (y * width + x) * 4; if (!pixels[p + 3]) continue;
      const gx = Math.max(0, Math.min(columns - 1, x / size - .5)); const x0 = Math.floor(gx); const x1 = Math.min(columns - 1, x0 + 1); const fx = gx - x0;
      const ratios: number[] = [];
      for (let c = 0; c < 3; c++) {
        const top = (background[(y0 * columns + x0) * 3 + c] ?? 255) * (1 - fx) + (background[(y0 * columns + x1) * 3 + c] ?? 255) * fx;
        const bottom = (background[(y1 * columns + x0) * 3 + c] ?? 255) * (1 - fx) + (background[(y1 * columns + x1) * 3 + c] ?? 255) * fx;
        ratios.push((pixels[p + c] ?? 0) / Math.max(85, top * (1 - fy) + bottom * fy));
      }
      // Measure chroma relative to the paper, without an abrupt raw-RGB cutoff.
      const strength = clamp((.12 - (Math.max(...ratios) - Math.min(...ratios))) / .08);
      for (let c = 0; c < 3; c++) pixels[p + c] = (pixels[p + c] ?? 0) * (1 - strength) + Math.min(255, (ratios[c] ?? 0) * 255) * strength;
    }
  }
  signal.throwIfAborted();
}
