import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('./print-question-pages.web.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const fit: unknown = new Function('exports', `${compiled}\nreturn exports.fitBatchPrintQuestionPages;`)({});
const fitPage: unknown = new Function('exports', `${compiled}\nreturn exports.fitBatchPrintQuestionPage;`)({});
if (typeof fit !== 'function' || typeof fitPage !== 'function') throw new Error('QUESTION_FITTER');
function fixture(height: number, width: number) {
  const inner = { scrollHeight: height, scrollWidth: width, style: { transform: '', transformOrigin: '' }, querySelectorAll: () => [] };
  const body = { clientHeight: 902, clientWidth: 674 };
  const page = { dataset: { pdfQuestion: '1', pdfFit: '' }, ownerDocument: { defaultView: { getComputedStyle: () => ({ fontSize: '14px' }) } }, querySelector: (selector: string) => selector === '.print-page-body' ? body : inner };
  return { querySelectorAll: () => [page], inner, page };
}
describe('single-question page fitting', () => {
  it('keeps a fitting page at its normal font size', () => { const root = fixture(600, 600); fit(root); expect(root.inner.style.transform).toBe('scale(1)'); });
  it('fits a single cloned sheet without requiring its empty sibling sheets', () => { const root = fixture(600, 840); fitPage(root.page); expect(root.inner.style.transform).toBe('scale(0.8)'); });
  it('fits horizontal content too instead of allowing the page body to clip it', () => { const root = fixture(600, 840); fit(root); expect(root.inner.style.transform).toBe('scale(0.8)'); });
  it('reports a question that would fall below the readable font floor', () => { expect(() => fit(fixture(1500, 600))).toThrow('第1题内容过长'); });
});
