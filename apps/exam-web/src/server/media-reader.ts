// Decision: .agents/notes/implemented/architecture/2026-11-09-managed-backend-performance.md
import { EXAM_MODEL_IMAGE_BYTES } from '@solveflow/contracts/managed-exam';
import { ExamError } from '@solveflow/db';
import type { ExamStorage } from './storage.js';
import { imageStream } from './image-stream.js';

type Cached = { bytes: Uint8Array; expires: number };
type Pending = { controller: AbortController; promise: Promise<Uint8Array>; consumers: number; size: number };
const CACHE_BYTES = 32 * 1024 * 1024, CACHE_ENTRIES = 32, CACHE_TTL_MS = 60000, MAX_PENDING = 8;
const bytesStream = (bytes: Uint8Array) => new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(bytes); controller.close(); } });

/** Byte reuse only. Every request must finish imageAccess before calling read. */
export class MediaReader {
    private readonly cache = new Map<string, Cached>();
    private readonly pending = new Map<string, Pending>();
    private readonly stop = new AbortController();
    private bytes = 0;
    constructor(private readonly storage: ExamStorage, private readonly now = Date.now) {}
    private forget(key: string) {
        const old = this.cache.get(key); if (old) this.bytes -= old.bytes.byteLength;
        this.cache.delete(key);
    }
    private remember(key: string, bytes: Uint8Array) {
        this.forget(key);
        for (const [id, value] of this.cache) if (value.expires <= this.now()) this.forget(id);
        while (this.cache.size >= CACHE_ENTRIES || this.bytes + bytes.byteLength > CACHE_BYTES) {
            const first = this.cache.keys().next().value; if (first === undefined) break;
            this.forget(first);
        }
        this.cache.set(key, { bytes, expires: this.now() + CACHE_TTL_MS }); this.bytes += bytes.byteLength;
    }
    private wait(key: string, job: Pending, signal: AbortSignal): Promise<ReadableStream<Uint8Array>> {
        job.consumers++;
        return new Promise((resolve, reject) => {
            let finished = false;
            const finish = () => {
                if (finished) return false;
                finished = true; signal.removeEventListener('abort', abort); job.consumers--;
                if (!job.consumers && this.pending.get(key) === job) { this.pending.delete(key); job.controller.abort(); }
                return true;
            };
            const abort = () => { if (finish()) reject(signal.reason); };
            signal.addEventListener('abort', abort, { once: true });
            job.promise.then(bytes => { if (finish()) resolve(bytesStream(bytes)); }, error => { if (finish()) reject(error); });
            if (signal.aborted) abort();
        });
    }
    async read(access: { key: string; byteSize: number }, cacheable: boolean, requestSignal: AbortSignal): Promise<ReadableStream<Uint8Array>> {
        const signal = AbortSignal.any([requestSignal, this.stop.signal]); signal.throwIfAborted();
        const cached = this.cache.get(access.key);
        if (cached && cached.expires > this.now() && cached.bytes.byteLength === access.byteSize) {
            this.cache.delete(access.key); this.cache.set(access.key, cached); return bytesStream(cached.bytes);
        }
        if (cached) this.forget(access.key);
        if (cacheable && access.byteSize <= EXAM_MODEL_IMAGE_BYTES || !this.storage.stream) {
            let job = this.pending.get(access.key);
            if (job && job.size !== access.byteSize) throw new Error('IMAGE_LENGTH_MISMATCH');
            if (!job && this.pending.size < MAX_PENDING) {
                const controller = new AbortController();
                job = { controller, promise: Promise.resolve(new Uint8Array()), consumers: 0, size: access.byteSize };
                const current = job;
                current.promise = Promise.resolve().then(() => this.storage.get(access.key, controller.signal)).then(bytes => {
                    controller.signal.throwIfAborted();
                    if (bytes.byteLength !== access.byteSize) throw new Error('IMAGE_LENGTH_MISMATCH');
                    if (cacheable && bytes.byteLength <= EXAM_MODEL_IMAGE_BYTES) this.remember(access.key, bytes);
                    return bytes;
                }).finally(() => { if (this.pending.get(access.key) === current) this.pending.delete(access.key); });
                this.pending.set(access.key, current);
            }
            if (job) return this.wait(access.key, job, signal);
        }
        if (this.storage.stream) return imageStream(await this.storage.stream(access.key, signal), signal, access.byteSize, access.byteSize);
        // Compatibility for injected adapters; avoid an unbounded number of buffered reads.
        throw new ExamError(429, 'IMAGE_BUSY', '图片请求较多，请稍后重试。');
    }
    close() { this.stop.abort(); for (const job of this.pending.values()) job.controller.abort(); this.pending.clear(); this.cache.clear(); this.bytes = 0; }
}
