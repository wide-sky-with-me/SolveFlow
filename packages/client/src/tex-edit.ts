export type TexTemplate = 'formula' | 'fraction' | 'root' | 'power' | 'subscript';
/** Insert at the actual selection; preserve existing dollar and TeX delimiters. */
export function insertTex(text: string, selection: { start: number; end: number }, template: TexTemplate) {
  const start = Math.max(0, Math.min(text.length, selection.start));
  const end = Math.max(start, Math.min(text.length, selection.end));
  let delimiter = '';
  for (let i = 0; i < start; i++) {
    if (text[i] === '\\') {
      const next = text[++i];
      if (!delimiter && (next === '(' || next === '[')) delimiter = next;
      else if (delimiter === '(' && next === ')' || delimiter === '[' && next === ']') delimiter = '';
    } else if (text[i] === '$') {
      const token = text[i + 1] === '$' ? '$$' : '$';
      if (token === '$$') i++;
      if (!delimiter) delimiter = token;
      else if (delimiter === token) delimiter = '';
    }
  }
  const selected = text.slice(start, end) || 'x';
  const expression = template === 'fraction' ? `\\frac{${selected}}{2}` : template === 'root' ? `\\sqrt{${selected}}` : template === 'power' ? `${selected}^{2}` : template === 'subscript' ? `${selected}_{1}` : selected;
  const snippet = delimiter ? expression : `$${expression}$`;
  const value = text.slice(0, start) + snippet + text.slice(end);
  if (value.length > 2000) return null;
  const offset = start + (delimiter ? 0 : 1) + (template === 'fraction' ? 6 : template === 'root' ? 6 : 0);
  return { text: value, selection: { start: offset, end: offset + selected.length } };
}
