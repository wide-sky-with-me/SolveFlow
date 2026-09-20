import { runInNewContext } from 'node:vm';
import { expect, it } from 'vitest';
import { prepareDomHtml } from '../../scripts/prepare-dom-bootstrap.mjs';
const html = `<html><body><div id="root"></div><script>var injectedObject = {};try {injectedObject = JSON.parse(window.ReactNativeWebView.injectedObjectJson());} catch(e){throw e;}
window.$$EXPO_DOM_HOST_OS = injectedObject.EXPO_DOM_HOST_OS; window.$$EXPO_INITIAL_PROPS = injectedObject.initialProps;</script><script src="./_expo/static/js/web/entry-123.js" defer></script></body></html>`;
function harness() {
  const prepared = prepareDomHtml(html); const code = /<script id="solveflow-dom-bootstrap-v1">([\s\S]*?)<\/script>/.exec(prepared)![1]!;
  const queue: (() => void)[] = []; const loaded: unknown[] = []; const props = { props: { payload: 'untrusted `${text}` </script>' }, names: ['onReady'] };
  const win: { ReactNativeWebView: { injectedObjectJson?: () => string }; $$EXPO_INITIAL_PROPS?: unknown; addEventListener: (name: string, listener: () => void) => void } = { ReactNativeWebView: {}, addEventListener: (_name, listener) => { hide = listener; } };
  let hide = () => {}; const dataset: Record<string, string> = {};
  runInNewContext(code, { window: win, document: { documentElement: { dataset }, createElement: () => ({}), body: { appendChild: (node: unknown) => { loaded.push(node); } } }, setTimeout: (fn: () => void) => { queue.push(fn); return 1; }, clearTimeout: () => { queue.length = 0; } });
  return { win, queue, loaded, dataset, props, hide: () => hide() };
}
it('waits for both a late bridge and its data before starting the local entry once', () => {
  const h = harness(); expect(h.loaded).toHaveLength(0);
  h.queue.shift()!(); h.win.ReactNativeWebView.injectedObjectJson = () => 'null'; h.queue.shift()!(); expect(h.loaded).toHaveLength(0);
  h.win.ReactNativeWebView.injectedObjectJson = () => JSON.stringify({ EXPO_DOM_HOST_OS: 'android', initialProps: h.props }); h.queue.shift()!();
  expect(h.win.$$EXPO_INITIAL_PROPS).toEqual(h.props); expect(h.loaded).toHaveLength(1); expect(h.queue).toHaveLength(0); expect(h.dataset.solveflowBootstrap).toBe('ready');
});
it('stops after its bounded wait without running a partially initialized document', () => {
  const h = harness(); let attempts = 0;
  while (h.queue.length) { h.queue.shift()!(); expect(++attempts).toBeLessThan(161); }
  expect(attempts).toBe(159); expect(h.loaded).toHaveLength(0); expect(h.dataset.solveflowBootstrap).toBe('failed');
});
it('cancels on page disposal and rejects unknown or external bootstrap templates', () => {
  const h = harness(); h.hide(); expect(h.queue).toHaveLength(0); expect(h.loaded).toHaveLength(0);
  expect(prepareDomHtml(prepareDomHtml(html))).toBe(prepareDomHtml(html));
  for (const value of ['<html></html>', html.replace('./_expo/static/js/web/entry-123.js', 'https://untrusted.example/run.js')]) expect(() => prepareDomHtml(value)).toThrow('UNSUPPORTED_EXPO_DOM_HTML');
});
