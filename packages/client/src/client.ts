import { z } from "zod";
import { ApiErrorSchema, BootstrapSchema, NativeBootstrapSchema, NATIVE_CLIENT_HEADER, ResourceIdSchema, type RunEvent } from "@solveflow/contracts/http";
import { RunEventDecoder } from "./sse.js";
import { ClientError } from './errors.js';
export { ClientError, clientError } from './errors.js';
export interface ClientStore { get(key: string): Promise<string | null>; set(key: string, value: string): Promise<void>; remove(key: string): Promise<void> }
export type Transport = (url: string, init?: RequestInit) => Promise<Response>;
export function apiOrigin(value: string, development = false): string {
  const url = new URL(value);
  const local = /^(localhost|127\.0\.0\.1|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+)$/.test(url.hostname);
  if (url.username || url.password || url.search || url.hash || url.pathname !== "/" || !(url.protocol === "https:" || (development && local && url.protocol === "http:"))) throw new Error("服务地址必须是 HTTPS 域名；开发环境可使用本地地址。");
  return url.origin;
}
export function createClient(options: { origin: string; native: boolean; store: ClientStore; transport: Transport; development?: boolean }) {
  const transport = options.transport;
  const origin = apiOrigin(options.origin, options.development); let token: string | null = null;
  const credentialKey = `identity.${encodeURIComponent(origin)}`;
  const headers = (init?: HeadersInit) => {
    const value = new Headers(init);
    if (options.native) { value.set("x-solveflow-client", NATIVE_CLIENT_HEADER); if (token) value.set("authorization", `Bearer ${token}`); }
    return value;
  };
  async function response(path: string, init: RequestInit = {}, timeout = 20_000) {
    if (!/^\/[a-zA-Z0-9/?=&_-]*$/.test(path) || path.startsWith("//")) throw new Error("请求路径无效。");
    const result = await transport(`${origin}/api/v1${path}`, { ...init, headers: headers(init.headers), credentials: options.native ? "omit" : "same-origin", cache: "no-store", redirect: "error", signal: AbortSignal.any([AbortSignal.timeout(timeout), ...(init.signal ? [init.signal] : [])]) });
    if (!result.ok) {
      let value: unknown; try { value = await result.json(); } catch { value = null; }
      const parsed = ApiErrorSchema.safeParse(value);
      throw new ClientError(parsed.success ? parsed.data.error.message : "服务暂不可用，请稍后重试。", parsed.success ? parsed.data.error.code : "NETWORK_ERROR");
    }
    return result;
  }
  async function request<T>(path: string, schema: z.ZodType<T>, init: RequestInit = {}): Promise<T> {
    const result = await response(path, init);
    return schema.parse(result.status === 204 ? null : await result.json());
  }
  return {
    request,
    async bootstrap(signal?: AbortSignal) {
      const init: RequestInit = { method: "POST", ...(signal ? { signal } : {}) };
      if (!options.native) return request("/bootstrap", BootstrapSchema, init);
      token = await options.store.get(credentialKey);
      const value = await request("/native/bootstrap", NativeBootstrapSchema, init);
      await options.store.set(credentialKey, value.accessToken); token = value.accessToken;
      const { accessToken: _accessToken, ...publicValue } = value;
      return BootstrapSchema.parse(publicValue);
    },
    async image(id: string, signal?: AbortSignal) {
      const result = await response(`/uploads/${ResourceIdSchema.parse(id)}/image`, signal ? { signal } : {});
      if (!result.headers.get("content-type")?.startsWith("image/jpeg")) throw new Error("题图格式无效。");
      const bytes = await boundedBytes(result, 4 * 1024 * 1024);
      return `data:image/jpeg;base64,${base64(bytes)}`;
    },
    async sample(signal?: AbortSignal) { return (await response("/demo-image", signal ? { signal } : {})).blob(); },
    async events(runId: string, after: number, signal: AbortSignal, onEvent: (event: RunEvent) => void) {
      ResourceIdSchema.parse(runId); z.number().int().min(0).max(128).parse(after);
      const result = await response(`/runs/${runId}/events?after=${after}`, { signal, headers: { Accept: "text/event-stream" } }, 130_000);
      if (!result.body || !result.headers.get("content-type")?.startsWith("text/event-stream")) throw new Error("进度连接暂不可用。");
      const reader = result.body.getReader(); const decoder = new RunEventDecoder(runId, after);
      try { while (!signal.aborted) { const chunk = await reader.read(); if (chunk.done) break; for (const event of decoder.push(chunk.value)) { signal.throwIfAborted(); onEvent(event); } } }
      finally { await reader.cancel().catch(() => undefined); reader.releaseLock(); }
    },
  };
}
async function boundedBytes(response: Response, limit: number) {
  if (!response.body) throw new Error("题图读取失败。");
  const reader = response.body.getReader(); const parts: Uint8Array[] = []; let size = 0;
  try {
    while (true) { const chunk = await reader.read(); if (chunk.done) break; size += chunk.value.byteLength; if (size > limit) throw new Error("题图过大。"); parts.push(chunk.value); }
    const bytes = new Uint8Array(size); let offset = 0; for (const part of parts) { bytes.set(part, offset); offset += part.length; } return bytes;
  } finally { await reader.cancel().catch(() => undefined); reader.releaseLock(); }
}
export function base64(bytes: Uint8Array) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"; let result = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i] ?? 0; const b = bytes[i + 1] ?? 0; const c = bytes[i + 2] ?? 0;
    result += alphabet[a >> 2]! + alphabet[((a & 3) << 4) | (b >> 4)]! + (i + 1 < bytes.length ? alphabet[((b & 15) << 2) | (c >> 6)] : "=") + (i + 2 < bytes.length ? alphabet[c & 63] : "=");
  } return result;
}
export const jsonRequest = (value: unknown): RequestInit => ({ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(value) });
export type SolveClient = ReturnType<typeof createClient>;
