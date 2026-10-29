interface Interval { start: number; end: number }
interface ReadingBlock {
  element: HTMLElement;
  fragment: DocumentFragment;
  height: number;
  originalHeight: string;
  pages: Interval[];
  measured: boolean;
}
export interface ReadingPdfPage { element: HTMLElement; pages: Interval[]; index: number; measured: boolean }

/** Drop only complete trailing sheets with no text, image or visible decoration. */
export function trimReadingPageMargins(element: HTMLElement, pages: Interval[]): Interval[] {
  if (pages.length < 2) return pages;
  const last = pages.at(-1), view = element.ownerDocument.defaultView; if (!last || !view) return pages;
  const top = element.getBoundingClientRect().top; let bottom = top;
  const retain = (rect: DOMRect) => { if (rect.width > 0 && rect.height > 0) bottom = Math.max(bottom, rect.bottom); };
  for (const image of element.querySelectorAll('img,svg')) retain(image.getBoundingClientRect());
  if (bottom - top > last.start) return pages;
  const doc = element.ownerDocument, walker = doc.createTreeWalker(element, 4); let count = 0;
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (++count > 100000) return pages;
    if (!node.textContent?.trim() || node.parentElement?.closest('.katex-mathml')) continue;
    const range = doc.createRange(); range.selectNodeContents(node);
    for (const rect of range.getClientRects()) retain(rect);
    if (bottom - top > last.start) return pages;
  }
  const painted = (color: string) => !['transparent', 'rgba(0, 0, 0, 0)', 'rgb(255, 255, 255)', 'white'].includes(color);
  const nodes = [element, ...element.querySelectorAll('*')]; if (nodes.length > 100000) return pages;
  for (const node of nodes) {
    const rect = node.getBoundingClientRect(), style = view.getComputedStyle(node);
    if (style.boxShadow !== 'none' || style.textShadow !== 'none') return pages;
    if (style.backgroundImage !== 'none' || painted(style.backgroundColor)) retain(rect);
    for (const side of ['top', 'right', 'bottom', 'left']) {
      const width = parseFloat(style.getPropertyValue(`border-${side}-width`));
      if (width > 0 && style.getPropertyValue(`border-${side}-style`) !== 'none' && painted(style.getPropertyValue(`border-${side}-color`))) bottom = Math.max(bottom, side === 'top' ? rect.top + width : rect.bottom);
    }
    // A generated decoration has no independent DOM bounds; keep the complete layout.
    for (const pseudo of ['::before', '::after']) {
      const style = view.getComputedStyle(node, pseudo);
      if (!['none', 'normal'].includes(style.content) && (!['""', "''"].includes(style.content) || style.backgroundImage !== 'none' || painted(style.backgroundColor) || ['top', 'right', 'bottom', 'left'].some(side => parseFloat(style.getPropertyValue(`border-${side}-width`)) > 0))) return pages;
    }
    if (bottom - top > last.start) return pages;
  }
  let countToKeep = pages.length;
  while (countToKeep > 1 && (pages[countToKeep - 1]?.start ?? -1) >= bottom - top) countToKeep--;
  return pages.slice(0, countToKeep);
}

function containsInk(element: HTMLElement, top: number, bottom: number) {
  const inside = (rect: DOMRect) => rect.height <= 0 || rect.top >= top - 1 && rect.bottom <= bottom + 1;
  for (const image of element.querySelectorAll('img,svg')) if (!inside(image.getBoundingClientRect())) return false;
  const doc = element.ownerDocument, walker = doc.createTreeWalker(element, 4); let count = 0;
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (++count > 100000) return false;
    if (!node.textContent?.trim() || node.parentElement?.closest('.katex-mathml')) continue;
    const range = doc.createRange(); range.selectNodeContents(node);
    if (![...range.getClientRects()].every(inside)) return false;
  }
  return true;
}

/** Freeze only a known reading document; unknown nodes keep the complete renderer. */
// Decision: .agents/notes/implemented/storage/2026-10-21-reading-pdf-render-scope.md
export function createReadingPdfScope(root: HTMLElement, pages: Interval[], paginate: (element: HTMLElement) => Interval[]) {
  if (!root.matches('[data-testid="batch-print-document"]') || root.querySelector('[data-pdf-question]')) return null;
  const view = root.ownerDocument.defaultView; if (!view) return null;
  // Adopted source nodes keep their original realm's prototype inside the print frame.
  const elements = [...root.children].filter((element): element is HTMLElement => element instanceof HTMLElement || element instanceof view.HTMLElement);
  if (!elements.length || elements.length !== root.childNodes.length || !elements.every((element, index) => element.matches(index ? '.print-question' : '.print-cover'))) return null;
  const top = root.getBoundingClientRect().top;
  const blocks: ReadingBlock[] = [];
  const locations: Array<{ block: ReadingBlock; index: number }> = [];
  for (const [position, element] of elements.entries()) {
    const rect = element.getBoundingClientRect();
    if (!Number.isFinite(rect.height) || rect.height <= 0 || !containsInk(element, rect.top, rect.bottom)) return null;
    const local = paginate(element);
    const block: ReadingBlock = { element, fragment: root.ownerDocument.createDocumentFragment(), height: rect.height, originalHeight: element.style.height, pages: local, measured: false };
    for (const [index, page] of local.entries()) {
      const original = pages[locations.length];
      if (!original || Math.abs(page.start + rect.top - top - original.start) > 1) return null;
      const end = page.end + rect.top - top;
      // The complete paginator may include a trailing blank margin before the next record.
      const nextTop = elements[position + 1]?.getBoundingClientRect().top ?? root.getBoundingClientRect().bottom;
      const blankTail = index === local.length - 1 && original.end >= end - 1 && original.end <= nextTop - top + 1;
      if (Math.abs(end - original.end) > 1 && !blankTail) return null;
      locations.push({ block, index });
    }
    blocks.push(block);
  }
  if (locations.length !== pages.length) return null;
  const plan = locations.map(({ block, index }) => block.pages[index]).filter((page): page is Interval => !!page);
  for (const block of blocks) {
    block.element.style.height = `${block.height}px`;
    while (block.element.firstChild) block.fragment.append(block.element.firstChild);
  }
  let active: ReadingBlock | null = null;
  return {
    pages: plan,
    activate(index: number): ReadingPdfPage {
      const location = locations[index]; if (!location) throw new Error('PDF 阅读页不可用。');
      if (active !== location.block) {
        if (active) {
          active.element.style.height = `${active.height}px`;
          while (active.element.firstChild) active.fragment.append(active.element.firstChild);
        }
        active = location.block; active.element.append(active.fragment); active.element.style.height = active.originalHeight;
      }
      return { element: active.element, pages: active.pages, index: location.index, measured: active.measured };
    },
    measure(index: number, measured: Interval[]) {
      const location = locations[index];
      if (!location || location.index !== 0 || location.block.measured || !measured.length) throw new Error('PDF 阅读页测量顺序无效。');
      location.block.pages.splice(0, location.block.pages.length, ...measured); location.block.measured = true;
      locations.length = 0; plan.length = 0;
      for (const block of blocks) for (const [index, page] of block.pages.entries()) { locations.push({ block, index }); plan.push(page); }
    },
    dispose() {
      for (const block of blocks) block.fragment.replaceChildren();
      blocks.length = 0; locations.length = 0; plan.length = 0; active = null;
    },
  };
}
