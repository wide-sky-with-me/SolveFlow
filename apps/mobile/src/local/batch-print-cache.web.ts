import { z } from 'zod';
import { BatchPrintLayoutSchema, PrintImageAdjustmentSchema, PreparedPrintRecordSchema, type PreparedPrintRecord, type BatchPrintLayoutInput, type BatchPrintLayout } from '@solveflow/contracts/local';
import type { PrintImages } from '../dom/batch-print-document';
import type { ReviewPrintSource } from './batch-print-presentation.web';

// Decision: .agents/notes/implemented/storage/2026-10-13-print-layout-cache.md
const CACHE_REVISION = 'print-layout-4';
const MAX_CACHE_BYTES = 256 * 1024 * 1024; const MAX_ENTRIES = 512; const MAX_AGE = 7 * 24 * 60 * 60 * 1000;
const CacheSchema = z.strictObject({
  schemaVersion: z.literal(1), proposal: BatchPrintLayoutSchema,
  images: z.record(z.string().max(256), z.string().max(6 * 1024 * 1024).regex(/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/)),
  sources: z.array(z.strictObject({ key: z.string().max(256), image: z.string().max(6 * 1024 * 1024).regex(/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/), label: z.string().max(500), region: z.literal(true) })).max(384),
  adjustments: z.record(z.string().max(256), PrintImageAdjustmentSchema),
});
const MetadataSchema = z.array(z.strictObject({ key: z.string().max(100), bytes: z.number().int().nonnegative().max(MAX_CACHE_BYTES), usedAt: z.number().finite() })).max(MAX_ENTRIES + 1);
export type CachedPrintLayout = z.infer<typeof CacheSchema>;
export async function printLayoutCacheKey(input: BatchPrintLayoutInput): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(input)));
  return `${CACHE_REVISION}:${Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('')}`;
}
function cancelled(signal: AbortSignal) { if (signal.aborted) throw new Error('导出已取消。'); }
async function openCache(signal: AbortSignal): Promise<IDBDatabase> {
  cancelled(signal);
  return new Promise((resolve, reject) => {
    let finished = false; const request = indexedDB.open('solveflow-print-cache', 1);
    const fail = () => { if (finished) return; finished = true; clearTimeout(timer); signal.removeEventListener('abort', fail); reject(new Error(signal.aborted ? '导出已取消。' : '导出整理缓存无法打开。')); };
    const timer = setTimeout(fail, 5000); signal.addEventListener('abort', fail, { once: true });
    request.onupgradeneeded = () => { request.result.createObjectStore('entries'); request.result.createObjectStore('metadata', { keyPath: 'key' }); };
    request.onerror = request.onblocked = fail;
    request.onsuccess = () => { if (finished) { request.result.close(); return; } finished = true; clearTimeout(timer); signal.removeEventListener('abort', fail); resolve(request.result); };
  });
}
async function transaction<T>(signal: AbortSignal, mode: IDBTransactionMode, action: (tx: IDBTransaction, result: (value: T) => void) => void): Promise<T> {
  const db = await openCache(signal);
  try {
    cancelled(signal);
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(['entries', 'metadata'], mode); let value: T; let assigned = false;
      const abort = () => { try { tx.abort(); } catch { /* Completion already owns the result. */ } };
      const timer = setTimeout(abort, 5000); signal.addEventListener('abort', abort, { once: true });
      const cleanup = () => { clearTimeout(timer); signal.removeEventListener('abort', abort); };
      tx.oncomplete = () => { cleanup(); if (signal.aborted) reject(new Error('导出已取消。')); else if (!assigned) reject(new Error('导出缓存结果无法读取。')); else resolve(value); };
      tx.onerror = tx.onabort = () => { cleanup(); reject(new Error(signal.aborted ? '导出已取消。' : '导出整理缓存读写失败。')); };
      try { action(tx, result => { value = result; assigned = true; }); } catch (cause) { abort(); reject(cause); }
    });
  } finally { db.close(); }
}
export async function readPrintLayoutCache(key: string, signal: AbortSignal): Promise<CachedPrintLayout | null> {
  return transaction(signal, 'readwrite', (tx, result) => {
    const entries = tx.objectStore('entries'); const metadata = tx.objectStore('metadata'); const request = entries.get(key); const info = metadata.get(key);
    info.onsuccess = () => {
      const meta = MetadataSchema.element.safeParse(info.result); const cached = CacheSchema.safeParse(request.result);
      if (!meta.success || !cached.success || Date.now() - meta.data.usedAt > MAX_AGE) { entries.delete(key); metadata.delete(key); result(null); return; }
      metadata.put({ ...meta.data, usedAt: Date.now() }); result(cached.data);
    };
  });
}
export function cachePrintLayout(proposal: BatchPrintLayout, images: PrintImages, sources: ReviewPrintSource[], adjustments: Record<string, z.infer<typeof PrintImageAdjustmentSchema>>): CachedPrintLayout {
  const keys = new Set(proposal.questions.flatMap(question => question.sources.flatMap(source => source.kind === 'text-only' ? [] : source.kind === 'retain-source' ? [`${question.key.split('/')[0]}/${source.id}`] : source.regions.map(region => `${question.key}/${source.id}/${region.id}`))));
  return CacheSchema.parse({ schemaVersion: 1, proposal, images: Object.fromEntries(Object.entries(images).filter(([key]) => keys.has(key))), sources: sources.filter(source => source.region), adjustments: Object.fromEntries(Object.entries(adjustments).filter(([key]) => keys.has(key))) });
}
export async function writePrintLayoutCache(key: string, value: CachedPrintLayout, signal: AbortSignal): Promise<void> {
  await writeCacheEntry(key, CacheSchema.parse(value), signal);
}
async function writeCacheEntry(key: string, checked: unknown, signal: AbortSignal): Promise<void> {
  const bytes = new TextEncoder().encode(JSON.stringify(checked)).byteLength;
  if (bytes > MAX_CACHE_BYTES) throw new Error('本题整理结果超过缓存容量。');
  return transaction(signal, 'readwrite', (tx, result) => {
    const metadata = tx.objectStore('metadata'); const entries = tx.objectStore('entries'); const request = metadata.getAll(undefined, MAX_ENTRIES + 1);
    request.onsuccess = () => {
      try {
        const rows = MetadataSchema.parse(request.result).filter(row => row.key !== key).sort((a, b) => a.usedAt - b.usedAt);
        let total = rows.reduce((sum, row) => sum + row.bytes, 0) + bytes;
        while (rows.length >= MAX_ENTRIES || total > MAX_CACHE_BYTES) { const row = rows.shift(); if (!row) break; total -= row.bytes; entries.delete(row.key); metadata.delete(row.key); }
        entries.put(checked, key); metadata.put({ key, bytes, usedAt: Date.now() }); result(undefined);
      } catch { tx.abort(); }
    };
  });
}

// Prepared documents do not expire by age; only explicit edits, resource limits or browser storage eviction invalidate them.
export async function preparedPrintCacheKey(input: BatchPrintLayoutInput): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify({ questions: input.questions, sources: input.sources })));
  return `prepared-paper-1-sharpen-1:${Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('')}`;
}
export async function readPreparedPrintCache(key: string, signal: AbortSignal): Promise<PreparedPrintRecord | null> {
  return transaction(signal, 'readwrite', (tx, result) => {
    const entries = tx.objectStore('entries'); const metadata = tx.objectStore('metadata'); const request = entries.get(key); const info = metadata.get(key);
    info.onsuccess = () => {
      const meta = MetadataSchema.element.safeParse(info.result); const cached = PreparedPrintRecordSchema.safeParse(request.result);
      if (!meta.success || !cached.success) { result(null); return; }
      metadata.put({ ...meta.data, usedAt: Date.now() }); result(cached.data);
    };
  });
}
export async function writePreparedPrintCache(key: string, value: PreparedPrintRecord, signal: AbortSignal): Promise<void> {
  await writeCacheEntry(key, PreparedPrintRecordSchema.parse(value), signal);
}
