import { z } from 'zod';
import { AnswerCandidateSchema, MAX_ANSWER_CHARACTERS } from './agent.js';
import { ProblemStatementSchema } from './learning-content.js';

export const MAX_BATCH_PRINT_COPIES = 20;
export const MAX_BATCH_PRINT_QUESTIONS = 400;
const count = z.number().int().min(0).max(MAX_BATCH_PRINT_QUESTIONS);
const key = z.string().min(1).max(256);
const labels = z.array(z.string().regex(/^[A-Z]$/)).min(1).max(10).refine(value => new Set(value).size === value.length, '选项不能重复。');
export const BatchPrintProblemSchema = z.strictObject({
  key, ordinal: count.refine(value => value > 0), recordId: z.uuid(),
  number: z.number().int().min(1).max(999).optional(), problem: ProblemStatementSchema.nullable(),
});
export type BatchPrintProblem = z.infer<typeof BatchPrintProblemSchema>;
export const BatchPrintProblemsSchema = z.array(BatchPrintProblemSchema).min(1).max(MAX_BATCH_PRINT_QUESTIONS).refine(value => new Set(value.map(item => item.key)).size === value.length && value.every((item, index) => item.ordinal === index + 1), '题目键或顺序不一致。');
// Decision: .agents/notes/implemented/storage/2026-10-15-printable-variant-boundary.md
export const BatchPrintQuestionSchema = z.strictObject({
  key, ordinal: count.refine(value => value > 0), recordId: z.uuid(), runId: z.uuid(),
  number: z.number().int().min(1).max(999).optional(), candidate: AnswerCandidateSchema,
  baselineWrong: z.boolean(), validOptions: z.array(z.string().regex(/^[A-Z]$/)).max(10).refine(value => new Set(value).size === value.length, '选项不能重复。'),
  printOptions: z.array(z.string().regex(/^[A-Z]$/)).max(10).refine(value => new Set(value).size === value.length, '打印选项不能重复。').optional(), printOptionsComplete: z.boolean().optional(),
}).superRefine((value, context) => {
  const options = value.candidate.problem.options?.map(option => option.label) ?? [];
  if (value.candidate.questions || options.length !== value.validOptions.length || options.some(label => !value.validOptions.includes(label))) context.addIssue({ code: 'custom', message: '题目须按实际题号拆分，选项须与已保存题目一致。' });
});
export type BatchPrintQuestion = z.infer<typeof BatchPrintQuestionSchema>;
export const BatchPrintQuestionsSchema = z.array(BatchPrintQuestionSchema).min(1).max(MAX_BATCH_PRINT_QUESTIONS).refine(value => new Set(value.map(item => item.key)).size === value.length && value.every((item, index) => item.ordinal === index + 1), '题目键或顺序不一致。');
export const BatchPrintCopyRequestSchema = z.strictObject({ correct: count, incorrect: count });
export const BatchPrintCopyRequestsSchema = z.array(BatchPrintCopyRequestSchema).min(1).max(MAX_BATCH_PRINT_COPIES);
export type BatchPrintCopyRequest = z.infer<typeof BatchPrintCopyRequestSchema>;
export const BatchPrintReferenceSchema = z.strictObject({ key, referenceOptions: labels.nullable().optional(), referenceAnswer: z.string().trim().min(1).max(MAX_ANSWER_CHARACTERS).nullable().optional(), wrongAnswer: z.string().max(MAX_ANSWER_CHARACTERS).optional() });
export const BatchPrintReferencesSchema = z.array(BatchPrintReferenceSchema).max(MAX_BATCH_PRINT_QUESTIONS).refine(value => new Set(value.map(item => item.key)).size === value.length, '每题只能填写一次参照。');
export type BatchPrintReference = z.infer<typeof BatchPrintReferenceSchema>;
export const BatchPrintCopyAnswerSchema = z.strictObject({ key, ordinal: count.refine(value => value > 0), recordId: z.uuid(), runId: z.uuid(), answer: z.string().max(MAX_ANSWER_CHARACTERS), selectedOptions: labels.optional(), incorrect: z.boolean(), changed: z.boolean() });
export type BatchPrintCopyAnswer = z.infer<typeof BatchPrintCopyAnswerSchema>;
export const BatchPrintCopySchema = z.strictObject({ copyIndex: z.number().int().min(1).max(MAX_BATCH_PRINT_COPIES), total: count.refine(value => value > 0), correct: count, incorrect: count, answers: z.array(BatchPrintCopyAnswerSchema).min(1).max(MAX_BATCH_PRINT_QUESTIONS) }).superRefine((value, context) => {
  if (value.correct + value.incorrect !== value.total || value.answers.length !== value.total || value.answers.filter(item => item.incorrect).length !== value.incorrect || new Set(value.answers.map(item => item.key)).size !== value.total || value.answers.some((item, index) => item.ordinal !== index + 1)) context.addIssue({ code: 'custom', message: '导出份数的题量、作答和对错数不一致。' });
});
export type BatchPrintCopy = z.infer<typeof BatchPrintCopySchema>;
