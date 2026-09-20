/** Ignore fractional layout noise; permit real expansion and contraction. */
export function stableDocumentHeight(previous: number, value: number): number {
  if (!Number.isFinite(value) || value <= 0 || value > 120000) return previous;
  const next = Math.max(80, Math.ceil(value));
  return Math.abs(next - previous) < 2 ? previous : next;
}
