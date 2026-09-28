export function historyGestureIntent(dx: number, dy: number): 'pending' | 'horizontal' | 'vertical' {
  if (Math.abs(dx) >= 6 && Math.abs(dx) >= Math.abs(dy) * .85) return 'horizontal';
  if (Math.abs(dy) >= 12 && Math.abs(dy) > Math.abs(dx) * 1.5) return 'vertical';
  return 'pending';
}
export function historyGestureOpen(open: boolean, dx: number, elapsedMs: number): boolean {
  const distance = Math.abs(dx);
  if (distance >= 20 || (distance >= 12 && distance / Math.max(1, elapsedMs) >= .35)) return dx < 0;
  return open;
}
