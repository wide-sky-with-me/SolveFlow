import { z } from 'zod';
import { ProviderNameSchema, ModelReferenceSchema } from './model.js';
import { SessionViewSchema } from './http.js';
/** Two-level device thinking control: a switch plus optional effort and protocol. */
export const ThinkingControlSchema = z.strictObject({
  mode: z.enum(['provider-default', 'off', 'on']),
  protocol: z.enum(['thinking-type', 'enable-thinking', 'reasoning-effort']).optional(),
  effort: z.enum(['low', 'medium', 'high']).optional(),
});
export type ThinkingControl = z.infer<typeof ThinkingControlSchema>;
/** Reads the two-level control and migrates the legacy single-select value. */
export function resolveThinking(profile: { thinking?: ThinkingControl | undefined; thinkingControl?: string | undefined }): ThinkingControl {
  if (profile.thinking) return profile.thinking;
  switch (profile.thinkingControl) {
    case 'disabled-thinking': return { mode: 'off', protocol: 'thinking-type' };
    case 'disabled-enable-thinking': return { mode: 'off', protocol: 'enable-thinking' };
    case 'disabled-reasoning-effort': return { mode: 'off', protocol: 'reasoning-effort' };
    default: return { mode: 'provider-default' };
  }
}
/** Personal device configuration, never populated from server environment variables. */
export const LocalModelProfileSchema = z.strictObject({
  provider: ProviderNameSchema,
  baseURL: z.url().max(2048).refine(value => { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash; }, '请填写不含登录参数的 HTTPS 模型服务地址').transform(value => value.replace(/\/+$/, '')),
  model: ModelReferenceSchema,
  api: z.literal('openai-completions'),
  contextWindow: z.number().int().min(4096).max(2_000_000),
  maxTokens: z.number().int().min(1024).max(32768),
  maxTokensField: z.enum(['max_tokens', 'max_completion_tokens']),
  // Explicit protocol selection: never infer a provider or model from its name.
  thinking: ThinkingControlSchema.optional(),
  /** @deprecated Legacy single-select control; read through resolveThinking(). */
  thinkingControl: z.enum(['provider-default', 'disabled-thinking', 'disabled-enable-thinking', 'disabled-reasoning-effort']).optional(),
}).refine(value => value.maxTokens <= value.contextWindow, '输出上限不能超过上下文容量');
export const LocalSettingsSchema = z.strictObject({ schemaVersion: z.literal(1), solver: LocalModelProfileSchema, verifier: LocalModelProfileSchema.nullable() });
export const LocalKeySchema = z.string().trim().min(1).max(2048).regex(/^[\x21-\x7e]+$/);
export type LocalModelProfile = z.infer<typeof LocalModelProfileSchema>;
export type LocalSettings = z.infer<typeof LocalSettingsSchema>;
export const LocalRecordSchema = z.strictObject({ schemaVersion: z.literal(1), session: SessionViewSchema,
  image: z.string().max(5_592_432).regex(/^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/),
});
export type LocalRecord = z.infer<typeof LocalRecordSchema>;

/** Separate metadata avoids an in-flight solver overwriting a new bookmark. */
export const LocalFavoriteSchema = z.strictObject({ schemaVersion: z.literal(1), favorite: z.literal(true) });

/** Diagnostic metadata only: no prompts, images, response bodies, credentials or thinking. */
export const LocalDiagnosticSchema = z.strictObject({
  schemaVersion: z.literal(1), runId: z.string().min(1).max(128),
  role: z.enum(['solver', 'verifier', 'runtime']), event: z.enum(['request', 'response', 'finish', 'validation', 'failure', 'lifecycle']),
  attempt: z.number().int().min(0).max(32), elapsedMs: z.number().int().min(0).max(1_000_000),
  httpStatus: z.number().int().min(100).max(599).optional(),
  stopReason: z.enum(['stop', 'length', 'toolUse', 'pending', 'error', 'aborted', 'unknown']).optional(),
  maxTokens: z.number().int().positive().optional(), contextWindow: z.number().int().positive().optional(),
  inputTokens: z.number().int().nonnegative().optional(), outputTokens: z.number().int().nonnegative().optional(), outputBytes: z.number().int().nonnegative().optional(),
  firstTokenMs: z.number().int().nonnegative().max(1_000_000).optional(), textBytes: z.number().int().nonnegative().optional(),
  fields: z.array(z.string().max(120).regex(/^[a-zA-Z0-9_.\[\]]*$/)).max(24).optional(),
  reason: z.enum(['http', 'network', 'truncated', 'json', 'schema', 'output_limit', 'invalid_finish', 'background_start', 'started', 'completed', 'failed', 'cancelled', 'deadline', 'storage']).optional(),
});
export type LocalDiagnostic = z.infer<typeof LocalDiagnosticSchema>;
export const LocalDiagnosticsSchema = z.strictObject({ schemaVersion: z.literal(1), runId: z.string().min(1).max(128), entries: z.array(LocalDiagnosticSchema).max(64) });
