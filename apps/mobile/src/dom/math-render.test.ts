import { expect, it } from 'vitest';
import { renderFormula } from './math-render.js';
import { ChemistrySchema, reactionLatex } from '../../../../packages/contracts/src/chemistry.js';

it('renders formulas containing invisible model control characters without changing ordinary whitespace', () => {
  for (const formula of [
    '\u001bsin^2\\theta+\\cos^2\\theta=1',
    '\u001bcos\\theta=\\sin(90^\\circ-\\theta)',
    '\\si\u0000n^2\\theta+\\cos^2\\theta=1',
  ]) {
    const html = renderFormula(formula, true);
    expect(html).toContain('katex');
    expect(html).not.toMatch(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/);
  }
  expect(renderFormula('x = 1\n+ 2\t', true)).toContain('katex');
});

it('renders structured hydrates without turning the hydrate count into a subscript', () => {
  const term = (formula: string, coefficient = 1) => ({ formula, coefficient, charge: 0 });
  const reaction = ChemistrySchema.parse({ reactions: [{ reactants: [term('CuSO4·5H2O')], products: [term('CuSO4'), term('H2O', 5)], arrow: 'forward' }] }).reactions[0]!;
  expect(reactionLatex(reaction)).toContain('CuSO4 * 5H2O');
  expect(renderFormula(reactionLatex(reaction), false)).toContain('katex');
});

it('renders chemical equations, ions and equilibrium arrows', () => {
  for (const formula of [String.raw`\ce{2H2 + O2 -> 2H2O}`, String.raw`\ce{Fe^{3+} + e- <=> Fe^{2+}}`]) {
    expect(renderFormula(formula, false)).toContain('katex');
  }
});

it('renders Chinese quantity labels used in science answers', () => {
  const html = renderFormula(String.raw`R_{总}=R_1+R_2`, true);
  expect(html).toContain('katex');
  expect(html).toContain('总');
});

it('retains syntax errors and untrusted-command protection', () => {
  expect(() => renderFormula(String.raw`I=\dfrac{3}`, true)).toThrow();
  expect(renderFormula(String.raw`\href{javascript:alert(1)}{x}`, true)).not.toContain('href="javascript:');
  expect(() => renderFormula(String.raw`\def\a{\a}\a`, true)).toThrow();
});
