import type { Page } from '@playwright/test';

export type PdfCodecPhase = 'blob' | 'bytes';
interface CellState {
  phase: PdfCodecPhase; nativeReturned: boolean; nativeReady: boolean; held: boolean; released: boolean; expired: boolean;
  cancelClicked: boolean; readyAtCancel: boolean | null; abortsAtCancel: number | null;
  blob: { type: string; bytes: number } | null; byteLength: number | null; readStarts: number; canvas: [number, number];
}
export interface PdfCodecSnapshot {
  encodes: number; aborts: number; events: Array<{ name: string; at: number; [key: string]: unknown }>;
  liveEncodedCanvases: Array<[number, number]>;
  frames: Array<{ owner: string | null; title: string; connected: boolean }>;
  filePutAttempts: string[]; recordWrites: Array<{ id: string; status: string }>;
  artifactUrls: Array<{ url: string; type: string; bytes: number; revoked: boolean }>;
  cells: Record<string, CellState>;
}
interface PdfCodecProbe {
  state(): PdfCodecSnapshot;
  arm(tag: string, phase: PdfCodecPhase, autoCancel: boolean): void;
  release(tag: string): void;
  quiet(): Promise<{ before: PdfCodecSnapshot; after: PdfCodecSnapshot; observationMs: number }>;
  restore(): void;
}
declare global { interface Window { __pdfCodecProbe: PdfCodecProbe } }

// Keep browser dependencies inside this function so the native replay can use the identical probe.
export function browserPdfCodecProbe() {
  interface Cell extends Omit<CellState, 'canvas'> {
    tag: string; canvas: HTMLCanvasElement; release: (() => void) | null; timer: number | undefined;
  }
  const nativeBlob = HTMLCanvasElement.prototype.toBlob, nativeCreate = Document.prototype.createElement, nativeAbort = AbortController.prototype.abort;
  const nativePut = IDBObjectStore.prototype.put, nativeUrl = URL.createObjectURL, nativeRevoke = URL.revokeObjectURL;
  const filePutAttempts: string[] = [], recordWrites: PdfCodecSnapshot['recordWrites'] = [], artifactUrls: PdfCodecSnapshot['artifactUrls'] = [];
  const timeout = window.setTimeout.bind(window);
  const cells = new Map<string, Cell>(), canvases = new Set<HTMLCanvasElement>();
  const frames: Array<{ owner: string | null; frame: HTMLIFrameElement }> = [], events: PdfCodecSnapshot['events'] = [];
  let arm: { tag: string; phase: PdfCodecPhase; autoCancel: boolean } | null = null, owner: string | null = null, encodes = 0, aborts = 0;
  const record = (name: string, detail: Record<string, unknown> = {}) => { events.push({ name, at: performance.now(), ...detail }); if (events.length > 180) events.shift(); };
  const snapshot = (): PdfCodecSnapshot => ({
    encodes, aborts, events: [...events], filePutAttempts: [...filePutAttempts], recordWrites: [...recordWrites], artifactUrls: artifactUrls.map(value => ({ ...value })),
    liveEncodedCanvases: [...canvases].filter(canvas => canvas.width * canvas.height > 0).map((canvas): [number, number] => [canvas.width, canvas.height]),
    frames: frames.map(item => ({ owner: item.owner, title: item.frame.title, connected: item.frame.isConnected })),
    cells: Object.fromEntries([...cells].map(([tag, cell]): [string, CellState] => [tag, {
      phase: cell.phase, nativeReturned: cell.nativeReturned, nativeReady: cell.nativeReady, held: cell.held, released: cell.released, expired: cell.expired,
      cancelClicked: cell.cancelClicked, readyAtCancel: cell.readyAtCancel, abortsAtCancel: cell.abortsAtCancel,
      blob: cell.blob, byteLength: cell.byteLength, readStarts: cell.readStarts, canvas: [cell.canvas.width, cell.canvas.height],
    }])),
  });
  const cancel = (cell: Cell) => {
    // The resource wait is installed before this microtask; do not introduce synchronous API re-entry.
    queueMicrotask(() => {
      const control = [...document.querySelectorAll('button,[role="button"]')].find(node => node.getAttribute('aria-label') === '取消导出' || node.textContent?.trim() === '取消导出');
      if (!(control instanceof HTMLElement) || control.getAttribute('aria-disabled') === 'true') throw new Error('CANCEL_CONTROL_MISSING');
      cell.readyAtCancel = cell.nativeReady; cell.cancelClicked = true; record('public-cancel-click', { tag: cell.tag, ready: cell.nativeReady });
      control.click(); cell.abortsAtCancel = aborts;
    });
  };
  const hold = (cell: Cell, deliver: () => void) => {
    cell.held = true; record('native-result-held', { tag: cell.tag, phase: cell.phase });
    cell.release = () => {
      if (!cell.held) throw new Error('RESULT_NOT_HELD');
      clearTimeout(cell.timer); cell.held = false; cell.released = true; cell.release = null;
      record('result-delivered', { tag: cell.tag }); deliver();
    };
    cell.timer = timeout(() => { cell.expired = true; record('gate-expired', { tag: cell.tag }); cell.release?.(); }, 20000);
  };
  AbortController.prototype.abort = new Proxy(nativeAbort, { apply(target, receiver, args) { aborts++; record('controller-abort'); return Reflect.apply(target, receiver, args); } });
  IDBObjectStore.prototype.put = new Proxy(nativePut, { apply(target, receiver, args) {
    if (receiver instanceof IDBObjectStore && receiver.transaction.db.name === 'solveflow-exports') {
      const value: unknown = args[0];
      if (receiver.name === 'files') filePutAttempts.push(String(args[1]));
      if (receiver.name === 'records' && value && typeof value === 'object' && 'id' in value && typeof value.id === 'string' && 'status' in value && typeof value.status === 'string') recordWrites.push({ id: value.id, status: value.status });
    }
    return Reflect.apply(target, receiver, args);
  } });
  URL.createObjectURL = new Proxy(nativeUrl, { apply(target, receiver, args) {
    const url: string = Reflect.apply(target, receiver, args); const blob: unknown = args[0];
    if (blob instanceof Blob && ['application/pdf', 'application/zip'].includes(blob.type)) artifactUrls.push({ url, type: blob.type, bytes: blob.size, revoked: false });
    return url;
  } });
  URL.revokeObjectURL = new Proxy(nativeRevoke, { apply(target, receiver, args) { for (const value of artifactUrls) if (value.url === args[0]) value.revoked = true; return Reflect.apply(target, receiver, args); } });
  Document.prototype.createElement = new Proxy(nativeCreate, { apply(target, receiver, args) {
    const element = Reflect.apply(target, receiver, args);
    if (element instanceof HTMLIFrameElement) frames.push({ owner, frame: element });
    return element;
  } });
  HTMLCanvasElement.prototype.toBlob = new Proxy(nativeBlob, { apply(target, receiver, args) {
    if (args[1] !== 'image/jpeg') return Reflect.apply(target, receiver, args);
    if (!(receiver instanceof HTMLCanvasElement)) throw new Error('ENCODER_CANVAS_MISSING');
    encodes++; canvases.add(receiver);
    if (!arm) return Reflect.apply(target, receiver, args);
    const request = arm; arm = null;
    const cell: Cell = { tag: request.tag, phase: request.phase, nativeReturned: false, nativeReady: false, held: false, released: false, expired: false,
      cancelClicked: false, readyAtCancel: null, abortsAtCancel: null, blob: null, byteLength: null, readStarts: 0, canvas: receiver, release: null, timer: undefined };
    cells.set(cell.tag, cell); record('native-encoder-called', { tag: cell.tag, width: receiver.width, height: receiver.height, quality: args[2] });
    const callback: unknown = args[0]; if (typeof callback !== 'function') throw new Error('ENCODER_CALLBACK_MISSING');
    const result = Reflect.apply(target, receiver, [(blob: Blob | null) => {
      if (!blob) { record('null-native-blob', { tag: cell.tag }); Reflect.apply(callback, undefined, [blob]); return; }
      cell.blob = { type: blob.type, bytes: blob.size };
      const read = blob.arrayBuffer.bind(blob);
      Object.defineProperty(blob, 'arrayBuffer', { configurable: true, value: () => {
        cell.readStarts++; record('native-byte-read-called', { tag: cell.tag }); const native = read();
        if (cell.phase !== 'bytes') return native;
        if (request.autoCancel) cancel(cell);
        return new Promise<ArrayBuffer>((resolve, reject) => { void native.then(bytes => {
          cell.nativeReady = true; cell.byteLength = bytes.byteLength; record('native-byte-read-finished', { tag: cell.tag });
          hold(cell, () => resolve(bytes));
        }, reject); });
      } });
      record('native-encoder-finished', { tag: cell.tag, bytes: blob.size });
      if (cell.phase === 'blob') { cell.nativeReady = true; hold(cell, () => Reflect.apply(callback, undefined, [blob])); }
      else Reflect.apply(callback, undefined, [blob]);
    }, ...args.slice(1)]);
    cell.nativeReturned = true; if (cell.phase === 'blob' && request.autoCancel) cancel(cell); return result;
  } });
  window.__pdfCodecProbe = {
    state: snapshot,
    arm(tag, phase, autoCancel) { if (arm || cells.has(tag) || !['blob', 'bytes'].includes(phase)) throw new Error('INVALID_ARM'); arm = { tag, phase, autoCancel }; owner = tag; record('armed', { tag, phase, autoCancel }); },
    release(tag) { const cell = cells.get(tag); if (!cell?.release) throw new Error('RESULT_NOT_READY'); cell.release(); },
    async quiet() { const before = snapshot(); await new Promise<void>(resolve => timeout(resolve, 400)); return { before, after: snapshot(), observationMs: 400 }; },
    restore() {
      for (const cell of cells.values()) clearTimeout(cell.timer);
      HTMLCanvasElement.prototype.toBlob = nativeBlob; Document.prototype.createElement = nativeCreate; AbortController.prototype.abort = nativeAbort;
      IDBObjectStore.prototype.put = nativePut; URL.createObjectURL = nativeUrl; URL.revokeObjectURL = nativeRevoke;
      cells.clear(); canvases.clear(); frames.length = 0;
    },
  };
}
export async function installPdfCodecProbe(page: Page) { await page.evaluate(browserPdfCodecProbe); }
