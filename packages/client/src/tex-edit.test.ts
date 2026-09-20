import { expect, it } from 'vitest';
import { insertTex } from './tex-edit.js';
it('inserts formulas at the selection and selects the editable operand', () => {
  expect(insertTex('求 y 的值', { start: 2, end: 3 }, 'fraction')).toEqual({ text: '求 $\\frac{y}{2}$ 的值', selection: { start: 9, end: 10 } });
  expect(insertTex('', { start: 0, end: 0 }, 'root')?.text).toBe('$\\sqrt{x}$');
});
it('does not nest delimiters inside existing inline or display math', () => {
  for (const [open, close] of [['$', '$'], ['$$', '$$'], ['\\(', '\\)'], ['\\[', '\\]']]) {
    const text = `${open}x${close}`;
    expect(insertTex(text, { start: open!.length, end: open!.length + 1 }, 'power')?.text).toBe(`${open}x^{2}${close}`);
  }
  expect(insertTex('价格\\$5，', { start: 7, end: 7 }, 'formula')?.text).toBe('价格\\$5，$x$');
});
it('preserves the input limit and clamps stale selections', () => {
  expect(insertTex('a'.repeat(2000), { start: 2000, end: 2000 }, 'root')).toBeNull();
  expect(insertTex('x', { start: 99, end: 100 }, 'subscript')?.text).toBe('x$x_{1}$');
});
