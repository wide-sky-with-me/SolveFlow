/** Finger left = previous, finger right = next, per product preference. */
export function questionSwipe(dx: number, dy: number, elapsed: number): -1 | 0 | 1 {
  if (elapsed > 900 || Math.abs(dx) < 64 || Math.abs(dx) < Math.abs(dy) * 1.8) return 0;
  return dx < 0 ? -1 : 1;
}
