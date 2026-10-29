// Decision: .agents/notes/implemented/storage/2026-10-25-continuous-capture-buffer.md
import type { Photo } from './platform.types';

export const CAPTURE_BUFFER_LIMIT = 3;
type Prepared = { ok: true; photo: Photo } | { ok: false; cause: unknown };
interface Entry { raw: Photo; prepared: Promise<Prepared>; retryPrepare: boolean; released: boolean }
interface CaptureBufferOptions {
  prepare: (photo: Photo) => Promise<Photo>;
  persist: (photo: Photo) => Promise<string>;
  enqueue: (id: string) => Promise<void>;
  saved: (id: string) => void;
  release: (photo: Photo) => void;
  failed: (cause: unknown, saved: boolean) => void;
  changed: () => void;
}

/** Own at most three captures; only persistence and admission run in capture order. */
export class BatchCaptureBuffer {
  private entries: Entry[] = [];
  private running: Promise<void> | null = null;
  private closed = false;
  private paused = false;
  private clearing = false;
  private closing: Promise<void> | null = null;
  private cleanupFailure: { cause: unknown } | null = null;
  constructor(private readonly options: CaptureBufferOptions) {}
  get pending() { return this.entries.length; }
  get failed() { return this.paused; }
  get blocked() { return this.closed || this.clearing || this.paused || this.entries.length >= CAPTURE_BUFFER_LIMIT; }
  private prepare(photo: Photo): Promise<Prepared> {
    return Promise.resolve().then(() => this.options.prepare(photo)).then<Prepared, Prepared>(value => ({ ok: true, photo: value }), (cause: unknown) => ({ ok: false, cause }));
  }
  /** Rejection leaves ownership with the caller; acceptance transfers it to this buffer. */
  add(photo: Photo): boolean {
    if (this.blocked) return false;
    this.entries.push({ raw: photo, prepared: this.prepare(photo), retryPrepare: false, released: false }); this.options.changed(); this.pump(); return true;
  }
  private async release(entry: Entry) {
    const result = await entry.prepared;
    if (entry.released) return; entry.released = true;
    const photos = result.ok && result.photo !== entry.raw ? [result.photo, entry.raw] : [entry.raw]; const failures: unknown[] = [];
    for (const photo of photos) { try { this.options.release(photo); } catch (cause) { failures.push(cause); } }
    if (failures.length) throw new AggregateError(failures, '拍摄图片资源释放失败。');
  }
  private pump() {
    if (this.running || this.closed || this.clearing || this.paused || !this.entries.length) return;
    this.running = this.drain().finally(() => { this.running = null; this.options.changed(); this.pump(); });
  }
  private async drain() {
    while (!this.closed && !this.paused && this.entries.length) {
      const entry = this.entries[0]!; let saved = false;
      try {
        const result = await entry.prepared;
        if (this.closed) return;
        if (!result.ok) { entry.retryPrepare = true; throw result.cause; }
        const id = await this.options.persist(result.photo);
        saved = true; this.options.saved(id);
        // An accepted write may finish after close; that never authorizes a new model request.
        if (!this.closed) await this.options.enqueue(id);
      } catch (cause) {
        this.paused = true; this.options.failed(cause, saved);
      } finally {
        if (saved) {
          this.entries.shift();
          try { await this.release(entry); } catch (cause) { this.cleanupFailure ??= { cause }; this.paused = true; this.options.failed(cause, true); }
        }
        this.options.changed();
      }
    }
  }
  async flush(): Promise<boolean> { await this.running; return !this.paused && this.entries.length === 0; }
  async retry(): Promise<boolean> {
    if (this.closed || this.clearing) return false;
    await this.running;
    const entry = this.entries[0];
    if (entry?.retryPrepare) { entry.prepared = this.prepare(entry.raw); entry.retryPrepare = false; }
    this.paused = false; this.options.changed(); this.pump(); return this.flush();
  }
  private async releaseAll(entries: Entry[]) {
    const results = await Promise.allSettled(entries.map(entry => this.release(entry)));
    const failures: unknown[] = []; for (const result of results) if (result.status === 'rejected') failures.push(result.reason);
    if (failures.length) throw new AggregateError(failures, '拍摄图片资源释放失败。');
  }
  async discard() {
    if (!this.paused || this.closed || this.clearing) throw new Error('请先等待当前照片保存结束。');
    this.clearing = true; this.options.changed(); await this.running;
    const entries = this.entries; this.entries = [];
    try { await this.releaseAll(entries); }
    finally { this.paused = false; this.clearing = false; this.options.changed(); }
  }
  dispose(): Promise<void> {
    this.closed = true; this.options.changed();
    this.closing ??= (async () => { await this.running; const entries = this.entries; this.entries = []; await this.releaseAll(entries); if (this.cleanupFailure) throw new AggregateError([this.cleanupFailure.cause], '拍摄图片资源释放失败。'); })();
    return this.closing;
  }
}
