// Decision: .agents/notes/implemented/architecture/2026-10-08-answer-checkpoint-queues.md
/** FIFO resource admission only; it does not own model/tool loops or replay work. */
export class PhaseQueue {
  private active = 0;
  private waiting: { signal: AbortSignal; abort: () => void; accept: (release: () => void) => void; reject: (error: Error) => void }[] = [];
  constructor(private concurrency: number, private readonly capacity: number) {}
  setConcurrency(concurrency: number) {
    if (this.active || this.waiting.length) throw new Error('PHASE_QUEUE_BUSY');
    this.concurrency = concurrency;
  }
  acquire(signal: AbortSignal): Promise<() => void> {
    if (signal.aborted) return Promise.reject(new Error('CANCELLED'));
    if (this.waiting.length >= this.capacity) return Promise.reject(new Error('PHASE_QUEUE_FULL'));
    return new Promise((accept, reject) => {
      const row = { signal, accept, reject, abort: () => {
        this.waiting = this.waiting.filter(item => item !== row);
        signal.removeEventListener('abort', row.abort); reject(new Error('CANCELLED')); this.pump();
      } };
      this.waiting.push(row); signal.addEventListener('abort', row.abort, { once: true }); this.pump();
    });
  }
  private pump() {
    while (this.active < this.concurrency && this.waiting.length) {
      const row = this.waiting.shift()!; row.signal.removeEventListener('abort', row.abort);
      if (row.signal.aborted) { row.reject(new Error('CANCELLED')); continue; }
      this.active++; let released = false;
      row.accept(() => { if (released) return; released = true; this.active--; this.pump(); });
    }
  }
}
