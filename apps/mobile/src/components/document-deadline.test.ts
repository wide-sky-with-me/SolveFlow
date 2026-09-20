import { afterEach, expect, it, vi } from 'vitest';
import { startDocumentDeadline } from './document-deadline';
afterEach(() => vi.useRealTimers());
it('does not fail a document while the native app is asleep and gives it time to resume', () => {
  vi.useFakeTimers(); let active = true; let changed = () => {};
  const failed = vi.fn(); const unsubscribe = vi.fn();
  const stop = startDocumentDeadline(failed, { isActive: () => active, subscribe: fn => { changed = fn; return unsubscribe; } });
  vi.advanceTimersByTime(9000); active = false; changed();
  vi.advanceTimersByTime(120000); expect(failed).not.toHaveBeenCalled();
  active = true; changed(); vi.advanceTimersByTime(9999); expect(failed).not.toHaveBeenCalled();
  vi.advanceTimersByTime(1); expect(failed).toHaveBeenCalledOnce(); stop(); expect(unsubscribe).toHaveBeenCalledOnce();
});
it('defers an initially background document and cancels its deadline after readiness/unmount', () => {
  vi.useFakeTimers(); let active = false; let changed = () => {};
  const failed = vi.fn(); const unsubscribe = vi.fn();
  const stop = startDocumentDeadline(failed, { isActive: () => active, subscribe: fn => { changed = fn; return unsubscribe; } });
  vi.advanceTimersByTime(120000); expect(failed).not.toHaveBeenCalled();
  active = true; changed(); vi.advanceTimersByTime(1000); stop();
  vi.advanceTimersByTime(20000); expect(failed).not.toHaveBeenCalled(); expect(unsubscribe).toHaveBeenCalledOnce();
});

it('does not time out hidden question pages while the app remains active', () => {
  vi.useFakeTimers(); let visible = false; let changed = () => {};
  const failed = vi.fn();
  const stop = startDocumentDeadline(failed, { isActive: () => true, isVisible: () => visible, subscribe: fn => { changed = fn; return () => {}; } });
  vi.advanceTimersByTime(30000); expect(failed).not.toHaveBeenCalled();
  visible = true; changed(); vi.advanceTimersByTime(9000); expect(failed).not.toHaveBeenCalled();
  visible = false; changed(); vi.advanceTimersByTime(30000); expect(failed).not.toHaveBeenCalled();
  visible = true; changed(); vi.advanceTimersByTime(10000); expect(failed).toHaveBeenCalledOnce(); stop();
});
