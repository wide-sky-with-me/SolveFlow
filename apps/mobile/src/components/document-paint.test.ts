import { afterEach, beforeEach, expect, test, vi } from 'vitest';
const native = vi.hoisted(() => ({
  Platform: { OS: 'android' },
  NativeModules: { SolveDocument: { waitForPaint: vi.fn<(tag: number, id: number) => Promise<unknown>>(), cancel: vi.fn<(id: number) => void>() } },
}));
vi.mock('react-native', () => native);
import { waitForDocumentPaint } from './document-paint';

beforeEach(() => {
  vi.useFakeTimers(); vi.clearAllMocks(); native.Platform.OS = 'android';
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => setTimeout(() => callback(0), 16));
  vi.stubGlobal('cancelAnimationFrame', clearTimeout);
});
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

test('native frames alone do not expose a WebView before its compositor is ready', async () => {
  const draw = Promise.withResolvers<void>(); native.NativeModules.SolveDocument.waitForPaint.mockReturnValue(draw.promise);
  const ready = vi.fn(); const failed = vi.fn(); const cancel = waitForDocumentPaint(41, ready, failed);
  await vi.advanceTimersByTimeAsync(32);
  expect(native.NativeModules.SolveDocument.waitForPaint).toHaveBeenCalledWith(41, expect.any(Number));
  expect(ready).not.toHaveBeenCalled(); draw.resolve(); await vi.runAllTimersAsync();
  expect(ready).toHaveBeenCalledOnce(); expect(failed).not.toHaveBeenCalled(); cancel();
});

test('unmount cancels native work and ignores its late completion', async () => {
  const draw = Promise.withResolvers<void>(); native.NativeModules.SolveDocument.waitForPaint.mockReturnValue(draw.promise);
  const ready = vi.fn(); const failed = vi.fn(); const cancel = waitForDocumentPaint(43, ready, failed);
  await vi.advanceTimersByTimeAsync(32); const id = native.NativeModules.SolveDocument.waitForPaint.mock.calls[0]![1];
  cancel(); expect(native.NativeModules.SolveDocument.cancel).toHaveBeenCalledWith(id);
  draw.resolve(); await vi.runAllTimersAsync(); expect(ready).not.toHaveBeenCalled(); expect(failed).not.toHaveBeenCalled();
});

test('native timeout or unavailable view uses the existing visible fallback', async () => {
  native.NativeModules.SolveDocument.waitForPaint.mockRejectedValue(new Error('DOCUMENT_PAINT_TIMEOUT'));
  const ready = vi.fn(); const failed = vi.fn(); const cancel = waitForDocumentPaint(45, ready, failed);
  await vi.advanceTimersByTimeAsync(32); expect(ready).not.toHaveBeenCalled(); expect(failed).toHaveBeenCalledOnce(); cancel();
});

test('web uses animation frames without requiring an Android module', async () => {
  native.Platform.OS = 'web'; const ready = vi.fn(); const failed = vi.fn(); const cancel = waitForDocumentPaint(null, ready, failed);
  await vi.advanceTimersByTimeAsync(32); expect(ready).toHaveBeenCalledOnce(); expect(failed).not.toHaveBeenCalled();
  expect(native.NativeModules.SolveDocument.waitForPaint).not.toHaveBeenCalled(); cancel();
});


test('closing before the layout frames prevents a native request entirely', async () => {
  const ready = vi.fn(); const failed = vi.fn(); const cancel = waitForDocumentPaint(47, ready, failed);
  cancel(); await vi.advanceTimersByTimeAsync(32);
  expect(native.NativeModules.SolveDocument.waitForPaint).not.toHaveBeenCalled();
  expect(ready).not.toHaveBeenCalled(); expect(failed).not.toHaveBeenCalled();
});
