// Decision: .agents/notes/implemented/agent/2026-10-09-direct-answer-review.md
// Decision: .agents/notes/implemented/architecture/2026-10-09-batch-learning-admission.md
import { z } from 'zod';
import { ProviderNameSchema, ModelReferenceSchema } from './model.js';
import { ProblemStatementSchema } from './learning-content.js';
import { IdentifierSchema, makeSafeAgentError } from './agent.js';
import { SessionViewSchema, MAX_CONVERSATION_RUNS, MAX_AUXILIARY_RUNS } from './http.js';
import { ExamTypeSchema } from './exam.js';
import { LocalMaterialSchema, LocalImageDataSchema, MaterialInfoSchema, QuestionImageIdsSchema, MAX_MATERIAL_IMAGES, MAX_QUESTION_IMAGE_BYTES, MAX_STORED_MATERIAL_IMAGES, MAX_STORED_IMAGE_BYTES } from './material.js';
export { LocalMaterialSchema, MAX_MATERIAL_IMAGES, MAX_QUESTION_IMAGE_BYTES, type LocalMaterial } from './material.js';
export { LocalImageEditSchema, QuestionImageIdsSchema, MAX_STORED_MATERIAL_IMAGES, MAX_STORED_IMAGE_BYTES, type LocalImageEdit } from './material.js';
export { ExamTypeSchema, EXAM_LABELS, EXAM_DESCRIPTIONS, type ExamType } from './exam.js';
export const MAX_LOCAL_RECORDS = 500;
export const MAX_BATCH_PHOTOS = 100;
export const BATCH_CONCURRENCY = 8;
export const BATCH_VERIFICATION_CONCURRENCY = 8;
export const MAX_LOCAL_CONCURRENCY = 32;
/** Learning requests have their own bounded slots beside batch phases. */
export const MAX_LOCAL_AUXILIARY_RUNS = 3;
/** Android protects only executing phases, never all queued verification inputs. */
export const MAX_LOCAL_MODEL_RUNS = MAX_LOCAL_CONCURRENCY * 2 + MAX_LOCAL_AUXILIARY_RUNS;
/** The entire accepted batch can wait for verification without holding solver slots. */
export const MAX_PENDING_VERIFICATIONS = MAX_BATCH_PHOTOS;
export const LocalConcurrencySchema = z.strictObject({
  solver: z.number().int().min(1).max(MAX_LOCAL_CONCURRENCY).default(BATCH_CONCURRENCY),
  verifier: z.number().int().min(1).max(MAX_LOCAL_CONCURRENCY).default(BATCH_VERIFICATION_CONCURRENCY),
});
export type LocalConcurrency = z.infer<typeof LocalConcurrencySchema>;
export const MAX_LOCAL_DIAGNOSTICS = 128;
export const LocalBatchSchema = z.strictObject({ id: z.uuid(), title: z.string().trim().min(1).max(100), createdAt: z.iso.datetime(), exam: ExamTypeSchema, position: z.number().int().min(1).max(MAX_BATCH_PHOTOS) });
export type LocalBatch = z.infer<typeof LocalBatchSchema>;
/** Ordered selection for an explicit batch edit; omitted IDs are deleted after confirmation. */
export const LocalBatchEditSchema = z.strictObject({ batchId: z.uuid(), expectedIds: z.array(z.uuid()).min(1).max(MAX_BATCH_PHOTOS), orderedIds: z.array(z.uuid()).max(MAX_BATCH_PHOTOS) }).refine(value => new Set(value.expectedIds).size === value.expectedIds.length && new Set(value.orderedIds).size === value.orderedIds.length && value.orderedIds.every(id => value.expectedIds.includes(id)), '批次调整包含重复或未知题目');
export type LocalBatchEdit = z.infer<typeof LocalBatchEditSchema>;
/** A small title override avoids rewriting every photo when a batch is renamed. */
export const LocalBatchTitleSchema = z.strictObject({ schemaVersion: z.literal(1), title: LocalBatchSchema.shape.title });
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
  api: z.enum(['openai-completions', 'openai-responses']),
  contextWindow: z.number().int().min(4096).max(2_000_000),
  maxTokens: z.number().int().min(1024).max(32768),
  maxTokensField: z.enum(['max_tokens', 'max_completion_tokens']),
  streaming: z.boolean().optional(),
  // Explicit protocol selection: never infer a provider or model from its name.
  thinking: ThinkingControlSchema.optional(),
  /** @deprecated Legacy single-select control; read through resolveThinking(). */
  thinkingControl: z.enum(['provider-default', 'disabled-thinking', 'disabled-enable-thinking', 'disabled-reasoning-effort']).optional(),
}).refine(value => value.maxTokens <= value.contextWindow, '输出上限不能超过上下文容量');
export const LocalSettingsSchema = z.strictObject({ schemaVersion: z.literal(1), solver: LocalModelProfileSchema, verifier: LocalModelProfileSchema.nullable(), backup: LocalModelProfileSchema.nullable().optional(), exam: ExamTypeSchema.optional(), concurrency: LocalConcurrencySchema.optional() });
export const LocalKeySchema = z.string().trim().min(1).max(2048).regex(/^[\x21-\x7e]+$/);
export type LocalModelProfile = z.infer<typeof LocalModelProfileSchema>;
export type LocalSettings = z.infer<typeof LocalSettingsSchema>;
/** Local Web bridge grants short-lived role tokens; never contains provider API keys. */
export const WebModelConfigurationSchema = z.strictObject({ solver: LocalModelProfileSchema, verifier: LocalModelProfileSchema.nullable(), backup: LocalModelProfileSchema.nullable() });
export const MAX_WEB_MODEL_PRESETS = 8;
export const WebModelPresetSchema = z.strictObject({ id: z.uuid(), name: z.string().trim().min(1).max(40), models: WebModelConfigurationSchema });
export type WebModelPreset = z.infer<typeof WebModelPresetSchema>;
export const WebEnvironmentSchema = z.strictObject({ schemaVersion: z.literal(1), settings: LocalSettingsSchema,
  accessTokens: z.strictObject({ solver: LocalKeySchema, verifier: LocalKeySchema.nullable(), backup: LocalKeySchema.nullable() }),
  canEditModels: z.boolean().optional(),
  canManagePresets: z.boolean().optional(),
  presets: z.array(WebModelPresetSchema).max(MAX_WEB_MODEL_PRESETS).optional(),
}).refine(value => !!value.settings.verifier === !!value.accessTokens.verifier && !!value.settings.backup === !!value.accessTokens.backup);
export type WebEnvironment = z.infer<typeof WebEnvironmentSchema>;
export const WebModelKeysSchema = z.strictObject({ solver: LocalKeySchema.nullable(), verifier: LocalKeySchema.nullable(), backup: LocalKeySchema.nullable() });
/** Null key updates preserve a trusted same-destination credential; never expose it in bootstrap. */
export const WebModelUpdateSchema = z.strictObject({ schemaVersion: z.literal(1), models: WebModelConfigurationSchema, keys: WebModelKeysSchema, presetId: z.uuid().optional() });
export type WebModelUpdate = z.infer<typeof WebModelUpdateSchema>;
export const WebModelTestSchema = z.strictObject({ schemaVersion: z.literal(1), profile: LocalModelProfileSchema, key: LocalKeySchema.nullable(), presetId: z.uuid().optional(), request: z.unknown() });
/** Server-only sidecar. It must never enter device persistence, exports or responses. */
export const WebStoredModelsSchema = WebModelUpdateSchema.omit({ presetId: true }).refine(value => !!value.keys.solver && !!value.models.verifier === !!value.keys.verifier && !!value.models.backup === !!value.keys.backup);
export const WebModelPresetCreateSchema = z.strictObject({ name: WebModelPresetSchema.shape.name, configuration: WebModelUpdateSchema });
export const WebStoredPresetsSchema = z.strictObject({ schemaVersion: z.literal(1), presets: z.array(z.strictObject({ id: z.uuid(), name: WebModelPresetSchema.shape.name, configuration: WebStoredModelsSchema })).max(MAX_WEB_MODEL_PRESETS) }).refine(value => new Set(value.presets.map(preset => preset.id)).size === value.presets.length && new Set(value.presets.map(preset => preset.name)).size === value.presets.length);
export const LocalStudyTimerSchema = z.strictObject({ schemaVersion: z.literal(1), elapsedMs: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER), startedAt: z.iso.datetime().nullable() });
export type LocalStudyTimer = z.infer<typeof LocalStudyTimerSchema>;
function checkMaterials(record: { session: { upload: { id: string; bytes: number }; runs: { materialIds?: string[] | undefined; imageIds?: string[] | undefined }[] }; materials?: { id: string; bytes: number }[] | undefined; activeImageIds?: string[] | undefined }, context: z.RefinementCtx) {
  const materials = record.materials ?? [];
  const images = new Map([[record.session.upload.id, record.session.upload.bytes], ...materials.map(item => [item.id, item.bytes] as const)]);
  if (images.size !== materials.length + 1 || record.session.upload.bytes + materials.reduce((sum, item) => sum + item.bytes, 0) > MAX_STORED_IMAGE_BYTES) context.addIssue({ code: 'custom', message: '历史材料重复或图片存储超过32MiB', path: ['materials'] });
  const selections = [record.activeImageIds ?? [record.session.upload.id, ...materials.map(item => item.id)], ...record.session.runs.map(run => run.imageIds ?? [record.session.upload.id, ...(run.materialIds ?? [])])];
  if (selections.some(ids => ids.length > MAX_MATERIAL_IMAGES + 1 || ids.some(id => !images.has(id)) || ids.reduce((sum, id) => sum + (images.get(id) ?? 0), 0) > MAX_QUESTION_IMAGE_BYTES)) context.addIssue({ code: 'custom', message: '题目图片不存在、超过8张或总大小超过8MiB', path: ['activeImageIds'] });
  if (record.session.runs.some(run => run.materialIds?.some(id => !materials.some(item => item.id === id)))) context.addIssue({ code: 'custom', message: '解答引用了不存在的材料', path: ['session', 'runs'] });
}
export const LocalRecordSchema = z.strictObject({ schemaVersion: z.literal(1), session: SessionViewSchema,
  exam: ExamTypeSchema.optional(),
  batch: LocalBatchSchema.optional(),
  image: LocalImageDataSchema,
  materials: z.array(LocalMaterialSchema).max(MAX_STORED_MATERIAL_IMAGES).optional(),
  activeImageIds: QuestionImageIdsSchema.optional(),
}).superRefine(checkMaterials);
export type LocalRecord = z.infer<typeof LocalRecordSchema>;
/** Disk v2 keeps the immutable photo at image.<session.id> in the same private store. */
export const StoredLocalRecordSchema = z.strictObject(LocalRecordSchema.shape).omit({ image: true }).extend({ schemaVersion: z.literal(2), materials: z.array(MaterialInfoSchema).max(MAX_STORED_MATERIAL_IMAGES).optional() }).superRefine(checkMaterials);
export type LocalRecordMetadata = Omit<z.infer<typeof StoredLocalRecordSchema>, 'schemaVersion'> & { schemaVersion: 1 };
export const StoredLocalImageSchema = z.strictObject({ schemaVersion: z.literal(1), image: LocalRecordSchema.shape.image });

const LegacyUnavailableErrorSchema = z.strictObject({ code: z.literal('MODEL_UNAVAILABLE'),
  message: z.literal('指定模型暂不可用，请检查服务端配置。'), retryable: z.literal(false), traceId: IdentifierSchema });
function object(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value); }
/** Read compatibility only: canonical writes and public events keep the current safe catalog.
 * Decision: .agents/notes/implemented/storage/2026-10-08-local-error-message-compatibility.md */
export function normalizeLegacyLocalRecord(value: unknown): unknown {
  if (!object(value) || !object(value.session) || !Array.isArray(value.session.runs)) return value;
  return { ...value, session: { ...value.session, runs: value.session.runs.map((run: unknown) => {
    if (!object(run) || !object(run.outcome)) return run;
    const legacy = LegacyUnavailableErrorSchema.safeParse(run.outcome.error);
    if (!legacy.success) return run;
    return { ...run, outcome: { ...run.outcome, error: makeSafeAgentError(legacy.data.code, legacy.data.traceId) } };
  }) } };
}
export const ReadableStoredLocalRecordSchema = z.preprocess(normalizeLegacyLocalRecord, StoredLocalRecordSchema);
export const ReadableLocalRecordSchema = z.preprocess(normalizeLegacyLocalRecord, z.union([StoredLocalRecordSchema, LocalRecordSchema]));


/** Rebuildable list index: no photo, run history, answer or credentials. */
export const LocalHistorySummarySchema = z.strictObject({
  schemaVersion: z.literal(1), id: z.uuid(), subject: SessionViewSchema.shape.subject,
  createdAt: z.iso.datetime(), text: ProblemStatementSchema.shape.text, pending: z.boolean(),
  answerState: z.enum(['verified', 'answered', 'failed', 'unanswered']).optional(),
  batch: LocalBatchSchema.optional(),
});
export type LocalHistorySummary = z.infer<typeof LocalHistorySummarySchema> & { favorite: boolean };

/** Separate metadata avoids an in-flight solver overwriting a new bookmark. */
export const LocalFavoriteSchema = z.strictObject({ schemaVersion: z.literal(1), favorite: z.literal(true) });

/** Diagnostic metadata only: no prompts, images, response bodies, credentials or thinking. */
export const LocalDiagnosticSchema = z.strictObject({
  schemaVersion: z.literal(1), runId: z.string().min(1).max(128),
  role: z.enum(['solver', 'verifier', 'backup', 'runtime']), event: z.enum(['request', 'response', 'finish', 'validation', 'failure', 'lifecycle', 'retry', 'tool', 'queue']),
  attempt: z.number().int().min(0).max(32), elapsedMs: z.number().int().min(0).max(1_000_000),
  httpStatus: z.number().int().min(100).max(599).optional(),
  stopReason: z.enum(['stop', 'length', 'toolUse', 'pending', 'error', 'aborted', 'unknown']).optional(),
  maxTokens: z.number().int().positive().optional(), contextWindow: z.number().int().positive().optional(),
  inputTokens: z.number().int().nonnegative().optional(), outputTokens: z.number().int().nonnegative().optional(), outputBytes: z.number().int().nonnegative().optional(),
  firstTokenMs: z.number().int().nonnegative().max(1_000_000).optional(), textBytes: z.number().int().nonnegative().optional(),
  thinkingBytes: z.number().int().nonnegative().max(8 * 1024 * 1024).optional(),
  fields: z.array(z.string().max(120).regex(/^[a-zA-Z0-9_.\[\]]*$/)).max(24).optional(),
  toolStopReason: z.enum(['repeated', 'errors', 'budget', 'time', 'format']).optional(),
  toolName: z.enum(['read', 'calculate']).optional(), toolStatus: z.enum(['completed', 'failed']).optional(),
  durationMs: z.number().int().nonnegative().max(1_000_000).optional(),
  phaseMs: z.number().int().positive().max(1_000_000).optional(), imageCount: z.number().int().min(1).max(MAX_MATERIAL_IMAGES + 1).optional(),
  streaming: z.boolean().optional(), responseFormat: z.enum(['sse', 'json']).optional(),
  model: ModelReferenceSchema.optional(), resourcePath: z.string().max(160).regex(/^\/skills\/[a-z]+\/(?:references\/)?[a-zA-Z.-]+\.md$/).optional(),
  reason: z.enum(['http', 'network', 'truncated', 'json', 'schema', 'output_limit', 'invalid_finish', 'background_start', 'started', 'completed', 'failed', 'cancelled', 'deadline', 'thinking_limit', 'storage']).optional(),
});
export type LocalDiagnostic = z.infer<typeof LocalDiagnosticSchema>;
export const LocalDiagnosticsSchema = z.strictObject({ schemaVersion: z.literal(1), runId: z.string().min(1).max(128), entries: z.array(LocalDiagnosticSchema).max(MAX_LOCAL_DIAGNOSTICS) });

/** Local NDJSON archive. Deliberately excludes settings and credential stores. */
export const LocalHistoryExportLineSchema = z.discriminatedUnion('kind', [
  z.strictObject({ schemaVersion: z.literal(1), kind: z.literal('header'), format: z.literal('solveflow-history'), createdAt: z.iso.datetime(), count: z.number().int().min(0).max(MAX_LOCAL_RECORDS) }),
  z.strictObject({ schemaVersion: z.literal(1), kind: z.literal('question'), record: LocalRecordSchema, favorite: z.boolean(), diagnostics: z.array(LocalDiagnosticsSchema).max(MAX_CONVERSATION_RUNS + MAX_AUXILIARY_RUNS) }).superRefine((value, context) => {
    const ids = new Set(value.record.session.runs.map(run => run.id));
    if (new Set(value.diagnostics.map(item => item.runId)).size !== value.diagnostics.length || value.diagnostics.some(item => !ids.has(item.runId) || item.entries.some(entry => entry.runId !== item.runId))) context.addIssue({ code: 'custom', message: '导出诊断与题目不匹配。' });
  }),
  z.strictObject({ schemaVersion: z.literal(1), kind: z.literal('complete'), count: z.number().int().min(0).max(MAX_LOCAL_RECORDS) }),
]);
export type LocalHistoryExportLine = z.infer<typeof LocalHistoryExportLineSchema>;
