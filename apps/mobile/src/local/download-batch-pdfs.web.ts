// Decision: .agents/notes/implemented/storage/2026-10-13-batch-pdf-variants-and-image-layout.md
import { MAX_BATCH_PRINT_BYTES } from '@solveflow/contracts/local';
import { createBatchPrintFrame, fitBatchPrintMath } from './print-batch.web.ts';
import type html2canvas from 'html2canvas';

export interface BatchPdfDownload { element: Element | (() => Element); name: string }
export interface BatchPdfDownloadProgress { copy: number; copies: number; page: number; pages: number }
interface Interval { start: number; end: number }
const MAX_COPIES = 20;
const MAX_PAGES = 300;
const RESOURCE_TIMEOUT = 30000;
const MM_PER_PIXEL = 25.4 / 96;
const PAGE_HEIGHT = 264 / MM_PER_PIXEL;

function checkCancelled(signal: AbortSignal) {
  if (signal.aborted) throw new Error('导出已取消。');
}

function bounded<T>(work: Promise<T>, signal: AbortSignal, cleanup: () => void): Promise<T> {
  checkCancelled(signal);
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      signal.removeEventListener('abort', aborted);
      return true;
    };
    const fail = (error: Error) => { if (finish()) { cleanup(); reject(error); } };
    const aborted = () => fail(new Error('导出已取消。'));
    const timeout = setTimeout(() => fail(new Error('PDF 资源处理超时。')), RESOURCE_TIMEOUT);
    signal.addEventListener('abort', aborted, { once: true });
    void work.then(value => { if (finish()) resolve(value); }, error => fail(error instanceof Error ? error : new Error('PDF 处理失败。')));
  });
}

function safeFilename(name: string, extension: 'pdf' | 'zip'): string {
  const stem = name.replace(/\.(pdf|zip)$/i, '').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '-').replace(/[.\s]+$/g, '').trim().slice(0, 180);
  return `${stem || 'batch'}.${extension}`;
}

/** Bound canvases to individual A4 pages, preserving whole short blocks and text lines. */
function paginate(root: HTMLElement): Interval[] {
  const doc = root.ownerDocument;
  const top = root.getBoundingClientRect().top;
  const height = Math.ceil(root.getBoundingClientRect().height);
  if (height <= 0 || height > PAGE_HEIGHT * MAX_PAGES) throw new Error('PDF 正文尺寸超出导出范围。');
  const blocks: Interval[] = [];
  const protectedRows: Interval[] = [];
  const forcedBreaks: number[] = [];
  const interval = (rect: DOMRect): Interval => ({ start: Math.max(0, rect.top - top), end: Math.min(height, rect.bottom - top) });
  for (const block of root.querySelectorAll<HTMLElement>('[data-pdf-block],figure,.print-cover')) {
    const value = interval(block.getBoundingClientRect());
    if (value.end > value.start && value.end - value.start < PAGE_HEIGHT) blocks.push(value);
  }
  for (const block of root.querySelectorAll<HTMLElement>('.print-cover,.print-question')) {
    const computed = doc.defaultView?.getComputedStyle(block);
    const value = interval(block.getBoundingClientRect());
    if (computed?.breakBefore === 'page' && value.start > 0) forcedBreaks.push(value.start);
    if (computed?.breakAfter === 'page' && value.end < height) forcedBreaks.push(value.end);
  }
  for (const image of root.querySelectorAll('img,svg')) {
    const value = interval(image.getBoundingClientRect());
    if (value.end - value.start <= PAGE_HEIGHT) protectedRows.push(value);
    else throw new Error('题图高于一整页，请先缩小图片。');
  }
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let nodes = 0;
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (++nodes > 100000) throw new Error('PDF 正文过大。');
    if (!node.textContent?.trim() || node.parentElement?.closest('.katex-mathml')) continue;
    const range = doc.createRange();
    range.selectNodeContents(node);
    for (const rect of range.getClientRects()) {
      const value = interval(rect);
      if (rect.height > 0 && value.end - value.start < PAGE_HEIGHT) protectedRows.push(value);
    }
  }
  const pages: Interval[] = [];
  let start = 0;
  while (start < height - 0.5) {
    let end = Math.min(height, start + PAGE_HEIGHT);
    const forced = forcedBreaks.filter(value => value > start + 1 && value <= end).sort((a, b) => a - b)[0];
    if (forced !== undefined) end = forced;
    const crossing = blocks.filter(value => value.start > start + 1 && value.start < end && value.end > end + 0.5);
    if (crossing.length) end = Math.min(...crossing.map(value => value.start));
    // Moving the edge above one row can reveal another overlapping row (fractions/SVGs).
    for (let pass = 0; pass < 32; pass++) {
      const rows = protectedRows.filter(value => value.start < end - 0.5 && value.end > end + 0.5 && value.start > start + 1);
      if (!rows.length) break;
      end = Math.min(...rows.map(value => value.start));
    }
    if (end <= start + 1) throw new Error('无法安全分页，请调整过大的内容块。');
    pages.push({ start, end });
    if (pages.length > MAX_PAGES) throw new Error('PDF 页数超过上限。');
    start = end;
  }
  return pages;
}

function requireLocalImages(root: Document | Element) {
  for (const image of root.querySelectorAll<HTMLImageElement>('img')) {
    if (!/^data:image\/(jpeg|png|webp);base64,/i.test(image.src)) throw new Error('PDF 只支持本地题图。');
  }
}

function download(bytes: Uint8Array<ArrayBuffer>, name: string, type: string, signal: AbortSignal) {
  checkCancelled(signal);
  const url = URL.createObjectURL(new Blob([bytes], { type }));
  const link = document.createElement('a');
  link.href = url; link.download = name; document.body.append(link);
  const release = () => { URL.revokeObjectURL(url); signal.removeEventListener('abort', release); };
  signal.addEventListener('abort', release, { once: true });
  try { link.click(); } finally { link.remove(); setTimeout(release, 30000); }
}

/** Generate all files locally before triggering one atomic download. No source writes or uploads. */
export async function exportBatchPdfs(
  items: ReadonlyArray<BatchPdfDownload>, archiveName: string, signal: AbortSignal,
  onProgress?: (progress: BatchPdfDownloadProgress) => void,
): Promise<void> {
  checkCancelled(signal);
  if (items.length < 1 || items.length > MAX_COPIES) throw new Error('每次导出需要 1 至 20 份。');
  const [canvasModule, pdfModule, zipModule] = await bounded(Promise.all([import('html2canvas'), import('jspdf'), import('fflate')]), signal, () => undefined);
  const files: Record<string, Uint8Array<ArrayBuffer>> = Object.create(null);
  let totalBytes = 0;
  for (const [index, item] of items.entries()) {
    checkCancelled(signal);
    const element = typeof item.element === 'function' ? item.element() : item.element;
    requireLocalImages(element);
    const frame = await createBatchPrintFrame(element, item.name, signal);
    const copyDeadline = Date.now() + 60000;
    try {
      requireLocalImages(frame.doc);
      if (frame.content.scrollWidth > frame.content.clientWidth + 1) throw new Error('PDF 正文超出页宽，请调整公式或图片。');
      let pages = paginate(frame.content);
      const pdf = new pdfModule.jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4', compress: true });
      let imageBytes = 0;
      for (let pageIndex = 0; pageIndex < pages.length; pageIndex++) {
        checkCancelled(signal);
        if (Date.now() > copyDeadline) throw new Error('单份 PDF 处理超时，请减少内容后重试。');
        let page = pages[pageIndex];
        if (!page) throw new Error('PDF 分页不可用。');
        const options: NonNullable<Parameters<typeof html2canvas>[1]> = {
          backgroundColor: '#ffffff', scale: 2, x: 0, y: page.start,
          width: frame.content.clientWidth, height: page.end - page.start,
          windowWidth: 800, windowHeight: 1100, scrollX: 0, scrollY: 0,
          logging: false, allowTaint: false, useCORS: false, imageTimeout: 15000,
          removeContainer: true,
          onclone: (doc, clonedRoot) => {
            checkCancelled(signal);
            fitBatchPrintMath(doc);
            if (clonedRoot.scrollWidth > clonedRoot.clientWidth + 1) throw new Error('PDF 绘制内容超出页宽。');
            // The canvas library rebuilds font layout. Its actual clone must define the cuts.
            const measured = paginate(clonedRoot);
            if (pageIndex === 0) pages = measured;
            else if (measured.length !== pages.length || measured.some((value, i) => Math.abs(value.start - (pages[i]?.start ?? -1)) > 1 || Math.abs(value.end - (pages[i]?.end ?? -1)) > 1)) throw new Error('PDF 排版在绘制时发生变化，请重试。');
            page = pages[pageIndex];
            if (!page) throw new Error('PDF 分页不可用。');
            options.y = page.start; options.height = page.end - page.start; options.width = clonedRoot.clientWidth;
            onProgress?.({ copy: index + 1, copies: items.length, page: pageIndex + 1, pages: pages.length });
          },
        };
        const render = canvasModule.default(frame.content, options);
        let renderActive = true;
        void render.then(canvas => { if (!renderActive || signal.aborted) { canvas.width = 0; canvas.height = 0; } }, () => undefined);
        let canvas: HTMLCanvasElement;
        try { canvas = await bounded(render, signal, frame.dispose); }
        catch (error) { renderActive = false; throw error; }
        try {
          checkCancelled(signal);
          const image = canvas.toDataURL('image/jpeg', 0.94);
          imageBytes += Math.ceil(image.length * 0.75);
          if (imageBytes + totalBytes > MAX_BATCH_PRINT_BYTES) throw new Error('PDF 导出超过 128 MiB，请减少份数。');
          if (pageIndex > 0) pdf.addPage('a4', 'portrait');
          pdf.addImage(image, 'JPEG', 16, 16, 178, (page.end - page.start) * 178 / frame.content.clientWidth, undefined, 'FAST');
          pdf.setFontSize(8); pdf.setTextColor(100); pdf.text(`${pageIndex + 1} / ${pages.length}`, 194, 289, { align: 'right' });
        } finally { canvas.width = 0; canvas.height = 0; }
        await bounded(new Promise<void>(resolve => setTimeout(resolve, 0)), signal, frame.dispose);
      }
      const bytes = new Uint8Array(pdf.output('arraybuffer'));
      totalBytes += bytes.byteLength;
      if (totalBytes > MAX_BATCH_PRINT_BYTES) throw new Error('PDF 导出超过 128 MiB，请减少份数。');
      const filename = safeFilename(item.name, 'pdf');
      let name = filename;
      for (let duplicate = 2; files[name]; duplicate++) name = `${filename.slice(0, -4)}-${String(duplicate).padStart(2, '0')}.pdf`;
      files[name] = bytes;
    } finally { frame.dispose(); }
  }
  checkCancelled(signal);
  if (items.length === 1) {
    const entry = Object.entries(files)[0];
    if (!entry) throw new Error('PDF 文件为空。');
    download(entry[1], entry[0], 'application/pdf', signal);
    return;
  }
  let terminate: (() => void) | undefined;
  const archive = await bounded(new Promise<Uint8Array<ArrayBuffer>>((resolve, reject) => {
    terminate = zipModule.zip(files, { level: 0 }, (error, bytes) => {
      if (error) reject(new Error('PDF 打包失败。'));
      else if (!bytes) reject(new Error('PDF 打包结果为空。'));
      else resolve(new Uint8Array(bytes));
    });
  }), signal, () => terminate?.());
  if (archive.byteLength > MAX_BATCH_PRINT_BYTES) throw new Error('PDF 压缩包超过 128 MiB，请减少份数。');
  download(archive, safeFilename(archiveName, 'zip'), 'application/zip', signal);
}
