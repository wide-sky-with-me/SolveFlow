import { z } from 'zod';
import { ChoiceOptionsSchema, ProblemStatementSchema, type ProblemStatement } from './learning-content.js';
import { ResponseFormatSchema } from './response-format.js';
import { ExamTypeSchema } from './exam.js';

const text = (max: number) => z.string().trim().min(1).max(max);
const question = z.strictObject({
  number: z.number().int().min(1).max(999), sourceNumber: text(40).optional(), text: text(3000),
  options: ChoiceOptionsSchema.optional(), optionsComplete: z.boolean().optional(), response: ResponseFormatSchema.optional(),
  activeSpan: z.strictObject({ block: z.number().int().min(0).max(31), text: text(2000), occurrence: z.number().int().min(1).max(20) }).nullable(),
  uncertainties: z.array(text(500)).max(4),
});
const transcript = z.strictObject({
  schemaVersion: z.literal(1), kind: z.literal('act-transcript'), subject: text(40), exam: ExamTypeSchema.optional(), module: text(80).optional(),
  blocks: z.array(z.strictObject({ kind: z.enum(['passage', 'table', 'caption']), text: text(8000) })).max(32),
  questions: z.array(question).min(1).max(4), uncertainties: z.array(text(500)).max(4),
});
export type ActTranscript = z.infer<typeof transcript>;

/** The solver cannot substitute a candidate option for the captured source span. */
export function actProblem(source: ActTranscript, index = 0): ProblemStatement {
  const current = source.questions[index];
  if (!current) throw new Error('ACT_QUESTION_MISSING');
  const blocks = source.blocks.map(block => block.text);
  if (blocks.some(block => block.includes('**'))) throw new Error('ACT_SOURCE_MARKUP');
  if (current.activeSpan) {
    const span = current.activeSpan;
    const block = blocks[span.block];
    if (block === undefined) throw new Error('ACT_SPAN_BLOCK');
    let start = -1;
    for (let occurrence = 0; occurrence < span.occurrence; occurrence++) {
      start = block.indexOf(span.text, start + 1);
      if (start === -1) throw new Error('ACT_SPAN_NOT_IN_SOURCE');
    }
    blocks[span.block] = block.slice(0, start) + '**' + span.text + '**' + block.slice(start + span.text.length);
  }
  return ProblemStatementSchema.parse({ text: [...blocks, current.text].join('\n\n'), subject: source.subject, exam: source.exam ?? 'act', ...(!source.exam || source.exam === 'act' ? { transcriptionScope: 'act-visible' } : {}),
    ...(source.module ? { module: source.module } : {}), ...(current.sourceNumber ? { sourceNumber: current.sourceNumber } : {}),
    ...(current.options ? { options: current.options } : {}), ...(current.optionsComplete === undefined ? {} : { optionsComplete: current.optionsComplete }),
    ...(current.response ? { response: current.response } : current.options ? { response: { type: 'single-choice' } } : {}),
    uncertainties: [...new Set([...source.uncertainties, ...current.uncertainties])],
  });
}

export const ActTranscriptSchema = transcript.superRefine((value, ctx) => {
  if (new Set(value.questions.map(item => item.number)).size !== value.questions.length) ctx.addIssue({ code: 'custom', path: ['questions'], message: '当前题号不能重复' });
  value.questions.forEach((_, index) => {
    try { actProblem(value, index); }
    catch { ctx.addIssue({ code: 'custom', path: ['questions', index], message: '转录必须保留完整可见题面；高亮须逐字出现在指定原文块中，不能用候选词代替；题面和疑点须符合容量约束' }); }
  });
});

const check = z.enum(['pass', 'fail', 'unknown', 'not_applicable']);
export const ActTranscriptionChecksSchema = z.strictObject({ body: check, question: check, options: check, activeSpan: check, tables: check });
