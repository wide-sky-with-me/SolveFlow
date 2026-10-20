// Decision: .agents/notes/implemented/storage/2026-10-13-batch-pdf-variants-and-image-layout.md
// Decision: .agents/notes/implemented/storage/2026-10-15-pdf-page-render-scope.md
// Decision: .agents/notes/implemented/storage/2026-10-15-pdf-capacity-estimate.md
// Decision: .agents/notes/implemented/storage/2026-10-16-pdf-async-jpeg.md
// Decision: .agents/notes/implemented/storage/2026-10-18-pdf-resource-handoff.md
// Decision: .agents/notes/implemented/storage/2026-10-19-pdf-cleanup-settlement.md
import { MAX_BATCH_PRINT_BYTES, MAX_BATCH_PRINT_COPIES, MAX_BATCH_PRINT_PAGES } from '@solveflow/contracts/local';
import { ExportTaskFailure } from '@solveflow/client/local';
import { createBatchPrintFrame, fitBatchPrintMath } from './print-batch.web.ts';
import { fitBatchPrintQuestionPage, fitBatchPrintQuestionPages } from './print-question-pages.web';
import type html2canvas from 'html2canvas';
import { createPdfRenderLifecycle, yieldPdfRender } from './pdf-render-lifecycle.web';

export interface BatchPdfDownload { element: Element | (() => Element | Promise<Element>); name: string }
export interface BatchPdfDownloadProgress { copy: number; copies: number; page: number; pages: number; estimatedBytes?: number }
interface Interval { start: number; end: number }
const MAX_COPIES = MAX_BATCH_PRINT_COPIES;
const MAX_PAGES = MAX_BATCH_PRINT_PAGES;
const RESOURCE_TIMEOUT = 30000;
const MM_PER_PIXEL = 25.4 / 96;
const PAGE_HEIGHT = 264 / MM_PER_PIXEL;
const ARCHIVE_ENTRY_ESTIMATE = 2048;

export function formatBatchPdfProgress(value: BatchPdfDownloadProgress): string {
  const current = `生成第 ${value.copy} / ${value.copies} 份 · 第 ${value.page} / ${value.pages} 页`;
  const estimate = value.estimatedBytes;
  if (estimate === undefined || !Number.isFinite(estimate) || estimate < MAX_BATCH_PRINT_BYTES * .9) return current;
  return `${current} · 预计约 ${(estimate / 1024 / 1024).toFixed(1)} MiB，${estimate >= MAX_BATCH_PRINT_BYTES ? '可能超过' : '接近'} ${MAX_BATCH_PRINT_BYTES / 1024 / 1024} MiB 上限；可取消后减少份数。`;
}
function checkCancelled(signal: AbortSignal) {
  if (signal.aborted) throw new Error('导出已取消。');
}

function cleanupAll(cleanups: Array<() => void>) {
  const errors: unknown[] = [];
  for (const cleanup of cleanups) { try { cleanup(); } catch (error) { errors.push(error); } }
  if (errors.length === 1) throw errors[0];
  if (errors.length > 1) throw new AggregateError(errors, 'PDF 资源清理失败。');
}

function bounded<T>(work: Promise<T>, signal: AbortSignal, cleanup: () => void, deadline?: number): Promise<T> {
  try { checkCancelled(signal); } catch (error) { void work.catch(() => {}); throw error; }
  const expiresAt = Math.min(Date.now() + RESOURCE_TIMEOUT, deadline ?? Infinity);
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      signal.removeEventListener('abort', aborted);
      return true;
    };
    const fail = (error: Error) => {
      if (!finish()) return;
      try { cleanup(); }
      catch (cleanupError) {
        // Preserve the terminal reason and its UI classification without losing cleanup evidence.
        const cause = new AggregateError([error, cleanupError], 'PDF 资源清理失败。');
        reject(error instanceof ExportTaskFailure ? new ExportTaskFailure(error.message, { cause }) : new Error(error.message, { cause }));
        return;
      }
      reject(error);
    };
    const aborted = () => fail(new Error('导出已取消。'));
    const timeoutError = () => new ExportTaskFailure(deadline !== undefined && Date.now() >= deadline ? '单份 PDF 处理超时，请减少内容后重试。' : 'PDF 资源处理超时，请重试。');
    const endingError = () => signal.aborted ? new Error('导出已取消。') : Date.now() >= expiresAt ? timeoutError() : undefined;
    const timeout = setTimeout(() => fail(endingError() ?? timeoutError()), Math.max(0, expiresAt - Date.now()));
    signal.addEventListener('abort', aborted, { once: true });
    void work.then(value => {
      if (settled) return;
      const error = endingError();
      if (error) fail(error); else if (finish()) resolve(value);
    }, error => {
      if (!settled) fail(endingError() ?? (error instanceof Error ? error : new Error('PDF 处理失败。')));
    });
  });
}

function safeFilename(name: string, extension: 'pdf' | 'zip'): string {
  const stem = name.replace(/\.(pdf|zip)$/i, '').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '-').replace(/[.\s]+$/g, '').trim().slice(0, 180);
  return `${stem || 'batch'}.${extension}`;
}

export function requireBatchPdfPageCount(count: number) {
  if (count > MAX_PAGES) throw new ExportTaskFailure(`PDF 页数超过上限（每份 ${MAX_PAGES} 页），请按题目拆分后重试。`);
}
function checkCopyDeadline(deadline: number) {
  if (Date.now() >= deadline) throw new ExportTaskFailure('单份 PDF 处理超时，请减少内容后重试。');
}

/** Bound canvases to individual A4 pages, preserving whole short blocks and text lines. */
function paginate(root: HTMLElement): Interval[] {
  const doc = root.ownerDocument;
  const top = root.getBoundingClientRect().top;
  const height = Math.ceil(root.getBoundingClientRect().height);
  if (height <= 0 || height > PAGE_HEIGHT * MAX_PAGES) throw new Error('PDF 正文尺寸超出导出范围。');
  const questionPages = [...root.querySelectorAll<HTMLElement>('[data-pdf-question]')];
  requireBatchPdfPageCount(questionPages.length);
  if (questionPages.length) return questionPages.map(page => {
    const rect = page.getBoundingClientRect();
    if (rect.height <= 0 || rect.height > PAGE_HEIGHT + 1) throw new Error('单题页面超出 A4 可用高度。');
    return { start: rect.top - top, end: rect.bottom - top };
  });
  const blocks: Interval[] = [];
  const protectedRows: Interval[] = [];
  const forcedBreaks: number[] = [];
  const breakGaps: Interval[] = [];
  const interval = (rect: DOMRect): Interval => ({ start: Math.max(0, rect.top - top), end: Math.min(height, rect.bottom - top) });
  for (const block of root.querySelectorAll<HTMLElement>('[data-pdf-block],figure,.print-cover')) {
    const value = interval(block.getBoundingClientRect());
    if (value.end > value.start && value.end - value.start < PAGE_HEIGHT) blocks.push(value);
  }
  // A long question may span pages, but its heading must stay with a short stem.
  for (const heading of root.querySelectorAll<HTMLElement>('.print-copy-question > h2')) {
    const next = heading.nextElementSibling;
    if (!next) continue;
    const first = interval(heading.getBoundingClientRect());
    const last = interval(next.getBoundingClientRect());
    if (last.end > first.start && last.end - first.start < PAGE_HEIGHT) blocks.push({ start: first.start, end: last.end });
  }
  for (const block of root.querySelectorAll<HTMLElement>('.print-cover,.print-question')) {
    const computed = doc.defaultView?.getComputedStyle(block);
    const value = interval(block.getBoundingClientRect());
    const previous = block.previousElementSibling;
    if (computed?.breakBefore === 'page' && previous?.matches('.print-cover,.print-question')) {
      const prior = interval(previous.getBoundingClientRect());
      if (value.start > prior.end) breakGaps.push({ start: prior.end, end: value.start });
    }
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
  // A page edge inside a known block margin must not create a blank continuation sheet.
  const margins = breakGaps.filter(gap => !protectedRows.some(row => row.start < gap.end && row.end > gap.start));
  const pages: Interval[] = [];
  let start = 0;
  while (start < height - 0.5) {
    const margin = margins.find(gap => gap.start <= start && gap.end > start);
    if (margin) { start = margin.end; continue; }
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
    requireBatchPdfPageCount(pages.length);
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

/** Build the complete artifact without a download gesture; background jobs can persist it. */
export async function buildBatchPdfs(
  items: ReadonlyArray<BatchPdfDownload>, archiveName: string, signal: AbortSignal,
  onProgress?: (progress: BatchPdfDownloadProgress) => void,
): Promise<{ name: string; mimeType: 'application/pdf' | 'application/zip'; data: Uint8Array<ArrayBuffer> }> {
  checkCancelled(signal);
  if (items.length < 1 || items.length > MAX_COPIES) throw new Error('每次导出需要 1 至 20 份。');
  const [canvasModule, pdfModule, zipModule] = await bounded(Promise.all([import('html2canvas'), import('jspdf'), import('fflate')]), signal, () => undefined);
  checkCancelled(signal);
  if (Reflect.get(canvasModule.default, 'renderLifecycleVersion') !== 2) throw new ExportTaskFailure('PDF 绘制组件版本不匹配，请刷新页面后重试。');
  const files: Record<string, Uint8Array<ArrayBuffer>> = Object.create(null);
  let totalBytes = 0;
  let estimatedBytes: number | undefined;
  for (const [index, item] of items.entries()) {
    checkCancelled(signal);
    const element = await bounded(Promise.resolve().then(() => {
      checkCancelled(signal);
      return typeof item.element === 'function' ? item.element() : item.element;
    }), signal, () => undefined);
    checkCancelled(signal);
    requireLocalImages(element);
    const frame = await createBatchPrintFrame(element, item.name, signal, { questionPages: true });
    const copyDeadline = Date.now() + 60000;
    try {
      requireLocalImages(frame.doc);
      if (frame.content.scrollWidth > frame.content.clientWidth + 1) throw new Error('PDF 正文超出页宽，请调整公式或图片。');
      let pages = paginate(frame.content);
      const candidates = [...frame.content.querySelectorAll<HTMLElement>('[data-pdf-question]')];
      const questionPages = frame.content.matches('.print-copy-document') && candidates.every(page => page.parentElement === frame.content && page.matches('.print-copy-question.print-question-page')) ? candidates : [];
      const pdf = new pdfModule.jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4', compress: true });
      let imageBytes = 0;
      for (let pageIndex = 0; pageIndex < pages.length; pageIndex++) {
        checkCancelled(signal);
        checkCopyDeadline(copyDeadline);
        if (pageIndex > 0 && frame.activateQuestionPage) await bounded(frame.activateQuestionPage(pageIndex), signal, frame.dispose, copyDeadline);
        let page = pages[pageIndex];
        if (!page) throw new Error('PDF 分页不可用。');
        const questionPage = questionPages[pageIndex];
        let renderActive = true;
        const renderDeadline = Math.min(copyDeadline, Date.now() + RESOURCE_TIMEOUT);
        const lifecycle = createPdfRenderLifecycle(frame.doc, () => {
          checkCancelled(signal); checkCopyDeadline(copyDeadline);
          if (Date.now() >= renderDeadline) throw new ExportTaskFailure('PDF 资源处理超时，请重试。');
          if (!renderActive) throw new Error('PDF 绘制已结束。');
        });
        const options: NonNullable<Parameters<typeof html2canvas>[1]> = {
          backgroundColor: '#ffffff', scale: 2, x: 0, y: questionPage ? 0 : page.start,
          width: frame.content.clientWidth, height: page.end - page.start,
          windowWidth: 800, windowHeight: 1100, scrollX: 0, scrollY: 0,
          logging: false, allowTaint: false, useCORS: false, imageTimeout: 15000,
          removeContainer: true,
          // Preserve first-page font/image scheduling; slice subsequent page parsing only.
          renderLifecycle: { assertActive: lifecycle.assertActive, onDispose: lifecycle.onDispose, ...(pageIndex > 0 ? { yieldControl: () => yieldPdfRender(lifecycle) } : {}) },
          // Keep sibling sheet geometry while avoiding their repeated content/image cloning.
          ...(questionPage ? { ignoreElements: (element: Element) => {
            const owner = element.closest('[data-pdf-question]');
            return !!owner && owner !== questionPage && element !== owner;
          } } : {}),
          onclone: (doc, clonedRoot) => {
            lifecycle.bindClone(doc);
            fitBatchPrintMath(doc);
            if (questionPage) fitBatchPrintQuestionPage(clonedRoot); else fitBatchPrintQuestionPages(doc);
            const clonedDocument = questionPage ? clonedRoot.parentElement : clonedRoot;
            if (!clonedDocument) throw new Error('PDF 单题页面结构不完整。');
            if (clonedDocument.scrollWidth > clonedDocument.clientWidth + 1) throw new Error('PDF 绘制内容超出页宽。');
            // Recheck all sheet positions, including the retained empty siblings.
            const measured = paginate(clonedDocument);
            if (pageIndex === 0) pages = measured;
            else if (measured.length !== pages.length || measured.some((value, i) => Math.abs(value.start - (pages[i]?.start ?? -1)) > 1 || Math.abs(value.end - (pages[i]?.end ?? -1)) > 1)) throw new Error('PDF 排版在绘制时发生变化，请重试。');
            page = pages[pageIndex];
            if (!page) throw new Error('PDF 分页不可用。');
            options.y = questionPage ? 0 : page.start; options.height = page.end - page.start; options.width = clonedRoot.clientWidth;
            onProgress?.({ copy: index + 1, copies: items.length, page: pageIndex + 1, pages: pages.length, ...(estimatedBytes === undefined ? {} : { estimatedBytes }) });
          },
        };
        let canvas: HTMLCanvasElement;
        try {
          const render = canvasModule.default(questionPage ?? frame.content, options);
          let pendingCanvas: Promise<HTMLCanvasElement>;
          // Guard completion first; observe late resources even if synchronous cancellation throws.
          try { pendingCanvas = bounded(render, signal, () => { renderActive = false; cleanupAll([() => lifecycle.dispose(), () => frame.dispose()]); }, copyDeadline); }
          finally { void render.then(value => { if (!renderActive || signal.aborted) { value.width = 0; value.height = 0; } }, () => undefined); }
          canvas = await pendingCanvas;
          try { lifecycle.completeRendering(); } catch (error) { canvas.width = 0; canvas.height = 0; throw error; }
        } catch (error) { renderActive = false; throw error; }
        finally { renderActive = false; lifecycle.dispose(); }
        try {
          checkCancelled(signal);
          checkCopyDeadline(copyDeadline);
          const blob = await bounded(new Promise<Blob>((resolve, reject) => {
            canvas.toBlob(value => value ? resolve(value) : reject(new ExportTaskFailure('PDF 页面图像编码失败，请重试。')), 'image/jpeg', .94);
          }), signal, frame.dispose, copyDeadline);
          checkCancelled(signal);
          checkCopyDeadline(copyDeadline);
          if (blob.type !== 'image/jpeg' || blob.size === 0) throw new ExportTaskFailure('PDF 页面图像格式无效，请重试。');
          // Preserve the former data-URI estimate, including its prefix and base64 padding.
          imageBytes += 3 * Math.ceil(blob.size / 3) + 18;
          if (imageBytes + totalBytes > MAX_BATCH_PRINT_BYTES) throw new ExportTaskFailure('PDF 导出超过 128 MiB，请减少份数或分批导出。');
          const image = new Uint8Array(await bounded(blob.arrayBuffer(), signal, frame.dispose, copyDeadline));
          checkCancelled(signal);
          checkCopyDeadline(copyDeadline);
          if (pageIndex > 0) pdf.addPage('a4', 'portrait');
          // Typed-array auto-aliases can collide on different JPEG tails; each page is unique.
          pdf.addImage(image, 'JPEG', 16, 16, 178, (page.end - page.start) * 178 / frame.content.clientWidth, `page-${pageIndex + 1}`, 'FAST');
          if (!frame.content.querySelector('[data-pdf-question]')) { pdf.setFontSize(8); pdf.setTextColor(100); pdf.text(`${pageIndex + 1} / ${pages.length}`, 194, 289, { align: 'right' }); }
        } finally { canvas.width = 0; canvas.height = 0; }
        await bounded(new Promise<void>(resolve => setTimeout(resolve, 0)), signal, frame.dispose, copyDeadline);
      }
      checkCancelled(signal);
      checkCopyDeadline(copyDeadline);
      const bytes = new Uint8Array(pdf.output('arraybuffer'));
      checkCancelled(signal);
      checkCopyDeadline(copyDeadline);
      totalBytes += bytes.byteLength;
      if (totalBytes > MAX_BATCH_PRINT_BYTES) throw new ExportTaskFailure('PDF 导出超过 128 MiB，请减少份数或分批导出。');
      const filename = safeFilename(item.name, 'pdf');
      let name = filename;
      for (let duplicate = 2; files[name]; duplicate++) name = `${filename.slice(0, -4)}-${String(duplicate).padStart(2, '0')}.pdf`;
      files[name] = bytes;
      if (index + 1 < items.length) {
        // Completed files are representative; estimates advise, never reject an artifact.
        estimatedBytes = Math.ceil(totalBytes * items.length / (index + 1)) + ARCHIVE_ENTRY_ESTIMATE * items.length;
        onProgress?.({ copy: index + 1, copies: items.length, page: pages.length, pages: pages.length, estimatedBytes });
        checkCancelled(signal);
      }
    } finally { frame.dispose(); }
  }
  checkCancelled(signal);
  if (items.length === 1) {
    const entry = Object.entries(files)[0];
    if (!entry) throw new Error('PDF 文件为空。');
    return { data: entry[1], name: entry[0], mimeType: 'application/pdf' };
  }
  let terminate: (() => void) | undefined;
  const archive = await bounded(new Promise<Uint8Array<ArrayBuffer>>((resolve, reject) => {
    terminate = zipModule.zip(files, { level: 0 }, (error, bytes) => {
      if (error) reject(new Error('PDF 打包失败。'));
      else if (!bytes) reject(new Error('PDF 打包结果为空。'));
      else if (bytes.buffer instanceof ArrayBuffer) resolve(new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength));
      else resolve(Uint8Array.from(bytes));
    });
  }), signal, () => terminate?.());
  checkCancelled(signal);
  if (archive.byteLength > MAX_BATCH_PRINT_BYTES) throw new ExportTaskFailure('PDF 压缩包超过 128 MiB，请减少份数或分批导出。');
  return { data: archive, name: safeFilename(archiveName, 'zip'), mimeType: 'application/zip' };
}

/** The foreground download API stays compatible with existing callers. */
export async function exportBatchPdfs(
  items: ReadonlyArray<BatchPdfDownload>, archiveName: string, signal: AbortSignal,
  onProgress?: (progress: BatchPdfDownloadProgress) => void,
): Promise<void> {
  const file = await buildBatchPdfs(items, archiveName, signal, onProgress);
  download(file.data, file.name, file.mimeType, signal);
}
