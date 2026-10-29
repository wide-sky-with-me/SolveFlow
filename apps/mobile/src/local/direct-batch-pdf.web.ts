// Decision: .agents/notes/implemented/storage/2026-10-22-direct-parsed-pdf.md
// Decision: .agents/notes/implemented/storage/2026-10-25-direct-pdf-resource-reuse.md
import { MAX_BATCH_PRINT_COPIES } from '@solveflow/contracts/local';
import { ExportTaskFailure } from '@solveflow/client/local';
import { boundedPdfResource, estimateBatchPdfBytes, packBatchPdfFiles, requireBatchPdfBytes, requireBatchPdfPageCount, safePdfFilename, type BatchPdfDownloadProgress } from './download-batch-pdfs.web';
import { directAnswerGroups, DIRECT_ANSWER_GROUP_SIZE, type DirectPrintBlock, type DirectHighlight } from './direct-batch-content';
import { directPdfResources, directNativeText, DIRECT_WIDTH as WIDTH, DIRECT_HEIGHT as HEIGHT, DIRECT_MARGIN as MARGIN, DIRECT_BOTTOM as BOTTOM, DIRECT_LINE as LINE } from './direct-pdf-resources.web';

type Command = { kind: 'text'; text: string; y: number; x?: number; native?: boolean; heading?: boolean; incorrect?: boolean; highlights?: DirectHighlight[]; anchor?: { key: string; title: string }; linkKey?: string; linkWidth?: number } | { kind: 'image'; image: string; y: number; width: number; height: number };
export interface DirectPdfItem { name: string; blocks: DirectPrintBlock[] }

/** Wrap saved source text as-is, including CJK, explicit lines and formula source. */
export function directTextLines(text: string, measure: (value: string) => number, width: number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.replaceAll('\r\n', '\n').replaceAll('\r', '\n').split('\n')) {
    const chars = Array.from(paragraph);
    if (!chars.length) { lines.push(''); continue; }
    let start = 0;
    while (start < chars.length) {
      let low = 1, high = chars.length - start, count = 0;
      while (low <= high) { const middle = Math.floor((low + high) / 2); if (measure(chars.slice(start, start + middle).join('')) <= width) { count = middle; low = middle + 1; } else high = middle - 1; }
      if (!count) throw new ExportTaskFailure('快速导出文字超出页宽。');
      // Prefer a word boundary without discarding any whitespace or splitting a Unicode code point.
      if (start + count < chars.length) { const candidate = chars.slice(start, start + count).join(''); const space = candidate.lastIndexOf(' '); if (space > candidate.length / 2) count = Array.from(candidate.slice(0, space + 1)).length; }
      lines.push(chars.slice(start, start + count).join('')); start += count;
    }
  }
  return lines;
}

async function paginateDirect(blocks: DirectPrintBlock[], resources: ReturnType<typeof directPdfResources>, signal: AbortSignal): Promise<Command[][]> {
  const pages: Command[][] = [[]]; let y = MARGIN;
  const next = () => { requireBatchPdfPageCount(pages.length + 1); pages.push([]); y = MARGIN; };
  const add = (height: number) => { signal.throwIfAborted(); if (y + height > BOTTOM) next(); return pages[pages.length - 1]!; };
  for (const [index, block] of blocks.entries()) {
    signal.throwIfAborted();
    if (block.kind === 'text') {
      const normalized = block.text.replaceAll('\r\n', '\n').replaceAll('\r', '\n');
      const lines = normalized.split('\n').flatMap(paragraph => resources.lines(paragraph, !!block.heading, WIDTH - 2 * MARGIN).map(text => ({ text, native: directNativeText(paragraph) })));
      if (block.heading) { add(2 * LINE); y += 6; }
      const { anchor, highlights: ranges, ...body } = block;
      let offset = 0;
      for (const [lineIndex, { text, native }] of lines.entries()) {
        const start = normalized.indexOf(text, offset); offset = start + text.length;
        const highlights = ranges?.flatMap(range => { const left = Math.max(range.start, start), right = Math.min(range.end, offset); return left < right ? [{ start: left - start, end: right - start }] : []; });
        add(LINE).push({ ...body, text, y, native, ...(lineIndex === 0 && anchor ? { anchor } : {}), ...(highlights ? { highlights } : {}) }); y += LINE;
      }
      y += 8;
    } else if (block.kind === 'answer-table') {
      add(2 * LINE).push({ kind: 'text', text: '答案表', heading: true, y, anchor: { key: 'answer-table', title: '答案表' } }); y += 2 * LINE;
      const inset = 110, cellWidth = (WIDTH - 2 * MARGIN - inset - 20) / DIRECT_ANSWER_GROUP_SIZE;
      add(LINE).push({ kind: 'text', text: '题号', y, x: MARGIN }, { kind: 'text', text: '答案', y, x: MARGIN + inset }); y += LINE + 8;
      for (const [row, group] of directAnswerGroups(block.entries).entries()) {
        const cells = group.map((entry, index) => {
          const text = `${entry.answer}${entry.incorrect ? ' ×' : ''}${index < group.length - 1 ? ',' : ''}`;
          return { entry, text, lines: resources.lines(text, false, cellWidth - 10) };
        });
        const height = Math.max(...cells.map(cell => cell.lines.length)) * LINE + 6;
        add(height);
        const range = group.length > 1 ? `${group[0]!.ordinal}–${group[group.length - 1]!.ordinal}` : String(group[0]!.ordinal);
        pages[pages.length - 1]!.push({ kind: 'text', text: range, y, x: MARGIN }, { kind: 'text', text: '[', y, x: MARGIN + inset - 16 }, { kind: 'text', text: ']', y, x: MARGIN + inset + cells.length * cellWidth - 5 });
        for (const [column, cell] of cells.entries()) {
          let offset = 0;
          for (const [lineIndex, text] of cell.lines.entries()) {
            const start = cell.text.indexOf(text, offset); offset = start + text.length;
            const left = Math.max(0, start), right = Math.min(cell.entry.answer.length, offset);
            pages[pages.length - 1]!.push({ kind: 'text', text, native: directNativeText(cell.text), y: y + lineIndex * LINE, x: MARGIN + inset + column * cellWidth, incorrect: cell.entry.incorrect, linkKey: cell.entry.key, linkWidth: cellWidth - 4, highlights: cell.entry.choice && left < right ? [{ start: left - start, end: right - start }] : [] });
          }
        }
        y += height;
        if (row % 16 === 0) await new Promise<void>(resolve => setTimeout(resolve, 0));
      }
      // The overview ends before the first question; long summaries may span several pages.
      next();
    } else {
      const { width, height } = await resources.size(block.image, signal);
      add(height + LINE).push({ kind: 'image', image: block.image, y, width, height }); y += height + LINE;
    }
    if (index % 8 === 0) await new Promise<void>(resolve => setTimeout(resolve, 0));
  }
  signal.throwIfAborted(); return pages;
}

/** Shared bounded assets and vector English avoid repeating whole-page rasterization for each copy. */
export async function buildDirectBatchPdfs(items: DirectPdfItem[], archiveName: string, signal: AbortSignal, onProgress: (value: BatchPdfDownloadProgress) => void, status: (value: string) => void) {
  signal.throwIfAborted();
  if (!items.length || items.length > MAX_BATCH_PRINT_COPIES) throw new ExportTaskFailure('每次导出需要 1 至 20 份。');
  const { jsPDF } = await boundedPdfResource(import('jspdf'), signal, () => undefined);
  const resources = directPdfResources(new jsPDF({ unit: 'pt' }), directTextLines);
  const files: Record<string, Uint8Array<ArrayBuffer>> = Object.create(null);
  let totalBytes = 0;
  let estimatedBytes: number | undefined;
  try {
    for (const [index, item] of items.entries()) {
      signal.throwIfAborted(); status(`正在分页第 ${index + 1} / ${items.length} 份已解析内容`);
      const pages = await paginateDirect(item.blocks, resources, signal);
      const pdf = new jsPDF({ unit: 'mm', format: 'a4', compress: true });
      const destinations = new Map<string, { pageNumber: number; top: number; title: string }>();
      for (const [pageIndex, commands] of pages.entries()) for (const command of commands) if (command.kind === 'text' && command.anchor) destinations.set(command.anchor.key, { pageNumber: pageIndex + 1, top: command.y / HEIGHT * 297, title: command.anchor.title });
      const deadline = Date.now() + Math.min(300000, Math.max(60000, pages.length * 10000));
      let encodedBytes = 0;
      const includedAssets = new Set<string>();
      const addAsset = (asset: Awaited<ReturnType<typeof resources.image>>, x: number, y: number, width: number, height: number) => {
        if (!includedAssets.has(asset.alias)) { encodedBytes += asset.data.byteLength; requireBatchPdfBytes(encodedBytes, totalBytes); includedAssets.add(asset.alias); }
        pdf.addImage(asset.data, asset.format, x / WIDTH * 210, y / HEIGHT * 297, width / WIDTH * 210, height / HEIGHT * 297, asset.alias, 'FAST');
      };
      for (const [pageIndex, commands] of pages.entries()) {
        signal.throwIfAborted(); if (Date.now() >= deadline) throw new ExportTaskFailure('快速导出单份处理超时，请减少内容后重试。');
        onProgress({ copy: index + 1, copies: items.length, page: pageIndex + 1, pages: pages.length, pagesFinal: true, ...(estimatedBytes === undefined ? {} : { estimatedBytes }) });
        if (pageIndex) pdf.addPage();
        for (const command of commands) {
          signal.throwIfAborted();
          if (command.kind === 'text') {
            const x = command.x ?? MARGIN, native = command.native ?? directNativeText(command.text);
            for (const range of command.highlights ?? []) {
              const left = resources.measure(command.text.slice(0, range.start), !!command.heading, native), width = resources.measure(command.text.slice(range.start, range.end), !!command.heading, native);
              pdf.setFillColor('#ffeb70'); pdf.rect((x + left - 2) / WIDTH * 210, (command.y - 1) / HEIGHT * 297, (width + 4) / WIDTH * 210, (LINE - 1) / HEIGHT * 297, 'F');
            }
            if (native) {
              pdf.setFont('helvetica', command.heading ? 'bold' : 'normal'); pdf.setFontSize((command.heading ? 21 : 17) / WIDTH * 210 * 72 / 25.4); pdf.setTextColor(command.incorrect ? '#ba2337' : '#17202b');
              pdf.text(command.text, x / WIDTH * 210, command.y / HEIGHT * 297, { baseline: 'top' });
            } else if (command.text) {
              const asset = await resources.text(command.text, !!command.heading, !!command.incorrect, signal, deadline); signal.throwIfAborted();
              addAsset(asset, x - 3, command.y - 2, asset.width, asset.height);
            }
          } else { const asset = await resources.image(command.image, signal, deadline); signal.throwIfAborted(); addAsset(asset, MARGIN, command.y, command.width, command.height); }
        }
        pdf.setFont('helvetica', 'normal'); pdf.setFontSize(13 / WIDTH * 210 * 72 / 25.4); pdf.setTextColor('#657080'); pdf.text(`${pageIndex + 1} / ${pages.length}`, (WIDTH - 105) / WIDTH * 210, (HEIGHT - 35) / HEIGHT * 297, { baseline: 'top' });
        for (const command of commands) if (command.kind === 'text' && command.linkKey) {
          const target = destinations.get(command.linkKey);
          if (target) pdf.link((command.x ?? MARGIN) / WIDTH * 210, command.y / HEIGHT * 297, (command.linkWidth ?? WIDTH / 2 - MARGIN) / WIDTH * 210, LINE / HEIGHT * 297, { pageNumber: target.pageNumber, top: target.top });
        }
        await new Promise<void>(resolve => setTimeout(resolve, 0));
      }
      for (const target of destinations.values()) pdf.outline.add(null, target.title, { pageNumber: target.pageNumber });
      if (destinations.size) pdf.setDisplayMode('fullwidth', 'continuous', 'UseOutlines');
      signal.throwIfAborted(); const data = new Uint8Array(pdf.output('arraybuffer')); signal.throwIfAborted();
      requireBatchPdfBytes(data.byteLength, totalBytes); totalBytes += data.byteLength;
      const filename = safePdfFilename(item.name, 'pdf'); let name = filename;
      for (let duplicate = 2; files[name]; duplicate++) name = `${filename.slice(0, -4)}-${String(duplicate).padStart(2, '0')}.pdf`;
      files[name] = data;
      if (index + 1 < items.length) {
        estimatedBytes = estimateBatchPdfBytes(totalBytes, index + 1, items.length);
        onProgress({ copy: index + 1, copies: items.length, page: pages.length, pages: pages.length, pagesFinal: true, estimatedBytes }); signal.throwIfAborted();
      }
    }
    return await packBatchPdfFiles(files, archiveName, signal);
  } finally { resources.dispose(); }
}
