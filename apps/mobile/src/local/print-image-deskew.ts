// Decision: .agents/notes/implemented/storage/2026-10-15-explicit-print-deskew.md
type InkPoint = readonly [number, number];

/** Estimate paper rotation from isolated text ink, never from the longest diagram line. */
export async function estimatePrintRotation(points: readonly InkPoint[], width: number, height: number, signal: AbortSignal): Promise<number> {
  signal.throwIfAborted();
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width * height > 1_000_000 || points.length > width * height) throw new Error('Invalid deskew sample.');
  if (points.length < 80) return 0;
  const stride = Math.max(1, Math.ceil(points.length / 16_000)); const sample = points.filter((_, index) => index % stride === 0);
  const scores: { angle: number; value: number }[] = []; const offset = Math.ceil(width / 2) + 1;
  for (let step = -60; step <= 60; step++) {
    if (step % 8 === 0) { await new Promise<void>(resolve => setTimeout(resolve, 0)); signal.throwIfAborted(); }
    const angle = step / 4, radians = angle * Math.PI / 180, sin = Math.sin(radians), cos = Math.cos(radians);
    const bins = new Float64Array(width + height + 4);
    for (const [x, y] of sample) {
      const position = y * cos + x * sin + offset, row = Math.floor(position), fraction = position - row;
      if (row >= 0 && row + 1 < bins.length) { bins[row] = (bins[row] ?? 0) + 1 - fraction; bins[row + 1] = (bins[row + 1] ?? 0) + fraction; }
    }
    scores.push({ angle, value: bins.reduce((sum, count) => sum + count * count, 0) });
  }
  signal.throwIfAborted();
  const best = scores.reduce((best, score) => score.value > best.value ? score : best);
  const baseline = scores.find(score => score.angle === 0)?.value ?? 0;
  const median = scores.map(score => score.value).sort((a, b) => a - b)[Math.floor(scores.length / 2)] ?? 0;
  // Weak or broad peaks are not evidence of photographic tilt.
  return Math.abs(best.angle) >= .5 && best.value > baseline * 1.04 && best.value > median * 1.12 ? best.angle : 0;
}
