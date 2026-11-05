import { newRequestId } from './request-id.js';
// Decision: .agents/notes/implemented/architecture/2026-11-03-browser-intent-lifecycle.md
import { z } from 'zod';
export class RequestError extends Error {
    constructor(readonly status: number, message: string) { super(message); }
}
export async function api<T>(path: string, schema: z.ZodType<T>, init: RequestInit = {}, timeoutMs = 50000): Promise<T> {
    const controller = new AbortController(), owner = init.signal;
    const abort = () => controller.abort(owner?.reason);
    owner?.addEventListener('abort', abort, { once: true });
    if (owner?.aborted) abort();
    const timer = setTimeout(() => controller.abort(new DOMException('请求超时，请重试。', 'TimeoutError')), Math.min(50000, Math.max(1, timeoutMs)));
    try {
        const response = await fetch('/api/v2' + path, { ...init, credentials: 'same-origin', signal: controller.signal });
        const value: unknown = await response.json();
        if (!response.ok) {
            if (response.status === 401 && path !== '/auth/login' && path !== '/session')
                window.dispatchEvent(new Event('exam-auth-expired'));
            const parsed = z.object({ message: z.string() }).safeParse(value);
            throw new RequestError(response.status, parsed.success ? parsed.data.message : '请求未完成。');
        }
        return schema.parse(value);
    } finally {
        clearTimeout(timer);
        owner?.removeEventListener('abort', abort);
    }
}
export const post = (value: unknown): RequestInit => ({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(value) });
export const idResponse = z.strictObject({ id: z.uuid() });
export function identityChanged() { try {
    localStorage.setItem('solveflow-exam-auth-change', newRequestId());
}
catch { /* Cookie authentication remains authoritative when localStorage is unavailable. */ } }
