import { z } from 'zod';
import { ProblemStatementSchema } from './learning-content.js';
import { PrintImageAdjustmentSchema } from './print-image-adjustment.js';
import { BatchPrintLayoutInputSchema, type BatchPrintLayoutInput } from './batch-print-layout.js';

// Decision: .agents/notes/implemented/storage/2026-10-14-persistent-paper-preparation.md
const key = z.string().min(1).max(256);
const jpeg = z.string().max(6 * 1024 * 1024).regex(/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/);
export const PreparedPrintAssetSchema = z.strictObject({ key, sourceId: z.uuid(), alt: z.string().min(1).max(500), role: z.enum(['question', 'option', 'source']), optionLabel: z.string().regex(/^[A-Z]$/).optional() }).superRefine((asset, context) => {
  if ((asset.role === 'option') !== (asset.optionLabel !== undefined)) context.addIssue({ code: 'custom', message: '图示选项归属不一致。' });
});
export const PreparedPrintLayoutSchema = z.strictObject({ problem: ProblemStatementSchema, assets: z.array(PreparedPrintAssetSchema).max(96), warnings: z.array(z.string().min(1).max(500)).max(8) }).superRefine((layout, context) => {
  const labels = new Set(layout.problem.options?.map(option => option.label) ?? []);
  if (new Set(layout.assets.map(asset => asset.key)).size !== layout.assets.length || layout.assets.some(asset => asset.optionLabel && !labels.has(asset.optionLabel))) context.addIssue({ code: 'custom', message: '图示重复或引用了未知选项。' });
});
export type PreparedPrintLayout = z.infer<typeof PreparedPrintLayoutSchema>;
export const PreparedPrintRecordSchema = z.strictObject({
  schemaVersion: z.literal(1),
  layouts: z.record(z.string().min(1).max(128), PreparedPrintLayoutSchema).refine(layouts => Object.keys(layouts).length > 0 && Object.keys(layouts).length <= 4),
  images: z.record(key, jpeg).refine(images => Object.keys(images).length <= 384),
  sources: z.array(z.strictObject({ key, image: jpeg, label: z.string().min(1).max(500), region: z.literal(true) })).max(384),
  adjustments: z.record(key, PrintImageAdjustmentSchema).refine(adjustments => Object.keys(adjustments).length <= 384),
});
export type PreparedPrintRecord = z.infer<typeof PreparedPrintRecordSchema>;
export function parsePreparedPrintRecord(value: unknown, inputValue: BatchPrintLayoutInput): PreparedPrintRecord {
  const input = BatchPrintLayoutInputSchema.parse(inputValue); const record = PreparedPrintRecordSchema.parse(value);
  const keys = new Set(input.questions.map(question => question.key)); const sources = new Set(input.sources.map(source => source.id));
  if (Object.keys(record.layouts).length !== keys.size || Object.keys(record.layouts).some(key => !keys.has(key))) throw new Error('整理记录不属于本题。');
  const assets = Object.values(record.layouts).flatMap(layout => layout.assets); const imageKeys = new Set(assets.map(asset => asset.key));
  if (assets.some(asset => !sources.has(asset.sourceId) || !record.images[asset.key])) throw new Error('整理记录的图源不完整。');
  if (Object.keys(record.images).some(key => !imageKeys.has(key)) || Object.keys(record.adjustments).some(key => !imageKeys.has(key)) || record.sources.some(source => !imageKeys.has(source.key))) throw new Error('整理记录含无关图片。');
  return record;
}
