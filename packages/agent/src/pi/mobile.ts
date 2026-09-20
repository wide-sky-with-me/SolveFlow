import { Agent, type AgentTool } from '@earendil-works/pi-agent-core';
import { Type, type Model } from '@earendil-works/pi-ai';
import { stream } from '@earendil-works/pi-ai/api/openai-completions';
import { z } from 'zod';
import { BriefSolverCandidateSchema, GeneratedSolverCandidateSchema, VerificationSchema, parseCandidateWithEvidence, parseVerificationForCandidate, type AgentInput, type PhaseResult, type SolverInput, type PublicAgentEvent } from '@solveflow/contracts/agent';
import { LocalDiagnosticSchema, resolveThinking, type LocalDiagnostic, LocalSettingsSchema, LocalKeySchema, type LocalModelProfile, type LocalSettings } from '@solveflow/contracts/local';
import { solve, SolvePhaseError } from '../orchestration/solve.js';
import { RunBudget } from '../policy/run-budget.js';
import { calculate } from '../tools/calculate.js';
import { resources, skills, policies } from './mobile-resources.js';
export type LocalCredentials = { solver: string; verifier: string | null };
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
  return { id: profile.model, name: profile.model, provider: profile.provider, api: profile.api, baseUrl: profile.baseURL,
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
/** No redirects, cookies, environment lookup, retries or model-selected destinations. */
export function modelTransport(profile: LocalModelProfile, transport: LocalFetch, observe?: (status: number | null, error?: SolvePhaseError) => void): LocalFetch {
  return async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url !== `${profile.baseURL}/chat/completions` || init?.method?.toUpperCase() !== 'POST') throw new SolvePhaseError('CAPABILITY_DENIED');
    let response: Response;
    try { response = await transport(input, { ...init, credentials: 'omit', redirect: 'error', cache: 'no-store' }); }
    catch { const error = new SolvePhaseError('MODEL_UNAVAILABLE'); if (!init?.signal?.aborted) observe?.(null, error); throw error; }
    if (!response.ok) { const error = new SolvePhaseError(response.status === 401 || response.status === 403 ? 'CAPABILITY_DENIED' : response.status === 402 ? 'SPEND_LIMIT' : 'MODEL_UNAVAILABLE'); observe?.(response.status, error); await response.body?.cancel(); throw error; }
    observe?.(response.status);
    if (!response.body) throw new SolvePhaseError('MODEL_OUTPUT_INVALID');
    const reader = response.body.getReader(); let size = 0; let released = false;
    const release = () => { if (!released) { released = true; reader.releaseLock(); } };
    const body = new ReadableStream<Uint8Array>({
      async pull(controller) { try { const part = await reader.read(); if (part.done) { release(); controller.close(); return; } size += part.value.byteLength; if (size > 1024 * 1024) { await reader.cancel(); release(); controller.error(new SolvePhaseError('MODEL_OUTPUT_INVALID')); return; } controller.enqueue(part.value); } catch { try { await reader.cancel(); } finally { release(); const error = new SolvePhaseError('MODEL_UNAVAILABLE'); if (!init?.signal?.aborted) observe?.(null, error); controller.error(error); } } },
      async cancel() { try { if (!released) await reader.cancel(); } finally { release(); } },
    });
    // RN's global Response is a legacy polyfill that cannot construct a streaming body.
    // Preserve Expo's actual response and bind its native-backed getters/methods.
    return new Proxy(response, { get(target, property) { if (property === 'body') return body; const value: unknown = Reflect.get(target, property, target); return typeof value === 'function' ? value.bind(target) : value; } });
  };
}
export function readMobileSkill(path: string): string {
  if (!/^\/skills\/[a-z]+\/(?:references\/)?[a-zA-Z.-]+\.md$/.test(path) || path.includes('..') || !Object.hasOwn(resources, path)) throw new SolvePhaseError('CAPABILITY_DENIED');
  return resources[path]!;
}
function encode(bytes: Uint8Array): string { let text = ''; for (let i = 0; i < bytes.length; i += 8192) text += String.fromCharCode(...bytes.subarray(i, i + 8192)); return btoa(text); }
async function phase(input: AgentInput, budget: RunBudget, signal: AbortSignal, settings: LocalSettings, keys: LocalCredentials, fetch: LocalFetch, onDiagnostic: (entry: LocalDiagnostic) => void, schedule: PhaseTimer): Promise<PhaseResult> {
  const profile = input.role === 'verifier' ? settings.verifier ?? settings.solver : settings.solver;
  const key = LocalKeySchema.parse(input.role === 'verifier' && settings.verifier ? keys.verifier : keys.solver);
  const started = performance.now(); let attemptNumber = 0; let requestStarted = started; let firstTokenMs: number | undefined;
  const diagnostic = (entry: Omit<LocalDiagnostic, 'schemaVersion' | 'runId' | 'role' | 'attempt' | 'elapsedMs'>) => onDiagnostic(LocalDiagnosticSchema.parse({ schemaVersion: 1, runId: input.identity.runId, role: input.role, attempt: attemptNumber, elapsedMs: Math.round(performance.now() - started), ...entry }));
  const model = mobileModel(profile); let failure: unknown; let timedOut = false;
  const controller = new AbortController(); const abort = () => controller.abort(); signal.addEventListener('abort', abort, { once: true }); if (signal.aborted) abort();
  const clearTimer = schedule(() => { timedOut = true; controller.abort(); }, input.role === 'verifier' ? Math.min(20_000, budget.remainingMs()) : budget.remainingMs());
  const tools: AgentTool[] = input.role === 'solver' ? [
    { name: 'read', label: '读取解题方法', description: '读取内置白名单 Skill 或其参考资料；path 使用 /skills/ 开头的完整路径。', parameters: Type.Object({ path: Type.String({ maxLength: 160 }) }),
      execute: async (_id, args) => { budget.reserveTool('file', controller.signal); const value = z.strictObject({ path: z.string().max(160) }).parse(args); return { content: [{ type: 'text', text: readMobileSkill(value.path) }], details: {} }; } },
    { name: 'calculate', label: '数值验算', description: '验算已列出的数值表达式：+ - * / **、括号、pi/e、sin/cos/tan/sqrt/abs/log/exp（单参数，log为自然对数）。乘法必须写*，乘方写**而不是^；先代入数字并换算单位，不传变量、等式、TeX或单位。angleUnit明确rad/deg。例如 expression="(10-2)/2"。返回近似数值不等于符号证明。', parameters: Type.Object({ schemaVersion: Type.Literal(1), expression: Type.String({ maxLength: 512 }), angleUnit: Type.Union([Type.Literal('rad'), Type.Literal('deg')]) }),
      execute: async (_id, args) => { budget.reserveTool('business', controller.signal); return { content: [{ type: 'text', text: JSON.stringify(calculate(args, controller.signal)) }], details: {} }; } },
  ] : [];
  const solverSchema = input.answerMode === 'brief' ? BriefSolverCandidateSchema : GeneratedSolverCandidateSchema;
  const agent = new Agent({ initialState: { model, thinkingLevel: thinkingLevelOf(profile), tools, systemPrompt: policies.CONTENT_POLICY + '\n' + (input.role === 'solver' ? policies.SYSTEM : policies.VERIFIER)
    + '\n本机仅可使用列出的 read 与 calculate；没有搜索、Python、MCP、文件写入或其他宿主工具。不要声称调用它们。Skill相对参考路径需按其目录补全为 /skills/... 路径。\n'
    + (input.role === 'solver' ? JSON.stringify(skills) : '') + '\nJSON Schema:\n' + JSON.stringify(z.toJSONSchema(input.role === 'solver' ? solverSchema : VerificationSchema)) },
    toolExecution: 'sequential',
    streamFn: (_model, context, options) => {
      // The agent omits reasoning when thinking is off, so any value here is a real effort.
      const effort = options?.reasoning;
      try { if (input.role === 'solver') budget.reserveModel(controller.signal); else budget.reserveVerifier(controller.signal); }
      catch (error) { failure = error; throw error; }
      attemptNumber++; requestStarted = performance.now(); firstTokenMs = undefined; diagnostic({ event: 'request', maxTokens: profile.maxTokens, contextWindow: profile.contextWindow });
      return stream(model, context, { apiKey: key, fetch: modelTransport(profile, fetch, (status, error) => { if (error) failure = error; diagnostic({ event: error ? 'failure' : 'response', ...(status === null ? {} : { httpStatus: status }), ...(error ? { reason: status === null ? 'network' : 'http' } : {}) }); }), signal: controller.signal, maxTokens: profile.maxTokens, maxRetries: 0, timeoutMs: Math.max(1, Math.floor(budget.remainingMs())), env: {}, ...(effort ? { reasoningEffort: effort } : {}),
        onPayload: payload => { if (new TextEncoder().encode(JSON.stringify(payload)).length > 7 * 1024 * 1024) throw new SolvePhaseError('INVALID_INPUT'); return payload; } });
    },
  });
  const timing = () => firstTokenMs === undefined ? {} : { firstTokenMs };
  const unsubscribe = agent.subscribe(event => {
    if (event.type === 'message_update' && firstTokenMs === undefined && ['text_delta', 'thinking_delta', 'toolcall_delta'].includes(event.assistantMessageEvent.type)) firstTokenMs = Math.round(performance.now() - requestStarted);
    if (event.type === 'message_end' && event.message.role === 'assistant' && event.message.stopReason === 'toolUse') {
      diagnostic({ event: 'finish', ...timing(), textBytes: new TextEncoder().encode(event.message.content.filter(part => part.type === 'text').map(part => part.text).join('')).length, stopReason: 'toolUse', inputTokens: event.message.usage.input, outputTokens: event.message.usage.output });
    }
  });
  const cancel = () => agent.abort(); controller.signal.addEventListener('abort', cancel, { once: true });
  try {
    const { image, identity: _identity, ...data } = input;
    await agent.prompt(JSON.stringify(data), [{ type: 'image', data: encode(image.bytes), mimeType: image.mimeType }]);
    for (let attempt = 0; attempt < 2; attempt++) {
      if (signal.aborted) throw new SolvePhaseError('CANCELLED');
      if (timedOut) throw new SolvePhaseError(input.role === 'verifier' && budget.remainingMs() > 0 ? 'MODEL_TIMEOUT' : 'RUN_TIMEOUT');
      if (failure) throw failure;
      budget.assertActive(signal);
      const final = agent.state.messages.at(-1);
      if (!final || final.role !== 'assistant') { diagnostic({ event: 'failure', reason: 'invalid_finish' }); throw new SolvePhaseError('MODEL_OUTPUT_INVALID'); }
      diagnostic({ event: 'finish', ...timing(), textBytes: new TextEncoder().encode(final.content.filter(part => part.type === 'text').map(part => part.text).join('')).length, stopReason: final.stopReason === 'deferred' ? 'unknown' : final.stopReason, inputTokens: final.usage.input, outputTokens: final.usage.output });
      if (final.stopReason !== 'stop') { diagnostic({ event: 'failure', reason: final.stopReason === 'length' ? 'truncated' : 'invalid_finish' }); throw new SolvePhaseError('MODEL_OUTPUT_INVALID'); }
      const text = final.content.filter(part => part.type === 'text').map(part => part.text).join('');
      const outputBytes = new TextEncoder().encode(text).length;
      if (outputBytes > 32 * 1024) { diagnostic({ event: 'failure', reason: 'output_limit', outputBytes }); throw new SolvePhaseError('MODEL_OUTPUT_INVALID'); }
      let value: unknown;
      try { value = JSON.parse(text); } catch {
        diagnostic({ event: 'validation', reason: 'json', outputBytes });
        if (input.role !== 'solver' || !budget.tryReserveFormatRepair(signal)) throw new SolvePhaseError('MODEL_OUTPUT_INVALID');
        await agent.prompt('最终输出不是有效JSON。请重新输出符合系统Schema的完整JSON，不要代码围栏或额外说明；正确转义LaTeX反斜线。只有这一次格式修复机会。'); continue;
      }
      try {
        if (input.role === 'solver' && input.focus?.kind === 'explanation') { const checked = GeneratedSolverCandidateSchema.parse(value); if (checked.kind === 'answer' && !checked.steps.length) throw new z.ZodError([{ code: 'custom', path: ['steps'], message: '详细步骤请求必须包含教学步骤' }]); }
        if (input.role === 'solver' && input.focus?.kind === 'knowledge-list') { const checked = GeneratedSolverCandidateSchema.parse(value); if (checked.kind === 'answer' && !(checked.knowledgeDetails ?? []).length) throw new z.ZodError([{ code: 'custom', path: ['knowledgeDetails'], message: '知识点请求必须包含知识点讲解' }]); }
        return input.role === 'solver'
          ? { role: 'solver', candidate: parseCandidateWithEvidence(solverSchema.parse(value), input.evidence), events: [] }
          : { role: 'verifier', verification: parseVerificationForCandidate(value, input.candidate), events: [] };
      } catch (error) {
        const fields = error instanceof z.ZodError ? [...new Set(error.issues.map(issue => issue.path.join('.')).filter(path => /^[a-zA-Z0-9_.\[\]]{0,120}$/.test(path)))].slice(0, 24) : [];
        diagnostic({ event: 'validation', reason: 'schema', outputBytes, fields });
        if (input.role !== 'solver' || !budget.tryReserveFormatRepair(signal)) throw new SolvePhaseError('MODEL_OUTPUT_INVALID');
        await agent.prompt('最终JSON未通过结构校验。请按系统Schema重新输出完整JSON，补齐必需字段，确保每个步骤/图示恰好归属一道题。需要检查的字段：' + fields.join('、') + '。单题省略questions，不能填空数组、null或仅一项；同一道题的小问仍在本题answer和steps中完整解答，不能凑成多道题。真正多题才填2–4项，每个步骤和图恰好归属一题。只有这一次格式修复机会。不要增加题目，不要省略原题小问。');
      }
    }
    throw new SolvePhaseError('MODEL_OUTPUT_INVALID');
  } finally { unsubscribe(); clearTimer(); signal.removeEventListener('abort', abort); controller.signal.removeEventListener('abort', cancel); agent.abort(); await agent.waitForIdle(); agent.reset(); }
}
export async function solveOnDevice(input: SolverInput, settingsValue: LocalSettings, keys: LocalCredentials, fetch: LocalFetch, signal: AbortSignal, onEvent: (event: PublicAgentEvent) => void, onDiagnostic: (entry: LocalDiagnostic) => void = () => {}, schedule: PhaseTimer = defaultTimer) {
  const settings = LocalSettingsSchema.parse(settingsValue);
  LocalKeySchema.parse(keys.solver); if (settings.verifier) LocalKeySchema.parse(keys.verifier);
  return solve(input, (value, budget, phaseSignal) => phase(value, budget, phaseSignal, settings, keys, fetch, onDiagnostic, schedule), new RunBudget(), signal, onEvent);
}
export async function testModelConnection(profile: LocalModelProfile, key: string, fetch: LocalFetch, signal: AbortSignal): Promise<void> {
  const model = mobileModel(profile);
  // The connection test uses the same thinking setting as solving, so a rejected parameter surfaces here.
  const level = thinkingLevelOf(profile);
  const result = await stream(model, { messages: [{ role: 'user', content: '请只回复 OK。', timestamp: Date.now() }] }, { apiKey: LocalKeySchema.parse(key), fetch: modelTransport(profile, fetch), signal, maxTokens: 64, maxRetries: 0, timeoutMs: 15000, env: {}, ...(level === 'off' ? {} : { reasoningEffort: level }) }).result();
  if (result.stopReason !== 'stop' || !result.content.some(part => part.type === 'text' && part.text.trim())) throw new Error('连接测试失败，请检查地址、密钥、模型名及协议兼容性。');
}
