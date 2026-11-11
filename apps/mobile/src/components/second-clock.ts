type Foreground = { active: () => boolean; subscribe: (changed: () => void) => () => void };

/** Display-only clock. Elapsed time remains derived from the persisted timestamp. */
export function secondClock(tick: () => void, foreground: Foreground) {
  let interval: ReturnType<typeof setInterval> | undefined, disposed = false;
  const changed = () => {
    if (interval !== undefined) clearInterval(interval);
    interval = undefined;
    if (disposed || !foreground.active()) return;
    tick(); interval = setInterval(tick, 1000);
  };
  const unsubscribe = foreground.subscribe(changed);
  changed();
  return () => { disposed = true; if (interval !== undefined) clearInterval(interval); unsubscribe(); };
}
