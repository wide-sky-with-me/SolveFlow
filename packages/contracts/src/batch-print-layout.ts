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
// Decision: .agents/notes/implemented/agent/2026-10-20-print-illustration-dispositions.md
const TranscribedIllustrationSchema = z.strictObject({
  id: OriginalIllustrationSchema.shape.id, kind: z.enum(['text', 'table']), content: z.string().trim().min(1).max(8000),
});
const IllustrationDispositionSchema = z.union([
  TranscribedIllustrationSchema,
  z.strictObject({ id: OriginalIllustrationSchema.shape.id, kind: z.literal('crop'), sourceId: z.uuid(), regionId: OriginalIllustrationSchema.shape.id }),
  z.strictObject({ id: OriginalIllustrationSchema.shape.id, kind: z.literal('source'), sourceId: z.uuid() }),
]);
export const PrintLayoutQuestionSchema = z.strictObject({
  key: z.string().min(1).max(128), problem: ProblemStatementSchema,
  sources: z.array(PrintLayoutSourceSchema).min(1).max(MAX_BATCH_PRINT_LAYOUT_SOURCES),
  warnings: z.array(z.string().trim().min(1).max(500)).max(8), confidence: z.number().finite().min(0).max(1),
  illustrationDispositions: z.array(IllustrationDispositionSchema).max(3).optional(),
}).superRefine((value, context) => {
  if (new Set(value.sources.map(source => source.id)).size !== value.sources.length) context.addIssue({ code: 'custom', message: '来源图片标识符重复。' });
  const dispositions = value.illustrationDispositions ?? [];
  if (new Set(dispositions.map(item => item.id)).size !== dispositions.length) context.addIssue({ code: 'custom', message: '图示处置标识符重复。' });
  for (const [index, item] of dispositions.entries()) {
    const valid = item.kind === 'text' || item.kind === 'table' ? printedTranscription(value.problem.text, item)
      : item.kind === 'crop' ? value.sources.some(source => source.id === item.sourceId && source.kind === 'illustrations' && source.regions.some(region => region.id === item.regionId))
      : item.kind === 'source' && value.sources.some(source => source.id === item.sourceId && source.kind === 'retain-source');
    if (!valid) context.addIssue({ code: 'custom', path: ['illustrationDispositions', index], message: '图示处置依据未完整排入题干，或引用的表格、裁片和图源无效。' });
  }
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
  purpose: z.enum(['exam', 'reference']).optional(),
  questions: z.array(z.strictObject({ key: z.string().min(1).max(128), problem: ProblemStatementSchema.nullable() })).min(1).max(4),
  sources: z.array(z.strictObject({ id: z.uuid(), image: z.string().max(6 * 1024 * 1024).regex(/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/) })).min(1).max(MAX_BATCH_PRINT_LAYOUT_SOURCES),
}).superRefine((value, context) => {
  if (new Set(value.questions.map(question => question.key)).size !== value.questions.length || new Set(value.sources.map(source => source.id)).size !== value.sources.length) context.addIssue({ code: 'custom', message: '输入题目或图片标识符重复。' });
  const bytes = value.sources.reduce((sum, source) => sum + Math.floor((source.image.length - 'data:image/jpeg;base64,'.length) * .75) - (source.image.endsWith('==') ? 2 : source.image.endsWith('=') ? 1 : 0), 0);
  if (bytes > MAX_QUESTION_IMAGE_BYTES) context.addIssue({ code: 'custom', message: '识别输入图片总大小超过8MiB。' });
});
export type BatchPrintLayoutInput = z.infer<typeof BatchPrintLayoutInputSchema>;
/** Explicit refinement hints do not alter source ownership or the persistent input key. */
export const PrintLayoutRefinementSchema = z.strictObject({ reviewNotes: z.string().max(2000).default('') });
export type PrintLayoutRefinement = z.infer<typeof PrintLayoutRefinementSchema>;
function object(value: unknown): value is Record<string, unknown> { return !!value && typeof value === 'object' && !Array.isArray(value); }
/** Model-only normalization; persisted schemas and ownership checks remain strict. */
export function normalizeGeneratedBatchPrintLayout(value: unknown): unknown {
  if (!object(value) || !Array.isArray(value.questions) || value.questions.length > 4) return value;
  return { ...value, questions: value.questions.map(question => {
    if (!object(question)) return question;
    const problem = object(question.problem) && typeof question.problem.sourceNumber === 'string' && !question.problem.sourceNumber.trim()
      ? { ...question.problem, sourceNumber: undefined } : question.problem;
    if (!Array.isArray(question.sources) || question.sources.length > MAX_BATCH_PRINT_LAYOUT_SOURCES) return { ...question, problem };
    return { ...question, problem, sources: question.sources.map(source => {
      if (!object(source) || source.kind !== 'illustrations' || !Array.isArray(source.regions) || source.regions.length > 12) return source;
      const missingLabel = source.regions.some(region => object(region) && region.role === 'option' && region.optionLabel === undefined);
      if (!missingLabel) return source;
      const validationRegions = source.regions.map(region => object(region) && region.role === 'option' && region.optionLabel === undefined ? { ...region, role: 'question' } : region);
      if (!PrintLayoutSourceSchema.safeParse({ ...source, regions: validationRegions }).success) return source;
      return { ...source, kind: 'retain-source', regions: [], rotation: 0 };
    }) };
  }) };
}
/** Compares visible transcription, not whether a model's visual classification is correct. */
function transcriptionText(value: string, table: boolean): string {
  const normalized = value.normalize('NFKC').replace(/\r\n?/g, '\n');
  return table ? normalized.split('\n').map(line => line.replace(/[^\S\n]+/g, ' ').trim()).join('\n').trim() : normalized.replace(/\s+/g, ' ').trim();
}
function tableCells(line: string): string[] {
  const cells: string[] = []; let cell = '';
  for (let index = 0; index < line.length; index++) {
    const character = line[index];
    if (character === '\\' && line[index + 1] === '|') { cell += '\\|'; index++; }
    else if (character === '|') { cells.push(cell.trim()); cell = ''; } else cell += character;
  }
  cells.push(cell.trim());
  if (line.trimStart().startsWith('|')) cells.shift();
  if (line.trimEnd().endsWith('|')) cells.pop();
  return cells;
}
function printedTranscription(text: string, item: z.infer<typeof TranscribedIllustrationSchema>): boolean {
  const table = item.kind === 'table'; const content = transcriptionText(item.content, table);
  if (!transcriptionText(text, table).includes(content)) return false;
  if (!table) return true;
  const rows = content.split('\n').map(tableCells); const width = rows[0]?.length ?? 0;
  return width >= 2 && rows.length >= 3 && rows.every(row => row.length === width) && [rows[0]!, ...rows.slice(2)].some(row => row.some(Boolean)) && rows[1]!.every(cell => /^:?-{3,}:?$/.test(cell));
}
function layoutOmission(question: PrintLayoutQuestion, original: BatchPrintLayoutInput['questions'][number]): string | undefined {
  const labels = new Set(question.problem.options?.map(option => option.label) ?? []);
  if (original.problem?.options?.some(option => !labels.has(option.label))) return '识别结果遗漏已有选项，已恢复原题文字并保留原图，请核对。';
  const illustrations = original.problem?.illustrations ?? [];
  const covered = new Set(question.illustrationDispositions?.map(item => item.id) ?? []);
  const missing = question.illustrationDispositions !== undefined ? illustrations.some(item => !covered.has(item.id)) : illustrations.length > 0 && !question.sources.some(source => source.kind === 'retain-source' || source.regions.length);
  if (missing) return '识别结果遗漏已有图示，已恢复原题文字并保留原图，请核对。';
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
    const originalIllustrations = new Set(original.problem?.illustrations?.map(item => item.id) ?? []);
    if (question.illustrationDispositions?.some(item => !originalIllustrations.has(item.id))) throw new Error('图示处置依据不属于本题。');
    const omittedContent = layoutOmission(question, original);
    // Reference documents preserve explicit crops and disclose transcription doubts; exam exports keep their strict gate.
    const referenceCrops = checkedInput.purpose === 'reference' && question.sources.some(source => source.regions.length);
    const fallback = omittedContent ?? (checkedInput.purpose === 'reference' && (question.confidence >= .9 || referenceCrops) ? undefined : layoutFallbackReason(question));
    const retained = question.sources.some(source => source.kind === 'retain-source');
    const warning = fallback ?? (checkedInput.purpose === 'reference' && question.confidence < .9 ? '题目识别置信度不足，请核对已提取的文字与图示。' : retained ? '部分图片无法可靠拆分，已保留原图，请核对。' : undefined);
    const printable = { ...question };
    if (fallback) delete printable.illustrationDispositions;
    return { ...printable, problem: omittedContent && original.problem ? original.problem : question.problem,
      warnings: warning ? [warning, ...question.warnings.filter(item => item !== warning)].slice(0, 8) : question.warnings,
      sources: checkedInput.sources.map(originalSource => {
      const source = question.sources.find(item => item.id === originalSource.id);
      if (!source) throw new Error('导出识别结果遗漏图片。');
      return fallback ? { ...source, kind: 'retain-source' as const, regions: [], rotation: 0 } : source;
    }) };
  }) };
}
