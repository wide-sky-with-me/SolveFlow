import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { ExportTaskFailure } from '@solveflow/client/local';
import { expect, it, vi } from 'vitest';

const source = readFileSync(new URL('./batch-export-root.web.tsx', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
function fixture(options: { createError?: boolean; renderError?: boolean; unmountError?: boolean; cleanupError?: boolean } = {}) {
  const user = new AbortController(); const nodes: unknown[] = [];
  let reportError: ((error: unknown) => void) | undefined;
  const container = { style: { cssText: '' }, setAttribute: vi.fn(), inert: false, firstElementChild: { copyIndex: 1 }, remove: vi.fn() };
  const render = vi.fn((node: unknown) => { if (options.renderError) throw new Error('UNTRUSTED_RENDER'); nodes.push(node); });
  const unmount = vi.fn(() => { if (options.cleanupError) reportError?.(new Error('UNTRUSTED_CLEANUP')); if (options.unmountError) throw new Error('UNTRUSTED_UNMOUNT'); });
  const create = vi.fn((_container: unknown, config: { onUncaughtError: (error: unknown) => void }) => { if (options.createError) throw new Error('UNTRUSTED_CREATE'); reportError = config.onUncaughtError; return { render, unmount }; });
  const transition = vi.fn((work: () => void) => work());
  const dependencies: Record<string, unknown> = {
    react: { startTransition: transition, useEffect: (effect: () => void) => effect() },
    'react-dom/client': { createRoot: create },
    'react/jsx-runtime': { jsx: (type: unknown, props: unknown) => ({ type, props }) },
    '@solveflow/client/local': { ExportTaskFailure },
  };
  const exported: Record<string, unknown> = {}; const append = vi.fn();
  new Function('require', 'exports', 'document', compiled)((name: string) => dependencies[name] ?? {}, exported, { createElement: () => container, body: { append } });
  const factory = exported.createBatchExportRoot;
  if (typeof factory !== 'function') throw new Error('ROOT_FACTORY_MISSING');
  const commit = (index = 0) => {
    const node = nodes[index];
    if (!node || typeof node !== 'object' || !('type' in node) || typeof node.type !== 'function' || !('props' in node)) throw new Error('COMMIT_MISSING');
    return node.type(node.props);
  };
  return { mount: () => factory(user.signal), user, container, append, create, render, unmount, transition, commit, fail: () => { if (!reportError) throw new Error('ROOT_MISSING'); reportError(new Error('UNTRUSTED_EFFECT')); } };
}

it('waits for a commit without adding a DOM wrapper and confirms every copy independently', async () => {
  const f = fixture(); const root = f.mount(); const first = root.render('COPY_ONE'); let delivered = false;
  void first.then(() => { delivered = true; }); await Promise.resolve();
  expect(delivered).toBe(false); expect(f.transition).toHaveBeenCalledTimes(1); expect(f.render).toHaveBeenCalledTimes(1);
  expect(f.commit()).toBe('COPY_ONE'); await expect(first).resolves.toBe(f.container.firstElementChild);
  f.container.firstElementChild = { copyIndex: 2 }; const second = root.render('COPY_TWO'); let secondDelivered = false;
  void second.then(() => { secondDelivered = true; }); f.commit(0); await Promise.resolve(); expect(secondDelivered).toBe(false);
  expect(f.commit(1)).toBe('COPY_TWO'); await expect(second).resolves.toEqual({ copyIndex: 2 });
  root.dispose(); root.dispose(); expect(f.unmount).toHaveBeenCalledTimes(1); expect(f.container.remove).toHaveBeenCalledTimes(1);
  expect(f.container.inert).toBe(true); expect(f.container.style.cssText).toContain('width:800px');
});
it('keeps the first pending copy when an overlapping render is attempted', async () => {
  const f = fixture(); const root = f.mount(); const first = root.render('FIRST');
  await expect(root.render('SECOND')).rejects.toThrow('仍在渲染'); expect(f.render).toHaveBeenCalledTimes(1);
  f.commit(); await expect(first).resolves.toBe(f.container.firstElementChild); root.dispose();
});
it('cancels pending work and ignores a late commit without changing the parent signal', async () => {
  const f = fixture(); const root = f.mount(); const pending = root.render('FIRST'); const reason = new Error('USER_CANCELLED');
  f.user.abort(reason); await expect(pending).rejects.toBe(reason); f.commit();
  await expect(root.render('SECOND')).rejects.toBe(reason); root.dispose(); expect(root.signal.reason).toBe(reason);
});
it('stops a resolved commit when cancellation wins the await continuation', async () => {
  const f = fixture(); const root = f.mount(); const pending = root.render('FIRST');
  f.commit(); const reason = new Error('USER_CANCELLED'); f.user.abort(reason); await expect(pending).rejects.toBe(reason); root.dispose();
});
it('locks in a root effect failure even after its commit acknowledgement', async () => {
  const f = fixture(); const root = f.mount(); const pending = root.render('FIRST'); f.commit(); f.fail();
  await expect(pending).rejects.toBeInstanceOf(ExportTaskFailure); expect(root.signal.aborted).toBe(true); expect(f.user.signal.aborted).toBe(false);
  await expect(pending).rejects.toThrow('PDF 文档渲染失败'); expect(root.signal.reason.message).not.toContain('UNTRUSTED'); root.dispose();
});
it('aborts downstream work on a root failure after the element was delivered', async () => {
  const f = fixture(); const root = f.mount(); const pending = root.render('FIRST'); f.commit(); await pending;
  f.fail(); expect(root.signal.aborted).toBe(true); expect(root.signal.reason).toBeInstanceOf(ExportTaskFailure);
  await expect(root.render('SECOND')).rejects.toBe(root.signal.reason); root.dispose();
});
it('settles pending work before disposal and releases abort listeners exactly once', async () => {
  const f = fixture(); const root = f.mount(); const removeUser = vi.spyOn(f.user.signal, 'removeEventListener'); const removeChild = vi.spyOn(root.signal, 'removeEventListener');
  const pending = root.render('FIRST'); root.dispose(); await expect(pending).rejects.toThrow('已结束'); f.commit(); root.dispose(); f.fail();
  expect(removeUser).toHaveBeenCalledTimes(1); expect(removeChild).toHaveBeenCalledTimes(1); expect(f.container.remove).toHaveBeenCalledTimes(1);
  await expect(root.render('SECOND')).rejects.toThrow('已结束');
});
it.each(['createError', 'renderError', 'unmountError', 'cleanupError'] as const)('releases the hidden container for %s', async key => {
  const f = fixture({ [key]: true });
  if (key === 'createError') { expect(f.mount).toThrow(ExportTaskFailure); expect(f.container.remove).toHaveBeenCalledTimes(1); return; }
  const root = f.mount();
  if (key === 'renderError') { await expect(root.render('FIRST')).rejects.toThrow('PDF 文档渲染失败'); root.dispose(); }
  else expect(() => root.dispose()).toThrow();
  expect(f.container.remove).toHaveBeenCalledTimes(1); expect(root.signal.aborted).toBe(true);
});
it('does not allocate a root for an already cancelled owner', () => {
  const f = fixture(); f.user.abort(); expect(f.mount).toThrow(); expect(f.create).not.toHaveBeenCalled(); expect(f.append).not.toHaveBeenCalled();
});
it('classifies a synchronous unmount failure without exposing its details', () => {
  const f = fixture({ unmountError: true }); const root = f.mount(); expect(() => root.dispose()).toThrow('PDF 文档渲染失败'); expect(f.container.remove).toHaveBeenCalledTimes(1);
});
