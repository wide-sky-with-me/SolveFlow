import { expect, it } from 'vitest';
import { BatchPrintLayoutSchema } from '@solveflow/contracts/local';
import { GeneratedPrintLayoutSchema, printLayoutGenerationJsonSchema } from './batch-print-layout-generation.js';

it('offers only extraction fields instead of solver-only response and duplicate illustration metadata', () => {
  const json = JSON.stringify(printLayoutGenerationJsonSchema);
  expect(json).not.toContain('"illustrations":');
  expect(json).not.toContain('"response":');
});
it('preserves extraction fields, crop ownership constraints and the complete persisted schema', () => {
  const problem = GeneratedPrintLayoutSchema.shape.questions.element.shape.problem;
  expect(Object.keys(problem.shape).sort()).toEqual(['options', 'optionsComplete', 'sourceNumber', 'subject', 'text', 'uncertainties']);
  expect(BatchPrintLayoutSchema.shape.questions.element.shape.problem.shape.illustrations).toBeDefined();
  expect(BatchPrintLayoutSchema.shape.questions.element.shape.problem.shape.response).toBeDefined();
  expect(GeneratedPrintLayoutSchema.shape.questions.element.shape.illustrationDispositions).toBeDefined();
  expect(BatchPrintLayoutSchema.shape.questions.element.shape.illustrationDispositions).toBeDefined();
  expect(printLayoutGenerationJsonSchema).toMatchObject({ properties: { questions: { maxItems: 4, minItems: 1 } } });
});
