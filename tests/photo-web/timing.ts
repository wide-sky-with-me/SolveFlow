import type { Page } from '@playwright/test';

/** Test-only metadata: no photo pixels, answers, credentials or request bodies. */
export async function installTimingProbe(page: Page) {
    await page.addInitScript(() => {
        const events: Record<string, string | number | boolean>[] = [];
        const log = (event: Record<string, string | number | boolean>) => {
            events.push({ at: Date.now(), ...event });
            if (events.length > 2000) events.splice(0, 1000);
        };
        Reflect.set(window, 'photoTiming', events);
        const transaction = IDBDatabase.prototype.transaction;
        IDBDatabase.prototype.transaction = function (...args: Parameters<IDBDatabase['transaction']>) {
            const started = Date.now(), tx: IDBTransaction = Reflect.apply(transaction, this, args);
            tx.addEventListener('complete', () => log({ kind: 'idb-complete', mode: tx.mode, ms: Date.now() - started }));
            tx.addEventListener('abort', () => log({ kind: 'idb-abort', mode: tx.mode, ms: Date.now() - started }));
            return tx;
        };
        const get = IDBObjectStore.prototype.get;
        IDBObjectStore.prototype.get = function (...args: Parameters<IDBObjectStore['get']>) {
            const request: IDBRequest<unknown> = Reflect.apply(get, this, args), key = args[0];
            if (typeof key === 'string' && key.startsWith('record.')) request.addEventListener('success', () => {
                try {
                    if (typeof request.result !== 'string') return;
                    const raw: unknown = JSON.parse(request.result);
                    if (!raw || typeof raw !== 'object' || !('session' in raw)) return;
                    const session = raw.session;
                    if (!session || typeof session !== 'object' || !('runs' in session) || !Array.isArray(session.runs)) return;
                    const run: unknown = session.runs.at(-1);
                    if (run && typeof run === 'object' && 'id' in run && typeof run.id === 'string' && 'status' in run && typeof run.status === 'string' && 'seq' in run && typeof run.seq === 'number')
                        log({ kind: 'record-read', id: run.id, status: run.status, seq: run.seq });
                } catch { log({ kind: 'probe-record-unreadable' }); }
            });
            return request;
        };
        let previous = Date.now();
        setInterval(() => { const now = Date.now(), lag = now - previous - 100; previous = now; if (lag > 200) log({ kind: 'event-loop-lag', ms: lag }); }, 100);
        document.addEventListener('visibilitychange', () => log({ kind: 'visibility', state: document.visibilityState }));
        document.addEventListener('DOMContentLoaded', () => {
            let last = '';
            new MutationObserver(() => {
                const progress = document.querySelector('.progress')?.textContent ?? '';
                const status = ['正在识别题目', '正在解答', '正在核对', '正在复核答案', '正在同步答题结果'].find(label => progress.includes(label)) ?? 'none';
                const state = { kind: 'ui', status, alerts: document.querySelectorAll('[role="alert"]').length, stop: !!document.querySelector('.progress button') };
                const encoded = JSON.stringify(state); if (encoded !== last) { last = encoded; log(state); }
            }).observe(document.documentElement, { subtree: true, childList: true, attributes: true, characterData: true });
        });
    });
}

/** Deliver one already-finished photo read late; storage writes themselves remain unblocked. */
export async function delayRetryPhotoRead(page: Page) {
    await page.addInitScript(() => {
        const descriptor = Object.getOwnPropertyDescriptor(IDBTransaction.prototype, 'oncomplete');
        const setter = descriptor?.set;
        if (!descriptor || !setter) throw new Error('EXPECTED_IDB_COMPLETION_HANDLER');
        const delayed = new WeakSet<IDBTransaction>();
        let armed = false, held: (() => void) | null = null, posts = 0;
        const log = (kind: string) => { const events: unknown = Reflect.get(window, 'photoTiming'); if (Array.isArray(events)) events.push({at:Date.now(),kind}); };
        Reflect.set(window, 'hasHeldPhotoRead', false);
        Reflect.set(window, 'releaseHeldPhotoRead', () => { const callback = held; held = null; if(callback){log('photo-read-released');callback();} });
        Object.defineProperty(IDBTransaction.prototype, 'oncomplete', {
            ...descriptor,
            set(this: IDBTransaction, callback: IDBTransaction['oncomplete']) {
                setter.call(this, callback && function (this: IDBTransaction, event: Event) {
                    if (!delayed.has(this)) { callback.call(this, event); return; }
                    held = () => callback.call(this, event);
                    log('photo-read-held');
                    Reflect.set(window, 'hasHeldPhotoRead', true);
                });
            },
        });
        const get = IDBObjectStore.prototype.get;
        IDBObjectStore.prototype.get = function (...args: Parameters<IDBObjectStore['get']>) {
            if (armed && typeof args[0] === 'string' && args[0].startsWith('image.')) {
                armed = false; delayed.add(this.transaction);
            }
            return Reflect.apply(get, this, args);
        };
        const fetch = window.fetch;
        window.fetch = function (input: RequestInfo | URL, init?: RequestInit) {
            const path = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
            if (path.endsWith('/api/jobs') && init?.method === 'POST' && ++posts === 2) {
                armed = true; setTimeout(() => { armed = false; }, 1000);
            }
            return Reflect.apply(fetch, window, [input, init]);
        };
    });
}
