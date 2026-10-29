import type { Model } from '@earendil-works/pi-ai';
import { MAX_MODEL_STREAM_BYTES, MAX_MODEL_JSON_BYTES } from '@solveflow/contracts/agent';
import { resolveThinking, type LocalModelProfile, type LocalDiagnostic } from '@solveflow/contracts/local';
import { SolvePhaseError } from '../orchestration/solve.js';
import { nonStreamResponse } from './non-stream-response.js';
export type LocalFetch = typeof globalThis.fetch;
/** Device effort ladder mapped to provider values; the UI offers exactly these three levels. */
const THINKING_EFFORT = {
  'thinking-type': { low: 'low', medium: 'high', high: 'max' },
  'enable-thinking': { low: 'low', medium: 'medium', high: 'high' },
  'reasoning-effort': { low: 'low', medium: 'medium', high: 'high' },
} as const;
/** Agent thinking level for the profile: off unless the switch is on, then the chosen effort. */
export function thinkingLevelOf(profile: LocalModelProfile): 'off' | 'low' | 'medium' | 'high' {
  const thinking = resolveThinking(profile);
  return thinking.mode === 'on' ? thinking.effort ?? 'medium' : 'off';
}
export function mobileModel(profile: LocalModelProfile): Model<'openai-completions'> {
  const thinking = resolveThinking(profile);
  const protocol = thinking.protocol ?? 'thinking-type';
  const active = thinking.mode !== 'provider-default';
  const on = thinking.mode === 'on';
  const ladder = THINKING_EFFORT[protocol];
  return { id: profile.model, name: profile.model, provider: profile.provider, api: 'openai-completions', baseUrl: profile.baseURL,
    // Pi's reasoning flag declares protocol capability; the agent's thinkingLevel drives the request.
    input: ['text', 'image'], reasoning: active, contextWindow: profile.contextWindow, maxTokens: profile.maxTokens,
    ...(on ? { thinkingLevelMap: { minimal: null, low: ladder.low, medium: ladder.medium, high: ladder.high, xhigh: null, max: null } }
      : protocol === 'reasoning-effort' ? { thinkingLevelMap: { off: 'none' } } : {}),
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    compat: { supportsStore: false, supportsDeveloperRole: false, supportsReasoningEffort: on || protocol === 'reasoning-effort', maxTokensField: profile.maxTokensField,
      ...(active ? { thinkingFormat: protocol === 'thinking-type' ? 'deepseek' : protocol === 'enable-thinking' ? 'qwen' : 'openai',
        // DeepSeek requires the reasoning field back on tool-carrying history once thinking is on.
        ...(on && protocol === 'thinking-type' ? { requiresReasoningContentOnAssistantMessages: true } : {}) } : {}) } };
}
export function responsesModel(profile: LocalModelProfile): Model<'openai-responses'> {
  const thinking = resolveThinking(profile);
  return { id: profile.model, name: profile.model, provider: profile.provider, api: 'openai-responses', baseUrl: profile.baseURL,
    input: ['text', 'image'], reasoning: thinking.mode !== 'provider-default', contextWindow: profile.contextWindow, maxTokens: profile.maxTokens,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, compat: { supportsDeveloperRole: false, supportsStrictMode: false } };
}
export function responsePayload(payload: unknown): unknown {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new SolvePhaseError('INVALID_INPUT');
  // Stateless tool continuations carry encrypted reasoning in memory only; never log it.
  return { ...payload, include: ['reasoning.encrypted_content'] };
}
/** No redirects, cookies, environment lookup, retries or model-selected destinations. */
export function modelTransport(profile: LocalModelProfile, transport: LocalFetch, observe?: (status: number | null, error?: SolvePhaseError, reason?: LocalDiagnostic['reason'], format?: LocalDiagnostic['responseFormat']) => void, streaming = profile.streaming ?? true): LocalFetch {
  return async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const endpoint = profile.api === 'openai-responses' ? 'responses' : 'chat/completions';
    if (url !== `${profile.baseURL}/${endpoint}` || init?.method?.toUpperCase() !== 'POST') throw new SolvePhaseError('CAPABILITY_DENIED');
    let response: Response;
    let bodyInit = init;
    // 只改变 HTTP 响应方式；JSON 在下方适配为 Pi 事件，工具续轮仍由 SDK 管理。
    if (!streaming) {
      if (typeof init?.body !== 'string') throw new SolvePhaseError('INVALID_INPUT');
      const value: unknown = JSON.parse(init.body);
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new SolvePhaseError('INVALID_INPUT');
      const body: Record<string, unknown> = { ...value, stream: false }; delete body.stream_options;
      bodyInit = { ...init, body: JSON.stringify(body) };
    }
    try { response = await transport(input, { ...bodyInit, credentials: 'omit', redirect: 'error', cache: 'no-store' }); }
    catch { const error = new SolvePhaseError('MODEL_UNAVAILABLE'); if (!init?.signal?.aborted) observe?.(null, error); throw error; }
    if (!response.ok) {
      // A local upload failure precedes model dispatch; keep it outside automatic fallback.
      const uploadTimeout = response.status === 408 && response.headers.get('x-solveflow-request-failure') === 'upload-timeout';
      const code = uploadTimeout ? 'MODEL_UPLOAD_TIMEOUT' : response.status === 401 || response.status === 403 ? 'CAPABILITY_DENIED'
        : response.status === 402 ? 'SPEND_LIMIT' : response.status === 429 ? 'MODEL_RATE_LIMITED'
        : response.status >= 400 && response.status < 500 && response.status !== 404 ? 'MODEL_REQUEST_REJECTED' : 'MODEL_UNAVAILABLE';
      const error = new SolvePhaseError(code); observe?.(response.status, error, uploadTimeout ? 'upload_timeout' : undefined); await response.body?.cancel(); throw error;
    }
    const format = response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() === 'text/event-stream' ? 'sse' : 'json';
    observe?.(response.status, undefined, undefined, format);
    if (!response.body) throw new SolvePhaseError('MODEL_OUTPUT_INVALID');
    const responseLimit = response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() === 'text/event-stream' ? MAX_MODEL_STREAM_BYTES : MAX_MODEL_JSON_BYTES;
    const reader = response.body.getReader(); let size = 0; let released = false;
    const release = () => { if (!released) { released = true; reader.releaseLock(); } };
    const body = new ReadableStream<Uint8Array>({
      async pull(controller) { try { const part = await reader.read(); if (part.done) { release(); controller.close(); return; } size += part.value.byteLength; if (size > responseLimit) { const error = new SolvePhaseError('MODEL_OUTPUT_INVALID'); observe?.(response.status, error, 'output_limit'); await reader.cancel(); release(); controller.error(error); return; } controller.enqueue(part.value); } catch { try { await reader.cancel(); } finally { release(); const error = new SolvePhaseError('MODEL_UNAVAILABLE'); if (!init?.signal?.aborted) observe?.(null, error); controller.error(error); } } },
      async cancel() { try { if (!released) await reader.cancel(); } finally { release(); } },
    });
    // RN's global Response is a legacy polyfill that cannot construct a streaming body.
    // Preserve Expo's actual response and bind its native-backed getters/methods.
    const bounded = new Proxy(response, { get(target, property) { if (property === 'body') return body; const value: unknown = Reflect.get(target, property, target); return typeof value === 'function' ? value.bind(target) : value; } });
    if (streaming || format === 'sse') return bounded;
    try { return await nonStreamResponse(bounded, profile.api, init?.signal); }
    catch (cause) { if (cause instanceof SolvePhaseError && cause.code === 'MODEL_OUTPUT_INVALID') observe?.(response.status, cause, 'json', format); throw cause; }
  };
}
