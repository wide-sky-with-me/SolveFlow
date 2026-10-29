// Decision: .agents/notes/implemented/storage/2026-10-16-pdf-admission-yield.md
const failure = () => new Error('导出暂未启动，请重试。');

export function waitForExportInitialization<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (result: { ok: true; value: T } | { ok: false; error: unknown }) => {
      if (settled) return;
      settled = true; signal?.removeEventListener('abort', abort);
      if (signal?.aborted) reject(signal.reason);
      else if (!result.ok) reject(result.error);
      else resolve(result.value);
    };
    const abort = () => finish({ ok: false, error: signal?.reason });
    // Consume late initialization/read failures even after this waiter cancels.
    promise.then(value => finish({ ok: true, value }), error => finish({ ok: false, error }));
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
