// Decision: .agents/notes/implemented/agent/2026-11-09-model-progress-timeouts.md
import { MAX_DEVICE_FIRST_CONTENT_MS, MAX_DEVICE_STREAM_IDLE_MS } from '@solveflow/contracts/agent';

export type ProgressTimeout = 'first_content_timeout' | 'stream_idle';
type Timer = (callback: () => void, ms: number) => () => void;

/** One network request at a time. Tool execution and admission wait have no idle timer. */
export function requestProgress(schedule: Timer, timeout: (reason: ProgressTimeout) => void) {
  let generation = 0, dispatched = false, clear = () => {};
  const stop = () => { generation++; dispatched = false; clear(); clear = () => {}; };
  const arm = (ms: number, reason: ProgressTimeout) => {
    clear();
    const owner = ++generation;
    clear = schedule(() => {
      if (owner !== generation || !dispatched) return;
      stop(); timeout(reason);
    }, ms);
  };
  return {
    prepare() {
      stop(); const owner = generation;
      return () => {
        if (owner !== generation || dispatched) return;
        dispatched = true; arm(MAX_DEVICE_FIRST_CONTENT_MS, 'first_content_timeout');
      };
    },
    progress(watchIdle = true) {
      if (!dispatched) return;
      if (watchIdle) arm(MAX_DEVICE_STREAM_IDLE_MS, 'stream_idle');
      else { generation++; clear(); clear = () => {}; }
    },
    stop,
  };
}
