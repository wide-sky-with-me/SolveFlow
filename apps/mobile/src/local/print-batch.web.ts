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
export interface BatchPrintFrame { doc: Document; target: Window; content: HTMLElement; dispose: () => void }

/** Share the trusted, bounded local document between printing and file export. */
// Decision: .agents/notes/implemented/storage/2026-10-13-batch-pdf-variants-and-image-layout.md
export async function createBatchPrintFrame(element: Element, title: string, signal: AbortSignal): Promise<BatchPrintFrame> {
  if (signal.aborted) throw new Error('导出已取消。');
  const frame = document.createElement('iframe'); frame.title = '批次 PDF 打印'; frame.style.cssText = 'position:fixed;left:-10000px;top:0;width:800px;height:1100px;border:0';
  document.body.append(frame);
  const dispose = () => { clearTimeout(timer); signal.removeEventListener('abort', dispose); frame.remove(); };
  const timer = setTimeout(dispose, 120000); signal.addEventListener('abort', dispose, { once: true });
  try {
    const doc = frame.contentDocument; const target = frame.contentWindow; if (!doc || !target) throw new Error('无法打开打印窗口。');
    const base = doc.createElement('base'); base.href = document.baseURI; doc.head.append(base);
    doc.title = title.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '-').slice(0, 120);
    const stylesReady: Promise<void>[] = [];
    for (const style of document.querySelectorAll('style,link[rel="stylesheet"]')) {
      const clone = style.cloneNode(true);
      if (clone instanceof HTMLLinkElement) stylesReady.push(new Promise<void>((resolve, reject) => { clone.onload = () => resolve(); clone.onerror = () => reject(new Error('打印样式无法加载。')); }));
      doc.head.append(clone);
    }
    const content = element.cloneNode(true); doc.body.append(content);
    if (!(content instanceof HTMLElement)) throw new Error('打印正文不可用。');
    doc.body.style.margin = '0';
    for (const details of doc.querySelectorAll('details')) details.open = true;
    await new Promise<void>((resolve, reject) => {
      const finish = (error?: Error) => { clearTimeout(timeout); signal.removeEventListener('abort', aborted); if (error) reject(error); else resolve(); };
      const aborted = () => finish(new Error('导出已取消。'));
      const timeout = setTimeout(() => finish(new Error('打印资源加载超时。')), 20000);
      signal.addEventListener('abort', aborted, { once: true });
      void Promise.all(stylesReady).then(() => Promise.all([doc.fonts.ready, ...[...doc.images].map(image => image.decode())])).then(() => finish(), () => finish(new Error('打印资源无法加载。')));
    });
    if (signal.aborted) throw new Error('导出已取消。');
    content.style.width = '178mm'; content.style.maxWidth = '178mm'; content.style.padding = '0';
    fitBatchPrintMath(doc);
    return { doc, target, content, dispose };
  } catch (error) { dispose(); throw error; }
}

/** Print a dedicated local document, preserving selectable text and formula fonts. */
export async function openBatchPrint(element: Element, title: string, signal: AbortSignal): Promise<() => void> {
  const frame = await createBatchPrintFrame(element, title, signal);
  try {
    frame.target.addEventListener('afterprint', frame.dispose, { once: true });
    frame.target.focus(); frame.target.print();
    return frame.dispose;
  } catch (error) { frame.dispose(); throw error; }
}
