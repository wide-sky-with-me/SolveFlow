import { afterEach, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { api } from './api.js';

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

function blockedFetch() {
    const fetch = vi.fn((_url: unknown, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal;
        if (!signal) { reject(new Error('EXPECTED_CANCELLABLE_REQUEST')); return; }
        const stop = () => reject(signal.reason);
        if (signal.aborted) stop(); else signal.addEventListener('abort', stop, { once: true });
    }));
    vi.stubGlobal('fetch', fetch);
    return fetch;
}

it('keeps the request deadline when a view supplies its own cancellation signal', async () => {
    vi.useFakeTimers();
    const fetch = blockedFetch(), owner = new AbortController(), failed = vi.fn();
    const request = api('/attempts/synthetic/snapshot', z.object({ ok: z.boolean() }), { signal: owner.signal }).catch(failed);
    try {
        await vi.advanceTimersByTimeAsync(50_001);
        expect(failed).toHaveBeenCalledTimes(1);
        expect(owner.signal.aborted).toBe(false);
        expect(fetch).toHaveBeenCalledTimes(1);
    } finally { owner.abort(); await request; }
});

it('honors view cancellation before the deadline without starting another request', async () => {
    vi.useFakeTimers();
    const fetch = blockedFetch(), owner = new AbortController(), reason = new DOMException('View closed', 'AbortError');
    const request = api('/slots/synthetic', z.object({ ok: z.boolean() }), { signal: owner.signal });
    const rejected = expect(request).rejects.toBe(reason);
    owner.abort(reason);
    await rejected;
    await vi.advanceTimersByTimeAsync(50_001);
    expect(fetch).toHaveBeenCalledTimes(1);
});

it('bounds a receipt read separately without aborting its owner or retrying writes', async () => {
    vi.useFakeTimers();
    const fetch=blockedFetch(),owner=new AbortController(),failed=vi.fn();
    const request=api('/slots/synthetic/submissions/synthetic',z.object({runId:z.string().nullable()}),{signal:owner.signal},8000).catch(failed);
    await vi.advanceTimersByTimeAsync(7999);expect(failed).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(2);expect(failed).toHaveBeenCalledTimes(1);expect(owner.signal.aborted).toBe(false);expect(fetch).toHaveBeenCalledTimes(1);await request;
});
