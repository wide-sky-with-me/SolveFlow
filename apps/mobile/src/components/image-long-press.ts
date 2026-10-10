/** Shared by native responder and DOM thumbnails. Pinch/pan always cancels. */
export function imageLongPress(onLongPress: () => void) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let origin: { x: number; y: number } | null = null;
  let fired = false;
  function cancel() { clearTimeout(timer); timer = undefined; origin = null; }
  return {
    start(x: number, y: number) { cancel(); fired = false; origin = { x, y }; timer = setTimeout(() => { cancel(); fired = true; onLongPress(); }, 500); },
    move(x: number, y: number) { if (origin && Math.hypot(x - origin.x, y - origin.y) > 8) cancel(); },
    end() { cancel(); return fired; },
    cancel,
  };
}
