import { expect, it } from 'vitest';
import { historyGestureIntent, historyGestureOpen } from './history-gesture';
it('accepts diagonal horizontal intent without stealing vertical scrolling or treating small jitter as a swipe', () => {
  expect(historyGestureIntent(-8, 3)).toBe('horizontal');
  expect(historyGestureIntent(1, 10)).toBe('pending');
  expect(historyGestureIntent(3, 16)).toBe('vertical');
  expect(historyGestureIntent(-3, 2)).toBe('pending');
});
it('opens on a short fast flick and closes symmetrically, while slow tiny movement keeps its original state', () => {
  expect(historyGestureOpen(false, -18, 40)).toBe(true);
  expect(historyGestureOpen(false, -18, 400)).toBe(false);
  expect(historyGestureOpen(false, -32, 800)).toBe(true);
  expect(historyGestureOpen(true, 18, 40)).toBe(false);
  expect(historyGestureOpen(true, 18, 400)).toBe(true);
  expect(historyGestureOpen(true, 32, 800)).toBe(false);
  expect(historyGestureOpen(false, 32, 50)).toBe(false);
});
it('locks short diagonal swipes early, tolerates vertical drift and accepts a deliberate 20px slide', () => {
  expect(historyGestureIntent(-7, 7)).toBe('horizontal');
  expect(historyGestureIntent(-10, 11)).toBe('horizontal');
  expect(historyGestureIntent(2, 13)).toBe('vertical');
  expect(historyGestureOpen(false, -21, 500)).toBe(true);
});
