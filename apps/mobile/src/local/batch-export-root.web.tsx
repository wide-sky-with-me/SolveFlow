// Decision: .agents/notes/implemented/storage/2026-10-16-pdf-concurrent-mount.md
import { startTransition, useEffect, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { ExportTaskFailure } from '@solveflow/client/local';

function Committed({ children, ready }: { children: ReactNode; ready: () => void }) {
  // Child formula effects run before this acknowledgement; no extra DOM wrapper.
  useEffect(ready, [ready]);
  return children;
}
interface Pending { resolve: (element: Element) => void; reject: (error: unknown) => void }

export function createBatchExportRoot(signal: AbortSignal) {
  signal.throwIfAborted();
  const container = document.createElement('div');
  container.style.cssText = 'position:fixed;left:-10000px;top:0;width:800px;pointer-events:none';
  container.setAttribute('aria-hidden', 'true'); container.inert = true; document.body.append(container);
  const controller = new AbortController();
  let pending: Pending | undefined;
  let phase: 'active' | 'disposing' | 'disposed' = 'active';
  let cleanupFailed = false;
  const failure = () => new ExportTaskFailure('PDF 文档渲染失败，请重试。');
  const failed = () => {
    if (phase === 'disposing') cleanupFailed = true;
    else if (phase === 'active') controller.abort(failure());
  };
  const root = (() => {
    try { return createRoot(container, { onUncaughtError: failed }); }
    catch { container.remove(); signal.throwIfAborted(); throw failure(); }
  })();
  const stopped = () => { const entry = pending; pending = undefined; entry?.reject(controller.signal.reason); };
  const aborted = () => controller.abort(signal.reason);
  controller.signal.addEventListener('abort', stopped, { once: true });
  signal.addEventListener('abort', aborted, { once: true });
  if (signal.aborted) aborted();
  return {
    signal: controller.signal,
    async render(children: ReactNode): Promise<Element> {
      controller.signal.throwIfAborted();
      if (phase !== 'active') throw new ExportTaskFailure('PDF 文档渲染已结束。');
      if (pending) throw new ExportTaskFailure('PDF 文档仍在渲染，请稍后重试。');
      const element = await new Promise<Element>((resolve, reject) => {
        const entry = { resolve, reject }; pending = entry;
        const ready = () => {
          if (phase !== 'active' || pending !== entry || controller.signal.aborted) return;
          const value = container.firstElementChild;
          if (!value) { failed(); return; }
          pending = undefined; resolve(value);
        };
        try { startTransition(() => root.render(<Committed ready={ready}>{children}</Committed>)); }
        catch { failed(); }
      });
      controller.signal.throwIfAborted();
      return element;
    },
    dispose() {
      if (phase !== 'active') return;
      phase = 'disposing';
      signal.removeEventListener('abort', aborted);
      controller.abort(new ExportTaskFailure('PDF 文档渲染已结束。'));
      controller.signal.removeEventListener('abort', stopped);
      try { root.unmount(); if (cleanupFailed) throw failure(); }
      catch { throw failure(); }
      finally { phase = 'disposed'; container.remove(); }
    },
  };
}
