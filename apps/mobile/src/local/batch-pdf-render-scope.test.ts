import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('./download-batch-pdfs.web.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
interface TestElement {
  clientWidth: number; scrollWidth: number; parentElement: TestElement | null; contents: TestElement[]; fitted: boolean;
  getBoundingClientRect: () => { top: number; bottom: number; height: number };
  querySelectorAll: (selector: string) => TestElement[];
  querySelector: (selector: string) => TestElement | null;
  closest: (selector: string) => TestElement | null; matches: (selector: string) => boolean;
  ownerDocument: object;
}
interface CanvasOptions {
  x: number; y: number; width: number; height: number;
  ignoreElements?: (element: TestElement) => boolean;
  renderLifecycle: { assertActive: () => void; yieldControl?: () => Promise<void> };
  onclone: (doc: object, root: TestElement) => void;
}
function fixture(questions = true, drift = false, nested = false, progressive = false, activationError = false, readingHeight = 500, questionCount = 3) {
  const height = 263 / (25.4 / 96);
  let offset = 0; let disposed = 0;
  const clock = { now: 0 }; class ClockDate extends Date { static override now() { return clock.now; } }
  const signal = new AbortController(); const hooks: { activation?: (index: number) => Promise<void>; written?: (page: number) => void } = {};
  function tree() {
    const doc = { querySelectorAll: () => [], defaultView: { getComputedStyle: () => ({}) }, createTreeWalker: () => ({ nextNode: () => null }) };
    const node = (top: number, bottom: number): TestElement => ({ clientWidth: 674, scrollWidth: 674, parentElement: null, contents: [], fitted: false, ownerDocument: doc, getBoundingClientRect: () => ({ top: top + offset, bottom: bottom + offset, height: bottom - top }), querySelectorAll: () => [], querySelector: () => null, closest: () => null, matches: () => false });
    const root = node(0, questions ? questionCount * height : readingHeight);
    const pages = questions ? Array.from({ length: questionCount }, (_, index) => node(index * height, (index + 1) * height)) : [];
    root.matches = selector => questions && selector === '.print-copy-document';
    root.querySelectorAll = selector => selector === '[data-pdf-question]' ? pages : [];
    root.querySelector = selector => selector === '[data-pdf-question]' ? pages[0] ?? null : null;
    root.getBoundingClientRect = () => ({ top: 0, bottom: questions ? questionCount * height : readingHeight, height: questions ? questionCount * height : readingHeight });
    const children = pages.map((page, index) => {
      const wrapper = node(index * height, (index + 1) * height); wrapper.parentElement = root;
      wrapper.querySelectorAll = selector => selector === '[data-pdf-question]' ? [page] : [];
      page.parentElement = nested ? wrapper : root; page.closest = () => page;
      page.matches = selector => selector === '.print-copy-question.print-question-page';
      const child = node(0, 1); child.closest = () => page; page.contents = [child]; return child;
    });
    return { doc, root, pages, children };
  }
  const original = tree(); const activated: number[] = []; const requested: unknown[] = [];
  if (progressive) original.pages.forEach((page, index) => { if (index) page.contents = []; });
  const calls: { target: TestElement; clone: ReturnType<typeof tree>; options: CanvasOptions }[] = [];
  const fittedPages: TestElement[] = []; const fittedDocuments: object[] = []; const progress: number[] = []; const progressDetails: Array<{ page: number; pages: number; pagesFinal?: boolean }> = []; const aliases: unknown[] = [];
  const footers: Array<{ rendered: number; page: number; text: string }> = [];
  const dependencies: Record<string, object> = {
    '@solveflow/contracts/local': { MAX_EXPORT_PDF_BYTES: 10000, MAX_EXPORT_ARTIFACT_BYTES: 10000, MAX_BATCH_PRINT_COPIES: 20, MAX_BATCH_PRINT_PAGES: 300 },
    '@solveflow/client/local': { ExportTaskFailure: Error },
    './print-batch.web.ts': { createBatchPrintFrame: async (_element: unknown, _name: unknown, _signal: unknown, options: unknown) => {
      requested.push(options);
      return { content: original.root, doc: original.doc, dispose: () => { disposed++; }, ...(progressive ? { activateQuestionPage: async (index: number) => {
        activated.push(index); if (activationError) throw new Error('PAGE_ACTIVATION_FAILED');
        original.pages.forEach((page, position) => { const child = original.children[position]; page.contents = position === index && child ? [child] : []; });
        await hooks.activation?.(index);
      } } : {}) };
    }, fitBatchPrintMath: () => {} },
    './print-question-pages.web': { fitBatchPrintQuestionPage: (page: TestElement) => { page.fitted = true; fittedPages.push(page); }, fitBatchPrintQuestionPages: (doc: object) => { fittedDocuments.push(doc); } },
    './pdf-render-lifecycle.web': { createPdfRenderLifecycle: (_doc: object, check: () => void) => ({ assertActive: check, bindClone: check, completeRendering: check, onDispose: () => () => {}, dispose: () => {} }), yieldPdfRender: async (lifecycle: { assertActive: () => void }) => { lifecycle.assertActive(); } },
    './reading-pdf-scope.web': { createReadingPdfScope: () => null },
    html2canvas: { __esModule: true, default: Object.assign(async (target: TestElement, options: CanvasOptions) => {
      const clone = tree();
      for (const [index, page] of clone.pages.entries()) {
        const child = original.children[index]; page.contents = child && options.ignoreElements?.(child) ? [] : page.contents;
      }
      calls.push({ target, clone, options }); if (drift && calls.length === 2) offset = 2;
      const reference = target === original.root ? clone.root : clone.pages[original.pages.indexOf(target)];
      if (!reference) throw new Error('CLONE_REFERENCE_MISSING');
      options.onclone(clone.doc, reference);
      return { width: 1348, height: 1988, toBlob: (callback: BlobCallback) => queueMicrotask(() => callback(new Blob([new Uint8Array(3)], { type: 'image/jpeg' }))) };
    }, { renderLifecycleVersion: 2 }) },
    jspdf: { jsPDF: class { pages = 1; page = 1; addPage() { this.pages++; } getNumberOfPages() { return this.pages; } setPage(page: number) { this.page = page; } addImage(_data: unknown, _format: unknown, _x: unknown, _y: unknown, _width: unknown, _height: unknown, alias: unknown) { aliases.push(alias); hooks.written?.(aliases.length); } setFontSize() {} setTextColor() {} text(text: string) { footers.push({ rendered: aliases.length, page: this.page, text }); } output() { return new ArrayBuffer(4); } } },
    fflate: {},
  };
  const build: unknown = new Function('require', 'exports', 'NodeFilter', 'Date', `${compiled}\nreturn exports.buildBatchPdfs;`)((name: string) => dependencies[name] ?? {}, {}, { SHOW_TEXT: 4 }, ClockDate);
  if (typeof build !== 'function') throw new Error('BUILD_MISSING');
  return { ...original, calls, aliases, footers, activated, requested, fittedPages, fittedDocuments, progress, progressDetails, clock, signal, hooks, disposed: () => disposed, build: () => build([{ element: original.root, name: 'copy.pdf' }], 'batch.zip', signal.signal, (value: { page: number; pages: number; pagesFinal?: boolean }) => { progress.push(value.page); progressDetails.push(value); }) };
}

describe('PDF rasterization scope', () => {
  it('finishes a steadily advancing long copy even when its total work exceeds one minute', async () => {
    const f = fixture(true, false, false, true, false, 500, 9);
    f.hooks.written = page => { f.clock.now = page * 8000; };
    await f.build();
    expect(f.aliases).toHaveLength(9); expect(f.clock.now).toBe(72000); expect(f.disposed()).toBe(1);
  });
  it('keeps one absolute deadline for a long copy rather than extending it after each completed page', async () => {
    const f = fixture(true, false, false, true, false, 500, 9);
    f.hooks.written = page => { f.clock.now = page * 10000; };
    await expect(f.build()).rejects.toThrow('第 1 / 1 份，第 9 / 9 页：单份 PDF 处理超时');
    expect(f.aliases).toHaveLength(9); expect(f.disposed()).toBe(2);
  });
  it('caps the complete copy at five minutes even when more pages keep advancing', async () => {
    const f = fixture(true, false, false, true, false, 500, 50);
    f.hooks.written = page => { f.clock.now = page * 7000; };
    await expect(f.build()).rejects.toThrow('单份 PDF 处理超时');
    expect(f.aliases).toHaveLength(43); expect(f.clock.now).toBe(301000); expect(f.disposed()).toBe(2);
  });
  it('activates later frame pages without resetting logical progress, aliases or later-page yielding', async () => {
    const f = fixture(true, false, false, true); await f.build();
    expect(f.requested).toEqual([{ questionPages: true, lifetimeMs: 330000 }]); expect(f.activated).toEqual([1, 2]); expect(f.progress).toEqual([1, 2, 3]);
    expect(f.calls.map(call => call.target)).toEqual(f.pages); expect(f.aliases).toEqual(['page-1', 'page-2', 'page-3']);
    expect(f.calls[0]?.options.renderLifecycle.yieldControl).toBeUndefined(); expect(f.calls.slice(1).every(call => typeof call.options.renderLifecycle.yieldControl === 'function')).toBe(true);
    expect(f.disposed()).toBe(1);
  });
  it('marks provisional totals while unprepared questions can still add continuation sheets', async () => {
    const f = fixture(true, false, false, true); await f.build();
    expect(f.progressDetails.map(value => value.pagesFinal)).toEqual([false, false, true]);
    const stable = fixture(); await stable.build();
    expect(stable.progressDetails.every(value => value.pagesFinal === true)).toBe(true);
  });
  it('fails the complete artifact when a later frame page fails activation', async () => {
    const f = fixture(true, false, false, true, true); await expect(f.build()).rejects.toThrow('PAGE_ACTIVATION_FAILED');
    expect(f.calls).toHaveLength(1); expect(f.activated).toEqual([1]); expect(f.progress).toEqual([1]); expect(f.disposed()).toBe(2);
  });
  it('fits only the current clone, retaining sibling sheet shells but excluding their contents', async () => {
    const f = fixture(); await f.build();
    expect(f.calls.map(call => call.target)).toEqual(f.pages);
    expect(f.fittedPages).toEqual(f.calls.map((call, index) => call.clone.pages[index])); expect(f.fittedDocuments).toEqual([]);
    expect(f.pages.every(page => !page.fitted && page.contents.length === 1)).toBe(true);
    expect(f.progress).toEqual([1, 2, 3]); expect(f.disposed()).toBe(1);
    expect(f.aliases).toEqual(['page-1', 'page-2', 'page-3']);
    expect(f.calls[0]?.options.renderLifecycle.yieldControl).toBeUndefined();
    expect(f.calls.slice(1).every(call => typeof call.options.renderLifecycle.yieldControl === 'function')).toBe(true);
    expect(new Set(f.calls.map(call => call.options.renderLifecycle.assertActive)).size).toBe(3);
    for (const [index, call] of f.calls.entries()) {
      expect(call.clone.doc).not.toBe(f.doc); expect(call.clone.pages).toHaveLength(3);
      expect(f.fittedPages[index]).toBe(call.clone.pages[index]); expect(f.fittedPages[index]).not.toBe(f.pages[index]);
      expect(call.options.x).toBe(0); expect(call.options.y).toBe(0);
      expect(call.options.width).toBe(674); expect(call.options.height).toBeCloseTo(263 / (25.4 / 96));
      expect(call.options.ignoreElements).toBeTypeOf('function'); expect(call.options.ignoreElements?.(f.root)).toBe(false);
      for (const [pageIndex, page] of f.pages.entries()) {
        expect(call.options.ignoreElements?.(page)).toBe(false);
        const child = f.children[pageIndex]; if (!child) throw new Error('CHILD_MISSING');
        expect(call.options.ignoreElements?.(child)).toBe(pageIndex !== index);
        expect(call.clone.pages[pageIndex]?.contents).toHaveLength(pageIndex === index ? 1 : 0);
      }
    }
  });
  it('keeps original-record continuation pages on the full-document renderer', async () => {
    const f = fixture(false); await f.build();
    expect(f.calls).toHaveLength(1); expect(f.calls[0]?.target).toBe(f.root);
    expect(f.calls[0]?.options.ignoreElements).toBeUndefined(); expect(f.fittedDocuments).toHaveLength(1); expect(f.fittedPages).toEqual([]);
  });
  it('writes reading footers only after the final physical page count is known', async () => {
    const f = fixture(false, false, false, false, false, 2400); await f.build();
    expect(f.calls).toHaveLength(3);
    expect(f.footers).toEqual([{ rendered: 3, page: 1, text: '1 / 3' }, { rendered: 3, page: 2, text: '2 / 3' }, { rendered: 3, page: 3, text: '3 / 3' }]);
  });
  it('preserves every nested question sheet through the original whole-document path', async () => {
    const f = fixture(true, false, true); await f.build();
    expect(f.calls).toHaveLength(3); expect(f.calls.every(call => call.target === f.root && !call.options.ignoreElements)).toBe(true);
    expect(f.progress).toEqual([1, 2, 3]); expect(f.fittedDocuments).toHaveLength(3);
  });
  it('does not apply sparse cloning to an unrelated document that happens to carry question attributes', async () => {
    const f = fixture(); f.root.matches = () => false; await f.build();
    expect(f.calls).toHaveLength(3); expect(f.calls.every(call => call.target === f.root && !call.options.ignoreElements)).toBe(true);
  });
  it('still rejects clone page-position drift rather than exporting a different layout', async () => {
    const f = fixture(true, true); await expect(f.build()).rejects.toThrow('PDF 排版在绘制时发生变化'); expect(f.disposed()).toBe(2);
  });
  describe('activation copy deadline', () => {
    function deferred() { let resolve = () => {}; let reject = (_error: Error) => {}; const promise = new Promise<void>((done, fail) => { resolve = done; reject = fail; }); return { promise, resolve, reject }; }
    function pendingActivation() {
      const f = fixture(true, false, false, true); const gate = deferred(); const entered = deferred();
      f.hooks.written = page => { if (page === 1) f.clock.now = 45000; };
      f.hooks.activation = async index => { if (index === 1) { entered.resolve(); await gate.promise; } };
      return { f, gate, entered };
    }
    it.each([['resolve', 60000], ['resolve', 60001], ['reject', 60000], ['reject', 60001]] as const)('rejects late activation %s at %ims without resetting the copy budget', async (outcome, elapsed) => {
      const { f, gate, entered } = pendingActivation(); const pending = f.build(); const failure = expect(pending).rejects.toThrow('单份 PDF 处理超时');
      await entered.promise; f.clock.now = elapsed;
      if (outcome === 'resolve') gate.resolve(); else gate.reject(new Error('LATE_ACTIVATION_FAILURE'));
      await failure; expect(f.calls).toHaveLength(1); expect(f.progress).toEqual([1]); expect(f.activated).toEqual([1]); expect(f.disposed()).toBe(2);
    });
    it('accepts activation immediately before the shared copy deadline', async () => {
      const { f, gate, entered } = pendingActivation(); const pending = f.build(); await entered.promise; f.clock.now = 59999; gate.resolve(); await pending;
      expect(f.calls).toHaveLength(3); expect(f.progress).toEqual([1, 2, 3]); expect(f.disposed()).toBe(1);
    });
    it.each(['resolve', 'reject'])('prioritizes cancellation over expired activation and consumes late %s', async outcome => {
      const { f, gate, entered } = pendingActivation(); const pending = f.build(); const failure = expect(pending).rejects.toThrow('导出已取消');
      await entered.promise; f.clock.now = 60001; f.signal.abort(); await failure;
      if (outcome === 'resolve') gate.resolve(); else gate.reject(new Error('LATE_ACTIVATION_FAILURE'));
      await Promise.resolve(); await Promise.resolve(); expect(f.calls).toHaveLength(1); expect(f.progress).toEqual([1]); expect(f.disposed()).toBe(2);
    });
  });
  it.each(['resolve', 'reject'])('consumes activation %s when cancellation happens synchronously before bounded registers', async outcome => {
    const f = fixture(true, false, false, true);
    f.hooks.activation = () => { f.signal.abort(); return outcome === 'resolve' ? Promise.resolve() : Promise.reject(new Error('SYNC_ACTIVATION_FAILURE')); };
    await expect(f.build()).rejects.toThrow('导出已取消'); await Promise.resolve(); await Promise.resolve();
    expect(f.calls).toHaveLength(1); expect(f.progress).toEqual([1]); expect(f.disposed()).toBe(1);
  });
});
