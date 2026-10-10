// Decision: .agents/notes/implemented/architecture/2026-10-09-batch-dispatch-and-verification.md
// Decision: .agents/notes/implemented/agent/2026-10-09-direct-answer-review.md
// Decision: .agents/notes/implemented/agent/2026-10-08-exam-flow-evidence-and-budgets.md
import { Agent, type AgentTool } from '@earendil-works/pi-agent-core';
import { Type, type Model } from '@earendil-works/pi-ai';
import { stream } from '@earendil-works/pi-ai/api/openai-completions';
import { stream as streamResponses } from '@earendil-works/pi-ai/api/openai-responses';
import { z } from 'zod';
import { DEVICE_RUN_DURATION_MS, MAX_DEVICE_PHASE_DURATION_MS, MAX_DEVICE_SOLVER_PHASE_MS, MAX_DEVICE_VERIFIER_PHASE_MS, MAX_DEVICE_BRIEF_THINKING_MS, MAX_VERIFIER_PHASE_ATTEMPTS, MAX_MODEL_STREAM_BYTES, MAX_MODEL_JSON_BYTES, MAX_SOLVER_MODEL_ATTEMPTS, MAX_VERIFIER_MODEL_ATTEMPTS, BriefSolverCandidateSchema, GeneratedSolverCandidateSchema, VerificationSchema, normalizeGeneratedCandidate, parseCandidateWithEvidence, parseCandidateForExam, parseVerificationForCandidate, type AgentInput, type AnswerCandidate, type PhaseResult, type SolverInput, type PublicAgentEvent } from '@solveflow/contracts/agent';
import { MAX_QUESTION_IMAGE_BYTES, LocalDiagnosticSchema, resolveThinking, ExamTypeSchema, type ExamType, type LocalDiagnostic, LocalSettingsSchema, LocalKeySchema, type LocalModelProfile, type LocalSettings } from '@solveflow/contracts/local';
import { solve, SolvePhaseError, type SolveLifecycle } from '../orchestration/solve.js';
import { assessVerificationCoverage } from './verification-coverage.js';
import { RunBudget } from '../policy/run-budget.js';
import { calculate } from '../tools/calculate.js';
import { resources, skills, policies } from './mobile-resources.js';
import { finishContext } from './finish-context.js';
import { nonStreamResponse } from './non-stream-response.js';
export type LocalCredentials = { solver: string; verifier: string | null; backup?: string | null };
export type LocalFetch = typeof globalThis.fetch;
export type PhaseTimer = (callback: () => void, ms: number) => () => void;
const defaultTimer: PhaseTimer = (callback, ms) => { const id = setTimeout(callback, ms); return () => clearTimeout(id); };
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
function mobileModel(profile: LocalModelProfile): Model<'openai-completions'> {
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
function responsesModel(profile: LocalModelProfile): Model<'openai-responses'> {
  const thinking = resolveThinking(profile);
  return { id: profile.model, name: profile.model, provider: profile.provider, api: 'openai-responses', baseUrl: profile.baseURL,
    input: ['text', 'image'], reasoning: thinking.mode !== 'provider-default', contextWindow: profile.contextWindow, maxTokens: profile.maxTokens,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, compat: { supportsDeveloperRole: false, supportsStrictMode: false } };
}
function responsePayload(payload: unknown): unknown {
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
      const code = response.status === 401 || response.status === 403 ? 'CAPABILITY_DENIED'
        : response.status === 402 ? 'SPEND_LIMIT' : response.status === 429 ? 'MODEL_RATE_LIMITED'
        : response.status >= 400 && response.status < 500 && response.status !== 404 ? 'MODEL_REQUEST_REJECTED' : 'MODEL_UNAVAILABLE';
      const error = new SolvePhaseError(code); observe?.(response.status, error); await response.body?.cancel(); throw error;
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
export function readMobileSkill(path: string): string {
  if (!/^\/skills\/[a-z]+\/(?:references\/)?[a-zA-Z.-]+\.md$/.test(path) || path.includes('..') || !Object.hasOwn(resources, path)) throw new SolvePhaseError('CAPABILITY_DENIED');
  return resources[path]!;
}
/** Explicit user context selects only two reviewed resources; other skills remain on demand. */
export function preloadExamResources(value: ExamType = 'general'): string {
  const exam = ExamTypeSchema.parse(value);
  if (exam === 'general') return '';
  const paths = ['/skills/exams/SKILL.md', `/skills/exams/references/${exam}.md`];
  return '\n已加载考试方法（由应用提供的当前内置版本）：\n' + paths.map(path => `来源：${path}\n${readMobileSkill(path)}`).join('\n\n')
    + '\n以上两个文件已完整提供，本轮无需重复read。其他缺少的方法仍按需读取。exam是用户选择的默认考试背景；原题或用户明确更正另一考试时，以更正为准并读取对应方法；不把考试背景当作题目答案或缺失条件。\n';
}
export function sanitizeJsonStringEscapes(text: string): string {
  let result = '';
  let inString = false;
  let i = 0;
  while (i < text.length) {
    const ch = text[i]!;
    if (!inString) {
      if (ch === '"') inString = true;
      result += ch;
      i++;
      continue;
    }
    if (ch === '"') {
      inString = false;
      result += ch;
      i++;
      continue;
    }
    if (ch === '\\') {
      const next = text[i + 1];
      if (next === undefined) {
        result += '\\\\';
        i++;
        continue;
      }
      const rest = text.slice(i + 1);
      if (/^(?:frac|text|times|theta|tau|begin|beta|bar|bold)/i.test(rest)) {
        result += '\\\\';
        i++;
        continue;
      }
      if (['"', '\\', '/', 'b', 'f', 'n', 'r', 't'].includes(next)) {
        result += ch + next;
        i += 2;
        continue;
      }
      if (next === 'u' && /^[0-9a-fA-F]{4}/.test(text.slice(i + 2, i + 6))) {
        result += text.slice(i, i + 6);
        i += 6;
        continue;
      }
      result += '\\\\';
      i++;
      continue;
    }
    if (ch === '\n') { result += '\\n'; i++; continue; }
    if (ch === '\r') { result += '\\r'; i++; continue; }
    if (ch === '\t') { result += '\\t'; i++; continue; }
    result += ch;
    i++;
  }
  return result;
}

export function parseModelJson(raw: string): unknown {
  try { return JSON.parse(raw); } catch {}
  let text = raw.trim();
  const fenceMatch = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fenceMatch) {
    text = fenceMatch[1]!.trim();
  } else {
    const firstBrace = text.indexOf('{');
    const lastBrace = text.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
      text = text.slice(firstBrace, lastBrace + 1);
    }
  }
  try { return JSON.parse(text); } catch {}
  const sanitized = sanitizeJsonStringEscapes(text);
  try { return JSON.parse(sanitized); } catch {}
  const noTrailingCommas = sanitized.replace(/,(\s*[}\]])/g, '$1');
  return JSON.parse(noTrailingCommas);
}

function encode(bytes: Uint8Array): string { let text = ''; for (let i = 0; i < bytes.length; i += 8192) text += String.fromCharCode(...bytes.subarray(i, i + 8192)); return btoa(text); }
async function phase(input: AgentInput, budget: RunBudget, signal: AbortSignal, settings: LocalSettings, keys: LocalCredentials, fetch: LocalFetch, onDiagnostic: (entry: LocalDiagnostic) => void, schedule: PhaseTimer, override?: { profile?: LocalModelProfile; key?: string; backup?: boolean; maxSolverMs?: number; allowThinkingTakeover?: boolean }): Promise<PhaseResult> {
  const profile = input.role === 'verifier' ? settings.verifier ?? settings.solver : override?.profile ?? settings.solver;
  const streaming = profile.streaming ?? (input.role === 'solver' && !override?.backup);
  const key = LocalKeySchema.parse(input.role === 'verifier' && settings.verifier ? keys.verifier : input.role === 'solver' ? override?.key ?? keys.solver : keys.solver);
  const started = performance.now(); let attemptNumber = 0; let requestStarted = started; let firstTokenMs: number | undefined;
  let clearThinkingTimer: () => void = () => {}; let thinkingTimerStarted = false; let visibleOutput = false; let thinkingBytes = 0;
  let lastProgressAt: number | undefined; let repairReserved = false; let transientRetryUsed = false; let lastHttpStatus: number | null = null;
  const diagnostic = (entry: Omit<LocalDiagnostic, 'schemaVersion' | 'runId' | 'role' | 'attempt' | 'elapsedMs'>) => onDiagnostic(LocalDiagnosticSchema.parse({ schemaVersion: 1, runId: input.identity.runId, role: override?.backup ? 'backup' : input.role, attempt: attemptNumber, elapsedMs: Math.round(performance.now() - started), ...entry }));
  const model = profile.api === 'openai-responses' ? responsesModel(profile) : mobileModel(profile); let failure: unknown; let timedOut = false;
  const controller = new AbortController(); const abort = () => controller.abort(); signal.addEventListener('abort', abort, { once: true }); if (signal.aborted) abort();
  // Decision: .agents/notes/implemented/agent/2026-10-07-exam-reliability-recovery.md
  // Decision: .agents/notes/implemented/agent/2026-10-08-unlimited-device-time.md
  // Decision: .agents/notes/implemented/agent/2026-10-08-device-time-and-stream-budget.md
  // Decision: .agents/notes/implemented/architecture/2026-10-09-batch-retry-and-phase-time.md
  const maxVerifierMs = input.role === 'verifier' ? MAX_DEVICE_VERIFIER_PHASE_MS : 0;
  const maxSolverMs = override?.maxSolverMs ?? (input.verificationMode === 'manual' ? MAX_DEVICE_PHASE_DURATION_MS : MAX_DEVICE_SOLVER_PHASE_MS);
  const phaseMs = Math.min(input.role === 'verifier' ? maxVerifierMs : maxSolverMs, budget.remainingMs());
  if (phaseMs <= 0) { signal.removeEventListener('abort', abort); budget.assertActive(signal); throw new SolvePhaseError('MODEL_TIMEOUT'); }
  let phaseDeadline = started + phaseMs;
  const expire = () => {
    const now = performance.now();
    // Recent stream progress may finish a slow first solve; idle/stalled calls cannot borrow.
    if (input.role === 'solver' && !override?.maxSolverMs && input.verificationMode !== 'manual' && !repairReserved && !signal.aborted && !controller.signal.aborted && firstTokenMs !== undefined && lastProgressAt !== undefined && now - lastProgressAt <= 10_000) {
      const extraMs = Math.min(started + phaseMs + 15_000 - now, budget.remainingMs() - 15_000);
      if (extraMs > 0) { clearTimer(); phaseDeadline = now + extraMs; clearTimer = schedule(expire, extraMs); return; }
    }
    diagnostic({ event: 'failure', reason: 'deadline', phaseMs: Math.round(phaseDeadline - started), ...(firstTokenMs === undefined ? {} : { firstTokenMs }) });
    timedOut = true; controller.abort();
  };
  let clearTimer = schedule(expire, phaseMs);
  const reserveRepair = () => {
    if (!budget.tryReserveFormatRepair(signal)) return false;
    repairReserved = true;
    if (input.role === 'solver' && !override?.maxSolverMs && input.verificationMode !== 'manual') {
      // Only the existing, once-per-run repair may borrow time; no first-call retry.
      const repairMs = Math.min(20_000, Math.max(0, budget.remainingMs() - 15_000));
      const remainingPhase = phaseDeadline - performance.now();
      if (repairMs > remainingPhase) {
        clearTimer(); phaseDeadline = performance.now() + repairMs; clearTimer = schedule(expire, repairMs);
      }
    }
    return true;
  };
  const seenTools = new Map<string, number>();
  let consecutiveToolErrors = 0; let finishOnly = input.role === 'verifier'; let finalAttempted = false;
  let toolStopReason: LocalDiagnostic['toolStopReason'];
  const finishTools = (reason: NonNullable<LocalDiagnostic['toolStopReason']>) => { finishOnly = true; toolStopReason ??= reason; };
  const tools: AgentTool[] = input.role === 'solver' ? [
    { name: 'read', label: '读取解题方法', description: '读取内置白名单 Skill 或其参考资料；path 使用 /skills/ 开头的完整路径。', parameters: Type.Object({ path: Type.String({ maxLength: 160 }) }),
      execute: async (_id, args) => { const began = performance.now(); try { budget.reserveTool('file', controller.signal); const value = z.strictObject({ path: z.string().max(160) }).parse(args); const text = readMobileSkill(value.path); diagnostic({ event: 'tool', toolName: 'read', toolStatus: 'completed', resourcePath: value.path, durationMs: Math.round(performance.now() - began) }); return { content: [{ type: 'text', text }], details: {} }; } catch (error) { diagnostic({ event: 'tool', toolName: 'read', toolStatus: 'failed', durationMs: Math.round(performance.now() - began) }); throw error; } } },
    { name: 'calculate', label: '数值验算', description: '验算已列出的数值表达式：+ - * / **、括号、pi/e、sin/cos/tan/sqrt/abs/log/exp（单参数，log为自然对数）。乘法必须写*，乘方写**而不是^；先代入数字并换算单位，不传变量、等式、TeX或单位。angleUnit明确rad/deg。例如 expression="(10-2)/2"。返回近似数值不等于符号证明。', parameters: Type.Object({ schemaVersion: Type.Literal(1), expression: Type.String({ maxLength: 512 }), angleUnit: Type.Union([Type.Literal('rad'), Type.Literal('deg')]) }),
      execute: async (_id, args) => { const began = performance.now(); try { budget.reserveTool('business', controller.signal); const result = calculate(args, controller.signal); diagnostic({ event: 'tool', toolName: 'calculate', toolStatus: 'completed', durationMs: Math.round(performance.now() - began) }); return { content: [{ type: 'text', text: JSON.stringify(result) }], details: {} }; } catch (error) { diagnostic({ event: 'tool', toolName: 'calculate', toolStatus: 'failed', durationMs: Math.round(performance.now() - began) }); throw error; } } },
  ] : [];
  const solverSchema = input.answerMode === 'brief' ? BriefSolverCandidateSchema : GeneratedSolverCandidateSchema;
  const agent = new Agent({ initialState: { model, thinkingLevel: thinkingLevelOf(profile), tools, systemPrompt: policies.CONTENT_POLICY + '\n' + (input.role === 'solver' ? policies.SYSTEM : policies.VERIFIER)
    + '\n本机仅可使用列出的 read 与 calculate；没有搜索、Python、MCP、文件写入或其他宿主工具。不要声称调用它们。Skill相对参考路径需按其目录补全为 /skills/... 路径。\n'
    + (input.role === 'solver' ? JSON.stringify(skills) : '') + preloadExamResources(input.exam) + '\nJSON Schema:\n' + JSON.stringify(z.toJSONSchema(input.role === 'solver' ? solverSchema : VerificationSchema)) },
    toolExecution: 'sequential',
    beforeToolCall: async () => finishOnly ? { block: true, reason: '工具阶段已结束；请依据已有证据完成答案，缺少必要条件则明确澄清。' } : undefined,
    shouldStopAfterTurn: ({ message }) => finishOnly && (message.stopReason === 'toolUse' || message.content.some(part => part.type === 'toolCall')),
    // Use Pi's turn hook; no separate model/tool loop or additional capability.
    prepareNextTurnWithContext: ({ message, toolResults }) => {
      if (input.role !== 'solver' || message.stopReason !== 'toolUse') return undefined;
      for (const part of message.content) {
        if (part.type !== 'toolCall') continue;
        if (!tools.some(tool => tool.name === part.name)) finishTools('errors');
        const args: unknown = part.arguments;
        const fingerprint = part.name + ':' + JSON.stringify(args, args && typeof args === 'object' && !Array.isArray(args) ? Object.keys(args).sort() : undefined)?.slice(0, 2048);
        const count = (seenTools.get(fingerprint) ?? 0) + 1;
        if (seenTools.size < 16 || seenTools.has(fingerprint)) seenTools.set(fingerprint, count);
        else finishTools('budget');
        if (count >= 3) finishTools('repeated');
      }
      for (const result of toolResults) {
        consecutiveToolErrors = result.isError ? consecutiveToolErrors + 1 : 0;
        if (consecutiveToolErrors >= 2) finishTools('errors');
      }
      const used = budget.snapshot();
      if (used.fileAttempts >= 8 || used.businessAttempts >= 8) finishTools('budget');
      if (Math.min(budget.remainingMs(), phaseDeadline - performance.now()) < 25_000) finishTools('time');
      return undefined;
    },
    streamFn: (_model, context, options) => {
      // The agent omits reasoning when thinking is off, so any value here is a real effort.
      const effort = options?.reasoning;
      try {
        if (failure) throw failure;
        if (finishOnly && finalAttempted) {
          diagnostic({ event: 'failure', reason: 'invalid_finish', ...(toolStopReason ? { toolStopReason } : {}) });
          throw new SolvePhaseError(toolStopReason === 'budget' ? 'TOOL_LIMIT' : 'MODEL_OUTPUT_INVALID');
        }
        if (input.role === 'solver') budget.reserveModel(controller.signal); else {
          if (attemptNumber >= MAX_VERIFIER_PHASE_ATTEMPTS) throw new SolvePhaseError('VERIFIER_LIMIT');
          budget.reserveVerifier(controller.signal);
        }
        if (finishOnly) finalAttempted = true;
      }
      catch (error) { failure = error; throw error; }
      clearThinkingTimer(); thinkingTimerStarted = false; visibleOutput = false; thinkingBytes = 0;
      attemptNumber++; requestStarted = performance.now(); firstTokenMs = undefined; lastHttpStatus = null; diagnostic({ event: 'request', phaseMs: Math.max(1, Math.floor(phaseDeadline - performance.now())), streaming, imageCount: 1 + (input.materials?.length ?? 0), model: profile.model, maxTokens: profile.maxTokens, contextWindow: profile.contextWindow, ...(toolStopReason ? { toolStopReason } : {}) });
      const streamOptions = { apiKey: key, fetch: modelTransport(profile, fetch, (status, error, reason, responseFormat) => { if (status !== null) lastHttpStatus = status; if (error) failure = error; diagnostic({ event: error ? 'failure' : 'response', ...(responseFormat ? { responseFormat } : {}), ...(status === null ? {} : { httpStatus: status }), ...(error ? { reason: reason ?? (status === null ? 'network' : 'http') } : {}) }); }, streaming), signal: controller.signal, maxTokens: profile.maxTokens, maxRetries: 0, timeoutMs: Math.max(1, Math.floor(Math.min(budget.remainingMs(), phaseDeadline - performance.now()))), env: {}, ...(effort ? { reasoningEffort: effort } : {}),
        ...(finishOnly ? { toolChoice: 'none' as const } : {}),
        onPayload: (payload: unknown) => { const value = model.api === 'openai-responses' ? responsePayload(payload) : payload; if (new TextEncoder().encode(JSON.stringify(value)).length > Math.ceil(MAX_QUESTION_IMAGE_BYTES / 3) * 4 + 1024 * 1024) throw new SolvePhaseError('INVALID_INPUT'); return value; } };
      const requestContext = finishOnly ? { ...finishContext(context), systemPrompt: context.systemPrompt + '\n工具阶段已结束。不得再次调用工具；依据原图与已有结果直接给最终JSON，不添加未获得的证据。缺少必要题意则明确澄清，不猜测。' } : context;
      return model.api === 'openai-responses' ? streamResponses(model, requestContext, streamOptions) : stream(model, requestContext, streamOptions);
    },
  });
  const timing = () => firstTokenMs === undefined ? {} : { firstTokenMs };
  const unsubscribe = agent.subscribe(event => {
    if (event.type === 'message_update' && ['text_delta', 'thinking_delta', 'toolcall_delta'].includes(event.assistantMessageEvent.type)) {
      lastProgressAt = performance.now();
      firstTokenMs ??= Math.round(lastProgressAt - requestStarted);
      if (event.assistantMessageEvent.type === 'thinking_delta') thinkingBytes = Math.min(MAX_MODEL_STREAM_BYTES, thinkingBytes + new TextEncoder().encode(event.assistantMessageEvent.delta).length);
      if (event.assistantMessageEvent.type !== 'thinking_delta') { visibleOutput = true; clearThinkingTimer(); }
      else if (!thinkingTimerStarted && !visibleOutput && input.role === 'solver' && input.answerMode === 'brief' && override?.allowThinkingTakeover && !override.backup) {
        thinkingTimerStarted = true;
        clearThinkingTimer = schedule(() => {
          if (visibleOutput || signal.aborted || controller.signal.aborted) return;
          diagnostic({ event: 'failure', reason: 'thinking_limit', thinkingBytes, phaseMs: MAX_DEVICE_BRIEF_THINKING_MS });
          timedOut = true; controller.abort();
        }, MAX_DEVICE_BRIEF_THINKING_MS);
      }
    }
    if (event.type === 'message_end' && event.message.role === 'assistant') clearThinkingTimer();
    if (event.type === 'message_end' && event.message.role === 'assistant' && event.message.stopReason === 'toolUse') {
      diagnostic({ event: 'finish', ...timing(), textBytes: new TextEncoder().encode(event.message.content.filter(part => part.type === 'text').map(part => part.text).join('')).length, thinkingBytes: new TextEncoder().encode(event.message.content.filter(part => part.type === 'thinking').map(part => part.thinking).join('')).length, stopReason: 'toolUse', inputTokens: event.message.usage.input, outputTokens: event.message.usage.output });
    }
  });
  const cancel = () => agent.abort(); controller.signal.addEventListener('abort', cancel, { once: true });
  try {
    const { image, materials, identity: _identity, useBackup: _useBackup, ...data } = input;
    await agent.prompt(JSON.stringify({ ...data, ...(materials?.length ? { materialOrder: materials.map(item => item.id) } : {}) }),
      [image, ...(materials ?? []).map(item => item.image)].map(photo => ({ type: 'image', data: encode(photo.bytes), mimeType: photo.mimeType })));
    for (let attempt = 0; attempt < 2; attempt++) {
      // Decision: .agents/notes/implemented/agent/2026-10-08-verifier-transport-degradation.md
      // Resume Pi from the last complete turn, retaining tool observations but
      // excluding the failed partial assistant message. The phase timer is shared.
      const used = budget.snapshot();
      const transient = failure instanceof SolvePhaseError && (failure.code === 'MODEL_RATE_LIMITED' || (failure.code === 'MODEL_UNAVAILABLE' && (lastHttpStatus === null || lastHttpStatus === 200 || lastHttpStatus >= 500)));
      const last = agent.state.messages.at(-1);
      const hasAttempt = input.role === 'solver' ? used.modelAttempts < MAX_SOLVER_MODEL_ATTEMPTS : used.verifierAttempts < MAX_VERIFIER_MODEL_ATTEMPTS && attemptNumber < MAX_VERIFIER_PHASE_ATTEMPTS;
      if (transient && !transientRetryUsed && hasAttempt && !controller.signal.aborted && !signal.aborted && Math.min(budget.remainingMs(), phaseDeadline - performance.now()) > 1000 && last?.role === 'assistant' && last.stopReason === 'error') {
        transientRetryUsed = true;
        diagnostic({ event: 'retry', reason: lastHttpStatus === null || lastHttpStatus === 200 ? 'network' : 'http' });
        await new Promise<void>(resolve => {
          const stop = () => { clearTimeout(timer); controller.signal.removeEventListener('abort', stop); resolve(); };
          const timer = setTimeout(stop, 500); controller.signal.addEventListener('abort', stop, { once: true }); if (controller.signal.aborted) stop();
        });
        if (!controller.signal.aborted) {
          budget.assertActive(signal); failure = undefined; finalAttempted = false;
          agent.state.messages = agent.state.messages.slice(0, -1);
          await agent.continue();
        }
      }
      if (signal.aborted) throw new SolvePhaseError('CANCELLED');
      if (timedOut) throw new SolvePhaseError(budget.remainingMs() > 0 ? 'MODEL_TIMEOUT' : 'RUN_TIMEOUT');
      if (failure) throw failure;
      budget.assertActive(signal);
      const final = agent.state.messages.findLast(message => message.role === 'assistant');
      if (!final || final.role !== 'assistant') { diagnostic({ event: 'failure', reason: 'invalid_finish' }); throw new SolvePhaseError('MODEL_OUTPUT_INVALID'); }
      diagnostic({ event: 'finish', ...timing(), textBytes: new TextEncoder().encode(final.content.filter(part => part.type === 'text').map(part => part.text).join('')).length, thinkingBytes: new TextEncoder().encode(final.content.filter(part => part.type === 'thinking').map(part => part.thinking).join('')).length, stopReason: final.stopReason === 'deferred' ? 'unknown' : final.stopReason, inputTokens: final.usage.input, outputTokens: final.usage.output });
      if (final.stopReason !== 'stop') {
        diagnostic({ event: 'failure', reason: final.stopReason === 'length' ? 'truncated' : 'invalid_finish' });
        if (finishOnly && final.stopReason === 'toolUse' && reserveRepair()) {
          finishTools('format'); finalAttempted = false;
          await agent.prompt('上一条在明确禁止工具时仍返回了工具调用，未获得这些工具的成功结果。仅有这一次格式修复机会：根据原图和已有有效证据给符合Schema的最终JSON，不请求工具、不虚构工具结果；条件不清则明确澄清。');
          continue;
        }
        throw new SolvePhaseError('MODEL_OUTPUT_INVALID');
      }
      const text = final.content.filter(part => part.type === 'text').map(part => part.text).join('');
      const outputBytes = new TextEncoder().encode(text).length;
      if (outputBytes > 64 * 1024) { diagnostic({ event: 'failure', reason: 'output_limit', outputBytes }); throw new SolvePhaseError('MODEL_OUTPUT_INVALID'); }
      let value: unknown;
      try { value = parseModelJson(text); } catch {
        diagnostic({ event: 'validation', reason: 'json', outputBytes });
        if (!reserveRepair()) throw new SolvePhaseError('MODEL_OUTPUT_INVALID');
        finishTools('format'); finalAttempted = false; // One existing, budgeted format repair may finish without tools.
        await agent.prompt(input.role === 'solver'
          ? '最终输出不是有效JSON。请重新输出符合系统Schema的完整JSON，不要代码围栏或额外说明；正确转义LaTeX反斜线。只有这一次格式修复机会。'
          : '校验输出不是有效JSON。请重新输出符合校验Schema的完整JSON对象，包含verdict、checked和issues字段，不要代码围栏或额外说明；正确转义LaTeX反斜线。只有这一次格式修复机会。');
        continue;
      }
      if (input.role === 'solver') value = normalizeGeneratedCandidate(value);
      try {
        if (input.role === 'solver' && input.focus?.kind === 'explanation') { const checked = GeneratedSolverCandidateSchema.parse(value); if (checked.kind === 'answer' && !checked.steps.length) throw new z.ZodError([{ code: 'custom', path: ['steps'], message: '详细步骤请求必须包含教学步骤' }]); }
        if (input.role === 'solver' && input.focus?.kind === 'knowledge-list') { const checked = GeneratedSolverCandidateSchema.parse(value); if (checked.kind === 'answer' && !(checked.knowledgeDetails ?? []).length) throw new z.ZodError([{ code: 'custom', path: ['knowledgeDetails'], message: '知识点请求必须包含知识点讲解' }]); }
        if (input.role === 'verifier' && value && typeof value === 'object' && !('schemaVersion' in value)) {
          (value as Record<string, unknown>).schemaVersion = 1;
        }
        return input.role === 'solver'
          ? { role: 'solver', candidate: parseCandidateWithEvidence(parseCandidateForExam(solverSchema.parse(value), input.exam), input.evidence), events: [] }
          : { role: 'verifier', verification: assessVerificationCoverage(parseVerificationForCandidate(value, input.candidate), input.candidate), events: [] };
      } catch (error) {
        const fields = error instanceof z.ZodError ? [...new Set(error.issues.map(issue => issue.path.join('.')).filter(path => /^[a-zA-Z0-9_.\[\]]{0,120}$/.test(path)))].slice(0, 24) : [];
        diagnostic({ event: 'validation', reason: 'schema', outputBytes, fields });
        if (!reserveRepair()) throw new SolvePhaseError('MODEL_OUTPUT_INVALID');
        finishTools('format'); finalAttempted = false; // One existing, budgeted format repair may finish without tools.
        const errorMsg = error instanceof Error ? error.message : '';
        const constraints = error instanceof z.ZodError ? error.issues.filter(issue => issue.code === 'custom').slice(0, 4).map(issue => issue.message.slice(0, 300)).join('；') : '';
        if (input.role === 'solver') {
          await agent.prompt('最终JSON未通过结构校验。请按系统Schema重新输出完整JSON，补齐必需字段，确保每个步骤/图示恰好归属一道题。需要检查的字段：' + fields.join('、') + '。题型约束：' + constraints + '。answer须为完整作答字符串，选择题selectedOptions须为原标签数组；不把正文写成对象，不把解释或编号当标签。仅修复表示，不能为通过校验擅改题意或删除必要作答。单题省略questions，不能填空数组、null或仅一项；同一道题的小问用problem.response.parts和parts逐项完整解答，不能凑成多道题。真正多题才填2–4项，每个步骤和图恰好归属一题。只有这一次格式修复机会。不要增加题目，不要省略原题小问。');
        } else {
          const detail = errorMsg === 'DIAGRAM_NOT_VERIFIED' ? '原题或候选包含图表，通过校验必须在checked数组中包含"diagram"。' : '必需包含verdict("pass"|"fail"|"unknown")、checked(核验项目数组)和issues(问题数组)；pass时issues必须为空。';
          await agent.prompt(`校验结果未通过结构校验。请按校验Schema重新输出完整JSON对象：${detail}只有这一次格式修复机会。`);
        }
      }
    }
    throw new SolvePhaseError('MODEL_OUTPUT_INVALID');
  } finally { unsubscribe(); clearThinkingTimer(); clearTimer(); signal.removeEventListener('abort', abort); controller.signal.removeEventListener('abort', cancel); agent.abort(); await agent.waitForIdle(); agent.reset(); }
}
export async function solveOnDevice(input: SolverInput, settingsValue: LocalSettings, keys: LocalCredentials, fetch: LocalFetch, signal: AbortSignal, onEvent: (event: PublicAgentEvent) => void, onDiagnostic: (entry: LocalDiagnostic) => void = () => {}, schedule: PhaseTimer = defaultTimer, lifecycle?: SolveLifecycle) {
  const settings = LocalSettingsSchema.parse(settingsValue);
  LocalKeySchema.parse(keys.solver); if (settings.verifier) LocalKeySchema.parse(keys.verifier);
  const backup = !input.verificationTarget && !['explanation', 'knowledge-list'].includes(input.focus?.kind ?? '') ? settings.backup : null;
  const backupKey = backup ? LocalKeySchema.parse(keys.backup) : undefined;
  const correctionProfile = backup ?? (!input.verificationTarget && !['explanation', 'knowledge-list'].includes(input.focus?.kind ?? '') ? settings.verifier : null);
  const correctionKey = backup ? backupKey : settings.verifier ? keys.verifier : undefined;
  if (input.useBackup && !backup) throw new SolvePhaseError('INVALID_INPUT');
  // Decision: .agents/notes/implemented/agent/2026-10-08-explicit-backup-solver.md
  return solve(input, (value, budget, phaseSignal) => phase(value, budget, phaseSignal, settings, keys, fetch, onDiagnostic, schedule, { ...(backup ? { maxSolverMs: MAX_DEVICE_SOLVER_PHASE_MS } : {}), allowThinkingTakeover: !!correctionProfile && !!correctionKey }), new RunBudget(undefined, DEVICE_RUN_DURATION_MS), signal, onEvent,
    correctionProfile && correctionKey ? { prefer: !!input.useBackup, execute: (value, budget, phaseSignal) => phase({ ...value, verificationMode: 'automatic' }, budget, phaseSignal, settings, keys, fetch, onDiagnostic, schedule, { profile: correctionProfile, key: correctionKey, backup: true, maxSolverMs: MAX_DEVICE_PHASE_DURATION_MS }) } : undefined, lifecycle);
}
export async function testModelConnection(profile: LocalModelProfile, key: string, fetch: LocalFetch, signal: AbortSignal): Promise<void> {
  profile = LocalSettingsSchema.shape.solver.parse(profile);
  const model = profile.api === 'openai-responses' ? responsesModel(profile) : mobileModel(profile);
  // The connection test uses the same thinking setting as solving, so a rejected parameter surfaces here.
  const level = thinkingLevelOf(profile);
  const context = { messages: [{ role: 'user' as const, content: '请只回复 OK。', timestamp: Date.now() }] };
  let failure: SolvePhaseError | undefined;
  const options = { apiKey: LocalKeySchema.parse(key), fetch: modelTransport(profile, fetch, (_status, error) => { if (error) failure = error; }), signal, maxTokens: 64, maxRetries: 0, timeoutMs: 15000, env: {}, ...(level === 'off' ? {} : { reasoningEffort: level }) };
  const result = await (model.api === 'openai-responses' ? streamResponses(model, context, options) : stream(model, context, options)).result();
  if (signal.aborted) throw new SolvePhaseError('CANCELLED');
  if (failure) throw failure;
  if (result.stopReason !== 'stop' || !result.content.some(part => part.type === 'text' && part.text.trim())) throw new Error('连接测试失败，请检查地址、密钥、模型名及协议兼容性。');
}
