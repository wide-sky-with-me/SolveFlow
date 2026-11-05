// Decision: .agents/notes/implemented/architecture/2026-11-03-browser-intent-lifecycle.md
// Decision: .agents/notes/implemented/architecture/2026-11-04-photo-view-ordering.md
import { z } from 'zod';
import { PhotoJobSnapshotSchema, type PhotoJobSnapshot } from '@solveflow/contracts/photo';
import { makeSafeAgentError, type SolveOutcome } from '@solveflow/contracts/agent';
import { type DeviceSolve, type LocalDocuments, type LocalEngine, type LocalRepository } from '@solveflow/client/local';
const Marker = z.strictObject({ schemaVersion: z.literal(1), requestId: z.uuid(), sessionId: z.uuid(), createdAt: z.number().int() });
const prefix = 'photo-remote.';
class ResponseError extends Error { constructor(readonly status: number, message: string) { super(message); } }
class StatusReadWoken extends Error {}
async function jobRequest(path: string, init: RequestInit = {}, signal?: AbortSignal): Promise<PhotoJobSnapshot | null> {
  const controller = new AbortController(), abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true }); if (signal?.aborted) controller.abort();
  const timer = setTimeout(abort, init.method === 'POST' && path === '' ? 45000 : 10000);
  const statusRead = (!init.method || init.method === 'GET') && /^\/[a-f0-9-]{36}$/.test(path);
  let woken = false;
  const resume = () => { if (!controller.signal.aborted) { woken = true; controller.abort(); } };
  const foreground = () => { if (document.visibilityState === 'visible') resume(); };
  if (statusRead) {
    window.addEventListener('online', resume); window.addEventListener('pageshow', foreground);
    document.addEventListener('visibilitychange', foreground);
  }
  try {
    const response = await fetch('/api/jobs' + path, { ...init, credentials: 'same-origin', cache: 'no-store', redirect: 'error', signal: controller.signal });
    if (response.status === 401) { window.dispatchEvent(new Event('photo-auth-expired')); throw new Error('登录已失效。'); }
    if (response.status === 404 && (init.method !== 'POST' || path.endsWith('/cancel'))) return null;
    const text = await response.text(); if (text.length > 2 * 1024 * 1024) throw new Error('返回内容超过限制。');
    const raw: unknown = JSON.parse(text);
    if (!response.ok) { const error = z.object({ message: z.string().max(120) }).safeParse(raw); throw new ResponseError(response.status, error.success ? error.data.message : '请求未完成。'); }
    return PhotoJobSnapshotSchema.parse(raw);
  } catch (error) {
    if (woken && !signal?.aborted) throw new StatusReadWoken();
    throw error;
  } finally {
    clearTimeout(timer); signal?.removeEventListener('abort', abort);
    window.removeEventListener('online', resume); window.removeEventListener('pageshow', foreground);
    document.removeEventListener('visibilitychange', foreground);
  }
}
const post = (value: unknown): RequestInit => ({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(value) });
function wait(signal: AbortSignal, ms = 2000) {
  return new Promise<void>((resolve, reject) => {
    const cleanup = () => { clearTimeout(timer); signal.removeEventListener('abort', abort); window.removeEventListener('online', finish); window.removeEventListener('pageshow', finish); document.removeEventListener('visibilitychange', foreground); };
    const finish = () => { cleanup(); resolve(); }, abort = () => { cleanup(); reject(new DOMException('已取消。', 'AbortError')); };
    const foreground = () => { if (document.visibilityState === 'visible') finish(); };
    const timer = setTimeout(finish, ms); signal.addEventListener('abort', abort, { once: true }); window.addEventListener('online', finish); window.addEventListener('pageshow', finish); document.addEventListener('visibilitychange', foreground); if (signal.aborted) abort();
  });
}
function outcome(snapshot: PhotoJobSnapshot): SolveOutcome | null {
  if (snapshot.status === 'finished') return snapshot.outcome;
  if (snapshot.status === 'cancelled') return { schemaVersion: 1, status: 'cancelled', verified: false, error: makeSafeAgentError('CANCELLED', snapshot.requestId) };
  if (snapshot.status === 'interrupted') return { schemaVersion: 1, status: 'failed', verified: false, error: makeSafeAgentError('WORKER_LOST', snapshot.requestId) };
  return null;
}
/** Markers contain identities only. Resume performs status reads, never resubmits the image. */
export async function remoteJobs(documents: LocalDocuments, repository: LocalRepository, engine: LocalEngine) {
  const listeners = new Set<() => void>(), pending = new Map<string, z.infer<typeof Marker>>();
  const cancellations = new Map<string, 'syncing' | 'waiting'>();
  const cancelTasks = new Map<string, Promise<boolean>>();
  const keys = (await documents.keys()).filter(key => key.startsWith(prefix)); if (keys.length > 20) throw new Error('待同步任务过多，请先处理已有记录。');
  for (const key of keys) { const marker = Marker.parse(JSON.parse(await documents.get(key) ?? 'null')); pending.set(marker.requestId, marker); }
  const ids = await repository.recordIds({ strict: true });
  for (const marker of pending.values()) {
    if (!ids.includes(marker.sessionId)) { cancellations.set(marker.requestId, 'syncing'); continue; }
    const run = (await repository.readMetadata(marker.sessionId)).session.runs.at(-1);
    if (!run || run.id !== marker.requestId || run.status === 'cancelled') cancellations.set(marker.requestId, 'syncing');
  }
  let disposed = false, syncing = false;
  const controller = new AbortController();
  const emit = () => { for (const listener of listeners) listener(); };
  async function forget(id: string) { await documents.remove(prefix + id); pending.delete(id); cancellations.delete(id); emit(); }
  function cancelMarker(marker: z.infer<typeof Marker>) {
    const current = cancelTasks.get(marker.requestId);
    if (current) return current;
    const task = performCancellation(marker).finally(() => cancelTasks.delete(marker.requestId));
    cancelTasks.set(marker.requestId, task);
    return task;
  }
  async function performCancellation(marker: z.infer<typeof Marker>) {
    // Local cancellation is durable first. The identity marker remains until the server acknowledges it.
    await repository.recoverRemoteRun(marker.sessionId, marker.requestId, { schemaVersion: 1, status: 'cancelled', verified: false, error: makeSafeAgentError('CANCELLED', marker.requestId) });
    if (!cancellations.has(marker.requestId)) cancellations.set(marker.requestId, 'syncing');
    emit();
    try { await jobRequest('/' + marker.requestId + '/cancel', post({}), controller.signal); }
    catch (error) {
      cancellations.set(marker.requestId, 'waiting'); emit();
      if (error instanceof TypeError || error instanceof DOMException && error.name === 'AbortError') return false;
      throw error;
    }
    if (disposed) return false;
    await forget(marker.requestId);
    return true;
  }
  async function sync() {
    if (disposed || syncing || engine.storageBlocked) return;
    syncing = true;
    try {
      const ids = await repository.recordIds({ strict: true });
      for (const marker of pending.values()) {
        if (disposed) break;
        if (engine.actives.some(run => run.id === marker.requestId)) continue;
        if (!ids.includes(marker.sessionId)) { await cancelMarker(marker); continue; }
        const record = await repository.readMetadata(marker.sessionId), run = record.session.runs.at(-1);
        if (!run || run.id !== marker.requestId || run.status === 'cancelled') { await cancelMarker(marker); continue; }
        if (run.outcome && !(run.status === 'failed' && 'error' in run.outcome && run.outcome.error.code === 'WORKER_LOST')) { await forget(marker.requestId); continue; }
        const snapshot = await jobRequest('/' + marker.requestId, {}, controller.signal);
        if (!snapshot) { if (Date.now() - marker.createdAt > 6 * 60000) await forget(marker.requestId); continue; }
        if (snapshot.sessionId !== marker.sessionId || snapshot.requestId !== marker.requestId) throw new Error('任务标识不匹配。');
        const result = outcome(snapshot);
        if (result) { await repository.recoverRemoteRun(marker.sessionId, marker.requestId, result); await forget(marker.requestId); }
      }
    } catch (error) { if (!disposed && !(error instanceof StatusReadWoken)) window.dispatchEvent(new CustomEvent('photo-service-error', { detail: error instanceof Error ? error.message : '同步暂未完成。' })); }
    finally { syncing = false; emit(); }
  }
  const execute: DeviceSolve = async (input, signal, onEvent) => {
    if (pending.size >= 20) throw new Error('待同步任务过多。');
    const marker = { schemaVersion: 1 as const, requestId: input.identity.runId, sessionId: input.identity.sessionId, createdAt: Date.now() };
    await documents.put(prefix + marker.requestId, JSON.stringify(marker)); pending.set(marker.requestId, marker); emit();
    const cancel = () => { void jobRequest('/' + marker.requestId + '/cancel', { ...post({}), keepalive: true }).catch(() => undefined); };
    signal.addEventListener('abort', cancel, { once: true });
    try {
      const bytes = Uint8Array.from(input.image.bytes); const blob = new Blob([bytes], { type: 'image/jpeg' });
      const image = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('图片读取失败。')); reader.onerror = () => reject(new Error('图片读取失败。')); reader.readAsDataURL(blob); });
      let snapshot: PhotoJobSnapshot | null = null;
      try { snapshot = await jobRequest('', post({ schemaVersion: 1, requestId: marker.requestId, sessionId: marker.sessionId, exam: input.exam ?? 'general', image }), signal); }
      catch (error) { if (signal.aborted) throw error; if (error instanceof ResponseError && error.status < 500) { window.dispatchEvent(new CustomEvent('photo-service-error', { detail: error.message })); return { schemaVersion: 1, status: 'failed', verified: false, error: makeSafeAgentError('MODEL_UNAVAILABLE', marker.requestId) }; } /* Unknown admission: only query the same identity below. */ }
      while (!signal.aborted) {
        if (snapshot) {
          if (snapshot.requestId !== marker.requestId || snapshot.sessionId !== marker.sessionId) throw new Error('任务标识不匹配。');
          if (snapshot.event) onEvent(snapshot.event);
          const result = outcome(snapshot); if (result) return result;
        }
        if (Date.now() - marker.createdAt > 6 * 60000) return { schemaVersion: 1, status: 'failed', verified: false, error: makeSafeAgentError('WORKER_LOST', marker.requestId) };
        await wait(signal);
        try { snapshot = await jobRequest('/' + marker.requestId, {}, signal); } catch (error) { if (signal.aborted) throw error; snapshot = null; }
      }
      signal.throwIfAborted(); throw new Error('CANCELLED');
    } finally { signal.removeEventListener('abort', cancel); }
  };
  const wake = () => { if (document.visibilityState === 'visible') void sync(); };
  const timer = setInterval(() => { if (pending.size && document.visibilityState === 'visible') void sync(); }, 2000);
  window.addEventListener('online', wake); window.addEventListener('pageshow', wake); document.addEventListener('visibilitychange', wake);
  const unsubscribe = engine.subscribe(() => { void sync(); }), unstore = engine.subscribeStorage(() => { void sync(); });
  void sync();
  return {
    execute,
    get pending() { return [...pending.keys()].some(id => !cancellations.has(id)); },
    get cancellationPending() { return [...cancellations.values()].some(status => status === 'waiting'); },
    latestSessionId: [...pending.values()].at(-1)?.sessionId,
    has: (id: string) => pending.has(id) && !cancellations.has(id),
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    cancel: async () => { await engine.cancel(); for (const marker of [...pending.values()]) await cancelMarker(marker); },
    dispose: () => { disposed = true; controller.abort(); clearInterval(timer); unsubscribe(); unstore(); window.removeEventListener('online', wake); window.removeEventListener('pageshow', wake); document.removeEventListener('visibilitychange', wake); listeners.clear(); },
  };
}
