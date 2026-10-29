import { z } from 'zod';
import { MAX_BATCH_PRINT_COPIES, MAX_BATCH_PRINT_QUESTIONS } from './batch-print-variants.js';
// Decision: .agents/notes/implemented/storage/2026-10-21-marked-answer-exports.md

export const MAX_EXPORT_QUEUED_TASKS = 3;
export const MAX_PENDING_EXPORT_ARTIFACTS = 1;
export const MAX_PENDING_EXPORT_SAVES = MAX_EXPORT_QUEUED_TASKS + 1;
export const MAX_EXPORT_TASK_RECORDS = 500;
// Decision: .agents/notes/implemented/storage/2026-10-22-multi-copy-pdf-capacity.md
export const MAX_EXPORT_PDF_BYTES = 128 * 1024 * 1024;
export const MAX_EXPORT_ARTIFACT_BYTES = 512 * 1024 * 1024;
export const MAX_EXPORT_STORED_BYTES = 512 * 1024 * 1024;
export const ExportStorageUsageSchema = z.strictObject({
  usedBytes: z.number().int().min(0).max(MAX_EXPORT_STORED_BYTES),
  limitBytes: z.literal(MAX_EXPORT_STORED_BYTES),
  availableBytes: z.number().int().min(0).max(MAX_EXPORT_STORED_BYTES),
  fileCount: z.number().int().min(0).max(MAX_EXPORT_TASK_RECORDS),
  browserAvailableBytes: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).nullable(),
}).refine(value => value.usedBytes + value.availableBytes === value.limitBytes, '导出缓存容量不一致');
export type ExportStorageUsage = z.infer<typeof ExportStorageUsageSchema>;
export const MAX_EXPORT_PROGRESS_CHARACTERS = 200;
export const MAX_EXPORT_ERROR_CHARACTERS = 500;
export const MAX_EXPORT_FILE_NAME_CHARACTERS = 200;
export const MAX_EXPORT_TASK_TIMEOUT_MS = 30 * 60 * 1000;
export const ExportTaskStatusSchema = z.enum(['queued', 'running', 'succeeded', 'failed', 'cancelled', 'interrupted']);
export const ExportLayoutSchema = z.enum(['saved', 'clean', 'paper', 'direct']);
export type ExportLayout = z.infer<typeof ExportLayoutSchema>;
export type ExportTaskStatus = z.infer<typeof ExportTaskStatusSchema>;
export const ExportTaskProgressSchema = z.string().max(MAX_EXPORT_PROGRESS_CHARACTERS);
export const ExportTaskFileSchema = z.strictObject({
  name: z.string().trim().min(1).max(MAX_EXPORT_FILE_NAME_CHARACTERS).refine(name => name !== '.' && name !== '..' && !/[\\/\u0000-\u001f\u007f]/.test(name), '文件名须无路径和控制字符。'),
  mimeType: z.enum(['application/pdf', 'application/zip']),
  bytes: z.number().int().positive().max(MAX_EXPORT_ARTIFACT_BYTES),
}).refine(file => file.mimeType !== 'application/pdf' || file.bytes <= MAX_EXPORT_PDF_BYTES, { path: ['bytes'], message: '单份PDF超过容量上限。' });
export type ExportTaskFile = z.infer<typeof ExportTaskFileSchema>;
export const ExportTaskMetadataSchema = z.strictObject({
  batchId: z.uuid(),
  title: z.string().trim().min(1).max(100),
  mode: z.enum(['answers', 'questions', 'reading']),
  markIncorrect: z.boolean().optional(),
  layout: ExportLayoutSchema,
  copies: z.number().int().min(1).max(MAX_BATCH_PRINT_COPIES),
  questionCount: z.number().int().min(1).max(MAX_BATCH_PRINT_QUESTIONS),
  parentId: z.uuid().nullable().default(null),
}).refine(task => task.mode === 'answers' || !task.markIncorrect, { path: ['markIncorrect'], message: '只有作答副本可标记错题。' });
export type ExportTaskMetadata = z.input<typeof ExportTaskMetadataSchema>;

export function isExportTaskTerminal(status: ExportTaskStatus): boolean {
  return status !== 'queued' && status !== 'running';
}

export const ExportTaskSchema = z.strictObject({
  ...ExportTaskMetadataSchema.shape,
  parentId: z.uuid().nullable(),
  schemaVersion: z.literal(1),
  id: z.uuid(),
  createdAt: z.iso.datetime(),
  startedAt: z.iso.datetime().nullable(),
  finishedAt: z.iso.datetime().nullable(),
  status: ExportTaskStatusSchema,
  progress: ExportTaskProgressSchema,
  error: z.string().trim().min(1).max(MAX_EXPORT_ERROR_CHARACTERS).nullable(),
  file: ExportTaskFileSchema.nullable(),
}).superRefine((task, context) => {
  const issue = (path: string, message: string) => context.addIssue({ code: 'custom', path: [path], message });
  if (task.mode !== 'answers' && task.markIncorrect) issue('markIncorrect', '只有作答副本可标记错题。');
  if (task.parentId === task.id) issue('parentId', '任务的父记录须为其他任务。');
  if (task.startedAt && Date.parse(task.startedAt) < Date.parse(task.createdAt)) issue('startedAt', '开始时间早于创建时间。');
  if (task.finishedAt && Date.parse(task.finishedAt) < Date.parse(task.startedAt ?? task.createdAt)) issue('finishedAt', '结束时间早于创建或开始时间。');
  if (isExportTaskTerminal(task.status) !== (task.finishedAt !== null)) issue('finishedAt', '只有终态任务具有结束时间。');
  if ((task.status === 'running' || task.status === 'succeeded') && !task.startedAt) issue('startedAt', '执行中和成功任务须具有开始时间。');
  if (task.status === 'queued' && (task.startedAt !== null || task.error !== null)) issue('status', '排队任务尚未开始且无错误。');
  if ((task.status === 'succeeded') !== (task.file !== null)) issue('file', '只有成功任务具有已保存文件。');
  if ((task.status === 'failed' || task.status === 'interrupted') && !task.error) issue('error', '失败和中断任务须具有错误说明。');
  if ((task.status === 'succeeded' || task.status === 'cancelled') && task.error !== null) issue('error', '成功和取消任务须无错误。');
});
export type ExportTask = z.infer<typeof ExportTaskSchema>;
