/** Loading may finish while Android keeps the solver alive but pauses WebViews. */
export function startDocumentDeadline(onTimeout: () => void, lifecycle: {
  isActive: () => boolean;
  isVisible?: () => boolean;
  subscribe: (listener: () => void) => () => void;
}, milliseconds = 10000) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const update = () => {
    clearTimeout(timer); timer = undefined;
    if (lifecycle.isActive() && (lifecycle.isVisible?.() ?? true)) timer = setTimeout(onTimeout, milliseconds);
  };
  const unsubscribe = lifecycle.subscribe(update);
  update();
  return () => { unsubscribe(); clearTimeout(timer); };
}
