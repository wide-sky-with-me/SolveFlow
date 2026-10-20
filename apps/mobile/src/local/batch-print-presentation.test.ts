import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { BatchPrintQuestionsSchema, BatchPrintCopySchema } from '@solveflow/contracts/local';
import { planBatchPrintCopies } from '@solveflow/client/presentation';

const source = readFileSync(new URL('./batch-print-presentation.web.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const clean: unknown = new Function('require', 'exports', `${compiled}\nreturn exports.requireCleanPrintLayouts;`)(() => ({}), {});
if (typeof clean !== 'function') throw new Error('PAPER_GUARD');
const questions = [{ key: 'fixture', ordinal: 1 }];
const problem = { text: 'Full question', uncertainties: [] };
describe('formal question-paper readiness', () => {
  it('keeps model warnings out of formal exports until reviewed', () => { expect(() => clean(questions, { fixture: { problem, assets: [], warnings: ['Uncertain label'] } }, {})).toThrow('尚待整理'); });
  it('rejects a remaining whole screenshot', () => { expect(() => clean(questions, { fixture: { problem, assets: [{ key: 'image', role: 'source' }], warnings: [] } }, { image: 'fixture' })).toThrow('尚待整理'); });
  it('accepts complete text and present cropped figures', () => { expect(() => clean(questions, { fixture: { problem, assets: [{ key: 'image', role: 'question' }], warnings: [] } }, { image: 'fixture' })).not.toThrow(); });
});

const saved: unknown = new Function('require', 'exports', `${compiled}\nreturn exports.requireSavedPrintLayouts;`)(() => ({}), {});
if (typeof saved !== 'function') throw new Error('SAVED_GUARD');
describe('saved-content export readiness', () => {
  it('preserves the original image rather than making layout extraction a prerequisite', () => {
    expect(() => saved(questions, { fixture: { problem, assets: [{ key: 'image', role: 'source' }], warnings: ['Needs review'] } }, { image: 'fixture' })).not.toThrow();
  });
  it('still rejects a missing source instead of silently dropping the illustration', () => {
    expect(() => saved(questions, { fixture: { problem, assets: [{ key: 'image', role: 'source' }], warnings: [] } }, {})).toThrow('图源不完整');
  });
});

const paper: unknown = new Function('require', 'exports', `${compiled}\nreturn exports.requirePaperPrintLayouts;`)(() => ({}), {});
if (typeof paper !== 'function') throw new Error('PAPER_READINESS_GUARD');
for (const check of [saved, paper]) describe('unanswered question export readiness', () => {
  it('accepts the extracted text without requiring an answer in the original snapshot', () => {
    expect(() => check([{ key: 'fixture', ordinal: 1, problem: null }], { fixture: { problem, assets: [], warnings: [] } }, {})).not.toThrow();
  });
  it('still blocks an unextracted placeholder after all original images were removed', () => {
    expect(() => check([{ key: 'fixture', ordinal: 1, problem: null }], { fixture: { problem: { text: '题目尚待提取', uncertainties: ['请从原图提取完整题目'] }, assets: [], warnings: [] } }, {})).toThrow('没有可导出的题干或原图');
  });
  it('still blocks empty extracted text', () => {
    expect(() => check([{ key: 'fixture', ordinal: 1, problem: null }], { fixture: { problem: { text: '  ', uncertainties: [] }, assets: [], warnings: [] } }, {})).toThrow('内容或图源不完整');
  });
  it('still blocks an extracted question whose required figure is missing', () => {
    expect(() => check([{ key: 'fixture', ordinal: 1, problem: null }], { fixture: { problem, assets: [{ key: 'missing', role: 'question' }], warnings: [] } }, {})).toThrow('内容或图源不完整');
  });
});

const project: unknown = new Function('require', 'exports', `${compiled}\nreturn exports.printableVariantQuestions;`)(() => ({}), {});
const guard: unknown = new Function('require', 'exports', `${compiled}\nreturn exports.requirePrintableCopies;`)(() => ({}), {});
const choice = { text: 'Full question', subject: 'math', uncertainties: [], optionsComplete: true, options: [{ label: 'A', text: 'one' }, { label: 'B', text: 'two' }, { label: 'C', text: 'three' }] };
const original = BatchPrintQuestionsSchema.parse([{ key: 'fixture', ordinal: 1, recordId: '94100000-0000-4000-8000-000000000001', runId: '94100000-0000-4000-8000-000000000001', baselineWrong: false, validOptions: ['A', 'B', 'C'], candidate: { schemaVersion: 1, kind: 'answer', problem: choice, answer: 'Saved answer.', selectedOptions: ['B'], steps: [], knowledgePoints: [], citationIds: [], clarificationQuestions: [] } }]);
function invokeProject(problem: unknown) {
  if (typeof project !== 'function') throw new Error('VARIANT_PROJECTOR_MISSING');
  return BatchPrintQuestionsSchema.parse(project(original, { fixture: { problem, assets: [], warnings: [] } }));
}
function invokeGuard(copies: unknown, problem: unknown) {
  if (typeof guard !== 'function') throw new Error('VARIANT_GUARD_MISSING');
  return guard(copies, { fixture: { problem, assets: [], warnings: [] } });
}
describe('variants follow the printable choice boundary', () => {
  it('plans new answers only from the actual printed labels without mutating the saved candidate', () => {
    const before = JSON.stringify(original);
    const next = invokeProject({ ...choice, options: [{ label: 'B', text: 'two' }, { label: 'D', text: 'four' }] });
    expect(next[0]?.printOptions).toEqual(['B', 'D']); expect(next[0]?.validOptions).toEqual(['A', 'B', 'C']); expect(next[0]?.candidate).toEqual(original[0]?.candidate);
    const copies = planBatchPrintCopies(next, [{ correct: 0, incorrect: 1 }]);
    expect(copies[0]?.answers[0]?.selectedOptions).toEqual(['D']); expect(JSON.stringify(original)).toBe(before);
  });
  it('validates explicit references against printed choices while keeping the original reference valid', () => {
    const next = invokeProject({ ...choice, options: [{ label: 'B', text: 'two' }, { label: 'D', text: 'four' }] });
    expect(() => planBatchPrintCopies(next, [{ correct: 1, incorrect: 0 }], [{ key: 'fixture', referenceOptions: ['A'] }])).toThrow('第1题的参照选项无效');
    expect(planBatchPrintCopies(next, [{ correct: 1, incorrect: 0 }])[0]?.answers[0]?.selectedOptions).toEqual(['B']);
  });
  it('does not reclassify choice questions when the printable option set is empty', () => {
    const next = invokeProject({ text: 'Partial question', subject: 'math', uncertainties: ['Options not visible'], optionsComplete: false });
    expect(next[0]?.validOptions).toEqual(['A', 'B', 'C']); expect(next[0]?.printOptions).toEqual([]);
    expect(() => planBatchPrintCopies(next, [{ correct: 0, incorrect: 1 }])).toThrow('可调整的题目不足');
    expect(BatchPrintQuestionsSchema.safeParse([{ ...original[0], printOptions: ['B', 'B'] }]).success).toBe(false);
  });
  it('keeps the unchanged baseline but excludes incomplete choices from new errors', () => {
    const next = invokeProject({ ...choice, optionsComplete: false, uncertainties: ['Needs review'] });
    expect(planBatchPrintCopies(next, [{ correct: 1, incorrect: 0 }])[0]?.answers[0]?.selectedOptions).toEqual(['B']);
    expect(() => planBatchPrintCopies(next, [{ correct: 0, incorrect: 1 }])).toThrow('可调整的题目不足');
  });
  it('preserves a hidden original baseline without treating it as a new printable alternative', () => {
    const next = invokeProject({ ...choice, options: [{ label: 'A', text: 'one' }, { label: 'C', text: 'three' }] });
    expect(next[0]?.candidate.selectedOptions).toEqual(['B']); expect(next[0]?.printOptionsComplete).toBe(false); expect(next[0]?.candidate).toEqual(original[0]?.candidate);
    expect(planBatchPrintCopies(next, [{ correct: 1, incorrect: 0 }])[0]?.answers[0]?.selectedOptions).toEqual(['B']);
    expect(() => planBatchPrintCopies(next, [{ correct: 0, incorrect: 1 }])).toThrow('可调整的题目不足');
  });
  it('rejects a frozen newly generated choice that disappeared before rendering', () => {
    const copies = planBatchPrintCopies(original, [{ correct: 0, incorrect: 1 }]);
    expect(() => invokeGuard(copies, { ...choice, options: [{ label: 'B', text: 'two' }, { label: 'D', text: 'four' }] })).toThrow('第1题整理后的选项');
    expect(() => invokeGuard(copies, { ...choice, optionsComplete: false, uncertainties: ['Needs review'] })).toThrow('第1题整理后的选项');
  });
  it('accepts visible new choices and unchanged original choices independently', () => {
    const adjusted = BatchPrintCopySchema.parse({ copyIndex: 1, total: 1, correct: 0, incorrect: 1, answers: [{ key: 'fixture', ordinal: 1, recordId: original[0]?.recordId, runId: original[0]?.runId, answer: 'C', selectedOptions: ['C'], incorrect: true, changed: true }] });
    expect(() => invokeGuard([adjusted], choice)).not.toThrow();
    expect(() => invokeGuard(planBatchPrintCopies(original, [{ correct: 1, incorrect: 0 }]), { ...choice, options: [{ label: 'A', text: 'one' }, { label: 'C', text: 'three' }] })).not.toThrow();
  });
});
