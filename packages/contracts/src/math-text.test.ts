import { expect, it } from 'vitest';
import { normalizeMathDelimiters } from './math-text.js';

it('prepares model delimiters and bare arithmetic without changing numbers or currency', () => {
  const text = String.raw`由 \(x=\frac{-7+\sqrt{29}}{2}\) 得到 \(k=29\)。计算 42.50\div 10=4.25。$12 each or $20 per pair.`;
  const normalized = normalizeMathDelimiters(text, { bareArithmetic: true });
  expect(normalized).toBe(String.raw`由 $x=\frac{-7+\sqrt{29}}{2}$ 得到 $k=29$。计算 $42.50\div 10=4.25$。\$12 each or \$20 per pair.`);
  expect(normalizeMathDelimiters(String.raw`42.50\div 10=4.25`)).toBe(String.raw`42.50\div 10=4.25`);
});

it('does not wrap code, file paths or already-delimited formulas again', () => {
  const text = String.raw`普通 C:\div\files；` + '`42.50\\div 10=4.25`\n```tex\n\\(literal\\)\n```\n' + String.raw`$42.50\div 10=4.25$；\[y=\sqrt{x}\]`;
  expect(normalizeMathDelimiters(text, { bareArithmetic: true })).toBe(String.raw`普通 C:\div\files；` + '`42.50\\div 10=4.25`\n```tex\n\\(literal\\)\n```\n' + '$42.50\\div 10=4.25$；\n$$\ny=\\sqrt{x}\n$$\n');
});
