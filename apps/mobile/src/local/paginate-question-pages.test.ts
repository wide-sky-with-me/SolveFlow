import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { expect, it } from 'vitest';

const source = readFileSync(new URL('./paginate-question-pages.web.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
class Overflow extends Error {}
const paginate: unknown = new Function('require', 'exports', `${compiled}\nreturn exports.paginateQuestionPage;`)(() => ({ fitBatchPrintQuestionPage() { throw new Overflow(); }, PrintQuestionOverflowError: Overflow }), {});
if (typeof paginate !== 'function') throw new Error('QUESTION_PAGINATOR');

it('cancellation wins before measuring or changing a question', async () => {
  const page = { get ownerDocument() { throw new Error('UNEXPECTED_DOM_READ'); } };
  await expect(paginate(page, 5, () => { throw new Error('CANCELLED'); })).rejects.toThrow('CANCELLED');
});
it.each([0, -1, NaN, 1.5])('rejects invalid remaining page capacity %s before reading source content', async capacity => {
  const page = { get ownerDocument() { throw new Error('UNEXPECTED_DOM_READ'); } };
  await expect(paginate(page, capacity, () => {})).rejects.toThrow('PDF 页数超过上限');
});
it('a long question cannot create a continuation after the remaining physical page slot is consumed', async () => {
  const body = { clientHeight: 102, clientWidth: 100 };
  const inner = { style: { transform: '' }, scrollHeight: 1000, scrollWidth: 90, querySelectorAll: () => [] };
  const page = { dataset: { pdfQuestion: '19' }, ownerDocument: {}, querySelectorAll: () => [], querySelector: (selector: string) => selector === '.print-page-body' ? body : selector === '.print-page-inner' ? inner : {} };
  await expect(paginate(page, 1, () => {})).rejects.toThrow('PDF 页数超过上限');
});
