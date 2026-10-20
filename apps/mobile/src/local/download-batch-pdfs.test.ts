import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('./download-batch-pdfs.web.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
// Evaluate the private paginator without loading browser rasterization dependencies.
const paginator: unknown = new Function('require', 'exports', 'NodeFilter', `${compiled}\nreturn paginate;`)(() => ({ MAX_BATCH_PRINT_COPIES: 20, MAX_BATCH_PRINT_PAGES: 300, ExportTaskFailure: Error }), {}, { SHOW_TEXT: 4 });
if (typeof paginator !== 'function') throw new Error('Paginator is missing.');

function element(start: number, end: number) {
  return { getBoundingClientRect: () => ({ top: start, bottom: end, height: end - start }) };
}
function fixture(stemEnd: number) {
  const stem = element(950, stemEnd);
  const heading = { ...element(900, 930), nextElementSibling: stem };
  const blocks = [element(0, 880), element(900, Math.max(2200, stemEnd)), stem, element(Math.max(1150, stemEnd), Math.max(1800, stemEnd)), element(1850, 2200)];
  return {
    ownerDocument: { defaultView: { getComputedStyle: () => ({}) }, createTreeWalker: () => ({ nextNode: () => null }) },
    getBoundingClientRect: () => ({ top: 0, bottom: Math.max(2200, stemEnd), height: Math.max(2200, stemEnd) }),
    querySelectorAll: (selector: string) => selector === '[data-pdf-block],figure,.print-cover' ? blocks : selector === '.print-copy-question > h2' ? [heading] : [],
  };
}

describe('batch PDF question pagination', () => {
  it('moves a heading with its short stem when a long question crosses a page', () => {
    expect(paginator(fixture(1120))).toEqual([{ start: 0, end: 900 }, { start: 900, end: 1850 }, { start: 1850, end: 2200 }]);
  });
  it('still paginates when a question stem itself exceeds one page', () => {
    const pageHeight = 264 / (25.4 / 96);
    expect(paginator(fixture(2400))).toEqual([{ start: 0, end: pageHeight }, { start: pageHeight, end: 1850 }, { start: 1850, end: 2400 }]);
  });
  it('exports each dedicated question sheet as exactly one interval', () => {
    const pageHeight = 263 / (25.4 / 96); const pages = [element(20, 20 + pageHeight), element(20 + pageHeight, 20 + 2 * pageHeight)];
    const root = { ...fixture(1120), getBoundingClientRect: () => ({ top: 20, height: 2 * pageHeight }), querySelectorAll: (selector: string) => selector === '[data-pdf-question]' ? pages : [] };
    expect(paginator(root)).toEqual([{ start: 0, end: pageHeight }, { start: pageHeight, end: 2 * pageHeight }]);
  });
  it('accepts exactly 300 dedicated question pages', () => {
    const pageHeight = 263 / (25.4 / 96); const pages = Array.from({ length: 300 }, (_, index) => element(index * pageHeight, (index + 1) * pageHeight));
    const root = { ...fixture(1120), getBoundingClientRect: () => ({ top: 0, height: pages.length * pageHeight }), querySelectorAll: (selector: string) => selector === '[data-pdf-question]' ? pages : [] };
    expect(paginator(root)).toHaveLength(300);
  });
  it('rejects 301 dedicated pages even when their combined height fits the older height gate', () => {
    const pageHeight = 263 / (25.4 / 96); const pages = Array.from({ length: 301 }, (_, index) => element(index * pageHeight, (index + 1) * pageHeight));
    const root = { ...fixture(1120), getBoundingClientRect: () => ({ top: 0, height: pages.length * pageHeight }), querySelectorAll: (selector: string) => selector === '[data-pdf-question]' ? pages : [] };
    expect(() => paginator(root)).toThrow('PDF 页数超过上限');
  });
  it('reports an oversized question sheet rather than clipping or splitting it', () => {
    const root = { ...fixture(1120), querySelectorAll: (selector: string) => selector === '[data-pdf-question]' ? [element(0, 1200)] : [] };
    expect(() => paginator(root)).toThrow('单题页面');
  });
});

function readingFixture(gapStart: number, nextStart: number, withInk = false, adjacent = true, forceAfter = true) {
  const cover = { ...element(0, gapStart), breakAfter: forceAfter ? 'page' : 'auto', matches: () => true };
  const next = { ...element(nextStart, nextStart + 600), breakBefore: 'page', previousElementSibling: adjacent ? cover : { ...element(gapStart, nextStart), matches: () => false }, matches: () => true };
  const ink = withInk ? { ...element(gapStart + 1, nextStart + 1), textContent: 'kept', parentElement: { closest: () => null } } : null;
  let visited = false;
  return {
    ownerDocument: {
      defaultView: { getComputedStyle: (block: { breakBefore?: string; breakAfter?: string }) => block },
      createTreeWalker: () => ({ nextNode: () => { if (visited || !ink) return null; visited = true; return ink; } }),
      createRange: () => ({ selectNodeContents: () => {}, getClientRects: () => ink ? [ink.getBoundingClientRect()] : [] }),
    },
    getBoundingClientRect: () => ({ top: 0, height: nextStart + 600 }),
    querySelectorAll: (selector: string) => selector === '.print-cover,.print-question' ? [cover, next] : [],
  };
}

describe('reading PDF block-margin boundaries', () => {
  it('does not emit a blank sheet between adjacent after/before page breaks', () => {
    expect(paginator(readingFixture(800, 840))).toEqual([{ start: 0, end: 800 }, { start: 840, end: 1440 }]);
  });
  it('does not emit a tiny blank sheet when a natural edge lands inside the next forced-break margin', () => {
    const pageHeight = 264 / (25.4 / 96);
    const root = readingFixture(990, 1005, false, true, false);
    expect(paginator(root)).toEqual([{ start: 0, end: pageHeight }, { start: 1005, end: 1605 }]);
  });
  it('keeps an intervening unknown block instead of assuming its background is blank', () => {
    expect(paginator(readingFixture(800, 840, false, false))).toEqual([{ start: 0, end: 800 }, { start: 800, end: 840 }, { start: 840, end: 1440 }]);
  });
  it('preserves protected ink protruding into an adjacent block margin', () => {
    expect(paginator(readingFixture(800, 840, true))).toEqual([{ start: 0, end: 800 }, { start: 800, end: 840 }, { start: 840, end: 1440 }]);
  });
  it.each(['img', 'svg'])('preserves a %s protruding into a block margin', tag => {
    const root = readingFixture(800, 840); const query = root.querySelectorAll;
    const image = { ...element(801, 841), tagName: tag.toUpperCase() };
    expect(paginator({ ...root, querySelectorAll: (selector: string) => selector === 'img,svg' ? [image] : query(selector) })).toEqual([{ start: 0, end: 800 }, { start: 800, end: 840 }, { start: 840, end: 1440 }]);
  });
  it('does not skip a margin without a following forced page break', () => {
    const root = readingFixture(800, 840); const query = root.querySelectorAll;
    expect(paginator({ ...root, querySelectorAll: (selector: string) => selector === '.print-cover,.print-question' ? query(selector).map(block => ({ ...block, breakBefore: 'auto' })) : query(selector) })).toEqual([{ start: 0, end: 800 }, { start: 800, end: 1440 }]);
  });
  it('keeps fractional page coordinates while skipping only the measured margin', () => {
    expect(paginator(readingFixture(800.25, 840.5))).toEqual([{ start: 0, end: 800.25 }, { start: 840.5, end: 1441 }]);
  });
  it('allows ink ending exactly at the margin start without dropping that ink', () => {
    const root = readingFixture(800, 840); const query = root.querySelectorAll;
    expect(paginator({ ...root, querySelectorAll: (selector: string) => selector === 'img,svg' ? [element(780, 800)] : query(selector) })).toEqual([{ start: 0, end: 800 }, { start: 840, end: 1440 }]);
  });
  it('advances across consecutive measured margins without blank sheets', () => {
    const root = readingFixture(800, 840); const cover = root.querySelectorAll('.print-cover,.print-question')[0];
    const next = { ...element(840, 1440), breakBefore: 'page', breakAfter: 'page', previousElementSibling: cover, matches: () => true };
    const last = { ...element(1480, 2080), breakBefore: 'page', previousElementSibling: next };
    expect(paginator({ ...root, getBoundingClientRect: () => ({ top: 0, height: 2080 }), querySelectorAll: (selector: string) => selector === '.print-cover,.print-question' ? [cover, next, last] : [] })).toEqual([{ start: 0, end: 800 }, { start: 840, end: 1440 }, { start: 1480, end: 2080 }]);
  });
});
