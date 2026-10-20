import { z } from 'zod';
import { BatchPrintLayoutSchema } from '@solveflow/contracts/local';

const question = BatchPrintLayoutSchema.shape.questions.element;
const fields = question.shape.problem.shape;
// Decision: .agents/notes/implemented/agent/2026-10-15-print-layout-generation-view.md
// Generation is narrower than storage; full validation and trusted input still govern acceptance.
export const GeneratedPrintLayoutSchema = BatchPrintLayoutSchema.safeExtend({
  questions: z.array(question.safeExtend({ problem: z.strictObject({
    sourceNumber: fields.sourceNumber, text: fields.text, subject: fields.subject,
    options: fields.options, optionsComplete: fields.optionsComplete, uncertainties: fields.uncertainties
  }) })).min(1).max(4)
});
export const printLayoutGenerationJsonSchema = z.toJSONSchema(GeneratedPrintLayoutSchema);
