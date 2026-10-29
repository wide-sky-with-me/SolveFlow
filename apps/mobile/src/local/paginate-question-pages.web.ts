// Decision: .agents/notes/implemented/storage/2026-10-21-question-continuation-pages.md
import { fitBatchPrintQuestionPage, PrintQuestionOverflowError } from './print-question-pages.web';

interface ProtectedRow { top: number; bottom: number }
const atoms = 'img,svg,.katex';
const blocks = 'p,li,figure,pre,tr,.print-page-diagrams,.print-warning,.print-copy-answer';

/** Pick a DOM boundary above complete text lines, formulas, rows and usable short blocks. */
function continuationBoundary(inner: HTMLElement, available: number): Range {
  const doc = inner.ownerDocument; const top = inner.getBoundingClientRect().top;
  const elements = inner.querySelectorAll('*'); if (elements.length > 100000) throw new Error('单题正文过大，无法安全续页。');
  const protectedRows: ProtectedRow[] = [];
  for (const element of inner.querySelectorAll(`${atoms},${blocks}`)) {
    if (element.closest('.katex-mathml')) continue;
    const rect = element.getBoundingClientRect();
    if (rect.height > 0 && rect.height <= available) protectedRows.push(rect);
    else if (rect.height > available && element.matches(atoms)) throw new Error('公式或图示高于一页，请先调整该内容。');
  }
  for (const heading of inner.querySelectorAll('h1,h2,h3,h4,h5,h6')) {
    const next = heading.nextElementSibling; if (!next) continue;
    const first = heading.getBoundingClientRect(), last = next.getBoundingClientRect();
    if (last.bottom - first.top <= available) protectedRows.push({ top: first.top, bottom: last.bottom });
  }
  for (const table of inner.querySelectorAll('table')) {
    const head = table.querySelector('thead'), firstRow = table.querySelector('tbody tr'); if (!head || !firstRow) continue;
    const first = head.getBoundingClientRect(), last = firstRow.getBoundingClientRect();
    if (last.bottom - first.top <= available) protectedRows.push({ top: first.top, bottom: last.bottom });
  }
  let edge = top + available;
  for (let pass = 0; pass < 64; pass++) {
    let next = edge;
    for (const row of protectedRows) if (row.top > top + 1 && row.top < edge - .5 && row.bottom > edge + .5) next = Math.min(next, row.top);
    if (next === edge) break;
    edge = next;
  }
  if (protectedRows.some(row => row.top > top + 1 && row.top < edge - .5 && row.bottom > edge + .5)) throw new Error('内容块相互重叠，无法安全续页。');
  let best: Range | null = null;
  const consider = (node: Node, offset: number) => {
    const range = doc.createRange(); range.setStart(inner, 0); range.setEnd(node, offset);
    if (!range.collapsed && (!best || range.compareBoundaryPoints(2, best) > 0)) best = range;
  };
  for (const element of elements) {
    if (element.closest('.katex-mathml') || element.parentElement?.closest(atoms)) continue;
    const rect = element.getBoundingClientRect(); const parent = element.parentNode;
    if (parent && rect.height > 0 && rect.bottom <= edge + .1) consider(parent, [...parent.childNodes].indexOf(element) + 1);
  }
  const walker = doc.createTreeWalker(inner, 4); let visited = 0;
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (++visited > 100000) throw new Error('单题正文过大，无法安全续页。');
    const text = node.textContent ?? ''; if (!text.trim() || node.parentElement?.closest(atoms)) continue;
    const range = doc.createRange(); range.selectNodeContents(node);
    const rects = [...range.getClientRects()].filter(rect => rect.height > 0);
    const first = rects[0]; if (!first || first.top >= edge) continue;
    let low = 0, high = text.length;
    while (low < high) {
      const middle = Math.ceil((low + high) / 2); range.setEnd(node, middle);
      const lines = [...range.getClientRects()].filter(rect => rect.height > 0);
      if (lines.length && lines.every(rect => rect.bottom <= edge + .1)) low = middle; else high = middle - 1;
    }
    // A text boundary must not divide a UTF-16 surrogate pair.
    if (low > 0 && low < text.length && /[\uD800-\uDBFF]/.test(text[low - 1] ?? '') && /[\uDC00-\uDFFF]/.test(text[low] ?? '')) low--;
    if (low > 0) consider(node, low);
  }
  if (!best) throw new Error('本题没有安全的续页位置，请检查过大的图示或公式。');
  const checked: Range = best;
  const prefix = checked.cloneContents();
  if (!prefix.textContent?.trim() && !prefix.querySelector('img,svg')) throw new Error('本题没有可放入当前页的完整内容。');
  return checked;
}

/** Expands only the connected question; future frozen questions remain untouched. */
export async function paginateQuestionPage(page: HTMLElement, maxPages: number, assertActive: () => void): Promise<HTMLElement[]> {
  assertActive();
  if (!Number.isSafeInteger(maxPages) || maxPages < 1) throw new Error('PDF 页数超过上限，请拆分批次。');
  try { fitBatchPrintQuestionPage(page); return [page]; }
  catch (error) { if (!(error instanceof PrintQuestionOverflowError)) throw error; }
  // DOM ranges follow source order, while a two-column grid can put a later choice beside
  // an earlier overflowing one. Linearize only overflowing sheets before choosing a boundary.
  // Decision: .agents/notes/implemented/storage/2026-10-22-direct-parsed-pdf.md
  for (const choices of page.querySelectorAll<HTMLElement>('.print-copy-options.has-diagrams')) choices.style.gridTemplateColumns = 'minmax(0,1fr)';
  const doc = page.ownerDocument;
  const header = page.querySelector<HTMLElement>('.print-page-heading'), footer = page.querySelector<HTMLElement>('.print-page-footer');
  if (!header || !footer) throw new Error('单题页眉或页脚不完整。');
  const result = [page]; page.dataset.pdfPart = '1';
  for (let index = 0; index < result.length; index++) {
    assertActive(); const current = result[index]; if (!current) throw new Error('续页不可用。');
    const body = current.querySelector<HTMLElement>('.print-page-body'), inner = current.querySelector<HTMLElement>('.print-page-inner');
    if (!body || !inner) throw new Error('单题正文不完整。');
    inner.style.transform = '';
    for (const image of inner.querySelectorAll<HTMLImageElement>('img')) image.style.maxHeight = '';
    const available = body.clientHeight - 4;
    if (available <= 0 || inner.scrollWidth > body.clientWidth + 1) throw new Error(`第${page.dataset.pdfQuestion}题内容超出页宽，请检查公式或图片。`);
    if (inner.scrollHeight <= available) { fitBatchPrintQuestionPage(current); continue; }
    if (result.length >= maxPages) throw new Error('PDF 页数超过上限，请拆分批次。');
    const boundary = continuationBoundary(inner, available);
    const table = [...inner.querySelectorAll('table')].find(item => item === boundary.endContainer) ?? boundary.endContainer.parentElement?.closest('table'); const tableHead = table?.querySelector('thead');
    const tailRange = doc.createRange(); tailRange.setStart(boundary.endContainer, boundary.endOffset); tailRange.setEnd(inner, inner.childNodes.length);
    const tail = tailRange.extractContents();
    if (!tail.hasChildNodes()) throw new Error('续页正文为空。');
    const nextTable = tail.querySelector('table'); if (tableHead && nextTable && !nextTable.querySelector('thead')) nextTable.prepend(tableHead.cloneNode(true));
    const next = doc.createElement('article');
    for (const attribute of page.attributes) if (attribute.name !== 'id') next.setAttribute(attribute.name, attribute.value);
    next.dataset.pdfPart = String(index + 2);
    const nextHeader = doc.importNode(header, true); const label = nextHeader.querySelector('span');
    if (label) label.textContent = `${label.textContent ?? ''} · 续 ${index + 2}`;
    const nextBody = doc.createElement('div'); nextBody.className = body.className;
    const nextInner = doc.createElement('div'); nextInner.className = inner.className;
    nextInner.append(tail); nextBody.append(nextInner); next.append(nextHeader, nextBody, doc.importNode(footer, true));
    current.after(next); result.push(next); fitBatchPrintQuestionPage(current);
    await new Promise<void>(resolve => setTimeout(resolve, 0)); assertActive();
  }
  return result;
}
