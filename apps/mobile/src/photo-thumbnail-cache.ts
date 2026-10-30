import type { Photo } from './platform.types';
import { MAX_BATCH_PHOTOS } from '@solveflow/contracts/local';
// Decision: .agents/notes/implemented/architecture/2026-10-29-retry-projection-and-import-previews.md

type Entry<Source> = { source: Source; refs: number; value?: Photo; ready: Promise<Photo | null>; resolve: (photo: Photo | null) => void };
/** A workbench owns its previews; original photos never transfer to this cache. */
export class PhotoThumbnailCache<Source = Photo> {
  private entries = new Map<Source, Entry<Source>>();
  private waiting: Entry<Source>[] = [];
  private running = 0;
  constructor(private readonly prepare: (photo: Source) => Promise<Photo>, private readonly release: (photo: Photo) => void, private readonly capacity = 24, private readonly concurrency = 2) {}
  acquire(source: Source) {
    let entry = this.entries.get(source);
    if (!entry) {
      if (this.entries.size >= MAX_BATCH_PHOTOS + this.capacity) return { ready: Promise.resolve(null), release() {} };
      let resolve!: Entry<Source>['resolve'];
      const ready = new Promise<Photo | null>(done => { resolve = done; });
      entry = { source, refs: 0, ready, resolve };
      this.entries.set(source, entry); this.waiting.push(entry);
    }
    entry.refs++;
    const current = entry; let released = false;
    this.pump();
    return { ready: current.ready, release: () => {
      if (released) return; released = true; current.refs--;
      if (!current.refs && this.entries.get(source) === current) {
        if (!current.value) { this.entries.delete(source); this.waiting = this.waiting.filter(row => row !== current); current.resolve(null); }
        else { this.entries.delete(source); this.entries.set(source, current); }
      }
      this.pump();
    } };
  }
  private dispose(photo: Photo) {
    try { this.release(photo); } catch { console.warn('PHOTO_THUMBNAIL_CLEANUP_FAILED'); }
  }
  private evict() {
    const idle = [...this.entries.values()].find(entry => !entry.refs && entry.value);
    if (!idle?.value) return false;
    this.entries.delete(idle.source); this.dispose(idle.value); return true;
  }
  private pump() {
    while (this.running < this.concurrency && this.waiting.length) {
      const resident = [...this.entries.values()].filter(entry => entry.value).length + this.running;
      if (resident >= this.capacity) { if (this.evict()) continue; break; }
      const entry = this.waiting.shift()!;
      if (!entry.refs || this.entries.get(entry.source) !== entry) continue;
      this.running++;
      void Promise.resolve().then(() => this.prepare(entry.source)).then(value => {
        if (this.entries.get(entry.source) !== entry || !entry.refs) { this.dispose(value); entry.resolve(null); }
        else { entry.value = value; entry.resolve(value); }
      }, () => {
        if (this.entries.get(entry.source) === entry) this.entries.delete(entry.source);
        entry.resolve(null);
      }).finally(() => { this.running--; this.pump(); });
    }
  }
  retain(sources: ReadonlySet<Source>) {
    for (const [source, entry] of this.entries) if (!sources.has(source)) {
      this.entries.delete(source); if (entry.value) this.dispose(entry.value); entry.resolve(null);
    }
    this.waiting = this.waiting.filter(entry => this.entries.get(entry.source) === entry); this.pump();
  }
  clear() {
    for (const entry of this.entries.values()) { if (entry.value) this.dispose(entry.value); entry.resolve(null); }
    this.entries.clear(); this.waiting = [];
  }
}
