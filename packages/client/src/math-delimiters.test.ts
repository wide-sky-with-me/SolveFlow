import { expect, it } from "vitest";
import { normalizeMathDelimiters } from "./math-delimiters.js";
it("normalizes model math delimiters while preserving inline and fenced code", () => {
  expect(normalizeMathDelimiters(String.raw`行内 \(x^2\) 与 \[y=1\]`)).toBe("行内 $x^2$ 与 \n$$\ny=1\n$$\n");
  expect(normalizeMathDelimiters("$$y=1$$")).toBe("\n$$\ny=1\n$$\n");
  const code = "`\\(literal\\)`\n```tex\n\\[literal\\]\n```";
  expect(normalizeMathDelimiters(code)).toBe(code);
});
