import { z } from "zod";
export const ModelRoleSchema = z.enum(["solver", "verifier"]);
export type ModelRole = z.infer<typeof ModelRoleSchema>;
export const ModelReferenceSchema = z.string().trim().min(1).max(256).regex(/^[^\s\x00-\x1f\x7f]+$/);
export const ProviderNameSchema = z.string().trim().min(1).max(128).regex(/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/);
export const ProviderBaseUrlSchema = z.url().max(2048).refine(value => {
  const url = new URL(value);
  return (url.protocol === "https:" || (url.protocol === "http:" && url.hostname === "127.0.0.1")) && !url.username && !url.password && !url.search && !url.hash;
}).transform(value => value.replace(/\/+$/, ""));
export const CompletionCompatSchema = z.strictObject({
  maxTokensField: z.enum(["max_tokens", "max_completion_tokens"]).default("max_tokens"),
  supportsStore: z.boolean().default(false),
  supportsDeveloperRole: z.boolean().default(false),
  supportsReasoningEffort: z.boolean().default(false),
  thinkingFormat: z.enum(["openai", "openrouter", "deepseek", "together", "baseten", "zai", "qwen", "chat-template", "qwen-chat-template", "string-thinking", "ant-ling"]).optional(),
});
const tokens = z.number().int().positive().max(10_000_000);
export const ModelRouteSchema = z.strictObject({
  schemaVersion: z.literal(1), provider: ProviderNameSchema, api: z.literal("openai-completions"),
  baseURL: ProviderBaseUrlSchema, model: ModelReferenceSchema,
  contextWindow: tokens, maxOutputTokens: tokens, requestMaxTokens: tokens,
  outputBudgetMode: z.enum(["capacity", "request-limit"]).default("capacity"),
  inputRmbPerMillionTokens: z.number().finite().nonnegative(), outputRmbPerMillionTokens: z.number().finite().nonnegative(),
  requestFeeRmb: z.number().finite().nonnegative().default(0),
  supportsImages: z.boolean(), supportsTools: z.boolean(), reasoning: z.boolean().default(false),
  compat: CompletionCompatSchema,
}).refine(route => route.requestMaxTokens <= route.maxOutputTokens && route.requestMaxTokens <= route.contextWindow, { message: "REQUEST_TOKEN_LIMIT_EXCEEDS_MODEL" });
export type ModelRoute = z.infer<typeof ModelRouteSchema>;
export const ModelConnectionSchema = z.strictObject({ route: ModelRouteSchema, apiKey: z.string().trim().min(1).max(4096).regex(/^[\x21-\x7e]+$/) });
export const ModelConnectionsSchema = z.strictObject({ solver: ModelConnectionSchema, verifier: ModelConnectionSchema });
export type ModelConnections = z.infer<typeof ModelConnectionsSchema>;
