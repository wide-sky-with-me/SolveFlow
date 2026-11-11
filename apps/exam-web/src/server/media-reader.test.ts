import { describe, expect, it } from 'vitest';
import { MediaReader } from './media-reader.js';
import { imageStream } from './image-stream.js';
import type { ExamStorage } from './storage.js';

function storage(get: ExamStorage['get'], stream?: ExamStorage['stream']): ExamStorage {
    return { get, ...stream ? { stream } : {}, async put() {}, async remove() {}, close() {} };
}
const controller = () => new AbortController();
const read = async (body: ReadableStream<Uint8Array>) => new Uint8Array(await new Response(body).arrayBuffer());
const single = (bytes: Uint8Array) => new ReadableStream<Uint8Array>({ start(c) { c.enqueue(bytes); c.close(); } });

describe('authorized media byte reader', () => {
    it('coalesces reads and one cancelled viewer does not cancel another viewer', async () => {
        let calls = 0, release = () => {}, fetchSignal: AbortSignal | undefined;
        const held = new Promise<void>(resolve => release = resolve), bytes = new Uint8Array([1, 2, 3]);
        const media = new MediaReader(storage(async (_key, signal) => { calls++; fetchSignal = signal; await held; return bytes; }));
        const a = controller(), b = controller(), access = { key: 'shared', byteSize: 3 };
        const first = media.read(access, true, a.signal), second = media.read(access, true, b.signal);
        await Promise.resolve(); expect(calls).toBe(1);
        const cancelled = expect(first).rejects.toMatchObject({ name: 'AbortError' }); a.abort(); await cancelled;
        expect(fetchSignal?.aborted).toBe(false); release();
        expect(await read(await second)).toEqual(bytes);
        expect(await read(await media.read(access, true, controller().signal))).toEqual(bytes); expect(calls).toBe(1);
        media.close();
    });
    it('cancels an abandoned fetch and fences its late bytes from a newer read', async () => {
        let calls = 0, release = () => {}, oldSignal: AbortSignal | undefined;
        const held = new Promise<void>(resolve => release = resolve);
        const media = new MediaReader(storage(async (_key, signal) => { calls++; if (calls === 1) { oldSignal = signal; await held; return new Uint8Array([1]); } return new Uint8Array([2]); }));
        const owner = controller(), access = { key: 'late', byteSize: 1 }, first = media.read(access, true, owner.signal);
        await Promise.resolve(); const rejected = expect(first).rejects.toMatchObject({ name: 'AbortError' }); owner.abort(); await rejected;
        expect(oldSignal?.aborted).toBe(true);
        expect(await read(await media.read(access, true, controller().signal))).toEqual(new Uint8Array([2]));
        release(); await Promise.resolve(); await Promise.resolve();
        expect(await read(await media.read(access, true, controller().signal))).toEqual(new Uint8Array([2])); expect(calls).toBe(2);
        media.close();
    });
    it('does not cache failures or mismatched lengths', async () => {
        let calls = 0;
        const media = new MediaReader(storage(async () => { calls++; if (calls === 1) throw new Error('SYNTHETIC_STORAGE_FAILURE'); return new Uint8Array(calls === 2 ? [1, 2] : [3]); }));
        const access = { key: 'retry', byteSize: 1 };
        await expect(media.read(access, true, controller().signal)).rejects.toThrow('SYNTHETIC_STORAGE_FAILURE');
        await expect(media.read(access, true, controller().signal)).rejects.toThrow('IMAGE_LENGTH_MISMATCH');
        expect(await read(await media.read(access, true, controller().signal))).toEqual(new Uint8Array([3])); expect(calls).toBe(3);
        media.close();
    });
    it('expires bytes and evicts old entries to keep the 32 MiB budget', async () => {
        let calls = 0, now = 0;
        const bytes = new Uint8Array(4 * 1024 * 1024), media = new MediaReader(storage(async () => { calls++; return bytes; }), () => now);
        const access = (id: number) => ({ key: String(id), byteSize: bytes.length });
        for (let i = 0; i < 9; i++) await read(await media.read(access(i), true, controller().signal));
        await read(await media.read(access(8), true, controller().signal)); expect(calls).toBe(9);
        await read(await media.read(access(0), true, controller().signal)); expect(calls).toBe(10);
        now = 60001; await read(await media.read(access(8), true, controller().signal)); expect(calls).toBe(11);
        media.close();
    });
    it('bounds entry count even when every preview is tiny', async () => {
        let calls = 0; const media = new MediaReader(storage(async () => { calls++; return new Uint8Array([1]); }));
        for (let i = 0; i < 33; i++) await read(await media.read({ key: String(i), byteSize: 1 }, true, controller().signal));
        await read(await media.read({ key: '32', byteSize: 1 }, true, controller().signal)); expect(calls).toBe(33);
        await read(await media.read({ key: '0', byteSize: 1 }, true, controller().signal)); expect(calls).toBe(34); media.close();
    });
    it('streams overflow reads instead of starting unbounded buffered downloads', async () => {
        let gets = 0, streams = 0, release = () => {};
        const held = new Promise<void>(resolve => release = resolve);
        const media = new MediaReader(storage(async () => { gets++; await held; return new Uint8Array([1]); }, async () => { streams++; return single(new Uint8Array([2])); }));
        const pending = Array.from({ length: 8 }, (_, i) => media.read({ key: String(i), byteSize: 1 }, true, controller().signal));
        const settled = Promise.allSettled(pending); await Promise.resolve(); expect(gets).toBe(8);
        expect(await read(await media.read({ key: 'overflow', byteSize: 1 }, true, controller().signal))).toEqual(new Uint8Array([2]));
        expect(streams).toBe(1); expect(gets).toBe(8); media.close(); release();
        expect((await settled).every(result => result.status === 'rejected')).toBe(true);
        await expect(media.read({ key: 'closed', byteSize: 1 }, true, controller().signal)).rejects.toMatchObject({ name: 'AbortError' });
    });
    it('streams originals without populating the preview cache', async () => {
        let calls = 0;
        const media = new MediaReader(storage(async () => { throw new Error('ORIGINAL_MUST_NOT_BUFFER'); }, async () => { calls++; return single(new Uint8Array([1, 2])); }));
        for (let i = 0; i < 2; i++) expect(await read(await media.read({ key: 'original', byteSize: 2 }, false, controller().signal))).toEqual(new Uint8Array([1, 2]));
        expect(calls).toBe(2); media.close();
    });
});

describe('bounded image streams', () => {
    it('delivers the first chunk before the rest of the original arrives and cancels upstream', async () => {
        let release = () => {}, cancelled = false, pulls = 0;
        const held = new Promise<void>(resolve => release = resolve);
        const source = new ReadableStream<Uint8Array>({ async pull(c) { pulls++; if (pulls === 1) c.enqueue(new Uint8Array([1])); else { await held; if (!cancelled) { c.enqueue(new Uint8Array([2])); c.close(); } } }, cancel() { cancelled = true; release(); } });
        const output = imageStream(source, controller().signal, 2, 2).getReader();
        expect(await output.read()).toEqual({ done: false, value: new Uint8Array([1]) });
        await output.cancel(); expect(cancelled).toBe(true); output.releaseLock();
    });
    it('propagates aborts to storage even while waiting for the next chunk', async () => {
        let cancelled = false;
        const abort = controller(), source = new ReadableStream<Uint8Array>({ cancel() { cancelled = true; } });
        const output = imageStream(source, abort.signal).getReader(), pending = expect(output.read()).rejects.toMatchObject({ name: 'AbortError' });
        abort.abort(); await pending; await Promise.resolve(); expect(cancelled).toBe(true); output.releaseLock();
    });
    it.each(['oversize', 'truncated', 'invalid'] as const)('rejects %s content and releases upstream', async fault => {
        let cancelled = false;
        const body = new ReadableStream<unknown>({ start(c) { c.enqueue(fault === 'invalid' ? 'not bytes' : new Uint8Array(fault === 'oversize' ? [1, 2] : [1])); if (fault === 'truncated') c.close(); }, cancel() { cancelled = true; } });
        const output = imageStream(body, controller().signal, fault === 'oversize' ? 1 : 2, 2);
        await expect(read(output)).rejects.toThrow(fault === 'oversize' ? 'IMAGE_LIMIT' : fault === 'invalid' ? 'INVALID_IMAGE_CHUNK' : 'IMAGE_LENGTH_MISMATCH');
        if (fault !== 'truncated') expect(cancelled).toBe(true);
    });
});
