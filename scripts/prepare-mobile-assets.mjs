import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const app = fileURLToPath(new URL('../apps/mobile/', import.meta.url));
const require = createRequire(new URL('../apps/mobile/package.json', import.meta.url));
const cssPath = require.resolve('katex/dist/katex.min.css');
let css = await readFile(cssPath, 'utf8');
// Bundle reviewed KaTeX WOFF2 fonts inside CSS: Metro does not copy CSS-relative URLs.
for (const match of [...css.matchAll(/src:([^}]+?)(?=;?})/g)]) {
  const font = /url\((?:["']?)(fonts\/[^)"']+\.woff2)(?:["']?)\) format\(["']woff2["']\)/.exec(match[1]);
  if (!font) throw new Error('KATEX_FONT_SOURCE_CHANGED');
  const bytes = await readFile(resolve(dirname(cssPath), font[1]));
  css = css.replace(match[0], `src:url(data:font/woff2;base64,${bytes.toString('base64')}) format("woff2")`);
}
if (/url\(["']?fonts\//.test(css)) throw new Error('UNBUNDLED_KATEX_FONT');
await mkdir(resolve(app, '.generated'), { recursive: true });
await writeFile(resolve(app, '.generated/katex.css'), css);
console.log('Prepared local KaTeX styles and fonts.');

await import('./bundle-mobile-agent.mjs');
