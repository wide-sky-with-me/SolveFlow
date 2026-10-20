import { PrintImagePerspectiveSchema, type PrintImagePerspective } from '@solveflow/contracts/local';

// Decision: .agents/notes/implemented/storage/2026-10-15-explicit-print-perspective.md
/** Sample the immutable source through a square-to-quadrilateral homography. */
export async function warpPrintPerspective(data: Uint8ClampedArray, width: number, height: number, value: PrintImagePerspective, signal: AbortSignal) {
  signal.throwIfAborted();
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width > 2048 || height > 2048 || data.length !== width * height * 4) throw new Error('图示像素尺寸无效。');
  const [a, b, c, d] = PrintImagePerspectiveSchema.parse(value);
  const dx1 = b.x - c.x, dx2 = d.x - c.x, dy1 = b.y - c.y, dy2 = d.y - c.y;
  const sx = a.x - b.x + c.x - d.x, sy = a.y - b.y + c.y - d.y;
  const determinant = dx1 * dy2 - dx2 * dy1;
  if (Math.abs(determinant) < .00001) throw new Error('四角范围过于接近，请重新圈定。');
  const g = (sx * dy2 - dx2 * sy) / determinant, h = (dx1 * sy - sx * dy1) / determinant;
  const ax = b.x - a.x + g * b.x, bx = d.x - a.x + h * d.x;
  const ay = b.y - a.y + g * b.y, by = d.y - a.y + h * d.y;
  const distance = (p: typeof a, q: typeof a) => Math.hypot((q.x - p.x) * (width - 1), (q.y - p.y) * (height - 1));
  const desiredWidth = Math.round(Math.max(distance(a, b), distance(d, c))) + 1;
  const desiredHeight = Math.round(Math.max(distance(a, d), distance(b, c))) + 1;
  const scale = Math.min(1, 2048 / Math.max(desiredWidth, desiredHeight));
  const w = Math.max(1, Math.min(2048, Math.round(desiredWidth * scale))), z = Math.max(1, Math.min(2048, Math.round(desiredHeight * scale)));
  const output = new Uint8ClampedArray(w * z * 4);
  const epsilonX = .000001 / Math.max(1, width - 1), epsilonY = .000001 / Math.max(1, height - 1);
  for (let y = 0; y < z; y++) {
    if (y % 32 === 0) { await new Promise<void>(resolve => setTimeout(resolve, 0)); signal.throwIfAborted(); }
    const v = z === 1 ? .5 : y / (z - 1);
    for (let x = 0; x < w; x++) {
      const u = w === 1 ? .5 : x / (w - 1), denominator = g * u + h * v + 1;
      const sourceX = (ax * u + bx * v + a.x) / denominator, sourceY = (ay * u + by * v + a.y) / denominator;
      // Test the unit domain before a singleton dimension erases its coordinates.
      if (sourceX < -epsilonX || sourceY < -epsilonY || sourceX > 1 + epsilonX || sourceY > 1 + epsilonY) { const at = (y * w + x) * 4; output.fill(255, at, at + 4); continue; }
      const px = Math.max(0, Math.min(width - 1, sourceX * (width - 1))), py = Math.max(0, Math.min(height - 1, sourceY * (height - 1)));
      const x0 = Math.floor(px), y0 = Math.floor(py), x1 = Math.min(width - 1, x0 + 1), y1 = Math.min(height - 1, y0 + 1);
      const fx = px - x0, fy = py - y0;
      for (let channel = 0; channel < 4; channel++) output[(y * w + x) * 4 + channel] =
        (data[(y0 * width + x0) * 4 + channel] ?? 0) * (1 - fx) * (1 - fy) +
        (data[(y0 * width + x1) * 4 + channel] ?? 0) * fx * (1 - fy) +
        (data[(y1 * width + x0) * 4 + channel] ?? 0) * (1 - fx) * fy +
        (data[(y1 * width + x1) * 4 + channel] ?? 0) * fx * fy;
    }
  }
  signal.throwIfAborted();
  return { data: output, width: w, height: z };
}
