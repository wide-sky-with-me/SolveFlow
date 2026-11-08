// Decision: .agents/notes/implemented/rendering/2026-11-05-managed-student-presentation.md
/** Knowledge text sometimes quotes formulas as inline code; other code stays literal. */
function inlineMathCode(part: string): string {
  const match = /^(`{1,2})([^`\n]+)\1$/.exec(part);
  if (!match) return part;
  const body = match[2]!.trim();
  if (!body || body.length > 2000) return part;
  if (/^\$[^$\n]+\$$/.test(body) || /^\\\([^\n]*\\\)$/.test(body)) return normalizeMathDelimiters(body);
  const command = /\\(?:sin|cos|tan|cot|sec|csc|theta|phi|alpha|beta|gamma|delta|pi|frac|dfrac|sqrt|sum|int|lim|log|ln|exp|cdot|times|leq|geq|neq|pm|infty|ce)\b/.test(body);
  // Require formula characters and recognizable commands; code fences stay
  // untouched. KaTeX's existing trust and expansion limits still apply.
  const formula = /^[\s\dA-Za-z\\{}()[\].,=<>+\-*/^_|!≤≥πθαβ%]+$/.test(body)
    && (/[=^_]/.test(body) || /\\(?:frac|dfrac|sqrt|sum|int)\b/.test(body));
  return command && formula ? `$${body}$` : part;
}

/** Normalize model LaTeX delimiters; formula-like code is opt-in, fences stay literal. */
export function normalizeMathDelimiters(text: string, options: { inlineMathCode?: boolean; bareArithmetic?: boolean } = {}): string {
  return text.split(/(`{3,}[\s\S]*?`{3,}|~{3,}[\s\S]*?~{3,}|`+[^`\n]*`+)/g).map((part, index) => index % 2 ? options.inlineMathCode ? inlineMathCode(part) : part
    : normalizePlain(part.replace(/\\\[([\s\S]*?)\\\]/g, (_match, latex: string) => `\n$$\n${latex.trim()}\n$$\n`)
      .replace(/\$\$([^\n]+?)\$\$/g, (_match, latex: string) => `\n$$\n${latex.trim()}\n$$\n`)
      .replace(/\\\(([^\n]*?)\\\)/g, (_match, latex: string) => `$${latex}$`), options.bareArithmetic ?? false)).join("");
}

function normalizeDollars(text: string): string {
  let result = '';
  for (let i = 0; i < text.length;) {
    if (text[i] === '\\') { result += text.slice(i, i + 2); i += 2; continue; }
    if (text[i] !== '$') { result += text[i++]; continue; }
    const delimiter = text[i + 1] === '$' ? '$$' : '$';
    let end = i + delimiter.length;
    while (end < text.length && !text.startsWith(delimiter, end)) end += text[end] === '\\' ? 2 : 1;
    const body = text.slice(i + delimiter.length, end);
    // Only disambiguate an amount followed by prose and another amount/formula. Keep
    // genuine paired math (including bare numbers) intact; ambiguous input
    // continues through the normal Markdown rules.
    const amount = delimiter === '$' && /\d/.test(text[i + 1] ?? '');
    const prose = !/[\\=+*/^_{}<>]/.test(body) && /[\p{Script=Han}，、；。]|\s+[A-Za-z]{2,}\b|,\s*$/u.test(body);
    if (amount && (end >= text.length || (/[\d\\A-Za-z]/.test(text[end + 1] ?? '') && prose))) {
      result += '\\$'; i++; continue;
    }
    if (end >= text.length) { result += text.slice(i); break; }
    // remark-math closes math even at an escaped dollar. This equivalent
    // KaTeX character command has no dollar delimiter to confuse Markdown.
    result += delimiter + body.replace(/\\\$/g, '\\text{\\char36}') + delimiter;
    i = end + delimiter.length;
  }
  return result;
}


function normalizePlain(text: string, bareArithmetic: boolean) {
  const normalized = normalizeDollars(text);
  if (!bareArithmetic) return normalized;
  const arithmetic = (plain: string) => plain.replace(/(?:\d+(?:\.\d+)?|[A-Za-z])(?:[ \t]*(?:[=+*/-]|\\(?:div|times|cdot|pm|approx|leq|geq|neq)\b)[ \t]*(?:-?\d+(?:\.\d+)?|[A-Za-z]))+/g,
    (formula, offset: number) => /\\[a-z]+/.test(formula) && !/[\w\\]/.test(plain[offset - 1] ?? '') ? `$${formula}$` : formula);
  let result = '', start = 0;
  for (let i = 0; i < normalized.length;) {
    if (normalized[i] === '\\') { i += 2; continue; }
    if (normalized[i] !== '$') { i++; continue; }
    const delimiter = normalized[i + 1] === '$' ? '$$' : '$';
    let end = i + delimiter.length;
    while (end < normalized.length && !normalized.startsWith(delimiter, end)) end += normalized[end] === '\\' ? 2 : 1;
    if (end >= normalized.length) break;
    result += arithmetic(normalized.slice(start, i)) + normalized.slice(i, end + delimiter.length);
    start = end + delimiter.length; i = start;
  }
  return result + arithmetic(normalized.slice(start));
}
