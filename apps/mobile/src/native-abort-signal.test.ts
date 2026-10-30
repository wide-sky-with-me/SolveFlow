import { expect, it, vi } from 'vitest';
import { installNativeAbortSignal } from './native-abort-signal';

interface SignalShape { aborted: boolean; reason?: unknown; throwIfAborted?: () => void }

it('checks each native signal instance when its prototype lacks throwIfAborted', () => {
  class Signal { constructor(public aborted = false, public reason?: unknown) {} }
  installNativeAbortSignal(Signal.prototype);
  const active: SignalShape = new Signal(); const stopped: SignalShape = new Signal(true);
  expect(active.throwIfAborted).toBeTypeOf('function');
  expect(() => active.throwIfAborted?.()).not.toThrow();
  let failure: unknown;
  try { stopped.throwIfAborted?.(); } catch (cause) { failure = cause; }
  expect(failure).toBeInstanceOf(Error);
  expect(failure).toMatchObject({ name: 'AbortError', message: '操作已取消。' });
  expect(Object.getOwnPropertyDescriptor(Signal.prototype, 'throwIfAborted')?.enumerable).toBe(false);
});

it('preserves an available cancellation reason by identity', () => {
  const reason = new Error('original cancellation');
  const signal: SignalShape = { aborted: true, reason };
  installNativeAbortSignal(signal);
  let failure: unknown;
  try { signal.throwIfAborted?.(); } catch (cause) { failure = cause; }
  expect(failure).toBe(reason);
});

it('does not replace an existing implementation and is safe to initialize twice', () => {
  const existing = vi.fn(); const signal = { aborted: false, throwIfAborted: existing };
  installNativeAbortSignal(signal); installNativeAbortSignal(signal);
  expect(signal.throwIfAborted).toBe(existing);
  signal.throwIfAborted(); expect(existing).toHaveBeenCalledTimes(1);
  const legacy: SignalShape = { aborted: false };
  installNativeAbortSignal(legacy); const installed = legacy.throwIfAborted;
  installNativeAbortSignal(legacy); expect(legacy.throwIfAborted).toBe(installed);
});
