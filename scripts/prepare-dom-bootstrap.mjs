import { readdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const marker = 'solveflow-dom-bootstrap-v1';
/** Adapt our generated local HTML, never installed SDK source or model content. */
export function prepareDomHtml(html) {
  if (html.includes(marker)) return html;
  const bootstrap = /<script>\s*var injectedObject = \{\};[\s\S]*?window\.\$\$EXPO_INITIAL_PROPS = injectedObject\.initialProps;\s*<\/script>/g;
  const entries = [...html.matchAll(/<script src="([^"<>]+)" defer><\/script>/g)];
  if ([...html.matchAll(bootstrap)].length !== 1 || !entries.length || entries.some(entry => !/^\.\/_expo\/static\/js\/web\/[a-zA-Z0-9_-]+\.js$/.test(entry[1]))) throw new Error('UNSUPPORTED_EXPO_DOM_HTML');
  const sources = entries.map(entry => entry[1]);
  let output = html.replace(bootstrap, '');
  for (const entry of entries) output = output.replace(entry[0], '');
  const script = `<script id="${marker}">
(function () {
  var attempts = 0, started = false, timer;
  function fail() { document.documentElement.dataset.solveflowBootstrap = 'failed'; }
  function load(index) {
    if (index === sources.length) return;
    var script = document.createElement('script');
    script.src = sources[index]; script.async = false;
    script.onload = function () { load(index + 1); }; script.onerror = fail;
    document.body.appendChild(script);
  }
  var sources = ${JSON.stringify(sources)};
  function start() {
    if (started) return;
    var value;
    try {
      if (typeof window.ReactNativeWebView?.injectedObjectJson === 'function') value = JSON.parse(window.ReactNativeWebView.injectedObjectJson());
    } catch (_) { /* Native injection may still be in progress. */ }
    if (value && value.initialProps && typeof value.initialProps.props === 'object' && Array.isArray(value.initialProps.names)) {
      started = true;
      window.$$EXPO_DOM_HOST_OS = value.EXPO_DOM_HOST_OS;
      window.$$EXPO_INITIAL_PROPS = value.initialProps;
      document.documentElement.dataset.solveflowBootstrap = 'ready';
      load(0); return;
    }
    if (++attempts >= 160) { fail(); return; }
    timer = setTimeout(start, 25);
  }
  window.addEventListener('pagehide', function () { started = true; clearTimeout(timer); }, { once: true });
  start();
})();
</script>`;
  if (!output.includes('</body>')) throw new Error('UNSUPPORTED_EXPO_DOM_HTML');
  return output.replace('</body>', () => script + '\n</body>');
}
export async function prepareDomDirectory(directory) {
  const root = resolve(directory, 'www.bundle');
  const files = (await readdir(root)).filter(name => name.endsWith('.html'));
  if (!files.length) throw new Error('NO_EXPO_DOM_DOCUMENTS');
  for (const file of files) { const path = resolve(root, file); await writeFile(path, prepareDomHtml(await readFile(path, 'utf8'))); }
  return files.length;
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  if (!process.argv[2]) throw new Error('Expected generated Android JS assets directory');
  console.log(`Prepared ${await prepareDomDirectory(process.argv[2])} local DOM documents with bounded native-props readiness.`);
}
