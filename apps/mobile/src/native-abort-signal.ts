interface NativeAbortSignal {
  readonly aborted: boolean;
  readonly reason?: unknown;
  throwIfAborted?: () => void;
}

// React Native's abort-controller implements cancellation without this method.
// Install it once so shared task code keeps the same cancellation checks.
export function installNativeAbortSignal(prototype: NativeAbortSignal) {
  if (typeof prototype.throwIfAborted === 'function') return;
  Object.defineProperty(prototype, 'throwIfAborted', {
    configurable: true,
    writable: true,
    value: function (this: NativeAbortSignal) {
      if (!this.aborted) return;
      if (this.reason !== undefined) throw this.reason;
      const cause = new Error('操作已取消。');
      cause.name = 'AbortError';
      throw cause;
    },
  });
}
