// Proposal (isolated candidate): .agents/notes/proposed/storage/2026-10-17-pdf-render-lifecycle.md
import { ExportTaskFailure } from '@solveflow/client/local';
import type { PdfRenderLifecycle } from './pdf-render-lifecycle.types';
export type { PdfRenderLifecycle } from './pdf-render-lifecycle.types';

interface DocumentOwner {
  doc: Document;
  root: Element;
  frame: HTMLIFrameElement;
  parent: Document;
  ancestors: Set<Node>;
  observer: MutationObserver;
  invalid: boolean;
}


/** A lease belongs to one render, never to whichever export happens to be newest. */
export function createPdfRenderLifecycle(source: Document, check: () => void): PdfRenderLifecycle {
  let closed = false;
  const cleanups = new Set<() => void>();
  let cloneBound = false;
  let cloneComplete = false;
  const owners: DocumentOwner[] = [];
  let cloneStart = 0;
  const invalid = () => new ExportTaskFailure('PDF 绘制文档已失效，请重试。');
  const sourceRoot = source.documentElement;
  if (!sourceRoot) throw invalid();

  const capture = (doc: Document) => {
    let current = doc;
    const seen = new Set<Document>();
    for (let depth = 0; depth < 16; depth++) {
      if (seen.has(current)) throw invalid();
      seen.add(current);
      const target = current.defaultView;
      const root = current.documentElement;
      if (!target || target.document !== current || !root) throw invalid();
      const element = target.frameElement;
      if (!element) return;
      const parent = element.ownerDocument;
      const Frame = parent.defaultView?.HTMLIFrameElement;
      const Observer = parent.defaultView?.MutationObserver;
      if (!Frame || !(element instanceof Frame) || !Observer || !element.isConnected || element.contentDocument !== current) throw invalid();
      // Reuse ownership checks, but keep walking to preserve the depth limit.
      if (owners.some(owner => owner.doc === current)) { current = parent; continue; }
      const ancestors = new Set<Node>();
      for (let node: Node | null = element; node; node = node.parentNode) ancestors.add(node);
      let owner: DocumentOwner;
      const observer = new Observer(records => {
        if (records.some(record => [...record.removedNodes].some(node => ancestors.has(node)))) owner.invalid = true;
      });
      owner = { doc: current, root, frame: element, parent, ancestors, observer, invalid: false };
      owners.push(owner);
      // Only removal of an ancestry edge can invalidate this ownership chain.
      for (const ancestor of ancestors) {
        if (ancestor !== element) owner.observer.observe(ancestor, { childList: true });
      }
      current = parent;
    }
    throw invalid();
  };
  const release = (from: number) => {
    for (const owner of owners.splice(from)) owner.observer.disconnect();
  };
  const assertActive = () => {
    check();
    if (closed || source.defaultView?.document !== source || source.documentElement !== sourceRoot) throw invalid();
    for (const owner of owners) {
      const records = owner.observer.takeRecords();
      if (records.some(record => [...record.removedNodes].some(node => owner.ancestors.has(node)))) owner.invalid = true;
      if (owner.invalid || !owner.frame.isConnected || owner.frame.ownerDocument !== owner.parent || owner.parent.defaultView?.document !== owner.parent || owner.frame.contentDocument !== owner.doc || owner.doc.documentElement !== owner.root) throw invalid();
      // Read after queue draining and the preceding short circuits, not before them.
      const view = owner.doc.defaultView;
      if (view?.document !== owner.doc || view?.frameElement !== owner.frame) throw invalid();
    }
  };
  try { capture(source); } catch (error) { release(0); throw error; }
  return {
    assertActive,
    bindClone(doc) {
      assertActive();
      if (cloneBound || doc === source || cloneComplete) throw invalid();
      cloneStart = owners.length;
      try {
        capture(doc);
        if (!owners.slice(cloneStart).some(owner => owner.parent === source)) throw invalid();
        cloneBound = true; assertActive();
      }
      catch (error) { release(cloneStart); throw error; }
    },
    completeRendering() {
      // html2canvas removes its clone synchronously before resolving the canvas.
      if (closed || !cloneBound || cloneComplete) throw invalid();
      release(cloneStart); cloneComplete = true; assertActive();
    },
    onDispose(cleanup) {
      assertActive(); cleanups.add(cleanup);
      return () => { cleanups.delete(cleanup); };
    },
    dispose() {
      closed = true; release(0);
      const pending = [...cleanups]; cleanups.clear();
      let failure: { error: unknown } | undefined;
      for (const cleanup of pending) { try { cleanup(); } catch (error) { failure ??= { error }; } }
      if (failure) throw failure.error;
    },
  };
}

export async function yieldPdfRender(lifecycle: Pick<PdfRenderLifecycle, 'assertActive'>): Promise<void> {
  lifecycle.assertActive();
  const scheduler: unknown = Reflect.get(globalThis, 'scheduler');
  if (typeof scheduler === 'object' && scheduler !== null && 'yield' in scheduler && typeof scheduler.yield === 'function') await scheduler.yield();
  else await new Promise<void>(resolve => setTimeout(resolve, 0));
  lifecycle.assertActive();
}
