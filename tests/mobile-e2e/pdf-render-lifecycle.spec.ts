import { test, expect } from '@playwright/test';
import { buildSync } from 'esbuild';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { PdfRenderLifecycleApi as LifecycleModule } from '../../apps/mobile/src/local/pdf-render-lifecycle.types.js';
import { preparePdfRenderBaseline } from '../../scripts/pdf-render-baseline.mjs';
type CanvasRunner = (element: HTMLElement, options: Record<string, unknown>) => Promise<unknown>;
const bundle = buildSync({ entryPoints: ['apps/mobile/src/local/pdf-render-lifecycle.web.ts'], bundle: true, write: false, platform: 'browser', format: 'iife', globalName: 'PdfRenderLease' }).outputFiles?.[0]?.text;
if (!bundle) throw new Error('Missing lifecycle browser bundle');
const stagedPackage = resolve(process.env.SOLVEFLOW_TEST_PDF_RENDER_PACKAGE ?? 'apps/mobile/node_modules/html2canvas');
const baselinePackage = preparePdfRenderBaseline();

for (const scenario of ['active', 'clone-complete', 'clone-detach', 'source-detach', 'source-reconnect', 'ancestor-reconnect', 'source-navigation', 'clone-navigation', 'foreign-clone', 'cancel-priority', 'closed', 'state-preserving-move', 'source-write', 'clone-write', 'clone-complete-source-move', 'clone-complete-source-move-async', 'clone-complete-ancestor-move', 'clone-complete-ancestor-move-async', 'clone-move', 'clone-ancestor-move'] as const) {
  test(`render document lease: ${scenario}`, async ({ page }) => {
    await page.goto('about:blank'); await page.addScriptTag({ content: bundle });
    const result = await page.evaluate(async scenario => {
      const raw: unknown = Reflect.get(globalThis, 'PdfRenderLease');
      const isModule = (value: unknown): value is LifecycleModule => typeof value === 'object' && value !== null && 'createPdfRenderLifecycle' in value && typeof value.createPdfRenderLifecycle === 'function' && 'yieldPdfRender' in value && typeof value.yieldPdfRender === 'function';
      if (!isModule(raw)) throw new Error('Missing lifecycle API');
      const wrapper = document.createElement('div'); document.body.append(wrapper);
      const marker = document.createElement('div'); wrapper.append(marker);
      const source = document.createElement('iframe'); wrapper.append(source);
      const doc = source.contentDocument; if (!doc) throw new Error('Missing source document');
      const cloneParent = scenario === 'clone-ancestor-move' ? doc.createElement('div') : doc.body;
      if (cloneParent !== doc.body) doc.body.append(cloneParent);
      const clone = doc.createElement('iframe'); cloneParent.append(clone);
      const cloned = clone.contentDocument; if (!cloned) throw new Error('Missing clone document');
      let stopped: Error | undefined; let checks = 0;
      const lease = raw.createPdfRenderLifecycle(doc, () => { checks++; if (stopped) throw stopped; });
      let error: string | undefined; let preserved: boolean | undefined;
      try {
        if (scenario === 'foreign-clone') {
          const foreign = document.createElement('iframe'); document.body.append(foreign);
          try { if (!foreign.contentDocument) throw new Error('Missing foreign document'); lease.bindClone(foreign.contentDocument); } finally { foreign.remove(); }
        } else {
          lease.bindClone(cloned); lease.assertActive();
          if (scenario === 'clone-complete') { clone.remove(); lease.completeRendering(); }
          if (scenario === 'clone-detach') clone.remove();
          if (scenario === 'source-detach') source.remove();
          if (scenario === 'source-reconnect') { source.remove(); wrapper.append(source); }
          if (scenario === 'ancestor-reconnect') { wrapper.remove(); document.body.append(wrapper); await Promise.resolve(); }
          if (scenario === 'source-navigation' || scenario === 'clone-navigation') {
            const target = scenario === 'source-navigation' ? source : clone;
            await new Promise<void>(resolve => { target.onload = () => resolve(); target.srcdoc = '<!doctype html><title>new document</title>'; });
          }
          if (scenario === 'source-write' || scenario === 'clone-write') {
            if (scenario === 'source-write') { clone.remove(); lease.completeRendering(); }
            const target = scenario === 'source-write' ? source : clone;
            const current = target.contentDocument; if (!current) throw new Error('Missing write document');
            current.open(); current.write('<!doctype html><title>replaced root</title>'); current.close(); preserved = target.contentDocument === current;
          }
          if (scenario === 'cancel-priority') { stopped = new Error('导出已取消。'); lease.dispose(); source.remove(); }
          if (scenario === 'closed') lease.dispose();
          if (scenario === 'state-preserving-move') {
            const move: unknown = Reflect.get(wrapper, 'moveBefore'); if (typeof move !== 'function') throw new Error('Missing state-preserving move');
            Reflect.apply(move, wrapper, [source, marker]); preserved = source.contentDocument === doc;
          }
          const movePreserving = (parent: Element, node: Node) => {
            const move: unknown = Reflect.get(parent, 'moveBefore'); if (typeof move !== 'function') throw new Error('Missing state-preserving move');
            Reflect.apply(move, parent, [node, null]);
          };
          if (scenario.startsWith('clone-complete-') && scenario.includes('move')) {
            clone.remove(); lease.completeRendering();
            if (scenario.includes('ancestor')) {
              const marker = document.createElement('div'); document.body.append(marker);
              movePreserving(document.body, wrapper);
            } else {
              const marker = document.createElement('div'); wrapper.append(marker);
              movePreserving(wrapper, source);
            }
            preserved = source.contentDocument === doc;
            if (scenario.endsWith('async')) await Promise.resolve();
          }
          if (scenario === 'clone-move' || scenario === 'clone-ancestor-move') {
            const marker = doc.createElement('div'); doc.body.append(marker);
            movePreserving(doc.body, scenario === 'clone-move' ? clone : cloneParent);
            preserved = clone.contentDocument === cloned;
          }
          lease.assertActive();
        }
      } catch (value) { error = value instanceof Error ? value.message : String(value); }
      finally { lease.dispose(); wrapper.remove(); }
      return { error, checks, preserved, frames: document.querySelectorAll('iframe').length };
    }, scenario);
    expect(result.frames).toBe(0);
    if (scenario === 'active' || scenario === 'clone-complete') expect(result.error).toBeUndefined();
    else if (scenario === 'cancel-priority') expect(result.error).toBe('导出已取消。');
    else expect(result.error).toContain('PDF 绘制文档已失效');
    if (scenario.includes('move') || scenario === 'source-write' || scenario === 'clone-write') expect(result.preserved).toBe(true);
    expect(result.checks).toBeGreaterThan(0);
  });
}

for (const bindClone of [false, true]) {
  test(`render document lease ignores unrelated subtree churn: clone=${bindClone}`, async ({ page }) => {
    await page.goto('about:blank'); await page.addScriptTag({ content: bundle });
    const result = await page.evaluate(bindClone => {
      const raw: unknown = Reflect.get(globalThis, 'PdfRenderLease');
      const isModule = (value: unknown): value is LifecycleModule => typeof value === 'object' && value !== null && 'createPdfRenderLifecycle' in value && typeof value.createPdfRenderLifecycle === 'function' && 'yieldPdfRender' in value && typeof value.yieldPdfRender === 'function';
      if (!isModule(raw)) throw new Error('Missing lifecycle API');
      const wrapper = document.createElement('div'); document.body.append(wrapper);
      const unrelated = document.createElement('div'); document.body.append(unrelated);
      const source = document.createElement('iframe'); wrapper.append(source);
      const doc = source.contentDocument; if (!doc) throw new Error('Missing source document');
      const clone = doc.createElement('iframe'); doc.body.append(clone);
      const cloned = clone.contentDocument; if (!cloned) throw new Error('Missing clone document');
      const sourceWindow = doc.defaultView; if (!sourceWindow) throw new Error('Missing source window');
      const NativeObserver = MutationObserver; const NativeSourceObserver = sourceWindow.MutationObserver;
      const parentCounts = { observers: 0, records: 0, subtreeObservations: 0 };
      const sourceCounts = { observers: 0, records: 0, subtreeObservations: 0 };
      const track = (Base: typeof MutationObserver, counts: typeof parentCounts) => class extends Base {
        constructor(callback: MutationCallback) {
          super((entries, observer) => { counts.records += entries.length; callback(entries, observer); });
          counts.observers++;
        }
        override observe(target: Node, options?: MutationObserverInit) {
          if (options?.subtree) counts.subtreeObservations++;
          super.observe(target, options);
        }
        override takeRecords() {
          const entries = super.takeRecords(); counts.records += entries.length; return entries;
        }
      };
      const innerUnrelated = doc.createElement('div'); doc.body.append(innerUnrelated);
      if (!Reflect.set(globalThis, 'MutationObserver', track(NativeObserver, parentCounts)) || !Reflect.set(sourceWindow, 'MutationObserver', track(NativeSourceObserver, sourceCounts))) throw new Error('Missing observer instrumentation');
      const lease = raw.createPdfRenderLifecycle(doc, () => {});
      try {
        if (bindClone) lease.bindClone(cloned);
        for (let index = 0; index < 500; index++) {
          const child = document.createElement('span'); unrelated.append(child); child.remove();
          const innerChild = doc.createElement('span'); innerUnrelated.append(innerChild); innerChild.remove();
        }
        lease.assertActive();
        return { parentCounts, sourceCounts };
      } finally {
        lease.dispose(); Reflect.set(globalThis, 'MutationObserver', NativeObserver); Reflect.set(sourceWindow, 'MutationObserver', NativeSourceObserver);
        wrapper.remove(); unrelated.remove();
      }
    }, bindClone);
    expect(result).toEqual({ parentCounts: { observers: 1, records: 0, subtreeObservations: 0 }, sourceCounts: { observers: bindClone ? 1 : 0, records: 0, subtreeObservations: 0 } });
  });
}

for (const depth of [14, 15]) {
  test(`render document lease retains clone ancestry limit: depth=${depth}`, async ({ page }) => {
    await page.goto('about:blank'); await page.addScriptTag({ content: bundle });
    const result = await page.evaluate(depth => {
      const raw: unknown = Reflect.get(globalThis, 'PdfRenderLease');
      const isModule = (value: unknown): value is LifecycleModule => typeof value === 'object' && value !== null && 'createPdfRenderLifecycle' in value && typeof value.createPdfRenderLifecycle === 'function' && 'yieldPdfRender' in value && typeof value.yieldPdfRender === 'function';
      if (!isModule(raw)) throw new Error('Missing lifecycle API');
      const frames: HTMLIFrameElement[] = []; let doc = document;
      try {
        for (let index = 0; index < depth; index++) {
          const frame = doc.createElement('iframe'); doc.body.append(frame); frames.push(frame);
          const next = frame.contentDocument; if (!next) throw new Error('Missing nested document'); doc = next;
        }
        const clone = doc.createElement('iframe'); doc.body.append(clone);
        const cloned = clone.contentDocument; if (!cloned) throw new Error('Missing clone document');
        const lease = raw.createPdfRenderLifecycle(doc, () => {});
        try {
          let cloneError: string | undefined;
          try { lease.bindClone(cloned); } catch (error) { cloneError = error instanceof Error ? error.message : String(error); }
          lease.assertActive();
          return { cloneError, sourceStillActive: true };
        } finally { lease.dispose(); }
      } finally { frames.reverse().forEach(frame => frame.remove()); }
    }, depth);
    expect(result.sourceStillActive).toBe(true);
    if (depth === 14) expect(result.cloneError).toBeUndefined();
    else expect(result.cloneError).toContain('PDF 绘制文档已失效');
  });
}

for (const bindClone of [false, true]) {
  test(`render document lease reads each owner window once after record drain: clone=${bindClone}`, async ({ page }) => {
    await page.goto('about:blank'); await page.addScriptTag({ content: bundle });
    const result = await page.evaluate(bindClone => {
      const raw: unknown = Reflect.get(globalThis, 'PdfRenderLease');
      const isModule = (value: unknown): value is LifecycleModule => typeof value === 'object' && value !== null && 'createPdfRenderLifecycle' in value && typeof value.createPdfRenderLifecycle === 'function' && 'yieldPdfRender' in value && typeof value.yieldPdfRender === 'function';
      if (!isModule(raw)) throw new Error('Missing lifecycle API');
      const source = document.createElement('iframe'); document.body.append(source);
      const doc = source.contentDocument; if (!doc) throw new Error('Missing source document');
      const clone = doc.createElement('iframe'); doc.body.append(clone);
      const cloned = clone.contentDocument; if (!cloned) throw new Error('Missing clone document');
      const lease = raw.createPdfRenderLifecycle(doc, () => {});
      if (bindClone) lease.bindClone(cloned);
      const native = Object.getOwnPropertyDescriptor(Document.prototype, 'defaultView')?.get;
      if (!native) throw new Error('Missing native document getter');
      const counts = { parent: 0, source: 0, clone: 0 };
      const before = new Map<Document, PropertyDescriptor | undefined>();
      let transientlyInactive = false;
      for (const [target, key] of [[document, 'parent'], [doc, 'source'], [cloned, 'clone']] as const) {
        before.set(target, Object.getOwnPropertyDescriptor(target, 'defaultView'));
        Object.defineProperty(target, 'defaultView', { configurable: true, get() {
          counts[key]++;
          return target === doc && transientlyInactive ? null : native.call(target);
        } });
      }
      try {
        lease.assertActive(); const first = { ...counts };
        lease.assertActive(); const second = { ...counts };
        transientlyInactive = true;
        let error: string | undefined;
        try { lease.assertActive(); } catch (value) { error = value instanceof Error ? value.message : String(value); }
        const failed = { ...counts };
        transientlyInactive = false; lease.assertActive();
        return { first, second, failed, restored: { ...counts }, error };
      } finally {
        for (const [target, descriptor] of before) {
          if (descriptor) Object.defineProperty(target, 'defaultView', descriptor);
          else if (!Reflect.deleteProperty(target, 'defaultView')) throw new Error('Failed to restore document getter');
        }
        lease.dispose(); source.remove();
      }
    }, bindClone);
    const sourceReads = bindClone ? 3 : 2;
    expect(result.first).toEqual({ parent: 1, source: sourceReads, clone: bindClone ? 1 : 0 });
    expect(result.second).toEqual({ parent: 2, source: sourceReads * 2, clone: bindClone ? 2 : 0 });
    expect(result.failed).toEqual({ parent: 2, source: sourceReads * 2 + 1, clone: bindClone ? 2 : 0 });
    expect(result.error).toContain('PDF 绘制文档已失效');
    expect(result.restored).toEqual({ parent: 3, source: sourceReads * 3 + 1, clone: bindClone ? 3 : 0 });
  });
}

for (const scenario of ['check-before-dom', 'invalid-before-owner-view'] as const) {
  test(`render document lease retains short-circuit order: ${scenario}`, async ({ page }) => {
    await page.goto('about:blank'); await page.addScriptTag({ content: bundle });
    const result = await page.evaluate(scenario => {
      const raw: unknown = Reflect.get(globalThis, 'PdfRenderLease');
      const isModule = (value: unknown): value is LifecycleModule => typeof value === 'object' && value !== null && 'createPdfRenderLifecycle' in value && typeof value.createPdfRenderLifecycle === 'function' && 'yieldPdfRender' in value && typeof value.yieldPdfRender === 'function';
      if (!isModule(raw)) throw new Error('Missing lifecycle API');
      const source = document.createElement('iframe'); document.body.append(source);
      const doc = source.contentDocument; if (!doc) throw new Error('Missing source document');
      const clone = doc.createElement('iframe'); doc.body.append(clone);
      const cloned = clone.contentDocument; if (!cloned) throw new Error('Missing clone document');
      const cancellation = {}; const lateRead = {}; let cancel = false; let reads = 0;
      const lease = raw.createPdfRenderLifecycle(doc, () => { if (cancel) throw cancellation; });
      lease.bindClone(cloned); lease.assertActive();
      const target = scenario === 'check-before-dom' ? doc : cloned;
      const before = Object.getOwnPropertyDescriptor(target, 'defaultView');
      Object.defineProperty(target, 'defaultView', { configurable: true, get() { reads++; throw lateRead; } });
      if (scenario === 'check-before-dom') cancel = true; else clone.remove();
      let failure: unknown;
      try {
        try { lease.assertActive(); } catch (error) { failure = error; }
        return { reads, cancellationIdentity: failure === cancellation, lateReadIdentity: failure === lateRead, message: failure instanceof Error ? failure.message : '' };
      } finally {
        if (before) Object.defineProperty(target, 'defaultView', before);
        else if (!Reflect.deleteProperty(target, 'defaultView')) throw new Error('Failed to restore document getter');
        lease.dispose(); source.remove();
      }
    }, scenario);
    expect(result.reads).toBe(0); expect(result.lateReadIdentity).toBe(false);
    if (scenario === 'check-before-dom') expect(result.cancellationIdentity).toBe(true);
    else expect(result.message).toContain('PDF 绘制文档已失效');
  });
}

test('render document lease rechecks source root after draining records', async ({ page }) => {
  await page.goto('about:blank'); await page.addScriptTag({ content: bundle });
  const result = await page.evaluate(() => {
    const raw: unknown = Reflect.get(globalThis, 'PdfRenderLease');
    const isModule = (value: unknown): value is LifecycleModule => typeof value === 'object' && value !== null && 'createPdfRenderLifecycle' in value && typeof value.createPdfRenderLifecycle === 'function' && 'yieldPdfRender' in value && typeof value.yieldPdfRender === 'function';
    if (!isModule(raw)) throw new Error('Missing lifecycle API');
    const source = document.createElement('iframe'); document.body.append(source);
    const frameDocument = source.contentDocument;
    if (!frameDocument) throw new Error('Missing source document');
    const doc = frameDocument;
    const sourceWindow = doc.defaultView; if (!sourceWindow) throw new Error('Missing source window');
    const clone = doc.createElement('iframe'); doc.body.append(clone);
    const cloned = clone.contentDocument; if (!cloned) throw new Error('Missing clone document');
    const root = doc.documentElement;
    const Native = MutationObserver; const NativeSource = sourceWindow.MutationObserver;
    let armed = false; let sourceDrains = 0; let cloneDrains = 0;
    class SourceObserver extends Native {
      override takeRecords() {
        sourceDrains++; const records = super.takeRecords();
        if (armed) { armed = false; doc.open(); doc.write('<html><body>replacement</body></html>'); doc.close(); }
        return records;
      }
    }
    class CloneObserver extends NativeSource {
      override takeRecords() { cloneDrains++; return super.takeRecords(); }
    }
    if (!Reflect.set(globalThis, 'MutationObserver', SourceObserver) || !Reflect.set(sourceWindow, 'MutationObserver', CloneObserver)) throw new Error('Missing observer instrumentation');
    const lease = raw.createPdfRenderLifecycle(doc, () => {});
    try {
      lease.bindClone(cloned); lease.assertActive(); sourceDrains = 0; cloneDrains = 0; armed = true;
      let message: string | undefined;
      try { lease.assertActive(); } catch (error) { message = error instanceof Error ? error.message : String(error); }
      return { message, sourceDrains, cloneDrains, sameDocument: source.contentDocument === doc, rootChanged: doc.documentElement !== root };
    } finally {
      lease.dispose(); Reflect.set(globalThis, 'MutationObserver', Native); Reflect.set(sourceWindow, 'MutationObserver', NativeSource); source.remove();
    }
  });
  expect(result).toEqual({ message: 'PDF 绘制文档已失效，请重试。', sourceDrains: 1, cloneDrains: 0, sameDocument: true, rootChanged: true });
});

test('render document lease disposes a callback snapshot synchronously and retains the first thrown value', async ({ page }) => {
  await page.goto('about:blank'); await page.addScriptTag({ content: bundle });
  const result = await page.evaluate(() => {
    const raw: unknown = Reflect.get(globalThis, 'PdfRenderLease');
    const isModule = (value: unknown): value is LifecycleModule => typeof value === 'object' && value !== null && 'createPdfRenderLifecycle' in value && typeof value.createPdfRenderLifecycle === 'function' && 'yieldPdfRender' in value && typeof value.yieldPdfRender === 'function';
    if (!isModule(raw)) throw new Error('Missing lifecycle API');
    const source = document.createElement('iframe'); document.body.append(source);
    const doc = source.contentDocument; if (!doc) throw new Error('Missing source document');
    const clone = doc.createElement('iframe'); doc.body.append(clone);
    const cloned = clone.contentDocument; if (!cloned) throw new Error('Missing clone document');
    const cancellation = {}; const laterFailure = {}; let cancel = false;
    const lease = raw.createPdfRenderLifecycle(doc, () => { if (cancel) throw cancellation; });
    lease.bindClone(cloned);
    const order: string[] = []; let cancelPriority = false;
    lease.onDispose(() => { order.push('A'); clone.remove(); throw undefined; });
    lease.onDispose(() => { order.push('B'); unregisterC(); lease.dispose(); });
    const unregisterC = lease.onDispose(() => { order.push('C'); });
    lease.onDispose(() => {
      order.push('D'); cancel = true;
      try { lease.assertActive(); } catch (error) { cancelPriority = error === cancellation; }
      throw laterFailure;
    });
    lease.onDispose(() => { order.push('omitted'); })();
    try {
      let threw = false; let firstWasUndefined = false;
      try { lease.dispose(); } catch (error) { threw = true; firstWasUndefined = error === undefined; }
      const synchronous = [...order]; lease.dispose();
      return { threw, firstWasUndefined, synchronous, final: [...order], cancelPriority, sourceRetained: source.isConnected, cloneRemoved: !clone.isConnected };
    } finally { source.remove(); }
  });
  expect(result).toEqual({ threw: true, firstWasUndefined: true, synchronous: ['A', 'B', 'C', 'D'], final: ['A', 'B', 'C', 'D'], cancelPriority: true, sourceRetained: true, cloneRemoved: true });
});

test.describe('staged html2canvas browser adapter', () => {
  for (const entry of ['html2canvas.js', 'html2canvas.esm.js', 'html2canvas.min.js']) {
    test(`preserves pixels and native JPEG: ${entry}`, async ({ page }) => {
      await page.goto('about:blank'); await page.addScriptTag({ content: bundle });
      if (!baselinePackage) throw new Error('Missing verified baseline');
      await page.addScriptTag({ content: readFileSync(resolve(baselinePackage, 'dist/html2canvas.js'), 'utf8') });
      await page.evaluate(() => Reflect.set(globalThis, 'OriginalPdfCanvas', Reflect.get(globalThis, 'html2canvas')));
      if (!stagedPackage) throw new Error('Missing candidate package');
      await page.addScriptTag({ content: readFileSync(resolve(stagedPackage, 'dist', entry), 'utf8') + '\n;globalThis.CandidatePdfCanvas = html2canvas;', ...(entry.includes('.esm.') ? { type: 'module' } : {}) });
      await page.waitForFunction(() => typeof Reflect.get(globalThis, 'CandidatePdfCanvas') === 'function');
      const result = await page.evaluate(async () => {
        const raw: unknown = Reflect.get(globalThis, 'PdfRenderLease');
        const isModule = (value: unknown): value is LifecycleModule => typeof value === 'object' && value !== null && 'createPdfRenderLifecycle' in value && typeof value.createPdfRenderLifecycle === 'function' && 'yieldPdfRender' in value && typeof value.yieldPdfRender === 'function';
        if (!isModule(raw)) throw new Error('Missing lifecycle API');
        const original: unknown = Reflect.get(globalThis, 'OriginalPdfCanvas'); const candidate: unknown = Reflect.get(globalThis, 'CandidatePdfCanvas');
        const isRunner = (value: unknown): value is CanvasRunner => typeof value === 'function';
        if (!isRunner(original) || !isRunner(candidate) || Reflect.get(candidate, 'renderLifecycleVersion') !== 2) throw new Error('Missing candidate API');
        let yields = 0;
        const render = async (runner: CanvasRunner, cooperative: boolean, owned: boolean) => {
          const source = document.createElement('iframe'); document.body.append(source); const doc = source.contentDocument;
          if (!doc) throw new Error('Missing source document');
          doc.body.style.margin = '0';
          const root = doc.createElement('div'); root.style.cssText = 'width:640px;background:white;color:#123456;font:18px serif;padding:12px;box-sizing:border-box'; doc.body.append(root);
          for (let index = 0; index < 42; index++) {
            const p = doc.createElement('p'); p.style.cssText = 'margin:3px 0;border-bottom:1px solid #aabbcc'; p.append(`Question ${index + 1}: `);
            const strong = doc.createElement('strong'); strong.textContent = 'x + y = 37'; p.append(strong, ' and 3/7'); root.append(p);
          }
          const drawing = document.createElement('canvas'); drawing.width = 80; drawing.height = 50;
          const paint = drawing.getContext('2d'); if (!paint) throw new Error('Missing drawing context'); paint.fillStyle = '#126547'; paint.fillRect(3, 4, 61, 32);
          const image = doc.createElement('img'); image.src = drawing.toDataURL('image/png'); image.style.cssText = 'width:80px;height:50px'; root.append(image); await image.decode();
          const svg = doc.createElementNS('http://www.w3.org/2000/svg', 'svg'); svg.setAttribute('width', '90'); svg.setAttribute('height', '45');
          const circle = doc.createElementNS(svg.namespaceURI, 'circle'); circle.setAttribute('cx', '25'); circle.setAttribute('cy', '20'); circle.setAttribute('r', '14'); circle.setAttribute('fill', '#2468ac'); svg.append(circle); root.append(svg);
          const lease = raw.createPdfRenderLifecycle(doc, () => {});
          try {
            const value: unknown = await runner(root, { logging: false, scale: 2, backgroundColor: '#ffffff', removeContainer: true,
              ...(owned ? { renderLifecycle: { assertActive: lease.assertActive, ...(cooperative ? { yieldControl: () => { yields++; return raw.yieldPdfRender(lease); } } : {}) }, onclone: (clone: Document) => lease.bindClone(clone) } : {}),
            });
            if (!(value instanceof HTMLCanvasElement)) throw new Error('Missing rendered canvas');
            if (owned) lease.completeRendering();
            if (doc.querySelectorAll('iframe').length !== 0) throw new Error('Clone retained after successful rendering');
            return value;
          } finally { lease.dispose(); source.remove(); }
        };
        const baseline = await render(original, false, false); const first = await render(candidate, false, true); const later = await render(candidate, true, true);
        const pixels = (canvas: HTMLCanvasElement) => { const ctx = canvas.getContext('2d'); if (!ctx) throw new Error('Missing pixel context'); return ctx.getImageData(0, 0, canvas.width, canvas.height).data; };
        const expected = pixels(baseline);
        const check = (canvas: HTMLCanvasElement) => { const actual = pixels(canvas); let differences = Math.abs(actual.length - expected.length); for (let i = 0; i < Math.min(actual.length, expected.length); i++) if (actual[i] !== expected[i]) differences++; return { differences, jpegEqual: canvas.toDataURL('image/jpeg', .94) === baseline.toDataURL('image/jpeg', .94), width: canvas.width, height: canvas.height }; };
        const firstResult = check(first); const laterResult = check(later);
        for (const canvas of [baseline, first, later]) { canvas.width = 0; canvas.height = 0; }
        return { first: firstResult, later: laterResult, yields, frames: document.querySelectorAll('iframe').length };
      });
      expect(result.first.differences).toBe(0); expect(result.later.differences).toBe(0);
      expect(result.first.jpegEqual).toBe(true); expect(result.later.jpegEqual).toBe(true);
      expect(result.yields).toBeGreaterThan(0); expect(result.frames).toBe(0);
    });
  }
});

for (const scenario of ['native', 'fallback', 'resume-invalid', 'pre-invalid'] as const) {
  test(`cooperative yield lifecycle: ${scenario}`, async ({ page }) => {
    await page.goto('about:blank'); await page.addScriptTag({ content: bundle });
    const result = await page.evaluate(async scenario => {
      const raw: unknown = Reflect.get(globalThis, 'PdfRenderLease');
      const isModule = (value: unknown): value is Pick<LifecycleModule, 'yieldPdfRender'> => typeof value === 'object' && value !== null && 'yieldPdfRender' in value && typeof value.yieldPdfRender === 'function';
      if (!isModule(raw)) throw new Error('Missing yield API');
      const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'scheduler');
      let release: (() => void) | undefined; let timer = false; let invalid = scenario === 'pre-invalid'; let checks = 0; let called = 0;
      const lifecycle = { assertActive: () => { checks++; if (invalid) throw new Error('OLD_RENDER_INVALID'); } };
      try {
        if (scenario === 'fallback') Object.defineProperty(globalThis, 'scheduler', { configurable: true, value: undefined });
        if (scenario === 'resume-invalid' || scenario === 'pre-invalid') Object.defineProperty(globalThis, 'scheduler', { configurable: true, value: { yield: () => { called++; return new Promise<void>(resolve => { release = resolve; }); } } });
        const scheduler: unknown = Reflect.get(globalThis, 'scheduler');
        const native = typeof scheduler === 'object' && scheduler !== null && 'yield' in scheduler && typeof scheduler.yield === 'function';
        setTimeout(() => { timer = true; }, 0);
        const pending = raw.yieldPdfRender(lifecycle).then(() => ({ error: undefined }), (error: unknown) => ({ error: error instanceof Error ? error.message : String(error) }));
        if (scenario === 'resume-invalid') { if (!release) throw new Error('Yield did not suspend'); invalid = true; release(); }
        return { ...(await pending), checks, called, timer, native };
      } finally { if (descriptor) Object.defineProperty(globalThis, 'scheduler', descriptor); else Reflect.deleteProperty(globalThis, 'scheduler'); }
    }, scenario);
    if (scenario === 'resume-invalid' || scenario === 'pre-invalid') expect(result.error).toBe('OLD_RENDER_INVALID'); else expect(result.error).toBeUndefined();
    if (scenario === 'native') expect(result.native).toBe(true);
    if (scenario === 'fallback') { expect(result.native).toBe(false); expect(result.timer).toBe(true); }
    if (scenario === 'pre-invalid') { expect(result.checks).toBe(1); expect(result.called).toBe(0); } else expect(result.checks).toBe(2);
  });
}

test.describe('held renderer resource continuations', () => {
  for (const kind of ['image', 'svg', 'background', 'list'] as const) for (const failure of ['cancel', 'deadline'] as const) {
    test(`${kind}: ${failure} survives image catch and leaves the next render independent`, async ({ page }) => {
      await page.goto('about:blank'); await page.addScriptTag({ content: bundle });
      if (!stagedPackage) throw new Error('Missing candidate package');
      await page.addScriptTag({ content: readFileSync(resolve(stagedPackage, 'dist/html2canvas.js'), 'utf8') });
      const result = await page.evaluate(async ({ kind, failure }) => {
        const raw: unknown = Reflect.get(globalThis, 'PdfRenderLease'); const runner: unknown = Reflect.get(globalThis, 'html2canvas');
        const isModule = (value: unknown): value is Pick<LifecycleModule, 'createPdfRenderLifecycle'> => typeof value === 'object' && value !== null && 'createPdfRenderLifecycle' in value && typeof value.createPdfRenderLifecycle === 'function';
        const isRunner = (value: unknown): value is CanvasRunner => typeof value === 'function';
        if (!isModule(raw) || !isRunner(runner)) throw new Error('Missing candidate API');
        const swatch = document.createElement('canvas'); swatch.width = 24; swatch.height = 24; const swatchContext = swatch.getContext('2d');
        if (!swatchContext) throw new Error('Missing swatch context'); swatchContext.fillStyle = '#237867'; swatchContext.fillRect(0, 0, 24, 24);
        const data = swatch.toDataURL('image/png'); const decoded = new Image(); decoded.src = data; await decoded.decode();
        const source = document.createElement('iframe'); document.body.append(source); const doc = source.contentDocument; if (!doc) throw new Error('Missing source document');
        const element = doc.createElement(kind === 'list' ? 'li' : 'div'); element.style.cssText = 'width:200px;height:80px;background-color:white;font:18px serif'; element.textContent = 'Owned render A'; doc.body.append(element);
        if (kind === 'image') { const image = doc.createElement('img'); image.src = data; element.append(image); }
        if (kind === 'background') element.style.backgroundImage = `url("${data}")`;
        if (kind === 'list') element.style.listStyleImage = `url("${data}")`;
        if (kind === 'svg') { const svg = doc.createElementNS('http://www.w3.org/2000/svg', 'svg'); svg.setAttribute('width', '24'); svg.setAttribute('height', '24'); const rect = doc.createElementNS(svg.namespaceURI, 'rect'); rect.setAttribute('width', '24'); rect.setAttribute('height', '24'); svg.append(rect); element.append(svg); }
        const controller = new AbortController(); let deadline = Infinity; let checks = 0;
        const lease = raw.createPdfRenderLifecycle(doc, () => { checks++; if (controller.signal.aborted) throw new Error('导出已取消。'); if (Date.now() >= deadline) throw new Error('DEADLINE_EXPIRED'); });
        let release: ((image: HTMLImageElement) => void) | undefined; let held: (() => void) | undefined;
        const heldReady = new Promise<void>(resolve => { held = resolve; }); const blocked = new Promise<HTMLImageElement>(resolve => { release = resolve; });
        const cache = { addImage: () => Promise.resolve(), match: () => { if (held) held(); return blocked; } };
        const surface = document.createElement('canvas'); const context = surface.getContext('2d'); if (!context) throw new Error('Missing render context');
        let draws = 0;
        for (const name of ['drawImage', 'fill', 'fillRect', 'fillText', 'stroke', 'strokeRect', 'strokeText']) {
          const operation: unknown = Reflect.get(context, name); if (typeof operation !== 'function') throw new Error('Missing paint operation');
          Reflect.set(context, name, (...args: unknown[]) => { draws++; Reflect.apply(operation, context, args); });
        }
        let settled = false;
        const outcome = runner(element, { cache, canvas: surface, logging: false, scale: 1, renderLifecycle: { assertActive: lease.assertActive, onDispose: lease.onDispose }, onclone: (clone: Document) => lease.bindClone(clone) }).then(() => { settled = true; return 'UNEXPECTED_SUCCESS'; }, (error: unknown) => { settled = true; return error instanceof Error ? error.message : String(error); });
        await Promise.race([heldReady, outcome.then(reason => { throw new Error('Renderer settled before resource hold: ' + reason); })]); const before = draws;
        if (failure === 'cancel') controller.abort();
        else { deadline = Date.now() + 30; await new Promise<void>(resolve => setTimeout(resolve, 45)); }
        lease.dispose();
        const immediateWidth = surface.width; const immediateHeight = surface.height; const immediateClones = doc.querySelectorAll('iframe').length;
        const next = document.createElement('iframe'); document.body.append(next); const nextDoc = next.contentDocument; if (!nextDoc) throw new Error('Missing next document');
        const nextElement = nextDoc.createElement('div'); nextElement.style.cssText = 'width:160px;height:60px;background:white'; nextElement.textContent = 'Independent render B'; nextDoc.body.append(nextElement);
        const nextLease = raw.createPdfRenderLifecycle(nextDoc, () => {});
        let nextWidth = 0;
        try {
          const value = await runner(nextElement, { logging: false, scale: 1, renderLifecycle: { assertActive: nextLease.assertActive }, onclone: (clone: Document) => nextLease.bindClone(clone) });
          if (!(value instanceof HTMLCanvasElement)) throw new Error('Missing next canvas'); nextLease.completeRendering(); nextWidth = value.width; value.width = 0; value.height = 0;
        } finally { nextLease.dispose(); next.remove(); }
        const stillHeld = !settled; if (!release) throw new Error('Missing release'); release(decoded);
        const error = await outcome; const cloneCount = doc.querySelectorAll('iframe').length; lease.dispose(); source.remove(); swatch.width = 0; swatch.height = 0;
        return { error, before, after: draws, stillHeld, nextWidth, width: surface.width, height: surface.height, checks, clones: cloneCount, frames: document.querySelectorAll('iframe').length, immediateWidth, immediateHeight, immediateClones };
      }, { kind, failure });
      expect(result.error).toBe(failure === 'cancel' ? '导出已取消。' : 'DEADLINE_EXPIRED');
      expect(result.immediateWidth).toBe(0); expect(result.immediateHeight).toBe(0); expect(result.immediateClones).toBe(0);
      expect(result.stillHeld).toBe(true); expect(result.nextWidth).toBeGreaterThan(0);
      expect(result.after).toBe(result.before); expect(result.width).toBe(0); expect(result.height).toBe(0); expect(result.frames).toBe(0); expect(result.clones).toBe(0);
      expect(result.checks).toBeGreaterThan(1);
    });
  }
});

test.describe('clone stage rejection cleanup', () => {
  for (const mode of ['throw', 'reject', 'cancel', 'deadline'] as const) {
    test(`${mode}: removes the owned clone while retaining the source`, async ({ page }) => {
      await page.goto('about:blank'); await page.addScriptTag({ content: bundle });
      if (!stagedPackage) throw new Error('Missing candidate package');
      await page.addScriptTag({ content: readFileSync(resolve(stagedPackage, 'dist/html2canvas.js'), 'utf8') });
      const result = await page.evaluate(async mode => {
        const raw: unknown = Reflect.get(globalThis, 'PdfRenderLease'); const runner: unknown = Reflect.get(globalThis, 'html2canvas');
        const isModule = (value: unknown): value is Pick<LifecycleModule, 'createPdfRenderLifecycle'> => typeof value === 'object' && value !== null && 'createPdfRenderLifecycle' in value && typeof value.createPdfRenderLifecycle === 'function';
        const isRunner = (value: unknown): value is CanvasRunner => typeof value === 'function';
        if (!isModule(raw) || !isRunner(runner)) throw new Error('Missing candidate API');
        const source = document.createElement('iframe'); document.body.append(source); const doc = source.contentDocument; if (!doc) throw new Error('Missing source document');
        const element = doc.createElement('div'); element.textContent = 'Clone cleanup'; doc.body.append(element);
        const expected = new Error('CLONE_STAGE_FAILURE'); const controller = new AbortController(); let expired = false;
        const lease = raw.createPdfRenderLifecycle(doc, () => { if (controller.signal.aborted || expired) throw expected; });
        let caught: unknown;
        try {
          await runner(element, { logging: false, removeContainer: true, renderLifecycle: { assertActive: lease.assertActive }, onclone: (clone: Document) => {
            if (mode === 'cancel') controller.abort(); if (mode === 'deadline') expired = true;
            lease.bindClone(clone);
            if (mode === 'reject') return Promise.reject(expected);
            throw expected;
          } });
        } catch (error) { caught = error; }
        const clones = doc.querySelectorAll('iframe').length; const sourceConnected = source.isConnected; const sameError = caught === expected;
        lease.dispose(); source.remove(); return { clones, sourceConnected, sameError };
      }, mode);
      expect(result.sameError).toBe(true); expect(result.sourceConnected).toBe(true); expect(result.clones).toBe(0);
    });
  }
});
