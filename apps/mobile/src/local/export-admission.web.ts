// Decision: .agents/notes/implemented/storage/2026-10-16-pdf-admission-yield.md
const failure = () => new Error('导出暂未启动，请重试。');

export function waitForExportInitialization(promise: Promise<void>, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error?: unknown, failed = false) => {
      if (settled) return;
      settled = true; signal?.removeEventListener('abort', abort);
      if (signal?.aborted) reject(signal.reason);
      else if (failed) reject(error);
      else resolve();
    };
    const abort = () => finish(signal?.reason, true);
    // Consume the shared initialization even if this waiter already cancelled.
    promise.then(() => finish(), error => finish(error, true));
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
  });
}

export async function yieldExportAdmission(signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted();
  let channel: MessageChannel | undefined;
  try {
    const ready = new Promise<void>((resolve, reject) => {
      try {
        channel = new MessageChannel();
        channel.port1.onmessage = () => resolve();
        channel.port1.onmessageerror = () => reject(failure());
        channel.port2.postMessage('solveflow-pdf-admission');
      } catch { reject(failure()); }
    });
    await waitForExportInitialization(ready, signal);
  } finally {
    try {
      if (channel) {
        channel.port1.onmessage = null; channel.port1.onmessageerror = null;
        try { channel.port1.close(); } finally { channel.port2.close(); }
      }
    } catch { throw failure(); }
    finally { signal?.throwIfAborted(); }
  }
}
