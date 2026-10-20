import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { ExportTaskFailure } from '@solveflow/client/local';
import type { BatchPdfDownloadProgress } from './download-batch-pdfs.web';
import { afterEach, describe, expect, it, vi } from 'vitest';

const source = readFileSync(new URL('./download-batch-pdfs.web.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
function fixture(options: { capability?: number; limit?: number; jpeg?: string; lateRender?: boolean; renderClock?: number; abortDuringRender?: 'resolve' | 'reject'; lateOutput?: boolean; zipBytes?: number; renderError?: boolean; cloneError?: boolean; abortAfterZipResolve?: boolean; deferredRender?: boolean; releaseDuringDispose?: boolean; pdfSizes?: number[]; abortAfterEstimate?: boolean; deferredBlob?: boolean; deferredRead?: boolean; nullBlob?: boolean; blobSize?: number; mimeType?: string; blobError?: boolean; readError?: boolean; lateBlob?: boolean; lateRead?: boolean; abortAfterRead?: boolean; abortAfterBlob?: boolean; blobClock?: number; cleanupError?: boolean; frameCleanupError?: boolean; undefinedCleanup?: boolean; renderAfterClone?: boolean } = {}) {
  let clock = 0; let disposed = 0; let encoded = 0; let outputs = 0; let fits = 0; let cleanupCalls = 0;
  const cleanupError = new Error('UNTRUSTED_CLEANUP_DETAIL');
  const controller = new AbortController(); const progress: number[] = []; const details: BatchPdfDownloadProgress[] = []; const elements: unknown[] = [];
  vi.spyOn(Date, 'now').mockImplementation(() => clock);
  const height = 263 / (25.4 / 96);
  const sheet: { parentElement: object | null; clientWidth: number; scrollWidth: number; matches: () => boolean; getBoundingClientRect: () => { top: number; bottom: number; height: number } } = { parentElement: null, clientWidth: 674, scrollWidth: 674, matches: () => true, getBoundingClientRect: () => ({ top: 0, bottom: height, height }) };
  const root = { matches: () => true, clientWidth: 674, scrollWidth: 674, getBoundingClientRect: () => ({ top: 0, height }), querySelector: () => sheet, querySelectorAll: (selector: string) => selector === '[data-pdf-question]' ? [sheet] : [] };
  sheet.parentElement = root;
  const frame = { content: root, doc: { querySelectorAll: () => [] }, dispose: () => { disposed++; if (options.frameCleanupError && disposed === 1) throw cleanupError; if (options.releaseDuringDispose && release) { const complete = release; release = undefined; complete(); } } };
  let releaseBlob: (() => void) | undefined; let releaseRead: (() => void) | undefined; let reads = 0;
  const requests: Array<[string | undefined, unknown]> = []; const imageData: unknown[] = []; const imageCalls: unknown[][] = [];
  const blobBytes = Uint8Array.from({ length: options.blobSize ?? 3 }, (_, index) => (index * 37 + 17) % 256);
  const blob = new Blob([blobBytes], { type: options.mimeType ?? 'image/jpeg' });
  vi.spyOn(blob, 'arrayBuffer').mockImplementation(() => {
    reads++;
    const complete = () => { if (options.lateRead) clock = 60000; return blobBytes.slice().buffer; };
    if (options.readError) return Promise.reject(new Error('UNTRUSTED_READ_DETAIL'));
    if (options.deferredRead) return new Promise<ArrayBuffer>(resolve => { releaseRead = () => resolve(complete()); });
    if (options.abortAfterRead) return new Promise<ArrayBuffer>(resolve => queueMicrotask(() => { resolve(complete()); queueMicrotask(() => controller.abort()); }));
    return Promise.resolve(complete());
  });
  const canvas = { width: 1348, height: 1988,
    toDataURL: () => { encoded++; return options.jpeg ?? 'data:image/jpeg;base64,AAAA'; },
    toBlob: (callback: BlobCallback, type?: string, quality?: unknown) => {
      encoded++; requests.push([type, quality]);
      if (options.blobError) throw new Error('UNTRUSTED_ENCODER_DETAIL');
      const complete = () => { if (options.lateBlob) clock = 60000; if (options.blobClock !== undefined) clock = options.blobClock; callback(options.nullBlob ? null : blob); if (options.abortAfterBlob) queueMicrotask(() => controller.abort()); };
      if (options.deferredBlob) releaseBlob = complete; else queueMicrotask(complete);
    },
  };
  let release: (() => void) | undefined;
  const fit = () => { fits++; if (options.cloneError) throw new Error('UNTRUSTED_CLONE_DETAIL'); };
  class Pdf {
    addPage() {} addImage(data: unknown, ...args: unknown[]) { imageData.push(data); imageCalls.push([data, ...args]); } setFontSize() {} setTextColor() {} text() {}
    output() { outputs++; if (options.lateOutput) clock = 60000; return new ArrayBuffer(options.pdfSizes?.[outputs - 1] ?? 4); }
  }
  const dependencies: Record<string, object> = {
    '@solveflow/contracts/local': { MAX_BATCH_PRINT_BYTES: options.limit ?? 1000, MAX_BATCH_PRINT_COPIES: 20, MAX_BATCH_PRINT_PAGES: 300 },
    '@solveflow/client/local': { ExportTaskFailure },
    './print-batch.web.ts': { createBatchPrintFrame: async (element: unknown) => { elements.push(element); return frame; }, fitBatchPrintMath: () => {} },
    './print-question-pages.web': { fitBatchPrintQuestionPages: fit, fitBatchPrintQuestionPage: fit },
    './pdf-render-lifecycle.web': {
      createPdfRenderLifecycle: (_doc: object, check: () => void) => {
        let closed = false; const cleanups = new Set<() => void>();
        const assertActive = () => { check(); if (closed) throw new Error('PDF 绘制已结束。'); };
        return { assertActive, bindClone: assertActive, completeRendering: assertActive,
          onDispose: (cleanup: () => void) => { cleanups.add(cleanup); return () => { cleanups.delete(cleanup); }; },
          dispose: () => { closed = true; const pending = [...cleanups]; cleanups.clear(); for (const cleanup of pending) cleanup(); } };
      },
      yieldPdfRender: async (lifecycle: { assertActive: () => void }) => { lifecycle.assertActive(); },
    },
    html2canvas: { __esModule: true, default: Object.assign(async (target: object, settings: { onclone: (doc: object, root: object) => void; renderLifecycle: { onDispose: (cleanup: () => void) => () => void } }) => {
      canvas.width = 1348; canvas.height = 1988;
      if (options.cleanupError) settings.renderLifecycle.onDispose(() => { cleanupCalls++; if (cleanupCalls === 1) throw options.undefinedCleanup ? undefined : cleanupError; });
      if (options.abortDuringRender) { controller.abort(); if (options.abortDuringRender === 'reject') throw new Error('RENDER_REJECT_AFTER_CANCEL'); return canvas; }
      if (options.renderError) throw new Error('UNTRUSTED_RENDER_DETAIL');
      if (options.renderAfterClone) settings.onclone(frame.doc, target);
      const complete = () => { if (!options.renderAfterClone) settings.onclone(frame.doc, target); if (options.lateRender) clock = 60000; if (options.renderClock !== undefined) clock = options.renderClock; return canvas; };
      if (!options.deferredRender) return complete();
      return new Promise((resolve, reject) => { release = () => { try { resolve(complete()); } catch (error) { reject(error); } }; });
    }, { renderLifecycleVersion: options.capability ?? 2 }) },
    jspdf: { jsPDF: Pdf },
    fflate: { zip: (_files: unknown, _options: unknown, done: (error: Error | null, data: Uint8Array<ArrayBuffer>) => void) => {
      const bytes = new Uint8Array(options.zipBytes ?? 12);
      if (options.abortAfterZipResolve) queueMicrotask(() => { done(null, bytes); queueMicrotask(() => controller.abort()); }); else done(null, bytes);
      return () => {};
    } },
  };
  const exported: Record<string, unknown> = {};
  new Function('require', 'exports', 'NodeFilter', compiled)((name: string) => dependencies[name] ?? {}, exported, { SHOW_TEXT: 4 });
  const build = exported.buildBatchPdfs;
  if (typeof build !== 'function') throw new Error('BUILD_MISSING');
  const format = (value: BatchPdfDownloadProgress): string => { const formatter = exported.formatBatchPdfProgress; if (typeof formatter !== 'function') throw new Error('FORMAT_MISSING'); const result: unknown = formatter(value); if (typeof result !== 'string') throw new Error('FORMAT_INVALID'); return result; };
  const report = (value: BatchPdfDownloadProgress) => { progress.push(value.page); details.push(value); if (options.abortAfterEstimate && value.estimatedBytes !== undefined) controller.abort(); };
  return { cleanupError, build: (copies = 1) => build(Array.from({ length: copies }, (_, index) => ({ element: root, name: `copy-${index + 1}.pdf` })), 'batch.zip', controller.signal, report), buildWithElement: (element: unknown) => build([{ element, name: 'copy.pdf' }], 'batch.zip', controller.signal, report), element: root, elements, format, details, canvas, counts: () => ({ disposed, encoded, outputs }), fits: () => fits, progress, waiting: () => !!release, release: () => { if (!release) throw new Error('RENDER_NOT_WAITING'); release(); }, requests, imageData, imageCalls, setClock: (value: number) => { clock = value; }, reads: () => reads, cancel: () => controller.abort(), waitingBlob: () => !!releaseBlob, completeBlob: () => { if (!releaseBlob) throw new Error('ENCODER_NOT_WAITING'); releaseBlob(); }, waitingRead: () => !!releaseRead, completeRead: () => { if (!releaseRead) throw new Error('READ_NOT_WAITING'); releaseRead(); } };
}
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });
describe('PDF resource limits and classified failures', () => {
  it.each([0, 1, 3])('fails before creating a frame for renderer capability %s', async capability => {
    const f = fixture({ capability }); const outcome = f.build();
    await expect(outcome).rejects.toBeInstanceOf(ExportTaskFailure);
    await expect(outcome).rejects.toThrow('PDF 绘制组件版本不匹配');
    expect(f.elements).toEqual([]); expect(f.counts()).toEqual({ disposed: 0, encoded: 0, outputs: 0 });
  });
  it('waits for an asynchronous source element before creating a frame', async () => {
    vi.useFakeTimers(); const f = fixture(); let complete: (() => void) | undefined;
    const outcome = f.buildWithElement(() => new Promise(resolve => { complete = () => resolve(f.element); }));
    const observed = outcome.then((value: unknown) => ({ value }), (error: unknown) => ({ error }));
    await vi.advanceTimersByTimeAsync(0);
    expect(f.elements).toEqual([]); expect(f.counts().encoded).toBe(0);
    if (!complete) throw new Error('ELEMENT_NOT_WAITING'); complete();
    await vi.advanceTimersByTimeAsync(0);
    await expect(observed).resolves.toMatchObject({ value: { mimeType: 'application/pdf' } }); expect(f.elements).toEqual([f.element]);
  });
  it.each([false, true])('accepts a %s promised factory result', async promised => {
    const f = fixture(); const outcome = f.buildWithElement(() => promised ? Promise.resolve(f.element) : f.element);
    await expect(outcome).resolves.toMatchObject({ mimeType: 'application/pdf' }); expect(f.elements).toEqual([f.element]);
  });
  it.each(['resolve', 'reject'])('times out the source factory and ignores late %s', async late => {
    vi.useFakeTimers(); const f = fixture(); let complete: (() => void) | undefined;
    const outcome = f.buildWithElement(() => new Promise((resolve, reject) => { complete = () => late === 'resolve' ? resolve(f.element) : reject(new Error('LATE_FACTORY')); }));
    const rejected = expect(outcome).rejects.toThrow('PDF 资源处理超时');
    await vi.advanceTimersByTimeAsync(30001); await rejected;
    if (!complete) throw new Error('ELEMENT_NOT_WAITING'); complete(); await vi.advanceTimersByTimeAsync(0);
    expect(f.elements).toEqual([]); expect(f.progress).toEqual([]); expect(f.counts().encoded).toBe(0);
  });
  it('cancels a pending source factory without creating a frame from its late result', async () => {
    vi.useFakeTimers(); const f = fixture(); let complete: (() => void) | undefined;
    const outcome = f.buildWithElement(() => new Promise(resolve => { complete = () => resolve(f.element); }));
    const rejected = expect(outcome).rejects.toThrow('导出已取消'); await vi.advanceTimersByTimeAsync(0); f.cancel(); await rejected;
    if (!complete) throw new Error('ELEMENT_NOT_WAITING'); complete(); await vi.advanceTimersByTimeAsync(0); expect(f.elements).toEqual([]);
  });
  it('rechecks cancellation after the source promise resolves', async () => {
    const f = fixture(); const outcome = f.buildWithElement(() => new Promise(resolve => queueMicrotask(() => { resolve(f.element); queueMicrotask(() => f.cancel()); })));
    await expect(outcome).rejects.toThrow('导出已取消'); expect(f.elements).toEqual([]); expect(f.counts().encoded).toBe(0);
  });
  it('consumes a rejected factory result even when the factory synchronously cancels', async () => {
    const f = fixture(); const outcome = f.buildWithElement(() => { f.cancel(); return Promise.reject(new Error('FACTORY_AFTER_CANCEL')); });
    await expect(outcome).rejects.toThrow('导出已取消'); expect(f.elements).toEqual([]);
  });
  it.each([false, true])('propagates a %s asynchronous factory failure without a print frame', async asynchronous => {
    const f = fixture(); const error = new Error('UNTRUSTED_FACTORY_DETAIL');
    const outcome = f.buildWithElement(() => { if (asynchronous) return Promise.reject(error); throw error; });
    await expect(outcome).rejects.toBe(error); expect(f.elements).toEqual([]);
  });
  it('starts the existing copy budget after readiness rather than at factory creation', async () => {
    vi.useFakeTimers(); const f = fixture({ blobClock: 50000 }); let complete: (() => void) | undefined;
    const outcome = f.buildWithElement(() => new Promise(resolve => { complete = () => resolve(f.element); }));
    await vi.advanceTimersByTimeAsync(25000); f.setClock(25000);
    if (!complete) throw new Error('ELEMENT_NOT_WAITING'); complete(); await vi.advanceTimersByTimeAsync(0);
    await expect(outcome).resolves.toMatchObject({ mimeType: 'application/pdf' }); expect(f.counts().outputs).toBe(1);
  });
  it.each(['resolve', 'reject'])('expires a source that completes by %s before its overdue timeout callback runs', async completion => {
    const f = fixture();
    const outcome = f.buildWithElement(() => {
      f.setClock(30000);
      return completion === 'resolve' ? Promise.resolve(f.element) : Promise.reject(new Error('LATE_SOURCE_DETAIL'));
    });
    await expect(outcome).rejects.toBeInstanceOf(ExportTaskFailure);
    await expect(outcome).rejects.toThrow('PDF 资源处理超时');
    expect(f.elements).toEqual([]); expect(f.counts()).toEqual({ disposed: 0, encoded: 0, outputs: 0 });
  });
  it.each(['render', 'blob', 'read'] as const)('expires a late %s completion before its timeout callback is dispatched', async boundary => {
    vi.useFakeTimers();
    const f = fixture({ deferredRender: boundary === 'render', ...(boundary === 'render' ? { renderClock: 30000 } : {}), deferredBlob: boundary === 'blob', deferredRead: boundary === 'read' });
    const outcome = f.build(); const observed = outcome.then((value: unknown) => ({ value }), (error: unknown) => ({ error }));
    await vi.advanceTimersByTimeAsync(0);
    expect(boundary === 'render' ? f.waiting() : boundary === 'blob' ? f.waitingBlob() : f.waitingRead()).toBe(true);
    if (boundary !== 'render') f.setClock(30000);
    if (boundary === 'render') f.release(); else if (boundary === 'blob') f.completeBlob(); else f.completeRead();
    await vi.advanceTimersByTimeAsync(0);
    await expect(observed).resolves.toMatchObject({ error: expect.any(ExportTaskFailure) });
    await expect(outcome).rejects.toThrow('PDF 资源处理超时');
    expect(f.counts().outputs).toBe(0); expect(f.canvas.width).toBe(0); expect(f.canvas.height).toBe(0);
    if (boundary === 'blob') expect(f.reads()).toBe(0);
    if (boundary === 'render') expect(f.counts().encoded).toBe(0);
  });
  it('accepts a source just before its deadline and starts the copy budget after readiness', async () => {
    const f = fixture(); const outcome = f.buildWithElement(() => { f.setClock(29999); return f.element; });
    await expect(outcome).resolves.toMatchObject({ mimeType: 'application/pdf' }); expect(f.elements).toEqual([f.element]);
  });
  it.each(['resolve', 'reject'] as const)('observes a renderer that synchronously cancels before returning a %s promise', async completion => {
    const f = fixture({ abortDuringRender: completion });
    await expect(f.build()).rejects.toThrow('导出已取消');
    await Promise.resolve();
    expect(f.reads()).toBe(0); expect(f.imageData).toEqual([]); expect(f.counts().outputs).toBe(0);
    if (completion === 'resolve') { expect(f.canvas.width).toBe(0); expect(f.canvas.height).toBe(0); }
  });
  it('keeps cancellation ahead of an overdue source completion', async () => {
    const f = fixture(); const outcome = f.buildWithElement(() => { f.setClock(30000); f.cancel(); return Promise.resolve(f.element); });
    await expect(outcome).rejects.toThrow('导出已取消'); expect(f.elements).toEqual([]); expect(f.counts().outputs).toBe(0);
  });
  it.each(['render', 'blob', 'read'] as const)('settles a timed-out %s despite throwing cleanup and permits a fresh build', async boundary => {
    vi.useFakeTimers();
    const f = fixture({ deferredRender: boundary === 'render', renderAfterClone: boundary === 'render', deferredBlob: boundary === 'blob', deferredRead: boundary === 'read', cleanupError: boundary === 'render', frameCleanupError: boundary !== 'render' });
    let settled = false; let failure: unknown; let released = false;
    const outcome = f.build();
    const observed = outcome.then((value: unknown) => { settled = true; return { value }; }, (error: unknown) => { settled = true; failure = error; return { error }; });
    const complete = () => { released = true; if (boundary === 'render') f.release(); else if (boundary === 'blob') f.completeBlob(); else f.completeRead(); };
    await vi.advanceTimersByTimeAsync(0);
    expect(boundary === 'render' ? f.waiting() : boundary === 'blob' ? f.waitingBlob() : f.waitingRead()).toBe(true);
    f.setClock(30000); let timerError: unknown;
    try { vi.advanceTimersByTime(30000); } catch (error) { timerError = error; }
    await vi.advanceTimersByTimeAsync(0);
    try {
      expect(timerError).toBeUndefined(); expect(settled).toBe(true);
      expect(failure).toBeInstanceOf(ExportTaskFailure);
      expect(failure).toMatchObject({ message: 'PDF 资源处理超时，请重试。', cause: expect.objectContaining({ errors: expect.arrayContaining([f.cleanupError]) }) });
      expect(f.counts().disposed).toBeGreaterThan(0); expect(f.counts().outputs).toBe(0);
      complete(); await vi.advanceTimersByTimeAsync(0);
      expect(f.canvas.width).toBe(0); expect(f.canvas.height).toBe(0); expect(f.imageData).toEqual([]);
      await expect(observed).resolves.toMatchObject({ error: failure });
      const retry = f.build(); await vi.advanceTimersByTimeAsync(0); complete(); await vi.advanceTimersByTimeAsync(0);
      await expect(retry).resolves.toMatchObject({ mimeType: 'application/pdf' }); expect(f.counts().outputs).toBe(1);
    } finally { if (!released) { complete(); await vi.advanceTimersByTimeAsync(0); } }
  });
  it.each([['timer', false], ['timer', true], ['cancel', false], ['cancel', true]] as const)('preserves %s while both cleanups throw (undefined=%s)', async (ending, undefinedCleanup) => {
    vi.useFakeTimers();
    const f = fixture({ deferredRender: true, renderAfterClone: true, cleanupError: true, frameCleanupError: true, undefinedCleanup });
    const outcome = f.build(); const observed = outcome.then((value: unknown) => ({ value }), (error: unknown) => ({ error }));
    await vi.advanceTimersByTimeAsync(0); expect(f.waiting()).toBe(true); f.setClock(30000);
    if (ending === 'cancel') f.cancel(); else vi.advanceTimersByTime(30000);
    await vi.advanceTimersByTimeAsync(0);
    const result = await observed; expect(result).toHaveProperty('error');
    if (!('error' in result)) throw new Error('EXPECTED_FAILURE');
    const message = ending === 'cancel' ? '导出已取消。' : 'PDF 资源处理超时，请重试。';
    expect(result.error).toMatchObject({ message, cause: expect.objectContaining({ errors: [expect.objectContaining({ message }), expect.objectContaining({ errors: [undefinedCleanup ? undefined : f.cleanupError, f.cleanupError] })] }) });
    expect(result.error instanceof ExportTaskFailure).toBe(ending === 'timer'); expect(f.counts().disposed).toBeGreaterThan(0);
    f.release(); await vi.advanceTimersByTimeAsync(0);
    expect(f.canvas.width).toBe(0); expect(f.canvas.height).toBe(0); expect(f.counts().outputs).toBe(0); expect(f.imageData).toEqual([]);
  });
  it('retains untrusted renderer and cleanup causes without promoting their UI classification', async () => {
    const f = fixture({ renderError: true, cleanupError: true }); const outcome = f.build();
    await expect(outcome).rejects.not.toBeInstanceOf(ExportTaskFailure);
    await expect(outcome).rejects.toMatchObject({ message: 'UNTRUSTED_RENDER_DETAIL', cause: expect.objectContaining({ errors: [expect.objectContaining({ message: 'UNTRUSTED_RENDER_DETAIL' }), f.cleanupError] }) });
    expect(f.counts().disposed).toBeGreaterThan(0); expect(f.counts().outputs).toBe(0);
  });
  it('builds a bounded complete artifact and releases its canvas and frame', async () => {
    const f = fixture(); const file = await f.build();
    expect(file.data).toHaveLength(4); expect(file.mimeType).toBe('application/pdf'); expect(f.fits()).toBe(1);
    expect(f.canvas.width).toBe(0); expect(f.canvas.height).toBe(0); expect(f.counts()).toEqual({ disposed: 1, encoded: 1, outputs: 1 });
  });
  it('classifies the capacity reason for the queue instead of redacting it to an unknown failure', async () => {
    const f = fixture({ limit: 10 });
    await expect(f.build()).rejects.toBeInstanceOf(ExportTaskFailure);
    expect(f.counts().outputs).toBe(0); expect(f.canvas.width).toBe(0); expect(f.counts().disposed).toBe(1);
  });
  it('does not encode or accept a final canvas that completed at the copy deadline', async () => {
    const f = fixture({ lateRender: true });
    await expect(f.build()).rejects.toThrow('单份 PDF 处理超时');
    expect(f.counts()).toEqual({ disposed: 2, encoded: 0, outputs: 0 }); expect(f.canvas.width).toBe(0);
  });
  it('rechecks the deadline after synchronous PDF serialization', async () => {
    const f = fixture({ lateOutput: true });
    await expect(f.build()).rejects.toThrow('单份 PDF 处理超时'); expect(f.counts().outputs).toBe(1); expect(f.counts().disposed).toBe(1);
  });
  it('checks the complete archive as well as its constituent PDFs', async () => {
    const f = fixture({ limit: 100, zipBytes: 101 });
    await expect(f.build(2)).rejects.toBeInstanceOf(ExportTaskFailure); expect(f.counts().outputs).toBe(2);
  });
  it('does not classify arbitrary third-party renderer details as trusted UI messages', async () => {
    const f = fixture({ renderError: true });
    const outcome = f.build(); await expect(outcome).rejects.toThrow('UNTRUSTED_RENDER_DETAIL');
    await expect(outcome).rejects.not.toBeInstanceOf(ExportTaskFailure); expect(f.counts().disposed).toBe(2);
  });
  it('releases a clone-fitting failure without accepting an artifact', async () => {
    const f = fixture({ cloneError: true }); await expect(f.build()).rejects.toThrow('UNTRUSTED_CLONE_DETAIL');
    expect(f.fits()).toBe(1); expect(f.counts()).toEqual({ disposed: 2, encoded: 0, outputs: 0 }); expect(f.progress).toEqual([]);
  });
  it('lets cancellation win after ZIP completion but before artifact delivery', async () => {
    const f = fixture({ abortAfterZipResolve: true }); await expect(f.build(2)).rejects.toThrow('导出已取消'); expect(f.counts().outputs).toBe(2);
  });
  it('invalidates the callback before frame disposal can settle a pending renderer', async () => {
    vi.useFakeTimers(); const f = fixture({ deferredRender: true, releaseDuringDispose: true });
    const rejection = expect(f.build()).rejects.toThrow('PDF 资源处理超时');
    await vi.advanceTimersByTimeAsync(0); expect(f.waiting()).toBe(true);
    await vi.advanceTimersByTimeAsync(30001); await rejection;
    expect(f.fits()).toBe(0); expect(f.progress).toEqual([]); expect(f.counts().outputs).toBe(0);
  });
  it('stops a late onclone after an actual resource timer expired', async () => {
    vi.useFakeTimers(); const f = fixture({ deferredRender: true });
    const outcome = f.build(); const rejection = expect(outcome).rejects.toThrow('PDF 资源处理超时');
    await vi.advanceTimersByTimeAsync(0); expect(f.waiting()).toBe(true);
    await vi.advanceTimersByTimeAsync(30001); await rejection;
    f.release(); await vi.advanceTimersByTimeAsync(0);
    expect(f.fits()).toBe(0); expect(f.progress).toEqual([]); expect(f.counts()).toEqual({ disposed: 2, encoded: 0, outputs: 0 });
  });
  it('estimates only after complete copies and carries the latest measured average forward', async () => {
    const f = fixture({ pdfSizes: [300, 350, 200] }); await f.build(3);
    expect(f.details[0]?.estimatedBytes).toBeUndefined();
    expect(f.details.filter(value => value.estimatedBytes !== undefined).map(value => [value.copy, value.estimatedBytes])).toEqual([[1, 7044], [2, 7044], [2, 7119], [3, 7119]]);
    expect(f.counts().outputs).toBe(3);
  });
  it('never treats an estimated overage as the actual artifact gate', async () => {
    const f = fixture({ pdfSizes: [300, 350, 200] }); const file = await f.build(3);
    expect(f.details.some(value => (value.estimatedBytes ?? 0) > 1000)).toBe(true); expect(file.data).toHaveLength(12); expect(f.counts().outputs).toBe(3);
  });
  it('lets explicit cancellation at the first estimate stop all remaining copies', async () => {
    const f = fixture({ abortAfterEstimate: true }); await expect(f.build(3)).rejects.toThrow('导出已取消'); expect(f.counts()).toEqual({ disposed: 1, encoded: 1, outputs: 1 });
  });
  it('does not emit estimates for single-file exports', async () => {
    const f = fixture(); await f.build(); expect(f.details).toHaveLength(1); expect(f.details[0]?.estimatedBytes).toBeUndefined();
  });
  it('keeps ordinary progress compact and does not invent a capacity measurement', () => {
    const f = fixture({ limit: 128 * 1024 * 1024 }); const base = { copy: 1, copies: 2, page: 1, pages: 27 };
    for (const estimatedBytes of [undefined, NaN, -1, 40 * 1024 * 1024]) expect(f.format({ ...base, ...(estimatedBytes === undefined ? {} : { estimatedBytes }) })).toBe('生成第 1 / 2 份 · 第 1 / 27 页');
  });
  it('warns near the byte budget and distinguishes a projected overage from an actual failure', () => {
    const f = fixture({ limit: 128 * 1024 * 1024 }); const base = { copy: 1, copies: 20, page: 27, pages: 27 };
    expect(f.format({ ...base, estimatedBytes: 120 * 1024 * 1024 })).toContain('预计约 120.0 MiB，接近 128 MiB 上限');
    expect(f.format({ ...base, estimatedBytes: 140 * 1024 * 1024 })).toContain('预计约 140.0 MiB，可能超过 128 MiB 上限');
  });
  it('uses asynchronous JPEG encoding at the original quality and passes bytes instead of a data URI', async () => {
    const f = fixture(); await f.build();
    expect(f.requests).toEqual([['image/jpeg', .94]]);
    const bytes = new Uint8Array([17, 54, 91]);
    expect(f.imageData).toEqual([bytes]); expect(f.imageData[0]).toBeInstanceOf(Uint8Array);
    expect(f.imageCalls).toEqual([[bytes, 'JPEG', 16, 16, 178, 263 / (25.4 / 96) * 178 / 674, 'page-1', 'FAST']]);
    expect(f.reads()).toBe(1); expect(f.canvas.width).toBe(0);
  });
  it.each([{ nullBlob: true }, { blobSize: 0 }, { mimeType: 'image/png' }])('fails closed for an unusable encoded JPEG %j', async options => {
    const f = fixture(options); await expect(f.build()).rejects.toBeInstanceOf(ExportTaskFailure);
    expect(f.reads()).toBe(0); expect(f.imageData).toEqual([]); expect(f.counts().outputs).toBe(0); expect(f.canvas.width).toBe(0);
  });
  it.each([{ blobError: true }, { readError: true }])('releases untrusted encoding errors without classifying their details %j', async options => {
    const f = fixture(options); const outcome = f.build();
    await expect(outcome).rejects.not.toBeInstanceOf(ExportTaskFailure);
    expect(f.counts().outputs).toBe(0); expect(f.imageData).toEqual([]); expect(f.canvas.width).toBe(0);
  });
  it.each([false, true])('lets cancellation dispose a pending encoder and ignores its late callback (null=%s)', async nullBlob => {
    vi.useFakeTimers(); const f = fixture({ deferredBlob: true, nullBlob });
    const rejection = expect(f.build()).rejects.toThrow('导出已取消');
    await vi.advanceTimersByTimeAsync(0); expect(f.waitingBlob()).toBe(true);
    f.cancel(); await rejection; expect(f.canvas.width).toBe(0);
    f.completeBlob(); await vi.advanceTimersByTimeAsync(0);
    expect(f.reads()).toBe(0); expect(f.imageData).toEqual([]); expect(f.counts().outputs).toBe(0);
  });
  it.each([false, true])('times out a pending encoder and ignores its late callback (null=%s)', async nullBlob => {
    vi.useFakeTimers(); const f = fixture({ deferredBlob: true, nullBlob });
    const rejection = expect(f.build()).rejects.toThrow('PDF 资源处理超时');
    await vi.advanceTimersByTimeAsync(0); expect(f.waitingBlob()).toBe(true);
    await vi.advanceTimersByTimeAsync(30001); await rejection;
    f.completeBlob(); await vi.advanceTimersByTimeAsync(0);
    expect(f.reads()).toBe(0); expect(f.canvas.width).toBe(0); expect(f.counts().outputs).toBe(0);
  });
  it('rechecks the copy deadline before reading a late encoded image', async () => {
    const f = fixture({ lateBlob: true }); await expect(f.build()).rejects.toThrow('单份 PDF 处理超时');
    expect(f.reads()).toBe(0); expect(f.imageData).toEqual([]); expect(f.canvas.width).toBe(0);
  });
  it('cancels a pending byte read without accepting its late result', async () => {
    vi.useFakeTimers(); const f = fixture({ deferredRead: true });
    const rejection = expect(f.build()).rejects.toThrow('导出已取消');
    await vi.advanceTimersByTimeAsync(0); expect(f.waitingRead()).toBe(true);
    f.cancel(); await rejection; f.completeRead(); await vi.advanceTimersByTimeAsync(0);
    expect(f.imageData).toEqual([]); expect(f.counts().outputs).toBe(0); expect(f.canvas.width).toBe(0);
  });
  it('rechecks cancellation after bytes resolve but before adding an image', async () => {
    const f = fixture({ abortAfterRead: true }); await expect(f.build()).rejects.toThrow('导出已取消');
    expect(f.imageData).toEqual([]); expect(f.counts().outputs).toBe(0); expect(f.canvas.width).toBe(0);
  });
  it('rechecks the copy deadline after reading encoded bytes', async () => {
    const f = fixture({ lateRead: true }); await expect(f.build()).rejects.toThrow('单份 PDF 处理超时');
    expect(f.imageData).toEqual([]); expect(f.counts().outputs).toBe(0); expect(f.canvas.width).toBe(0);
  });
  it('preserves the previous data-URI capacity boundary before reading encoded bytes', async () => {
    for (const size of [1, 2, 3, 4, 5, 6, 100]) {
      const accounted = Math.ceil((23 + 4 * Math.ceil(size / 3)) * .75);
      const below = fixture({ blobSize: size, limit: accounted - 1 });
      await expect(below.build()).rejects.toBeInstanceOf(ExportTaskFailure); expect(below.reads()).toBe(0);
      const exact = fixture({ blobSize: size, limit: accounted }); await exact.build(); expect(exact.reads()).toBe(1);
    }
  });
  it('rechecks cancellation after the encoding callback resolves but before byte reading', async () => {
    const f = fixture({ abortAfterBlob: true }); await expect(f.build()).rejects.toThrow('导出已取消');
    expect(f.reads()).toBe(0); expect(f.imageData).toEqual([]); expect(f.canvas.width).toBe(0);
  });
  it('times out a pending byte read and ignores its late result', async () => {
    vi.useFakeTimers(); const f = fixture({ deferredRead: true });
    const rejection = expect(f.build()).rejects.toThrow('PDF 资源处理超时');
    await vi.advanceTimersByTimeAsync(0); expect(f.waitingRead()).toBe(true);
    await vi.advanceTimersByTimeAsync(30001); await rejection;
    f.completeRead(); await vi.advanceTimersByTimeAsync(0);
    expect(f.imageData).toEqual([]); expect(f.counts().outputs).toBe(0); expect(f.canvas.width).toBe(0);
  });
  it('bounds a pending byte read by the remaining copy deadline', async () => {
    vi.useFakeTimers(); const f = fixture({ deferredRender: true, deferredRead: true, blobClock: 45000 });
    const rejection = expect(f.build()).rejects.toThrow('单份 PDF 处理超时');
    await vi.advanceTimersByTimeAsync(0); expect(f.waiting()).toBe(true);
    f.setClock(20000); f.release(); await vi.advanceTimersByTimeAsync(0); expect(f.waitingRead()).toBe(true);
    f.setClock(60000); await vi.advanceTimersByTimeAsync(15001); await rejection;
    f.completeRead(); await vi.advanceTimersByTimeAsync(0);
    expect(f.imageData).toEqual([]); expect(f.counts().outputs).toBe(0); expect(f.canvas.width).toBe(0);
  });
});
