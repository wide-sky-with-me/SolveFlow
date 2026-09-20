/** Normalize common model LaTeX delimiters, preserving inline/fenced code. */
export function normalizeMathDelimiters(text: string): string {
  return text.split(/(`{3,}[\s\S]*?`{3,}|~{3,}[\s\S]*?~{3,}|`+[^`\n]*`+)/g).map((part, index) => index % 2 ? part
    : part.replace(/\\\[([\s\S]*?)\\\]/g, (_match, latex: string) => `\n$$\n${latex.trim()}\n$$\n`)
      .replace(/\$\$([^\n]+?)\$\$/g, (_match, latex: string) => `\n$$\n${latex.trim()}\n$$\n`)
      .replace(/\\\(([^\n]*?)\\\)/g, (_match, latex: string) => `$${latex}$`)).join("");
}
