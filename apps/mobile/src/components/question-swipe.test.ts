import { describe, expect, it } from 'vitest';
import { questionSwipe } from './question-swipe';
describe('question swipe intent', () => {
  it('uses the requested left previous / right next direction', () => {
    expect(questionSwipe(-100, 8, 300)).toBe(-1);
    expect(questionSwipe(100, -8, 300)).toBe(1);
  });
  it('ignores taps, vertical reading, diagonal motion and long presses', () => {
    for (const [x, y, ms] of [[15, 0, 100], [80, 100, 300], [80, 50, 300], [100, 0, 1500]]) expect(questionSwipe(x!, y!, ms!)).toBe(0);
  });
});
