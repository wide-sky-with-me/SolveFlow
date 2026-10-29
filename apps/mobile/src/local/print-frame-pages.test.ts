import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { describe, expect, it, vi } from 'vitest';
import { ExportTaskFailure } from '@solveflow/client/local';

const source = readFileSync(new URL('./print-batch.web.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
interface Trace {
  created: Node[];
  adopted: { node: Node; from: FakeDocument; to: FakeDocument }[];
  appended: { parent: Node; node: Node }[];
  decoded: { image: FakeImage; owner: FakeDocument; connected: boolean }[];
  onAppend?: (parent: Node, node: Node) => void;
}
class Node {
  parent: Node | null = null;
  children: Node[] = [];
  style: Record<string, string> = {};
  dataset: Record<string, string> = {};
  title = ''; href = ''; open = false;
  source: Node | null = null;
  readonly createdBy: FakeDocument;
  constructor(public tag: string, public ownerDocument: FakeDocument, public label = '', public kind = '') { this.createdBy = ownerDocument; ownerDocument.trace.created.push(this); }
  get parentElement(): Node | null { return this.parent; }
  get childNodes(): Node[] { return this.children; }
  get firstChild(): Node | null { return this.children[0] ?? null; }
  get isConnected(): boolean { return this === this.ownerDocument.body || this === this.ownerDocument.head || (this.parent?.isConnected ?? false); }
  private adopt(doc: FakeDocument) {
    if (this.ownerDocument !== doc) { doc.trace.adopted.push({ node: this, from: this.ownerDocument, to: doc }); this.ownerDocument = doc; }
    for (const child of this.children) child.adopt(doc);
  }
  append(...nodes: Node[]) {
    for (const node of nodes) {
      if (node.tag === 'fragment') { this.append(...node.children.slice()); continue; }
      node.adopt(this.ownerDocument);
      node.remove(); node.parent = this; this.children.push(node); this.ownerDocument.trace.appended.push({ parent: this, node }); this.ownerDocument.trace.onAppend?.(this, node);
    }
  }
  remove() { if (this.parent) { this.parent.children.splice(this.parent.children.indexOf(this), 1); this.parent = null; } }
  replaceChildren(...nodes: Node[]) { for (const node of this.children.slice()) node.remove(); this.append(...nodes); }
  protected copyTo<T extends Node>(clone: T, deep: boolean): T {
    clone.source = this; clone.style = { ...this.style }; clone.dataset = { ...this.dataset }; clone.open = this.open; clone.href = this.href; clone.title = this.title;
    if (deep) clone.append(...this.children.map(child => child.cloneNode(true)));
    return clone;
  }
  cloneNode(deep: boolean): Node { return this.copyTo(new Node(this.tag, this.ownerDocument, this.label, this.kind), deep); }
  matches(selector: string) {
    if (selector === '.print-copy-document') return this.kind === 'copy';
    if (selector === '.print-copy-question.print-question-page' || selector === '[data-pdf-question].print-copy-question.print-question-page') return this.kind === 'question';
    return false;
  }
  querySelectorAll(selector: string): Node[] {
    return this.children.flatMap(child => [...((selector === '[data-pdf-question]' && child.kind === 'question') || selector === child.tag ? [child] : []), ...child.querySelectorAll(selector)]);
  }
}
class Link extends Node {
  onload?: () => void; onerror?: () => void;
  override cloneNode(deep: boolean): Link { return this.copyTo(new Link(this.tag, this.ownerDocument, this.label, this.kind), deep); }
}
class FakeImage extends Node {
  readonly decode = vi.fn(() => { this.ownerDocument.trace.decoded.push({ image: this, owner: this.ownerDocument, connected: this.isConnected }); return this.control.promise; });
  constructor(doc: FakeDocument, label: string, public readonly control = deferred()) { super('img', doc, label); }
  override cloneNode(deep: boolean): FakeImage { return this.copyTo(new FakeImage(this.ownerDocument, this.label, this.control), deep); }
}
class FakeDocument {
  readonly body: Node;
  readonly head: Node;
  readonly fonts = Object.assign(new Set<{ status: string }>(), { ready: Promise.resolve() });
  readonly injectedImages: { decode: () => Promise<void> }[] = [];
  readonly styles: Node[] = [];
  title = ''; baseURI = 'http://fixture.test/';
  open() {}
  write(declaration: string) { if (declaration !== '<!doctype html>') throw new Error('UNTRUSTED_DOCUMENT_MARKUP'); }
  close() {}
  constructor(readonly name: 'host' | 'frame', readonly trace: Trace) { this.body = new Node('body', this); this.head = new Node('head', this); }
  get images(): { decode: () => Promise<void> }[] { return [...[...this.head.querySelectorAll('img'), ...this.body.querySelectorAll('img')].filter((node): node is FakeImage => node instanceof FakeImage), ...this.injectedImages]; }
  createElement(tag: string): Node { return tag === 'img' ? new FakeImage(this, '') : new Node(tag, this); }
  createDocumentFragment() { return new Node('fragment', this); }
  querySelectorAll(selector: string) { return selector === 'style,link[rel="stylesheet"]' ? this.styles : [...this.head.querySelectorAll(selector), ...this.body.querySelectorAll(selector)]; }
}
interface FrameResult { content: Node; doc: object; dispose: () => void; activateQuestionPage?: (index: number) => Promise<void> }
interface FrameFactory { (element: Node, title: string, signal: AbortSignal, options?: { questionPages?: boolean; lifetimeMs?: number }): Promise<FrameResult> }
function deferred() { let resolve = () => {}; let reject = (_error: Error) => {}; const promise = new Promise<void>((done, fail) => { resolve = done; reject = fail; }); return { promise, resolve, reject }; }
function fixture() {
  const signal = new AbortController(); const trace: Trace = { created: [], adopted: [], appended: [], decoded: [] };
  const document = new FakeDocument('host', trace); const doc = new FakeDocument('frame', trace); document.title = 'app-title';
  const clock = { now: 0 }; class ClockDate extends Date { static override now() { return clock.now; } }
  const hooks: { resourceSettled?: () => void; disposeFrame?: () => void } = {}; const timers = new Map<ReturnType<typeof setTimeout>, number>();
  const schedule = (callback: () => void, delay: number) => { const id = setTimeout(callback, delay); timers.set(id, delay); if (delay === 120000) hooks.disposeFrame = callback; return id; };
  const cancel = (id: ReturnType<typeof setTimeout>) => { const delay = timers.get(id); timers.delete(id); clearTimeout(id); if (delay === 20000) { const hook = hooks.resourceSettled; delete hooks.resourceSettled; hook?.(); } };
  const target = { addEventListener: vi.fn(), focus: vi.fn(), print: vi.fn() };
  const iframe = Object.assign(new Node('iframe', document), { contentDocument: doc, contentWindow: target });
  const createElement = document.createElement.bind(document); document.createElement = tag => tag === 'iframe' ? iframe : createElement(tag);
  const input = new Node('main', document, '', 'copy');
  for (let index = 0; index < 3; index++) {
    const page = new Node('article', document, String(index), 'question'); page.dataset.pdfQuestion = String(index + 1);
    page.append(new Node('h2', document, `heading-${index}`), new Node('section', document, `body-${index}`), new Node('footer', document, `${index + 1}/3`), new Node('details', document));
    input.append(page);
  }
  document.body.append(input);
  const fits: string[][] = []; const fitPages: Node[] = []; const math = vi.fn();
  const single = (page: Node) => { fitPages.push(page); fits.push([page.dataset.pdfQuestion ?? '', ...page.children.map(node => node.label)]); };
  const dependencies: Record<string, object> = { '@solveflow/client/local': { ExportTaskFailure }, '@solveflow/contracts/local': { MAX_BATCH_PRINT_PAGES: 300 }, './paginate-question-pages.web': { paginateQuestionPage: (page: Node) => { single(page); return [page]; } } };
  // Replace the local math implementation only; frame ownership and resource waits stay real.
  const executable = compiled.replace(/function fitBatchPrintMath\(doc\) \{[\s\S]*?\n\}/, 'function fitBatchPrintMath(doc) { math(doc); }');
  if (executable === compiled) throw new Error('MATH_ADAPTER_NOT_REPLACED');
  const exports: unknown = new Function('require', 'exports', 'document', 'HTMLElement', 'HTMLLinkElement', 'math', 'Date', 'setTimeout', 'clearTimeout', `${executable}\nreturn exports;`)((name: string) => dependencies[name] ?? {}, {}, document, Node, Link, math, ClockDate, schedule, cancel);
  if (typeof exports !== 'object' || exports === null || !('createBatchPrintFrame' in exports) || typeof exports.createBatchPrintFrame !== 'function' || !('openBatchPrint' in exports) || typeof exports.openBatchPrint !== 'function') throw new Error('FRAME_FACTORY_MISSING');
  const create = exports.createBatchPrintFrame as FrameFactory;
  const print = exports.openBatchPrint as (element: Node, title: string, signal: AbortSignal) => Promise<() => void>;
  return { input, doc, host: document, iframe, signal, trace, fits, fitPages, math, clock, hooks, target, styles: document.styles, timers, frame: (sparse = true, lifetimeMs?: number) => create(input, 'copy.pdf', signal.signal, { questionPages: sparse, ...(lifetimeMs === undefined ? {} : { lifetimeMs }) }), print: () => print(input, 'copy.pdf', signal.signal), connected: () => document.body.children.filter(node => node !== input).length };
}
function activate(frame: FrameResult, index: number) { if (!frame.activateQuestionPage) throw new Error('PAGE_ACTIVATION_MISSING'); return frame.activateQuestionPage(index); }
function tree(node: Node): Node[] { return [node, ...node.children.flatMap(tree)]; }
function cloneOf(f: ReturnType<typeof fixture>, source: Node) { const clone = f.trace.created.find(node => node.source === source); if (!clone) throw new Error('SNAPSHOT_NODE_MISSING'); return clone; }
function pageImages(f: ReturnType<typeof fixture>) {
  return f.input.children.map((page, index) => {
    const body = page.children[1]; if (!body) throw new Error('SOURCE_BODY_MISSING');
    const figure = new Node('figure', f.host, `figure-${index}`); const image = new FakeImage(f.host, `image-${index}`); figure.append(image); body.append(figure); return image;
  });
}
async function flushResources() { for (let turn = 0; turn < 8; turn++) await Promise.resolve(); }

describe('question print-frame materialization', () => {
  it('models native fragment expansion, descendant adoption and independent image clones', async () => {
    const f = fixture(); const image = new FakeImage(f.host, 'model-image'); const section = new Node('section', f.host); section.append(image);
    const heading = new Node('h2', f.host); const footer = new Node('footer', f.host); const fragment = f.host.createDocumentFragment(); fragment.append(heading, section, footer);
    const clone = section.cloneNode(true); const copied = clone.children[0]; if (!(copied instanceof FakeImage)) throw new Error('IMAGE_CLONE_MISSING');
    expect(clone.ownerDocument).toBe(f.host); expect(copied.ownerDocument).toBe(f.host); expect(copied).not.toBe(image); expect(copied.source).toBe(image); expect(copied.control).toBe(image.control); expect(f.doc.images).toEqual([]);
    f.doc.body.append(fragment); expect(fragment.children).toEqual([]); expect(f.doc.body.children).toEqual([heading, section, footer]); expect(f.doc.images).toEqual([image]);
    expect(fragment.ownerDocument).toBe(f.host); expect(f.trace.adopted.some(event => event.node === fragment)).toBe(false);
    for (const node of [heading, section, image, footer]) { expect(node.createdBy).toBe(f.host); expect(node.ownerDocument).toBe(f.doc); expect(f.trace.adopted.filter(event => event.node === node)).toHaveLength(1); }
    f.doc.body.append(clone); expect(f.doc.images).toEqual([image, copied]); const decoding = copied.decode(); expect(image.decode).not.toHaveBeenCalled();
    expect(f.trace.decoded).toEqual([{ image: copied, owner: f.doc, connected: true }]); image.control.resolve(); await decoding;
    clone.remove(); expect(f.doc.images).toEqual([image]); expect(copied.ownerDocument).toBe(f.doc); expect(copied.isConnected).toBe(false);
  });
  it('keeps future frozen bodies in the host document until their stable shell is activated', async () => {
    const f = fixture(); const images = pageImages(f); for (const image of images) image.control.resolve(); const originals = f.input.children.map(page => page.children.slice()); const frame = await f.frame();
    try {
      const shells = frame.content.children.slice(); const bodies = originals.map(nodes => nodes.map(node => cloneOf(f, node))); const fragments = f.trace.created.filter(node => node.tag === 'fragment');
      const snapshots = bodies.map(nodes => nodes.flatMap(tree)); const cloneCount = f.trace.created.filter(node => node.source !== null).length;
      expect(frame.content).toBe(cloneOf(f, f.input)); expect(frame.content.ownerDocument).toBe(f.doc); expect(fragments).toHaveLength(3);
      expect(fragments.map(fragment => fragment.createdBy.name)).toEqual(['host', 'host', 'host']);
      for (let index = 0; index < shells.length; index++) {
        const shell = shells[index]; const original = f.input.children[index]; if (!shell || !original) throw new Error('QUESTION_SHELL_MISSING');
        expect(shell).toBe(cloneOf(f, original)); expect(shell.createdBy).toBe(f.host); expect(shell.ownerDocument).toBe(f.doc);
        for (const node of snapshots[index] ?? []) { expect(node.createdBy).toBe(f.host); expect(node.ownerDocument).toBe(index === 0 ? f.doc : f.host); expect(f.trace.adopted.filter(event => event.node === node && event.to === f.doc)).toHaveLength(index === 0 ? 1 : 0); }
        if (index > 0) { expect(fragments[index]?.ownerDocument).toBe(f.host); expect(fragments[index]?.children).toEqual(bodies[index]); }
      }
      for (let index = 0; index < shells.length; index++) {
        if (index > 0) await activate(frame, index);
        for (let page = 0; page < shells.length; page++) {
          expect(frame.content.children[page]).toBe(shells[page]); expect(shells[page]?.children).toHaveLength(page === index ? 4 : 0);
          if (page === index) for (const [offset, node] of (bodies[page] ?? []).entries()) expect(shells[page]?.children[offset]).toBe(node);
          for (const node of snapshots[page] ?? []) { expect(node.ownerDocument).toBe(page <= index ? f.doc : f.host); expect(f.trace.adopted.filter(event => event.node === node && event.to === f.doc)).toHaveLength(page <= index ? 1 : 0); }
        }
        expect(f.fitPages[index]).toBe(shells[index]); expect(f.trace.created.filter(node => node.source !== null)).toHaveLength(cloneCount);
      }
      for (const node of tree(f.input)) expect(node.ownerDocument).toBe(f.host);
      expect(f.host.images).toEqual(images); expect(f.input.children.map(page => page.children.length)).toEqual([4, 4, 4]); expect(f.fits.map(row => row[0])).toEqual(['1', '2', '3']);
    } finally { frame.dispose(); }
    expect(f.connected()).toBe(0); expect(f.timers.size).toBe(0);
  });
  it('decodes only the connected image clone on the first and subsequent pages', async () => {
    const f = fixture(); const images = pageImages(f); const first = images[0]; const second = images[1]; const third = images[2]; if (!first || !second || !third) throw new Error('SOURCE_IMAGES_MISSING');
    let frame: FrameResult | undefined; const pending = f.frame(); void pending.catch(() => {});
    try {
      await flushResources(); expect(f.trace.decoded.map(event => event.image.label)).toEqual(['image-0']); expect(f.fits).toHaveLength(0); expect(f.doc.images).toEqual([cloneOf(f, first)]);
      first.control.resolve(); frame = await pending; const loading = activate(frame, 1); void loading.catch(() => {}); await flushResources();
      expect(f.doc.images).toEqual([cloneOf(f, second)]); expect(f.trace.decoded.map(event => event.image.label)).toEqual(['image-0', 'image-1']); expect(f.fits).toHaveLength(1);
      // No decode observation implies no claim about network requests for detached images.
      third.control.resolve(); await flushResources(); expect(f.fits).toHaveLength(1); second.control.resolve(); await loading; await activate(frame, 2);
      expect(f.doc.images).toEqual([cloneOf(f, third)]); expect(f.trace.decoded.map(event => event.image.label)).toEqual(['image-0', 'image-1', 'image-2']); expect(f.fits.map(row => row[0])).toEqual(['1', '2', '3']);
      expect(f.host.images).toEqual(images);
      for (const [index, image] of images.entries()) { expect(image.decode).not.toHaveBeenCalled(); const event = f.trace.decoded[index]; expect(event?.image).toBe(cloneOf(f, image)); expect(event?.owner).toBe(f.doc); expect(event?.connected).toBe(true); }
    } finally { frame?.dispose(); f.signal.abort(); }
  });
  it('decodes every connected clone for ordinary whole-document printing', async () => {
    const f = fixture(); const images = pageImages(f); for (const image of images) image.control.resolve(); const frame = await f.frame(false);
    try {
      expect(frame.activateQuestionPage).toBeUndefined(); expect(f.trace.decoded.map(event => event.image.label)).toEqual(['image-0', 'image-1', 'image-2']); expect(f.fits).toHaveLength(3);
      for (const event of f.trace.decoded) { expect(event.owner).toBe(f.doc); expect(event.connected).toBe(true); expect(event.image.source).not.toBeNull(); }
      for (const image of images) expect(image.decode).not.toHaveBeenCalled();
    } finally { frame.dispose(); }
  });
  it('keeps whole-document math fitting for original reading records without question sheets', async () => {
    const f = fixture(); f.input.kind = 'reading'; f.input.replaceChildren(new Node('section', f.host, 'original-record'));
    const frame = await f.frame(false);
    try { expect(f.math).toHaveBeenCalledOnce(); expect(f.fitPages).toEqual([]); expect(frame.activateQuestionPage).toBeUndefined(); }
    finally { frame.dispose(); }
  });
  it.each(['pending', 'error'])('does not let %s host fonts control frame resources', async status => {
    const f = fixture(); const images = pageImages(f); for (const image of images) image.control.resolve(); const hostFont = deferred();
    if (status === 'pending') f.host.fonts.ready = hostFont.promise; else f.host.fonts.add({ status: 'error' });
    const succeeded = vi.fn(); const pending = f.frame(); void pending.then(() => succeeded(), () => {}); let frame: FrameResult | undefined;
    try { await flushResources(); expect(succeeded).toHaveBeenCalledOnce(); frame = await pending; expect(f.fits).toHaveLength(1); expect(f.trace.decoded[0]?.owner).toBe(f.doc); }
    finally { frame?.dispose(); f.signal.abort(); hostFont.resolve(); }
  });
  it.each(['loaded', 'error'])('waits for the new frame font gate after page connection and checks %s status', async status => {
    const f = fixture(); const images = pageImages(f); const second = images[1]; if (!second) throw new Error('SOURCE_IMAGE_MISSING'); for (const image of images) image.control.resolve(); const frame = await f.frame(); const font = deferred(); const hostFont = deferred(); const face = { status: 'loading' }; const next = frame.content.children[1];
    f.host.fonts.ready = hostFont.promise; f.host.fonts.add({ status: 'error' }); let connected = false;
    f.trace.onAppend = parent => { if (parent === next && !connected) { connected = true; f.doc.fonts.ready = font.promise; f.doc.fonts.add(face); } };
    try {
      const pending = activate(frame, 1); void pending.catch(() => {}); const failure = status === 'error' ? expect(pending).rejects.toThrow('打印资源无法加载。') : undefined;
      await flushResources(); expect(connected).toBe(true); expect(f.doc.images).toEqual([cloneOf(f, second)]); expect(f.fits).toHaveLength(1); expect(f.math).toHaveBeenCalledTimes(1);
      hostFont.resolve(); await flushResources(); expect(f.fits).toHaveLength(1); expect(f.math).toHaveBeenCalledTimes(1);
      face.status = status; font.resolve(); await f.doc.fonts.ready;
      if (failure) { await failure; await expect(pending).rejects.toBeInstanceOf(ExportTaskFailure); expect(f.connected()).toBe(0); expect(f.fits).toHaveLength(1); expect(f.math).toHaveBeenCalledTimes(1); }
      else { await pending; expect(f.fits.map(row => row[0])).toEqual(['1', '2']); expect(f.fitPages[1]).toBe(next); expect(f.math).toHaveBeenCalledTimes(2); }
    } finally { delete f.trace.onAppend; frame.dispose(); f.signal.abort(); }
  });
  describe.each(['initial', 'later'])('%s connected-tree retirement', phase => {
    it.each([
      ['abort', 'resolve', 'resolve'], ['abort', 'resolve', 'reject'], ['abort', 'reject', 'resolve'], ['abort', 'reject', 'reject'],
      ['dispose', 'resolve', 'resolve'], ['dispose', 'resolve', 'reject'], ['dispose', 'reject', 'resolve'], ['dispose', 'reject', 'reject'],
    ] as const)('keeps %s terminal after late font %s and image %s', async (action, fontOutcome, imageOutcome) => {
      const f = fixture(); const images = pageImages(f); if (phase === 'later') images[0]?.control.resolve(); const frame = phase === 'later' ? await f.frame() : undefined;
      const image = images[phase === 'later' ? 1 : 0]; if (!image) throw new Error('ACTIVE_IMAGE_MISSING'); const font = deferred(); f.doc.fonts.ready = font.promise;
      const callbacks = vi.fn(); void font.promise.then(() => callbacks(), () => callbacks()); void image.control.promise.then(() => callbacks(), () => callbacks());
      const succeeded = vi.fn(); const pending = frame ? activate(frame, 1) : f.frame(); void pending.then(() => succeeded(), () => {}); const failure = expect(pending).rejects.toThrow(action === 'abort' ? '导出已取消' : '打印文档已关闭');
      try {
        await flushResources(); expect(f.doc.images).toEqual([cloneOf(f, image)]); expect(f.trace.decoded.map(event => event.image.label)).toEqual(phase === 'later' ? ['image-0', 'image-1'] : ['image-0']);
        for (const event of f.trace.decoded) { expect(event.owner).toBe(f.doc); expect(event.connected).toBe(true); }
        if (action === 'abort') f.signal.abort(); else {
          // Before the initial result exists, use the captured lifetime disposal callback.
          const dispose = frame?.dispose ?? f.hooks.disposeFrame; if (!dispose) throw new Error('FRAME_DISPOSAL_MISSING'); dispose();
        }
        await failure; expect(f.connected()).toBe(0); expect(f.timers.size).toBe(0); expect(f.fits).toHaveLength(phase === 'later' ? 1 : 0);
        const retired = [f.trace.adopted.length, f.trace.appended.length, f.fitPages.length, f.math.mock.calls.length];
        if (fontOutcome === 'resolve') font.resolve(); else font.reject(new Error('LATE_FONT_FAILURE'));
        if (imageOutcome === 'resolve') image.control.resolve(); else image.control.reject(new Error('LATE_IMAGE_FAILURE'));
        await Promise.allSettled([font.promise, image.control.promise]); await flushResources(); expect(callbacks).toHaveBeenCalledTimes(2);
        expect([f.trace.adopted.length, f.trace.appended.length, f.fitPages.length, f.math.mock.calls.length]).toEqual(retired); expect(succeeded).not.toHaveBeenCalled();
        expect(f.doc.body.querySelectorAll('[data-pdf-question]').map(page => page.children.length)).toEqual([0, 0, 0]); expect(f.connected()).toBe(0); expect(f.timers.size).toBe(0);
        if (frame) { await expect(activate(frame, 2)).rejects.toThrow(action === 'abort' ? '导出已取消' : '打印文档已关闭'); expect([f.trace.adopted.length, f.trace.appended.length, f.fitPages.length, f.math.mock.calls.length]).toEqual(retired); }
        for (const node of tree(f.input)) expect(node.ownerDocument).toBe(f.host);
      } finally { frame?.dispose(); f.signal.abort(); }
    });
  });
  it('retains all stable shells and only connects the active frozen question', async () => {
    const f = fixture(); const frame = await f.frame();
    try {
      const shells = frame.content.children.slice(); expect(shells).toHaveLength(3); expect(shells.map(page => page.children.length)).toEqual([4, 0, 0]);
      expect(f.input.children.map(page => page.children.length)).toEqual([4, 4, 4]); expect(f.fits.map(row => row[0])).toEqual(['1']);
      const original = f.input.children[1]?.children[1]; if (!original) throw new Error('SOURCE_BODY_MISSING'); original.label = 'changed-after-snapshot';
      await activate(frame, 1); expect(frame.content.children).toEqual(shells); expect(shells.map(page => page.children.length)).toEqual([0, 4, 0]);
      expect(shells[1]?.children[1]?.label).toBe('body-1'); expect(shells[1]?.children[2]?.label).toBe('2/3'); expect(shells[1]?.children[3]?.open).toBe(true);
      await activate(frame, 2); expect(shells.map(page => page.children.length)).toEqual([0, 0, 4]); expect(f.fits.map(row => row[0])).toEqual(['1', '2', '3']);
    } finally { frame.dispose(); }
    expect(f.connected()).toBe(0);
  });
  it('leaves ordinary printing and reading on whole-document materialization', async () => {
    const f = fixture(); const frame = await f.frame(false);
    try { expect(frame.activateQuestionPage).toBeUndefined(); expect(frame.content.children.map(page => page.children.length)).toEqual([4, 4, 4]); expect(f.fits).toHaveLength(3); }
    finally { frame.dispose(); }
  });
  it.each(['unrelated', 'nested', 'mixed'])('falls back without discarding %s document structure', async kind => {
    const f = fixture();
    if (kind === 'unrelated') f.input.kind = 'other';
    if (kind === 'nested') { const wrapper = new Node('div', f.host); wrapper.append(...f.input.children.slice()); f.input.append(wrapper); }
    if (kind === 'mixed') f.input.append(new Node('aside', f.host, 'preserved'));
    const frame = await f.frame();
    try { expect(frame.activateQuestionPage).toBeUndefined(); expect(frame.content.querySelectorAll('[data-pdf-question]')).toHaveLength(3); expect(f.fits).toHaveLength(3); }
    finally { frame.dispose(); }
  });
  it('rejects invalid or skipped indices before mutating the active question', async () => {
    const f = fixture(); const frame = await f.frame();
    try {
      for (const index of [-1, .5, 2, 3, NaN]) await expect(activate(frame, index)).rejects.toThrow();
      expect(frame.content.children.map(page => page.children.length)).toEqual([4, 0, 0]);
      await activate(frame, 0); expect(f.fits).toHaveLength(1);
    } finally { frame.dispose(); }
    await expect(activate(frame, 1)).rejects.toThrow();
  });
  it.each(['abort', 'dispose'])('settles pending activation on %s and ignores late fonts', async action => {
    const f = fixture(); const frame = await f.frame(); const font = deferred(); f.doc.fonts.ready = font.promise;
    const pending = activate(frame, 1); const failure = expect(pending).rejects.toThrow();
    if (action === 'abort') f.signal.abort(); else frame.dispose();
    await failure; expect(f.connected()).toBe(0); const count = f.fits.length;
    font.resolve(); await Promise.resolve(); await Promise.resolve(); expect(f.fits).toHaveLength(count); frame.dispose();
  });
  it('rejects overlapping activations rather than replacing a still-loading page', async () => {
    const f = fixture(); const frame = await f.frame(); const font = deferred(); f.doc.fonts.ready = font.promise;
    try {
      const pending = activate(frame, 1); await expect(activate(frame, 2)).rejects.toThrow(); expect(frame.content.children.map(page => page.children.length)).toEqual([0, 4, 0]);
      font.resolve(); await pending; await activate(frame, 2); expect(f.fits.map(row => row[0])).toEqual(['1', '2', '3']);
    } finally { frame.dispose(); }
  });
  it.each(['initial-sparse', 'initial-full', 'later-abort', 'later-dispose'])('checks retirement between resource helper and caller for %s', async phase => {
    const f = fixture(); const later = phase.startsWith('later'); const frame = later ? await f.frame() : undefined; const count = f.fits.length;
    // Two queued turns retire the frame after the helper resumes, before its caller does.
    f.hooks.resourceSettled = () => queueMicrotask(() => queueMicrotask(() => phase === 'later-dispose' ? frame?.dispose() : f.signal.abort()));
    try {
      const pending = frame ? activate(frame, 1) : f.frame(phase === 'initial-sparse');
      await expect(pending).rejects.toThrow(phase === 'later-dispose' ? '打印文档已关闭' : '导出已取消');
      expect(f.connected()).toBe(0); expect(f.fits).toHaveLength(count); expect(f.math).toHaveBeenCalledTimes(count);
    } finally { frame?.dispose(); f.signal.abort(); }
  });
  describe.each(['initial-sparse', 'initial-full', 'later'])('%s public resource failures', phase => {
    it.each(['timeout', 'decode'])('keeps the trusted %s message available to the export queue', async kind => {
      const f = fixture(); const frame = phase === 'later' ? await f.frame() : undefined; const resource = deferred();
      if (kind === 'timeout') f.doc.fonts.ready = resource.promise; else f.doc.injectedImages.push({ decode: () => resource.promise });
      try {
        const pending = frame ? activate(frame, 1) : f.frame(phase !== 'initial-full');
        const failure = expect(pending).rejects.toBeInstanceOf(ExportTaskFailure);
        await Promise.resolve();
        if (kind === 'timeout') { f.clock.now = 20000; resource.resolve(); } else resource.reject(new Error('UNTRUSTED_DECODE_DETAIL'));
        await failure; await expect(pending).rejects.toThrow(kind === 'timeout' ? '打印资源加载超时。' : '打印资源无法加载。'); expect(f.connected()).toBe(0);
      } finally { frame?.dispose(); f.signal.abort(); }
    });
  });
  describe.each(['initial-sparse', 'initial-full', 'later'])('%s settled font faces', phase => {
    it.each(['error', 'loaded', 'unloaded'])('checks %s faces even when ready fulfilled', async status => {
      const f = fixture(); const frame = phase === 'later' ? await f.frame() : undefined; const count = f.fits.length; f.doc.fonts.add({ status });
      try {
        const pending = frame ? activate(frame, 1) : f.frame(phase !== 'initial-full');
        if (status === 'error') {
          await expect(pending).rejects.toBeInstanceOf(ExportTaskFailure); await expect(pending).rejects.toThrow('打印资源无法加载。');
          expect(f.connected()).toBe(0); expect(f.fits).toHaveLength(count); expect(f.math).toHaveBeenCalledTimes(count);
        } else { const created = await pending; if (created) created.dispose(); expect(f.fits).toHaveLength(count + (phase === 'initial-full' ? 3 : 1)); }
      } finally { frame?.dispose(); f.signal.abort(); }
    });
    it('keeps cancellation ahead of an error face at settlement', async () => {
      const f = fixture(); const frame = phase === 'later' ? await f.frame() : undefined; f.doc.fonts.add({ status: 'error' });
      f.hooks.resourceSettled = () => f.signal.abort();
      try { await expect(frame ? activate(frame, 1) : f.frame(phase !== 'initial-full')).rejects.toThrow('导出已取消'); expect(f.connected()).toBe(0); }
      finally { frame?.dispose(); f.signal.abort(); }
    });
    it('keeps the deadline ahead of an error face at settlement', async () => {
      const f = fixture(); const frame = phase === 'later' ? await f.frame() : undefined; const font = deferred(); f.doc.fonts.ready = font.promise; f.doc.fonts.add({ status: 'error' });
      try {
        const pending = frame ? activate(frame, 1) : f.frame(phase !== 'initial-full'); const failure = expect(pending).rejects.toThrow('打印资源加载超时');
        await Promise.resolve(); f.clock.now = 20000; font.resolve(); await failure; expect(f.connected()).toBe(0);
      } finally { frame?.dispose(); f.signal.abort(); }
    });
  });
  describe.each(['initial', 'later'])('%s resource deadline', phase => {
    it.each([['resolve', 20000], ['resolve', 20001], ['reject', 20000], ['reject', 20001]] as const)('rejects %s at %ims before the timer runs', async (outcome, elapsed) => {
      const f = fixture(); const frame = phase === 'later' ? await f.frame() : undefined; const count = f.fits.length; const font = deferred(); f.doc.fonts.ready = font.promise;
      try {
        const pending = frame ? activate(frame, 1) : f.frame(); const failure = expect(pending).rejects.toThrow('打印资源加载超时');
        await Promise.resolve(); f.clock.now = elapsed;
        if (outcome === 'resolve') font.resolve(); else font.reject(new Error('LATE_FONT_FAILURE'));
        await failure; expect(f.connected()).toBe(0); expect(f.fits).toHaveLength(count);
      } finally { frame?.dispose(); f.signal.abort(); }
    });
    it('accepts resources immediately before the deadline', async () => {
      const f = fixture(); const frame = phase === 'later' ? await f.frame() : undefined; const font = deferred(); f.doc.fonts.ready = font.promise;
      try {
        const pending = frame ? activate(frame, 1) : f.frame(); await Promise.resolve(); f.clock.now = 19999; font.resolve();
        const created = await pending; if (created) created.dispose(); expect(f.fits).toHaveLength(frame ? 2 : 1);
      } finally { frame?.dispose(); f.signal.abort(); }
    });
    it('prioritizes cancellation over already-expired resource results', async () => {
      const f = fixture(); const frame = phase === 'later' ? await f.frame() : undefined; const font = deferred(); f.doc.fonts.ready = font.promise;
      try {
        const pending = frame ? activate(frame, 1) : f.frame(); const failure = expect(pending).rejects.toThrow('导出已取消');
        await Promise.resolve(); f.clock.now = 20001; f.signal.abort(); font.resolve(); await failure; expect(f.connected()).toBe(0);
      } finally { frame?.dispose(); f.signal.abort(); }
    });
  });
  it('temporarily gives native iframe printing the batch filename on the host document', async () => {
    const f = fixture(); f.target.print.mockImplementation(() => { expect(f.host.title).toBe('copy.pdf'); });
    const dispose = await f.print();
    try { expect(f.host.title).toBe('app-title'); } finally { dispose(); }
  });
  it('restores the host title when the native print API throws', async () => {
    const f = fixture(); f.target.print.mockImplementation(() => { expect(f.host.title).toBe('copy.pdf'); throw new Error('PRINTER_FAILED'); });
    await expect(f.print()).rejects.toThrow('PRINTER_FAILED'); expect(f.host.title).toBe('app-title'); expect(f.connected()).toBe(0);
  });
  it('preserves a newer navigation title set during native printing', async () => {
    const f = fixture(); f.target.print.mockImplementation(() => { f.host.title = 'navigated-title'; });
    const dispose = await f.print();
    try { expect(f.host.title).toBe('navigated-title'); } finally { dispose(); }
  });
  it('prints the complete default document and releases through afterprint', async () => {
    const f = fixture(); const dispose = await f.print();
    try {
      expect(f.target.focus).toHaveBeenCalledOnce(); expect(f.target.print).toHaveBeenCalledOnce();
      expect(f.target.addEventListener).toHaveBeenCalledWith('afterprint', dispose, { once: true });
      expect(f.doc.body.querySelectorAll('[data-pdf-question]').map(page => page.children.length)).toEqual([4, 4, 4]);
    } finally { dispose(); }
    expect(f.connected()).toBe(0);
  });
  it('releases the default document when the printing API fails', async () => {
    const f = fixture(); f.target.print.mockImplementation(() => { throw new Error('PRINTER_FAILED'); });
    await expect(f.print()).rejects.toThrow('PRINTER_FAILED'); expect(f.connected()).toBe(0);
  });
  it('skips printing when cancellation arrives after frame creation but before the print caller resumes', async () => {
    const f = fixture(); f.hooks.resourceSettled = () => queueMicrotask(() => queueMicrotask(() => queueMicrotask(() => f.signal.abort())));
    try { await expect(f.print()).rejects.toThrow('导出已取消'); expect(f.target.print).not.toHaveBeenCalled(); expect(f.connected()).toBe(0); }
    finally { f.signal.abort(); }
  });
  it('skips printing when focusing synchronously cancels the operation', async () => {
    const f = fixture(); f.target.focus.mockImplementation(() => f.signal.abort());
    try { await expect(f.print()).rejects.toThrow('导出已取消'); expect(f.target.print).not.toHaveBeenCalled(); expect(f.connected()).toBe(0); }
    finally { f.signal.abort(); }
  });
  it.each(['initial-sparse', 'initial-full', 'later'])('releases the frame on image decode rejection during %s', async phase => {
    const f = fixture(); const frame = phase === 'later' ? await f.frame() : undefined; const image = deferred(); const decode = vi.fn(() => image.promise); f.doc.injectedImages.push({ decode }); const count = f.fits.length;
    try {
      const pending = frame ? activate(frame, 1) : f.frame(phase !== 'initial-full'); const failure = expect(pending).rejects.toThrow('打印资源无法加载');
      await Promise.resolve(); expect(decode).toHaveBeenCalledOnce(); image.reject(new Error('IMAGE_DECODE_FAILED')); await failure;
      expect(f.connected()).toBe(0); expect(f.fits).toHaveLength(count); expect(f.timers.size).toBe(0);
    } finally { frame?.dispose(); f.signal.abort(); }
  });
  it.each(['resolve', 'reject'])('ignores late image %s after cancellation', async outcome => {
    const f = fixture(); const frame = await f.frame(); const image = deferred(); const decode = vi.fn(() => image.promise); f.doc.injectedImages.push({ decode });
    try {
      const pending = activate(frame, 1); const failure = expect(pending).rejects.toThrow('导出已取消'); await Promise.resolve(); expect(decode).toHaveBeenCalledOnce();
      f.signal.abort(); await failure; const count = f.fits.length;
      if (outcome === 'resolve') image.resolve(); else image.reject(new Error('LATE_IMAGE_FAILURE'));
      await Promise.resolve(); await Promise.resolve(); expect(f.connected()).toBe(0); expect(f.fits).toHaveLength(count); expect(f.timers.size).toBe(0);
    } finally { frame.dispose(); f.signal.abort(); }
  });
  it('releases the initial frame when a cloned stylesheet fails', async () => {
    const f = fixture(); f.styles.push(new Link('link', f.host)); const pending = f.frame(); const failure = expect(pending).rejects.toThrow('打印资源无法加载');
    try {
      const clone = f.doc.head.children.find(node => node instanceof Link); if (!(clone instanceof Link)) throw new Error('STYLESHEET_CLONE_MISSING');
      expect(clone.onerror).toBeTypeOf('function'); clone.onerror?.(); await failure;
      expect(f.connected()).toBe(0); expect(f.fits).toHaveLength(0); expect(f.timers.size).toBe(0);
    } finally { f.signal.abort(); }
  });
  it('does not start image decoding when a stylesheet loads after cancellation', async () => {
    const f = fixture(); f.styles.push(new Link('link', f.host)); const decode = vi.fn(async () => {}); f.doc.injectedImages.push({ decode }); const pending = f.frame(); const failure = expect(pending).rejects.toThrow('导出已取消');
    try {
      const clone = f.doc.head.children.find(node => node instanceof Link); if (!(clone instanceof Link)) throw new Error('STYLESHEET_CLONE_MISSING');
      f.signal.abort(); await failure; expect(clone.onload).toBeTypeOf('function'); clone.onload?.(); await Promise.resolve(); await Promise.resolve();
      expect(decode).not.toHaveBeenCalled(); expect(f.fits).toHaveLength(0); expect(f.connected()).toBe(0); expect(f.timers.size).toBe(0);
    } finally { f.signal.abort(); }
  });
  it('releases a ready frame when the lifetime timer fires', async () => {
    vi.useFakeTimers(); const f = fixture(); let frame: FrameResult | undefined;
    try {
      frame = await f.frame(); vi.advanceTimersByTime(120000); expect(f.connected()).toBe(0); expect(f.timers.size).toBe(0);
      expect(frame.content.children.map(page => page.children.length)).toEqual([0, 0, 0]); await expect(activate(frame, 1)).rejects.toThrow('打印文档已关闭'); expect(f.fits).toHaveLength(1);
    } finally { frame?.dispose(); f.signal.abort(); vi.useRealTimers(); }
  });
  it('retains an export frame past the print-dialog lifetime and releases it at the explicit bounded deadline', async () => {
    vi.useFakeTimers(); const f = fixture(); let frame: FrameResult | undefined;
    try {
      frame = await f.frame(true, 330000);
      vi.advanceTimersByTime(120000); expect(f.connected()).toBe(1);
      vi.advanceTimersByTime(209999); expect(f.connected()).toBe(1);
      vi.advanceTimersByTime(1); expect(f.connected()).toBe(0); expect(f.timers.size).toBe(0);
      await expect(activate(frame, 1)).rejects.toThrow('打印文档已关闭');
    } finally { frame?.dispose(); f.signal.abort(); vi.useRealTimers(); }
  });
  it.each([0, 119999, 330001, Infinity, NaN])('rejects an invalid frame lifetime before creating resources (%s)', async lifetime => {
    const f = fixture(); await expect(f.frame(true, lifetime)).rejects.toThrow('打印文档时限无效');
    expect(f.connected()).toBe(0); expect(f.timers.size).toBe(0);
  });
  it('settles pending activation on lifetime expiry and ignores late resources', async () => {
    vi.useFakeTimers(); const f = fixture(); let frame: FrameResult | undefined;
    try {
      frame = await f.frame(); vi.advanceTimersByTime(119999); const font = deferred(); f.doc.fonts.ready = font.promise;
      const pending = activate(frame, 1); const failure = expect(pending).rejects.toThrow('打印文档已关闭'); vi.advanceTimersByTime(1); await failure;
      font.resolve(); await Promise.resolve(); await Promise.resolve(); expect(f.fits).toHaveLength(1); expect(f.connected()).toBe(0); expect(f.timers.size).toBe(0);
    } finally { frame?.dispose(); f.signal.abort(); vi.useRealTimers(); }
  });
});
