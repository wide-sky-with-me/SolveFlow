import katex from 'katex';
import 'katex/contrib/mhchem';

/** Shared rendering policy; callers retain a readable fallback for invalid math. */
export function renderFormula(latex: string, inline: boolean): string {
  // Some saved model formulas contain invisible ESC/C0 bytes. Remove them
  // only for rendering; keep whitespace, stored text and TeX safety limits.
  const printable = latex.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '');
  return katex.renderToString(printable, {
    displayMode: !inline, throwOnError: true, trust: false,
    // KaTeX supports these glyphs; only its LaTeX-compatibility warning should
    // be relaxed. Invalid commands, syntax and resource limits remain enforced.
    strict: code => code === 'unicodeTextInMathMode' ? 'ignore' : 'error',
    maxExpand: 100, maxSize: 20, output: 'htmlAndMathml',
  });
}
