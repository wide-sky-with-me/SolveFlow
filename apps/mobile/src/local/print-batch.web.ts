import { ExportTaskFailure } from '@solveflow/client/local';
import { MAX_BATCH_PRINT_PAGES } from '@solveflow/contracts/local';
import { paginateQuestionPage } from './paginate-question-pages.web';

/** Fit long unbroken math locally so Chromium does not shrink the entire booklet. */
export function fitBatchPrintMath(doc: Document) {
  const target = doc.defaultView; if (!target) throw new Error('打印文档不可用。');
  for (const table of doc.querySelectorAll<HTMLTableElement>('.batch-print-document table')) table.style.tableLayout = 'fixed';
  for (const formula of doc.querySelectorAll<HTMLElement>('.batch-print-document .katex')) {
    const container = formula.closest<HTMLElement>('.math-block,.answer-markdown,td,th,.print-written,.print-section'); if (!container) continue;
    const available = container.clientWidth - 8; const width = Math.max(formula.getBoundingClientRect().width, formula.scrollWidth, formula.querySelector<HTMLElement>('.katex-html')?.getBoundingClientRect().width ?? 0);
    if (available > 0 && width > available) formula.style.fontSize = `${parseFloat(target.getComputedStyle(formula).fontSize) * available / width}px`;
  }
}
export interface BatchPrintFrame { doc: Document; target: Window; content: HTMLElement; dispose: () => void; activateQuestionPage?: (index: number) => Promise<void> }

/** Share the trusted, bounded local document between printing and file export. */
// Decision: .agents/notes/implemented/storage/2026-10-13-batch-pdf-variants-and-image-layout.md
// Decision: .agents/notes/implemented/storage/2026-10-18-pdf-resource-handoff.md
// Decision: .agents/notes/implemented/storage/2026-10-19-pdf-fragment-source-ownership.md
export async function createBatchPrintFrame(element: Element, title: string, signal: AbortSignal, options?: { questionPages?: boolean; lifetimeMs?: number }): Promise<BatchPrintFrame> {
  if (signal.aborted) throw new Error('导出已取消。');
  const lifetimeMs = options?.lifetimeMs ?? 120000;
  if (!Number.isSafeInteger(lifetimeMs) || lifetimeMs < 120000 || lifetimeMs > 330000) throw new Error('打印文档时限无效。');
  const frame = document.createElement('iframe'); frame.title = '批次 PDF 打印'; frame.style.cssText = 'position:fixed;left:-10000px;top:0;width:800px;height:1100px;border:0';
  document.body.append(frame);
  let disposed = false;
  let cancelResources: (() => void) | undefined;
  let releaseContents = () => {};
  const dispose = () => {
    if (disposed) return;
    disposed = true; clearTimeout(timer); signal.removeEventListener('abort', dispose);
    cancelResources?.(); releaseContents(); frame.remove();
  };
  const timer = setTimeout(dispose, lifetimeMs); signal.addEventListener('abort', dispose, { once: true });
  const assertActive = () => { if (signal.aborted) throw new Error('导出已取消。'); if (disposed) throw new Error('打印文档已关闭。'); };
  try {
    assertActive();
    const doc = frame.contentDocument; const target = frame.contentWindow; if (!doc || !target) throw new Error('无法打开打印窗口。');
    // Parse only the fixed document declaration. All question content remains cloned DOM.
    // Without it, about:blank can measure tables in quirks mode while capture uses standards mode.
    // Decision: .agents/notes/implemented/storage/2026-10-22-print-document-mode.md
    doc.open(); doc.write('<!doctype html>'); doc.close();
    const base = doc.createElement('base'); base.href = document.baseURI; doc.head.append(base);
    doc.title = title.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '-').slice(0, 120);
    const stylesReady: Promise<void>[] = [];
    for (const style of document.querySelectorAll('style,link[rel="stylesheet"]')) {
      const clone = style.cloneNode(true);
      if (clone instanceof HTMLLinkElement) stylesReady.push(new Promise<void>((resolve, reject) => { clone.onload = () => resolve(); clone.onerror = () => reject(new Error('打印样式无法加载。')); }));
      doc.head.append(clone);
    }
    const content = element.cloneNode(true);
    if (!(content instanceof HTMLElement)) throw new Error('打印正文不可用。');
    for (const details of content.querySelectorAll('details')) details.open = true;
    const candidates = [...content.querySelectorAll<HTMLElement>('[data-pdf-question]')];
    const pages = options?.questionPages && content.matches('.print-copy-document') && candidates.length > 0 && candidates.length === content.childNodes.length && candidates.every(page => page.parentElement === content && page.matches('.print-copy-question.print-question-page')) ? candidates : [];
    // Freeze in the source document; adopt active content into the frame without moving sheet coordinates.
    const questionContents = pages.map(page => {
      const fragment = content.ownerDocument.createDocumentFragment();
      while (page.firstChild) fragment.append(page.firstChild);
      return fragment;
    });
    if (questionContents[0]) pages[0]?.append(questionContents[0]);
    releaseContents = () => { questionContents.length = 0; for (const page of pages) page.replaceChildren(); };
    doc.body.append(content); doc.body.style.margin = '0';
    const waitForResources = async (styles: Promise<void>[] = []) => {
      assertActive();
      const expiresAt = Date.now() + 20000;
      await new Promise<void>((resolve, reject) => {
        let settled = false;
        const finish = (error?: Error) => {
          if (settled) return;
          settled = true; clearTimeout(timeout); signal.removeEventListener('abort', aborted); cancelResources = undefined;
          if (signal.aborted) reject(new Error('导出已取消。')); else if (Date.now() >= expiresAt) reject(new ExportTaskFailure('打印资源加载超时。')); else if (error) reject(error); else resolve();
        };
        const aborted = () => finish(new Error('导出已取消。'));
        const timeout = setTimeout(() => finish(new ExportTaskFailure('打印资源加载超时。')), 20000);
        cancelResources = () => finish(new Error('打印文档已关闭。'));
        signal.addEventListener('abort', aborted, { once: true });
        // FontFaceSet.ready also fulfills after failed loads; reject fallback rendering.
        void Promise.all(styles)
          .then(() => { assertActive(); return Promise.all([doc.fonts.ready, ...[...doc.images].map(image => image.decode())]); })
          .then(
            () => finish([...doc.fonts].some(face => face.status === 'error') ? new ExportTaskFailure('打印资源无法加载。') : undefined),
            () => finish(new ExportTaskFailure('打印资源无法加载。')),
          );
      });
      assertActive();
    };
    await waitForResources(stylesReady);
    assertActive();
    content.style.width = '178mm'; content.style.maxWidth = '178mm'; content.style.padding = '0';
    fitBatchPrintMath(doc);
    // Decision: .agents/notes/implemented/storage/2026-10-21-question-continuation-pages.md
    const preparePage = async (page: HTMLElement, index?: number) => {
      assertActive();
      const count = content.querySelectorAll('[data-pdf-question]').length;
      if (count > MAX_BATCH_PRINT_PAGES) throw new ExportTaskFailure(`PDF 页数超过上限（每份 ${MAX_BATCH_PRINT_PAGES} 页），请拆分批次。`);
      const sheets = await paginateQuestionPage(page, MAX_BATCH_PRINT_PAGES - count + 1, assertActive);
      assertActive();
      if (index !== undefined && sheets.length > 1) {
        const added = sheets.slice(1); const frozen = added.map(sheet => {
          const fragment = doc.createDocumentFragment(); while (sheet.firstChild) fragment.append(sheet.firstChild); return fragment;
        });
        pages.splice(index + 1, 0, ...added); questionContents.splice(index + 1, 0, ...frozen);
      }
    };
    if (pages[0]) await preparePage(pages[0], 0);
    else for (const page of content.querySelectorAll<HTMLElement>('[data-pdf-question]')) await preparePage(page);
    let activeIndex = 0; let activating = false;
    const activateQuestionPage = async (index: number) => {
      assertActive();
      if (activating || !Number.isSafeInteger(index) || index < activeIndex || index > activeIndex + 1 || index >= pages.length) throw new Error('PDF 单题页面顺序无效。');
      if (index === activeIndex) return;
      const next = pages[index]; const fragment = questionContents[index];
      if (!next || !fragment) throw new Error('PDF 单题页面内容缺失。');
      activating = true;
      try {
        pages[activeIndex]?.replaceChildren(); next.append(fragment); activeIndex = index;
        await waitForResources();
        assertActive();
        fitBatchPrintMath(doc);
        await preparePage(next, index);
      } catch (error) { dispose(); throw error; }
      finally { activating = false; }
    };
    return { doc, target, content, dispose, ...(pages.length ? { activateQuestionPage } : {}) };
  } catch (error) { dispose(); throw error; }
}

/** Print a dedicated local document, preserving selectable text and formula fonts. */
export async function openBatchPrint(element: Element, title: string, signal: AbortSignal): Promise<() => void> {
  const frame = await createBatchPrintFrame(element, title, signal);
  try {
    if (signal.aborted) throw new Error('导出已取消。');
    frame.target.addEventListener('afterprint', frame.dispose, { once: true });
    frame.target.focus();
    if (signal.aborted) throw new Error('导出已取消。');
    // Chrome derives iframe PDF filenames from the host document title.
    const previousTitle = document.title; const printTitle = frame.doc.title;
    document.title = printTitle;
    try { frame.target.print(); }
    finally { if (document.title === printTitle) document.title = previousTitle; }
    return frame.dispose;
  } catch (error) { frame.dispose(); throw error; }
}
