export const PHOTO_DISPLAY_CACHE_ENTRIES = 48;
export const PHOTO_DISPLAY_CACHE_BYTES = 96 * 1024 * 1024;

type CachedDisplayPhoto = {
  key: string;
  url: string;
  bytes: number;
  refs: number;
  used: number;
};

function decodeBase64DataUri(uri: string): { mime: string; bytes: Uint8Array<ArrayBuffer> } | null {
  const match = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(uri);
  if (!match) return null;
  const mime = match[1]!;
  const raw = match[2]!;
  if (typeof atob === 'function') {
    const binary = atob(raw);
    const buffer = new ArrayBuffer(binary.length);
    const out = new Uint8Array(buffer);
    for (let index = 0; index < binary.length; index++) out[index] = binary.charCodeAt(index);
    return { mime, bytes: out };
  }
  return null;
}

export class PhotoDisplayCache {
  private entries = new Map<string, CachedDisplayPhoto>();
  private sequence = 0;

  constructor(
    private readonly maxEntries = PHOTO_DISPLAY_CACHE_ENTRIES,
    private readonly maxBytes = PHOTO_DISPLAY_CACHE_BYTES,
  ) {}

  private totalBytes() {
    let sum = 0;
    for (const item of this.entries.values()) sum += item.bytes;
    return sum;
  }

  private evictIfNeeded(incomingBytes: number) {
    while (this.entries.size >= this.maxEntries || (this.entries.size > 0 && this.totalBytes() + incomingBytes > this.maxBytes)) {
      const candidate = [...this.entries.values()]
        .filter(item => item.refs === 0)
        .sort((a, b) => a.used - b.used)[0];
      if (!candidate) break;
      URL.revokeObjectURL(candidate.url);
      this.entries.delete(candidate.key);
    }
  }

  private ensureEntry(uri: string): CachedDisplayPhoto | null {
    const existing = this.entries.get(uri);
    if (existing) {
      existing.used = ++this.sequence;
      return existing;
    }
    if (typeof URL?.createObjectURL !== 'function') return null;
    const decoded = decodeBase64DataUri(uri);
    if (!decoded || !decoded.bytes.byteLength || decoded.bytes.byteLength > this.maxBytes) return null;
    this.evictIfNeeded(decoded.bytes.byteLength);
    if (this.entries.size >= this.maxEntries && [...this.entries.values()].every(item => item.refs > 0)) return null;
    const url = URL.createObjectURL(new Blob([decoded.bytes], { type: decoded.mime }));
    if (typeof Image === 'function') {
      const preload = new Image();
      preload.decoding = 'async';
      preload.src = url;
      void preload.decode?.().catch(() => {});
    }
    const entry: CachedDisplayPhoto = { key: uri, url, bytes: decoded.bytes.byteLength, refs: 0, used: ++this.sequence };
    this.entries.set(uri, entry);
    return entry;
  }

  warm(uri: string | null | undefined): string | null {
    if (!uri || !uri.startsWith('data:image/')) return null;
    return this.ensureEntry(uri)?.url ?? null;
  }

  acquire(uri: string): { url: string; release: () => void } {
    if (!uri.startsWith('data:image/')) return { url: uri, release: () => {} };
    const entry = this.ensureEntry(uri);
    if (!entry) return { url: uri, release: () => {} };
    entry.refs++;
    let released = false;
    return {
      url: entry.url,
      release: () => {
        if (released) return;
        released = true;
        entry.refs = Math.max(0, entry.refs - 1);
      },
    };
  }

  has(uri: string): boolean {
    return this.entries.has(uri);
  }

  clear() {
    for (const item of this.entries.values()) URL.revokeObjectURL(item.url);
    this.entries.clear();
  }
}
