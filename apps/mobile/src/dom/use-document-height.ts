import { useEffect, useRef, type RefObject } from 'react';
import { stableDocumentHeight } from './document-height';

/** Measure content, never viewport height. Width remains owned by RN layout. */
export function useDocumentHeight(root: RefObject<HTMLElement | null>, onHeight?: (height: number) => Promise<void>) {
  const send = useRef(onHeight); send.current = onHeight;
  useEffect(() => {
    const node = root.current; if (!node || !send.current) return;
    let alive = true; let previous = 0; let timer: ReturnType<typeof setTimeout> | undefined;
    const measure = () => {
      timer = undefined; if (!alive) return;
      const next = stableDocumentHeight(previous, node.getBoundingClientRect().height);
      if (next !== previous) { previous = next; void send.current?.(next); }
    };
    const schedule = () => { if (alive && !timer) timer = setTimeout(measure, 50); };
    const observer = new ResizeObserver(schedule); observer.observe(node);
    void document.fonts.ready.then(schedule); schedule();
    return () => { alive = false; observer.disconnect(); if (timer) clearTimeout(timer); };
  }, [root]);
}
