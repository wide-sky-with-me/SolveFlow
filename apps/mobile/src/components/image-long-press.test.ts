import { afterEach, expect, it, vi } from 'vitest';
import { imageLongPress } from './image-long-press';
afterEach(() => vi.useRealTimers());
it('shares once after a hold and suppresses the following click', () => {
  vi.useFakeTimers(); const share = vi.fn(); const press = imageLongPress(share);
  press.start(20, 30); vi.advanceTimersByTime(499); expect(share).not.toHaveBeenCalled();
  vi.advanceTimersByTime(1); expect(share).toHaveBeenCalledOnce();
  expect(press.end()).toBe(true); vi.advanceTimersByTime(2000); expect(share).toHaveBeenCalledOnce();
  press.start(20, 30); expect(press.end()).toBe(false);
});
it('pan, pinch/cancel, early release and unmount cancel a pending share', () => {
  vi.useFakeTimers(); const share = vi.fn(); const press = imageLongPress(share);
  for (const stop of [() => press.move(40, 30), press.cancel, press.end]) {
    press.start(20, 30); vi.advanceTimersByTime(100); stop(); vi.advanceTimersByTime(600);
  }
  expect(share).not.toHaveBeenCalled();
});
