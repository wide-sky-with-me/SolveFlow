import { z } from 'zod';
import { MAX_BATCH_PRINT_COPIES, MAX_BATCH_PRINT_QUESTIONS } from './batch-print-variants.js';

export const MAX_EXPORT_QUEUED_TASKS = 3;
export const MAX_PENDING_EXPORT_ARTIFACTS = 1;
export const MAX_PENDING_EXPORT_SAVES = MAX_EXPORT_QUEUED_TASKS + 1;
export const MAX_EXPORT_TASK_RECORDS = 500;
export const MAX_EXPORT_ARTIFACT_BYTES = 128 * 1024 * 1024;
export const MAX_EXPORT_PROGRESS_CHARACTERS = 200;
export const MAX_EXPORT_ERROR_CHARACTERS = 500;
export const MAX_EXPORT_FILE_NAME_CHARACTERS = 200;
export const MAX_EXPORT_TASK_TIMEOUT_MS = 30 * 60 * 1000;
export const ExportTaskStatusSchema = z.enum(['queued', 'running', 'succeeded', 'failed', 'cancelled', 'interrupted']);
export type ExportTaskStatus = z.infer<typeof ExportTaskStatusSchema>;
export const ExportTaskProgressSchema = z.string().max(MAX_EXPORT_PROGRESS_CHARACTERS);
export const ExportTaskFileSchema = z.strictObject({
  name: z.string().trim().min(1).max(MAX_EXPORT_FILE_NAME_CHARACTERS).refine(name => name !== '.' && name !== '..' && !/[\\/\u0000-\u001f\u007f]/.test(name), '文件名须无路径和控制字符。'),
  mimeType: z.enum(['application/pdf', 'application/zip']),
  bytes: z.number().int().positive().max(MAX_EXPORT_ARTIFACT_BYTES),
});
export type ExportTaskFile = z.infer<typeof ExportTaskFileSchema>;
export const ExportTaskMetadataSchema = z.strictObject({
  batchId: z.uuid(),
  title: z.string().trim().min(1).max(100),
  mode: z.enum(['answers', 'questions', 'reading']),
  layout: z.enum(['saved', 'clean', 'paper']),
  copies: z.number().int().min(1).max(MAX_BATCH_PRINT_COPIES),
  questionCount: z.number().int().min(1).max(MAX_BATCH_PRINT_QUESTIONS),
  parentId: z.uuid().nullable().default(null),
});
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
