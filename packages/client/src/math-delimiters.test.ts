import { expect, it } from "vitest";
import { normalizeMathDelimiters } from "./math-delimiters.js";
it('can render formula-only inline code in knowledge text without altering ordinary code', () => {
  const text = '同角平方关系（`sin^2\\theta+\\cos^2\\theta=1`），互余角（`\\cos\\theta=\\sin(90^\\circ-\\theta)`）';
  expect(normalizeMathDelimiters(text, { inlineMathCode: true })).toBe('同角平方关系（$sin^2\\theta+\\cos^2\\theta=1$），互余角（$\\cos\\theta=\\sin(90^\\circ-\\theta)$）');
  expect(normalizeMathDelimiters(text)).toBe(text);
  expect(normalizeMathDelimiters('公式 `\\(x^2+1\\)`、`$y=2$`', { inlineMathCode: true })).toBe('公式 $x^2+1$、$y=2$');
  const code = '`const x = "\\sin(y)";`、`C:\\theta`、`$12 each or $20`\n```tex\n\\sin^2\\theta=1\n```\n~~~\n\\cos^2\\theta=1\n~~~';
  expect(normalizeMathDelimiters(code, { inlineMathCode: true })).toBe(code);
});
it("normalizes model math delimiters while preserving inline and fenced code", () => {
  expect(normalizeMathDelimiters(String.raw`行内 \(x^2\) 与 \[y=1\]`)).toBe("行内 $x^2$ 与 \n$$\ny=1\n$$\n");
  expect(normalizeMathDelimiters("$$y=1$$")).toBe("\n$$\ny=1\n$$\n");
  const code = "`\\(literal\\)`\n```tex\n\\[literal\\]\n```";
  expect(normalizeMathDelimiters(code)).toBe(code);
});

it("keeps clearly written currency amounts in prose out of math", () => {
  expect(normalizeMathDelimiters('成人票$12，再买儿童票$7，合计$19。'))
    .toBe('成人票\\$12，再买儿童票\\$7，合计\\$19。');
  expect(normalizeMathDelimiters('Tickets cost $12 each or $20 per pair.'))
    .toBe('Tickets cost \\$12 each or \\$20 per pair.');
  expect(normalizeMathDelimiters('$5$ 与 $10$，$x+1=2$，$5x$'))
    .toBe('$5$ 与 $10$，$x+1=2$，$5x$');
  expect(normalizeMathDelimiters('`$12 each or $20`')).toBe('`$12 each or $20`');
  expect(normalizeMathDelimiters(String.raw`合计$19。另一个例子是 $\$50$；$R_{总}=R_1+R_2$。`))
    .toBe(String.raw`合计\$19。另一个例子是 $\text{\char36}50$；$R_{总}=R_1+R_2$。`);
  expect(normalizeMathDelimiters('$20元$，$2.5 m$，$5 and 6$。')).toBe('$20元$，$2.5 m$，$5 and 6$。');
});

it("keeps currency inside formulas from prematurely closing Markdown math", () => {
  expect(normalizeMathDelimiters(String.raw`票价 \(\$25\)，合计 $\$50$。`))
    .toBe(String.raw`票价 $\text{\char36}25$，合计 $\text{\char36}50$。`);
  expect(normalizeMathDelimiters(String.raw`普通价格 \$25；$x=2$；\[c=\$50\]`))
    .toBe("普通价格 \\$25；$x=2$；\n$$\nc=\\text{\\char36}50\n$$\n");
  expect(normalizeMathDelimiters(String.raw`代码 \`$\$25$\``)).toContain(String.raw`$\$25$`);
});
