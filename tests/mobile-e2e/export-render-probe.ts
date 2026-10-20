import ts from 'typescript';
import type { Page } from '@playwright/test';

type Location = { lineNumber: number; columnNumber: number };
export function exportRenderLocations(text: string) {
  const source = ts.createSourceFile('bundle.js', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const dialogs: Location[] = []; const progress: Location[] = [];
  function location(node: ts.Node): Location { const value = source.getLineAndCharacterOfPosition(node.getStart(source)); return { lineNumber: value.line, columnNumber: value.character }; }
  function visit(node: ts.Node): void {
    if (ts.isStringLiteral(node) && node.text === '重试保存并下载') {
      let owner: ts.Node | undefined = node.parent;
      while (owner && !ts.isFunctionDeclaration(owner) && !ts.isFunctionExpression(owner) && !ts.isArrowFunction(owner)) owner = owner.parent;
      if (owner && (ts.isFunctionDeclaration(owner) || ts.isFunctionExpression(owner) || ts.isArrowFunction(owner)) && owner.body && ts.isBlock(owner.body)) { const first = owner.body.statements.at(0); if (first) dialogs.push(location(first)); }
    }
    if (ts.isMethodDeclaration(node) && node.name.getText(source) === 'progress' && node.body) {
      const body = node.body.getText(source); const first = node.body.statements.at(0);
      if (first && body.includes('.records') && body.includes('.pending') && body.includes('.emit')) progress.push(location(first));
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  const dialog = dialogs.at(0); const tick = progress.at(0);
  if (!dialog || !tick || dialogs.length !== 1 || progress.length !== 1) throw new Error(`RENDER_PROBE_LOCATIONS:${dialogs.length}:${progress.length}`);
  return { dialog, progress: tick };
}
export async function trackExportRenders(page: Page) {
  const urls = await page.locator('script[src]').evaluateAll(nodes => nodes.flatMap(node => node instanceof HTMLScriptElement ? [node.src] : []));
  const url = urls.find(value => /\/index-[a-f0-9]+\.js(?:\?|$)/.test(value));
  if (!url) throw new Error('RENDER_PROBE_BUNDLE_MISSING');
  const response = await page.request.get(url); if (!response.ok()) throw new Error('RENDER_PROBE_BUNDLE_FETCH');
  const { dialog, progress: tick } = exportRenderLocations(await response.text());
  const session = await page.context().newCDPSession(page);
  try {
    await session.send('Debugger.enable');
    await page.evaluate('globalThis.__solveflowRenderProbe = { renders: 0, progress: 0, start: null, end: null }');
    // Conditional breakpoints count calls without pausing or shipping instrumentation.
    for (const [at, condition] of [[dialog, '(globalThis.__solveflowRenderProbe.renders++, false)'], [tick, '(globalThis.__solveflowRenderProbe.progress++, globalThis.__solveflowRenderProbe.progress === 10 && (globalThis.__solveflowRenderProbe.start = globalThis.__solveflowRenderProbe.renders), globalThis.__solveflowRenderProbe.progress === 30 && (globalThis.__solveflowRenderProbe.end = globalThis.__solveflowRenderProbe.renders), false)']] as const) {
      const result = await session.send('Debugger.setBreakpointByUrl', { url, ...at, condition });
      if (!result.locations.length) throw new Error('RENDER_PROBE_BREAKPOINT_MISSING');
    }
    return {
      async read() {
        const value: unknown = await page.evaluate('globalThis.__solveflowRenderProbe');
        if (!value || typeof value !== 'object' || !('renders' in value) || typeof value.renders !== 'number' || !('progress' in value) || typeof value.progress !== 'number' || !('start' in value) || value.start !== null && typeof value.start !== 'number' || !('end' in value) || value.end !== null && typeof value.end !== 'number') throw new Error('RENDER_PROBE_STATE');
        return { renders: value.renders, progress: value.progress, start: value.start, end: value.end };
      },
      close: () => session.detach(),
    };
  } catch (error) { await session.detach(); throw error; }
}
