import { LocalRepository, LocalEngine, type DeviceSolve } from '@solveflow/client/local';
import { makeSafeAgentError } from '@solveflow/contracts/agent';
import { PhotoStreamMessageSchema } from '@solveflow/contracts/photo';
import { openPhotoDocuments } from './documents.js';
export async function openPhotoRuntime(accountId: string) {
  let unlock = () => {};
  if (navigator.locks) await new Promise<void>((resolve, reject) => {
    void navigator.locks.request('solveflow-photo-' + accountId, { ifAvailable: true }, async lock => {
      if (!lock) { reject(new Error('当前浏览器已有拍题页面，请先关闭另一页。')); return; }
      await new Promise<void>(release => { unlock = release; resolve(); });
    }).catch(reject);
  });
  try {
    const storage = await openPhotoDocuments(accountId); const repository = new LocalRepository(storage.documents);
    try { await repository.recoverInterrupted(); } catch (e) { storage.close(); throw e; }
    const engine = new LocalEngine(repository, () => crypto.randomUUID());
    return { repository, engine, close: async () => { try { await engine.cancel(); } finally { storage.close(); unlock(); } } };
  } catch (e) { unlock(); throw e; }
}
export type PhotoRuntime = Awaited<ReturnType<typeof openPhotoRuntime>>;
export const executePhoto: DeviceSolve = async (input, signal, onEvent) => {
  const blob = new Blob([Uint8Array.from(input.image.bytes)], { type: 'image/jpeg' });
  const image = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onerror = () => reject(new Error('题图读取失败。')); reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('题图读取失败。')); reader.readAsDataURL(blob); });
  const response = await fetch('/api/solve', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ schemaVersion: 1, requestId: input.identity.runId, sessionId: input.identity.sessionId, exam: input.exam ?? 'general', image }), signal, cache: 'no-store', redirect: 'error' });
  if (response.status === 401) { window.dispatchEvent(new Event('photo-auth-expired')); throw new Error('登录已失效。'); }
  if (!response.ok || !response.body) {
    let message = '请求未完成，请稍后重试。';
    try { const v: unknown = await response.json(); if (v && typeof v === 'object' && 'message' in v && typeof v.message === 'string' && v.message.length <= 120) message = v.message; } catch { /* Keep the public fallback. */ }
    window.dispatchEvent(new CustomEvent('photo-service-error', { detail: message }));
    return { schemaVersion: 1, status: 'failed', verified: false, error: makeSafeAgentError('MODEL_UNAVAILABLE', input.identity.runId) };
  }
  const reader = response.body.getReader(); const decoder = new TextDecoder(); let buffer = '', total = 0;
  try {
    while (true) {
      signal.throwIfAborted(); const part = await reader.read();
      if (part.done) break;
      total += part.value.byteLength; if (total > 2 * 1024 * 1024) throw new Error('返回内容超出限制。');
      buffer += decoder.decode(part.value, { stream: true });
      for (let end = buffer.indexOf('\n'); end >= 0; end = buffer.indexOf('\n')) {
        const line = buffer.slice(0, end).trim(); buffer = buffer.slice(end + 1); if (!line) continue;
        const value: unknown = JSON.parse(line); const message = PhotoStreamMessageSchema.parse(value);
        if (message.type === 'event') onEvent(message.event); else return message.outcome;
      }
    }
    throw new Error('连接中断，未收到完整答案。');
  } finally { await reader.cancel().catch(() => undefined); reader.releaseLock(); }
};
