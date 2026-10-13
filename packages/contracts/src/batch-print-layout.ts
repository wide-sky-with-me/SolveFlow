import { z } from 'zod';
import { ProblemStatementSchema, OriginalIllustrationSchema } from './learning-content.js';
import { MAX_QUESTION_IMAGE_BYTES } from './material.js';

export const MAX_BATCH_PRINT_LAYOUT_SOURCES = 8;
export const PrintLayoutRegionSchema = OriginalIllustrationSchema.safeExtend({
  role: z.enum(['question', 'option']), optionLabel: z.string().regex(/^[A-Z]$/).optional(),
}).superRefine((value, context) => {
  if (value.role === 'option' && !value.optionLabel) context.addIssue({ code: 'custom', message: '选项图缺少选项标签。' });
  if (value.role === 'question' && value.optionLabel) context.addIssue({ code: 'custom', message: '题干图不能归属选项。' });
});
export const PrintLayoutSourceSchema = z.strictObject({
  id: z.uuid(), kind: z.enum(['text-only', 'illustrations', 'retain-source']),
  rotation: z.number().finite().min(-15).max(15), regions: z.array(PrintLayoutRegionSchema).max(12),
}).superRefine((value, context) => {
  if ((value.kind === 'illustrations') !== (value.regions.length > 0)) context.addIssue({ code: 'custom', message: '图片类型与裁框不一致。' });
  if (new Set(value.regions.map(region => region.id)).size !== value.regions.length) context.addIssue({ code: 'custom', message: '图片裁框标识符重复。' });
});
export const PrintLayoutQuestionSchema = z.strictObject({
  key: z.string().min(1).max(128), problem: ProblemStatementSchema,
  sources: z.array(PrintLayoutSourceSchema).min(1).max(MAX_BATCH_PRINT_LAYOUT_SOURCES),
  warnings: z.array(z.string().trim().min(1).max(500)).max(8), confidence: z.number().finite().min(0).max(1),
}).superRefine((value, context) => {
  if (new Set(value.sources.map(source => source.id)).size !== value.sources.length) context.addIssue({ code: 'custom', message: '来源图片标识符重复。' });
  const labels = new Set(value.problem.options?.map(option => option.label) ?? []);
  for (const source of value.sources) for (const region of source.regions) if (region.optionLabel && !labels.has(region.optionLabel)) context.addIssue({ code: 'custom', message: '选项图不属于已识别选项。' });
});
export const BatchPrintLayoutSchema = z.strictObject({ schemaVersion: z.literal(1), questions: z.array(PrintLayoutQuestionSchema).min(1).max(4) }).superRefine((value, context) => {
  if (new Set(value.questions.map(question => question.key)).size !== value.questions.length) context.addIssue({ code: 'custom', message: '题目标识符重复。' });
});
export type BatchPrintLayout = z.infer<typeof BatchPrintLayoutSchema>;
export type PrintLayoutRegion = z.infer<typeof PrintLayoutRegionSchema>;
export type PrintLayoutQuestion = z.infer<typeof PrintLayoutQuestionSchema>;
export const BatchPrintLayoutInputSchema = z.strictObject({
  questions: z.array(z.strictObject({ key: z.string().min(1).max(128), problem: ProblemStatementSchema })).min(1).max(4),
  sources: z.array(z.strictObject({ id: z.uuid(), image: z.string().max(6 * 1024 * 1024).regex(/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/) })).min(1).max(MAX_BATCH_PRINT_LAYOUT_SOURCES),
}).superRefine((value, context) => {
  if (new Set(value.questions.map(question => question.key)).size !== value.questions.length || new Set(value.sources.map(source => source.id)).size !== value.sources.length) context.addIssue({ code: 'custom', message: '输入题目或图片标识符重复。' });
  const bytes = value.sources.reduce((sum, source) => sum + Math.floor((source.image.length - 'data:image/jpeg;base64,'.length) * .75) - (source.image.endsWith('==') ? 2 : source.image.endsWith('=') ? 1 : 0), 0);
  if (bytes > MAX_QUESTION_IMAGE_BYTES) context.addIssue({ code: 'custom', message: '识别输入图片总大小超过8MiB。' });
});
export type BatchPrintLayoutInput = z.infer<typeof BatchPrintLayoutInputSchema>;
function layoutOmission(question: PrintLayoutQuestion, original: BatchPrintLayoutInput['questions'][number]): string | undefined {
  const labels = new Set(question.problem.options?.map(option => option.label) ?? []);
  if (original.problem.options?.some(option => !labels.has(option.label))) return '识别结果遗漏已有选项，已恢复原题文字并保留原图，请核对。';
  if (original.problem.illustrations?.length && !question.sources.some(source => source.kind === 'retain-source' || source.regions.length)) return '识别结果遗漏已有图示，已恢复原题文字并保留原图，请核对。';
  return undefined;
}
function layoutFallbackReason(question: PrintLayoutQuestion): string | undefined {
  if (question.confidence < .9) return '题目识别置信度不足，已保留原图，请核对。';
  if (question.warnings.length || question.problem.uncertainties.length || question.problem.optionsComplete === false) return '题目识别仍有疑点，已保留原图，请核对。';
  return undefined;
}
/** No confidence claim can authorize dropping an unknown source or question. */
export function parseBatchPrintLayout(value: unknown, input: BatchPrintLayoutInput): BatchPrintLayout {
  const checkedInput = BatchPrintLayoutInputSchema.parse(input);
  const result = BatchPrintLayoutSchema.parse(value);
  const keys = new Set(checkedInput.questions.map(question => question.key));
  const ids = new Set(checkedInput.sources.map(source => source.id));
  if (result.questions.length !== keys.size || result.questions.some(question => !keys.has(question.key) || question.sources.length !== ids.size || question.sources.some(source => !ids.has(source.id)))) throw new Error('导出识别结果遗漏题目或引用了未知图片。');
  return { schemaVersion: 1, questions: checkedInput.questions.map(original => {
    const question = result.questions.find(item => item.key === original.key);
    if (!question) throw new Error('导出识别结果遗漏题目。');
    const omittedContent = layoutOmission(question, original);
    const fallback = omittedContent ?? layoutFallbackReason(question);
    const retained = question.sources.some(source => source.kind === 'retain-source');
    const warning = fallback ?? (retained ? '部分图片无法可靠拆分，已保留原图，请核对。' : undefined);
    return { ...question, problem: omittedContent ? original.problem : question.problem,
      warnings: warning ? [warning, ...question.warnings.filter(item => item !== warning)].slice(0, 8) : question.warnings,
      sources: checkedInput.sources.map(originalSource => {
      const source = question.sources.find(item => item.id === originalSource.id);
      if (!source) throw new Error('导出识别结果遗漏图片。');
      return fallback ? { ...source, kind: 'retain-source' as const, regions: [], rotation: 0 } : source;
    }) };
  }) };
}
