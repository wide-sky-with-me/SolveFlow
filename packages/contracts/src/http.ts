import { z } from "zod";
import { PublicAgentEventSchema, RunStatusSchema, SolveOutcomeSchema } from "./agent.js";

import { RunContextSchema } from "./run-context.js";
export { RunContextSchema, isAuxiliaryContext, type RunContext } from "./run-context.js";

export const ResourceIdSchema = z.uuid();
export const CreateSessionSchema = z.strictObject({ schemaVersion: z.literal(1), uploadId: ResourceIdSchema, subject: z.enum(["math", "physics", "chemistry", "english", "general"]).default("general") });
export function subjectLabel(subject: string) {
  const labels: Record<string, string> = { math: "数学", physics: "物理", chemistry: "化学", english: "英语", chinese: "语文", biology: "生物", history: "历史", geography: "地理", politics: "政治", economics: "经济学", general: "综合" };
  return labels[subject.toLowerCase()] ?? subject;
}
export const CreateRunSchema = z.strictObject({ schemaVersion: z.literal(1), message: z.string().trim().max(2000).default(""), uploadId: ResourceIdSchema.optional(), context: RunContextSchema.optional() });
export const IdempotencyKeySchema = z.string().min(8).max(128).regex(/^[a-zA-Z0-9_-]+$/);
export const UploadViewSchema = z.strictObject({ schemaVersion: z.literal(1), id: ResourceIdSchema, mimeType: z.literal("image/jpeg"), bytes: z.number().int().positive().max(4 * 1024 * 1024), width: z.number().int().positive().max(2048), height: z.number().int().positive().max(2048), expiresAt: z.iso.datetime(), previewUrl: z.string().regex(/^\/api\/v1\/uploads\/[a-f0-9-]{36}\/image$/) });
export const RunViewSchema = z.strictObject({ schemaVersion: z.literal(1), id: ResourceIdSchema, sessionId: ResourceIdSchema, status: RunStatusSchema, message: z.string().max(2000), createdAt: z.iso.datetime(), seq: z.number().int().nonnegative(), outcome: SolveOutcomeSchema.nullable(), context: RunContextSchema.optional() });
export const SessionViewSchema = z.strictObject({ schemaVersion: z.literal(1), id: ResourceIdSchema, subject: z.string().max(40), createdAt: z.iso.datetime(), upload: UploadViewSchema, runs: z.array(RunViewSchema).max(10) });
export const SessionListSchema = z.strictObject({ schemaVersion: z.literal(1), sessions: z.array(z.strictObject({ id: ResourceIdSchema, subject: z.string().max(40), createdAt: z.iso.datetime(), title: z.string().max(120) })).max(50) });
export const ServiceInfoSchema = z.strictObject({ schemaVersion: z.literal(1), mode: z.enum(["disabled", "live", "demo"]), solvingAvailable: z.boolean(), unavailableReason: z.enum(["SPEND_LIMIT", "SERVICE_UNAVAILABLE"]).optional() });
export const BootstrapSchema = ServiceInfoSchema.extend({ ownerId: ResourceIdSchema });
/** Native-only bearer credentials never appear in URLs, browser bootstrap or result data. */
export const NativeBootstrapSchema = BootstrapSchema.extend({ accessToken: z.string().min(32).max(512).regex(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/) });
export const NATIVE_CLIENT_HEADER = "native-v1";
export const CreatedSessionSchema = z.strictObject({ schemaVersion: z.literal(1), id: ResourceIdSchema });
const eventBase = { schemaVersion: z.literal(1), runId: ResourceIdSchema, seq: z.number().int().positive() };
const FinalEventSchema = z.union([
  z.strictObject({ ...eventBase, type: z.literal("answer.final"), result: SolveOutcomeSchema }),
  z.strictObject({ ...eventBase, type: z.literal("run.done"), status: z.enum(["completed", "needs_clarification", "failed", "cancelled"]) }),
]);
// Parse the adapter event before adding seq: its strict schema deliberately excludes persistence metadata.
function parseEvent(value: unknown) {
  if (typeof value === "object" && value !== null && "type" in value && ["run.status", "tool.status", "run.error"].includes(String(value.type))) {
    const envelope = z.object({ seq: z.number().int().positive() }).parse(value);
    const { seq: _seq, ...data } = z.record(z.string(), z.unknown()).parse(value);
    return { ...PublicAgentEventSchema.parse(data), seq: envelope.seq };
  }
  return FinalEventSchema.parse(value);
}
export const RunEventSchema = z.unknown().transform((value, ctx) => {
  try { return parseEvent(value); } catch { ctx.addIssue({ code: "custom", message: "无效的任务事件" }); return z.NEVER; }
});
export const parseRunEvent = (value: unknown) => RunEventSchema.parse(value);
export type RunEvent = ReturnType<typeof parseRunEvent>;
export type UploadView = z.infer<typeof UploadViewSchema>;
export type RunView = z.infer<typeof RunViewSchema>;
export type SessionView = z.infer<typeof SessionViewSchema>;
export const terminal = (status: string) => ["completed", "needs_clarification", "failed", "cancelled"].includes(status);

const catalog = {
  INVALID_INPUT: [400, "请检查输入内容。"], UNAUTHORIZED: [401, "会话身份已失效，请刷新页面。"], FORBIDDEN: [403, "当前请求未获授权。"],
  NOT_FOUND: [404, "内容不存在或已被删除。"], CONFLICT: [409, "当前题目已有进行中的任务，或提交内容发生冲突。"],
  TOO_LARGE: [413, "图片不能超过10MB，且解码像素不能超过2000万。"], UNSUPPORTED_IMAGE: [415, "请上传有效的静态JPG、PNG或WebP图片。"],
  RATE_LIMIT: [429, "操作过于频繁，请稍后重试。"], SERVICE_UNAVAILABLE: [503, "解题服务尚未就绪，请稍后重试。"],
  SESSION_LIMIT: [409, "这道题已达到10次解答上限，请保存当前结果并新建题目继续。"],
  DAILY_LIMIT: [429, "最近24小时已达到30次任务上限，请等待较早的任务满24小时后再试。"],
  STORAGE_LIMIT: [409, "已保存100道题，请删除不再需要的题目后继续。"],
  SPEND_LIMIT: [503, "解题额度不足，请先核对服务额度。"],
  CURSOR_EXPIRED: [410, "进度记录已过期，请重新读取任务结果。"], INTERNAL_ERROR: [500, "服务暂时无法完成请求，请稍后重试。"],
} as const;
export type ApiErrorCode = keyof typeof catalog;
export class ApiError extends Error {
  constructor(readonly code: ApiErrorCode) { super(code); }
  get status() { return catalog[this.code][0]; }
}
export const ApiErrorSchema = z.strictObject({ error: z.strictObject({ code: z.enum(Object.keys(catalog) as [ApiErrorCode, ...ApiErrorCode[]]), message: z.string().max(160), retryable: z.boolean(), traceId: z.uuid() }) });
export function apiErrorBody(code: ApiErrorCode, traceId: string) { return ApiErrorSchema.parse({ error: { code, message: catalog[code][1], retryable: code !== "SPEND_LIMIT" && [429, 503].includes(catalog[code][0]), traceId } }); }

export { questionSections, type QuestionSection } from "./question-sections.js";
export { resolveQuestionThread, questionThreadHistory, projectQuestionRun, type QuestionThreadAddress } from "./question-thread.js";
