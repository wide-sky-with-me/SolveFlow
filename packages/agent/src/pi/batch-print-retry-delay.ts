import { SolvePhaseError } from '../orchestration/solve.js';

export function waitForPrintRetry(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(new SolvePhaseError('CANCELLED')); return; }
    const cleanup = () => { clearTimeout(timer); signal.removeEventListener('abort', abort); };
    const abort = () => { cleanup(); reject(new SolvePhaseError('CANCELLED')); };
    const timer = setTimeout(() => { cleanup(); resolve(); }, ms);
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
  });
}
