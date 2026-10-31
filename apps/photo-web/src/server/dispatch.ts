/** Operator-only, process-wide cap for an explicitly approved paid smoke test. */
export function photoDispatch(limit: number | null, transport: typeof fetch = fetch): typeof fetch {
  if (limit !== null && (!Number.isSafeInteger(limit) || limit < 1 || limit > 100)) throw new Error('Invalid dispatch limit.');
  let count = 0;
  return async (input, init) => {
    if (limit !== null) {
      if (count >= limit) throw new Error('PHOTO_DISPATCH_LIMIT');
      count++;
      console.info(JSON.stringify({ event: 'photo.dispatch', count, limit }));
    }
    return transport(input, init);
  };
}
