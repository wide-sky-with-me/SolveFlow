import { useEffect, useRef } from 'react';
import { questionSwipe } from '../components/question-swipe';
/** WebView gestures stay in the document so formula/figure pans never turn pages. */
export function useQuestionSwipe(onSwipe?: (direction: number) => Promise<void>) {
  const root = useRef<HTMLElement>(null);
  useEffect(() => {
    const node = root.current; if (!onSwipe || !node) return;
    let start: { x: number; y: number; time: number } | null = null;
    const down = (event: TouchEvent) => {
      const target = event.target;
      if (event.touches.length !== 1 || !(target instanceof Element) || target.closest('button, a, input, textarea, summary, .figure-viewport, .original-crop-viewport, .formula-shell, .katex-display, .math-inline, .math-block, .answer-table-scroll')) { start = null; return; }
      const touch = event.touches[0]!; start = { x: touch.clientX, y: touch.clientY, time: Date.now() };
    };
    const up = (event: TouchEvent) => {
      const touch = event.changedTouches[0]; const origin = start; start = null;
      if (!origin || !touch || document.getSelection()?.toString()) return;
      const direction = questionSwipe(touch.clientX - origin.x, touch.clientY - origin.y, Date.now() - origin.time);
      if (direction) void onSwipe(direction);
    };
    const cancel = () => { start = null; };
    node.addEventListener('touchstart', down, { passive: true }); node.addEventListener('touchend', up, { passive: true }); node.addEventListener('touchcancel', cancel);
    return () => { node.removeEventListener('touchstart', down); node.removeEventListener('touchend', up); node.removeEventListener('touchcancel', cancel); };
  }, [onSwipe]);
  return root;
}
