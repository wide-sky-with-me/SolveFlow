import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { expect, it, vi } from 'vitest';

const source = readFileSync(new URL('./math-text.tsx', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
function deferred() { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; }
function fixture() {
  let width = 324; let natural = 300; let refIndex = 0;
  const fonts = deferred(); const document = { fonts: { ready: fonts.promise } };
  const widthRead = vi.fn(() => width); const overflow = vi.fn();
  let fontSize = ''; const fontWrite = vi.fn((value: string) => { fontSize = value; });
  const style = { get fontSize() { return fontSize; }, set fontSize(value: string) { fontWrite(value); } };
  const bounds = vi.fn(() => ({ width: natural * parseFloat(style.fontSize || '1em') }));
  const outer = { get clientWidth() { return widthRead(); } }; const inner = { style, getBoundingClientRect: bounds };
  const cleanups: (() => void)[] = []; const observers: Observer[] = [];
  class Observer {
    readonly observe = vi.fn(); readonly disconnect = vi.fn();
    constructor(readonly callback: () => void) { observers.push(this); }
  }
  const jsx = (type: unknown, props: unknown): unknown => typeof type === 'function' ? type(props) : { type, props };
  const dependencies: Record<string, unknown> = {
    react: { memo: (value: unknown) => value, useRef: () => ({ current: refIndex++ % 2 === 0 ? outer : inner }), useState: () => [false, overflow], useEffect: (effect: () => () => void) => { cleanups.push(effect()); } },
    'react/jsx-runtime': { jsx, jsxs: jsx }, './math-render': { renderFormula: (latex: string) => latex },
  };
  const exported: Record<string, unknown> = {};
  new Function('require', 'exports', 'document', 'ResizeObserver', compiled)((name: string) => dependencies[name] ?? {}, exported, document, Observer);
  const mount = (latex = 'FORMULA') => { const block = exported.MathBlock; if (typeof block !== 'function') throw new Error('MATH_BLOCK_MISSING'); block({ latex }); };
  const cleanup = () => { const stop = cleanups.at(-1); if (!stop) throw new Error('EFFECT_MISSING'); stop(); };
  const clear = () => { widthRead.mockClear(); bounds.mockClear(); overflow.mockClear(); fontWrite.mockClear(); };
  return { mount, cleanup, clear, fonts, document, observers, widthRead, bounds, overflow, fontWrite, style, setWidth: (value: number) => { width = value; }, setNatural: (value: number) => { natural = value; } };
}

it('ignores late font readiness before reading a released formula layout', async () => {
  const f = fixture(); f.mount(); f.cleanup(); f.clear(); f.fonts.resolve(); await Promise.resolve();
  expect(f.widthRead).not.toHaveBeenCalled(); expect(f.bounds).not.toHaveBeenCalled(); expect(f.fontWrite).not.toHaveBeenCalled(); expect(f.overflow).not.toHaveBeenCalled();
  expect(f.observers[0]?.disconnect).toHaveBeenCalledOnce();
});
it('ignores an already queued resize callback after cleanup', () => {
  const f = fixture(); f.mount(); f.cleanup(); f.clear(); f.observers[0]?.callback();
  expect(f.widthRead).not.toHaveBeenCalled(); expect(f.bounds).not.toHaveBeenCalled(); expect(f.fontWrite).not.toHaveBeenCalled(); expect(f.overflow).not.toHaveBeenCalled();
});
it('isolates old font callbacks from a replacement formula on the same nodes', async () => {
  const f = fixture(); f.mount('FIRST'); f.cleanup(); const next = deferred(); f.document.fonts.ready = next.promise; f.mount('SECOND'); f.clear();
  f.fonts.resolve(); await Promise.resolve(); expect(f.widthRead).not.toHaveBeenCalled(); expect(f.bounds).not.toHaveBeenCalled(); expect(f.overflow).not.toHaveBeenCalled();
  f.setNatural(800); next.resolve(); await Promise.resolve(); expect(f.widthRead).toHaveBeenCalledOnce(); expect(f.bounds).toHaveBeenCalledTimes(2); expect(f.style.fontSize).toBe('0.82em'); expect(f.overflow).toHaveBeenLastCalledWith(true); f.cleanup();
});
it('remeasures active fonts at the same viewport width and preserves the minimum font size', async () => {
  const f = fixture(); f.mount(); f.clear(); f.setNatural(800); f.fonts.resolve(); await Promise.resolve();
  expect(f.widthRead).toHaveBeenCalledOnce(); expect(f.bounds).toHaveBeenCalledTimes(2); expect(f.style.fontSize).toBe('0.82em'); expect(f.overflow).toHaveBeenLastCalledWith(true); f.cleanup();
});
it('deduplicates unchanged active widths but measures a changed viewport', () => {
  const f = fixture(); f.mount(); f.clear(); f.observers[0]?.callback(); expect(f.widthRead).toHaveBeenCalledOnce(); expect(f.bounds).not.toHaveBeenCalled(); expect(f.fontWrite).not.toHaveBeenCalled();
  f.setWidth(644); f.observers[0]?.callback(); expect(f.bounds).toHaveBeenCalledTimes(2); expect(f.style.fontSize).toBe('1em'); expect(f.overflow).toHaveBeenLastCalledWith(false); f.cleanup();
});
it('does not measure content at a nonpositive viewport width', () => {
  const f = fixture(); f.setWidth(4); f.mount(); expect(f.bounds).not.toHaveBeenCalled(); expect(f.fontWrite).not.toHaveBeenCalled(); expect(f.overflow).not.toHaveBeenCalled(); f.cleanup();
});
it.each([[324, 300, '1em', false], [324, 800, '0.82em', true], [404, 450, `${400 / 450}em`, false]] as const)('preserves fitting and overflow for viewport %s and formula %s', (width, natural, fontSize, overflow) => {
  const f = fixture(); f.setWidth(width); f.setNatural(natural); f.mount(); expect(f.bounds).toHaveBeenCalledTimes(2); expect(f.style.fontSize).toBe(fontSize); expect(f.overflow).toHaveBeenLastCalledWith(overflow); f.cleanup();
});
