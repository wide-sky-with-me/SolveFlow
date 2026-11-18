import { EXAM_MODEL_IMAGE_BYTES, EXAM_SOURCE_IMAGE_BYTES } from '@solveflow/contracts/managed-exam';
// Decision: .agents/notes/implemented/rendering/2026-11-04-progressive-image-viewer.md
export type CachedImage = {
    url: string;
    bytes: number;
};
export type ImageLease = {
    promise: Promise<CachedImage>;
    release: () => void;
};
type Validation = {
    controller: AbortController;
    promise: Promise<void>;
};
type Entry = {
    path: string;
    source: boolean;
    refs: number;
    prefetching: boolean;
    used: number;
    controller: AbortController;
    promise: Promise<CachedImage>;
    data?: CachedImage;
    validation?: Validation;
};
const UUID_PATTERN = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const MEDIA_URL_PATTERN = /^\/api\/v2\/media\/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\?view=(thumbnail|model|source)$/;
const PREFETCH_URL_PATTERN = /^\/api\/v2\/media\/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\?view=(thumbnail|model)$/;
export const IMAGE_CACHE_BYTES = 64 * 1024 * 1024;
export const IMAGE_CACHE_MAX_ENTRIES = 96;
export const IMAGE_CACHE_MAX_SOURCES = 4;
export const IMAGE_CACHE_MAX_PENDING = 10;
export const IMAGE_CACHE_MAX_PREFETCH = 2;
const MAX_PREFETCH_QUEUE = 32;
export function mediaPath(id: string, view: 'thumbnail' | 'model' | 'source') {
    if (!UUID_PATTERN.test(id))
        throw new Error('图片地址无效。');
    return `/api/v2/media/${id}?view=${view}`;
}
export function imagePaths(source: string) {
    if (!/^\/api\/v2\/media\/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\?view=source$/.test(source))
        throw new Error('图片地址无效。');
    return { source, preview: source.replace('view=source', 'view=model') };
}
/** One instance belongs to one mounted login session; object URLs never enter persistent storage. */
export class SessionImageCache {
    private entries = new Map<string, Entry>();
    private prefetchQueue: string[] = [];
    private disposed = false;
    private sequence = 0;
    has(path: string) { return !this.disposed && !!this.entries.get(path)?.data; }
    prefetch(path: string, priority = false) {
        if (this.disposed || !PREFETCH_URL_PATTERN.test(path))
            return;
        const existing = this.entries.get(path);
        if (existing) {
            existing.used = ++this.sequence;
            return;
        }
        const queued = this.prefetchQueue.indexOf(path);
        if (queued >= 0) {
            if (priority && queued > 0) {
                this.prefetchQueue.splice(queued, 1);
                this.prefetchQueue.unshift(path);
            }
            return;
        }
        if (priority) {
            this.prefetchQueue.unshift(path);
            if (this.prefetchQueue.length > MAX_PREFETCH_QUEUE)
                this.prefetchQueue.pop();
        }
        else {
            if (this.prefetchQueue.length >= MAX_PREFETCH_QUEUE)
                this.prefetchQueue.shift();
            this.prefetchQueue.push(path);
        }
        this.pumpPrefetch();
    }
    acquire(path: string): ImageLease {
        if (this.disposed)
            throw new DOMException('图片会话已结束。', 'AbortError');
        if (!MEDIA_URL_PATTERN.test(path))
            throw new Error('图片地址无效。');
        const queued = this.prefetchQueue.indexOf(path);
        if (queued >= 0)
            this.prefetchQueue.splice(queued, 1);
        let entry = this.entries.get(path);
        if (!entry) {
            if ([...this.entries.values()].filter(value => !value.data && !value.prefetching).length >= IMAGE_CACHE_MAX_PENDING)
                throw new Error('图片正在加载，请稍后重试。');
            while (this.entries.size >= IMAGE_CACHE_MAX_ENTRIES)
                this.evict();
            entry = { path, source: path.endsWith('view=source'), refs: 0, prefetching: false, used: ++this.sequence, controller: new AbortController(), promise: Promise.resolve({ url: '', bytes: 0 }) };
            this.entries.set(path, entry);
            entry.refs++;
            entry.promise = this.download(entry).finally(() => this.pumpPrefetch());
        }
        else {
            if (entry.prefetching && !entry.data)
                entry.prefetching = false;
            entry.refs++;
            entry.used = ++this.sequence;
        }
        const held = entry;
        const promise = held.data ? this.validate(held).then(() => { if (this.disposed || this.entries.get(path) !== held || !held.data)
            throw new DOMException('图片会话已结束。', 'AbortError'); return held.data; }) : held.promise;
        let released = false;
        return { promise, release: () => {
                if (released)
                    return;
                released = true;
                held.refs = Math.max(0, held.refs - 1);
                if (!held.refs) {
                    if (!held.data && !held.prefetching) {
                        held.controller.abort();
                        if (this.entries.get(path) === held)
                            this.entries.delete(path);
                    }
                    held.validation?.controller.abort();
                    this.pumpPrefetch();
                }
            } };
    }
    forget(path: string) { const queued = this.prefetchQueue.indexOf(path); if (queued >= 0)
        this.prefetchQueue.splice(queued, 1); const entry = this.entries.get(path); if (!entry)
        return; entry.prefetching = false; entry.controller.abort(); entry.validation?.controller.abort(); if (entry.data)
        URL.revokeObjectURL(entry.data.url); this.entries.delete(path); }
    dispose() { if (this.disposed)
        return; this.disposed = true; this.prefetchQueue.length = 0; for (const path of [...this.entries.keys()])
        this.forget(path); }
    private pumpPrefetch() {
        if (this.disposed)
            return;
        while (this.prefetchQueue.length > 0) {
            const activePrefetch = [...this.entries.values()].filter(value => value.prefetching && !value.data).length;
            const activeForeground = [...this.entries.values()].filter(value => !value.prefetching && !value.data).length;
            if (activePrefetch >= IMAGE_CACHE_MAX_PREFETCH || activeForeground >= IMAGE_CACHE_MAX_PENDING)
                return;
            while (this.entries.size >= IMAGE_CACHE_MAX_ENTRIES) {
                const candidate = [...this.entries.values()].filter(value => value.refs === 0 && value.data).sort((a, b) => a.used - b.used)[0];
                if (!candidate)
                    return;
                this.forget(candidate.path);
            }
            const next = this.prefetchQueue.shift();
            if (!next || this.entries.has(next))
                continue;
            const entry: Entry = { path: next, source: false, refs: 0, prefetching: true, used: ++this.sequence, controller: new AbortController(), promise: Promise.resolve({ url: '', bytes: 0 }) };
            this.entries.set(next, entry);
            entry.promise = this.download(entry).then(cached => { entry.prefetching = false; this.pumpPrefetch(); return cached; }, error => { entry.prefetching = false; this.pumpPrefetch(); throw error; });
            void entry.promise.catch(() => {});
        }
    }
    private evict(sourceOnly = false, except?: Entry) {
        if (!sourceOnly) {
            const background = [...this.entries.values()].filter(value => value !== except && value.refs === 0 && value.prefetching && !value.data).sort((a, b) => a.used - b.used)[0];
            if (background) {
                this.forget(background.path);
                return;
            }
        }
        const candidate = [...this.entries.values()].filter(value => value !== except && value.refs === 0 && value.data && (!sourceOnly || value.source)).sort((a, b) => a.used - b.used)[0];
        if (!candidate)
            throw new Error('图片暂存较多，请关闭其他图片后重试。');
        this.forget(candidate.path);
    }
    private async response(path: string, method: string, controller: AbortController) {
        const response = await fetch(path, { method, credentials: 'same-origin', cache: 'no-store', signal: controller.signal });
        controller.signal.throwIfAborted();
        if (response.status === 401)
            window.dispatchEvent(new Event('exam-auth-expired'));
        if (!response.ok)
            throw new Error(response.status === 401 ? '登录已失效，请重新登录。' : response.status === 403 || response.status === 404 ? '图片已失效或没有查看权限。' : '图片加载失败，请重试。');
        return response;
    }
    private validate(entry: Entry) {
        if (entry.validation && !entry.validation.controller.signal.aborted)
            return entry.validation.promise;
        const controller = new AbortController(), validation = { controller, promise: Promise.resolve() };
        entry.validation = validation;
        const timer = setTimeout(() => controller.abort(new DOMException('图片请求超时。', 'TimeoutError')), 50000);
        validation.promise = this.response(entry.path, 'HEAD', controller).then(() => { controller.signal.throwIfAborted(); }).catch(error => { if (!controller.signal.aborted && this.entries.get(entry.path) === entry)
            this.forget(entry.path); throw error; }).finally(() => { clearTimeout(timer); if (entry.validation === validation)
            delete entry.validation; });
        return validation.promise;
    }
    private async download(entry: Entry): Promise<CachedImage> {
        const timer = setTimeout(() => entry.controller.abort(new DOMException('图片请求超时。', 'TimeoutError')), 50000);
        try {
            const response = await this.response(entry.path, 'GET', entry.controller), type = response.headers.get('content-type')?.split(';')[0]?.trim();
            if (!type || !['image/jpeg', 'image/png', 'image/webp'].includes(type) || !response.body)
                throw new Error('图片格式无效。');
            const limit = entry.source ? EXAM_SOURCE_IMAGE_BYTES : EXAM_MODEL_IMAGE_BYTES, declared = Number(response.headers.get('content-length'));
            if (declared > limit)
                throw new Error('图片超过大小限制。');
            const reader = response.body.getReader(), chunks: ArrayBuffer[] = [];
            let bytes = 0;
            try {
                for (;;) {
                    const part = await reader.read();
                    if (part.done)
                        break;
                    bytes += part.value.byteLength;
                    if (bytes > limit)
                        throw new Error('图片超过大小限制。');
                    chunks.push(Uint8Array.from(part.value).buffer);
                }
            }
            finally {
                try {
                    await reader.cancel();
                }
                finally {
                    reader.releaseLock();
                }
            }
            if (!bytes)
                throw new Error('图片内容为空。');
            entry.controller.signal.throwIfAborted();
            if (this.disposed || this.entries.get(entry.path) !== entry || (!entry.refs && !entry.prefetching))
                throw new DOMException('图片请求已取消。', 'AbortError');
            const total = () => [...this.entries.values()].reduce((sum, value) => sum + (value.data?.bytes ?? 0), 0);
            while (total() + bytes > IMAGE_CACHE_BYTES)
                this.evict(false, entry);
            while (entry.source && [...this.entries.values()].filter(value => value.source && value.data).length >= IMAGE_CACHE_MAX_SOURCES)
                this.evict(true, entry);
            const url = URL.createObjectURL(new Blob(chunks, { type }));
            if (typeof Image === 'function') {
                const preload = new Image();
                preload.decoding = 'async';
                preload.src = url;
                void preload.decode?.().catch(() => {});
            }
            entry.data = { url, bytes };
            return entry.data;
        }
        catch (error) {
            if (this.entries.get(entry.path) === entry)
                this.forget(entry.path);
            throw error;
        }
        finally {
            clearTimeout(timer);
        }
    }
}
