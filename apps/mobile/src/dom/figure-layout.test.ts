import { describe, expect, it } from 'vitest';
import { niceTicks, placeLabels } from './figure-layout';
describe('curriculum figure layout', () => {
  it('uses rounded increments without changing the mathematical domain', () => {
    expect(niceTicks(-0.2, 2.2)).toEqual([0, 0.5, 1, 1.5, 2]);
    expect(niceTicks(-1.3, 4.3)).toEqual([-1, 0, 1, 2, 3, 4]);
    expect(niceTicks(0, 0.12)).toEqual([0, .02, .04, .06, .08, .1, .12]);
    expect(niceTicks(-10000, 10000).length).toBeLessThanOrEqual(12);
  });
  it('keeps edge and nearby point labels in bounds and separate', () => {
    const labels = placeLabels([{ x: 300, y: 20, text: 'A' }, { x: 298, y: 21, text: 'B' }, { x: 0, y: 200, text: 'C' }], { left: 0, top: 0, right: 320, bottom: 220 });
    expect(labels).toHaveLength(3);
    for (const label of labels) { expect(label.x).toBeGreaterThanOrEqual(0); expect(label.y).toBeGreaterThanOrEqual(0); expect(label.x + label.width).toBeLessThanOrEqual(320); expect(label.y + label.height).toBeLessThanOrEqual(220); }
    const a = labels[0]!; const b = labels[1]!;
    expect(a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y).toBe(true);
  });
});
