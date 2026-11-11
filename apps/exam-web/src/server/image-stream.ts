import { EXAM_SOURCE_IMAGE_BYTES } from '@solveflow/contracts/managed-exam';

// Node and browser stream interfaces differ in iterator helpers; this reader is
// the common capability we actually consume. Chunks remain unknown until checked.
type ImageSource = { getReader(): {
    read(): Promise<{ done?: boolean; value?: unknown }>;
    cancel(reason?: unknown): Promise<void>;
    releaseLock(): void;
} };

/** Bound storage streams without collecting the complete original in API memory. */
export function imageStream(body: ImageSource, signal: AbortSignal, limit = EXAM_SOURCE_IMAGE_BYTES, expected?: number): ReadableStream<Uint8Array> {
    const reader = body.getReader();
    let ended = false, size = 0;
    const cancel = async (reason?: unknown) => { try { await reader.cancel(reason); } catch { /* Preserve the original read/abort error. */ } finally { reader.releaseLock(); } };
    let abort = () => {};
    const cleanup = () => signal.removeEventListener('abort', abort);
    return new ReadableStream<Uint8Array>({
        start(controller) {
            abort = () => { if (ended) return; ended = true; cleanup(); controller.error(signal.reason); void cancel(signal.reason); };
            signal.addEventListener('abort', abort, { once: true });
            if (signal.aborted) abort();
        },
        async pull(controller) {
            try {
                const next = await reader.read();
                if (ended) return;
                if (next.done) {
                    if (expected !== undefined && size !== expected) throw new Error('IMAGE_LENGTH_MISMATCH');
                    ended = true; cleanup(); reader.releaseLock(); controller.close(); return;
                }
                if (!(next.value instanceof Uint8Array)) throw new Error('INVALID_IMAGE_CHUNK');
                size += next.value.byteLength;
                if (size > limit) throw new Error('IMAGE_LIMIT');
                controller.enqueue(next.value);
            } catch (error) {
                if (ended) return;
                ended = true; cleanup(); controller.error(error); await cancel(error);
            }
        },
        async cancel(reason) { if (ended) return; ended = true; cleanup(); await cancel(reason); },
    });
}
