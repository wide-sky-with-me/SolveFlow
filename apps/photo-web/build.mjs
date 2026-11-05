import { prepareImageCodec } from '../../scripts/prepare-image-codec.mjs';
import { build } from 'esbuild';
import { cp, mkdir, writeFile, readdir, readFile, rm } from 'node:fs/promises';
import { brotliCompressSync, gzipSync } from 'node:zlib';
await rm('dist', { recursive: true, force: true });
await mkdir('dist/public', { recursive: true });
await prepareImageCodec('dist/public');
const browser = await build({ entryPoints: ['src/browser/main.tsx'], outdir: 'dist/public', bundle: true, platform: 'browser', jsx: 'automatic', format: 'esm', target: ['safari16', 'chrome110'], minify: true, entryNames: '[name]-[hash]', assetNames: '[name]-[hash]', loader: { '.woff2': 'file', '.woff': 'file', '.ttf': 'file', '.svg': 'file' }, metafile: true, define: { 'process.env.NODE_ENV': '"production"' } });
for (const file of Object.keys(browser.metafile.inputs)) if (/packages\/(agent|config|db)\/|src\/server\//.test(file)) throw new Error('PRIVATE_SERVER_CODE_IN_BROWSER');
const js = Object.keys(browser.metafile.outputs).find(p => p.endsWith('.js'));
const css = Object.keys(browser.metafile.outputs).find(p => p.endsWith('.css'));
const icon = Object.keys(browser.metafile.outputs).find(p => p.endsWith('.svg'));
if (!js || !icon) throw new Error('Missing browser entry or brand asset.');
await writeFile('dist/public/index.html', `<!doctype html><html lang="zh-CN"><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="theme-color" content="#f5f7fb"><meta name="robots" content="noindex,nofollow"><title>SolveFlow · 拍照解题</title><link rel="icon" href="/${icon.split('/').at(-1)}" type="image/svg+xml">${css ? `<link rel="stylesheet" href="/${css.split('/').at(-1)}">` : ''}<script type="module" src="/${js.split('/').at(-1)}"></script><div id="root"></div></html>`);
await cp('src/browser/icon.svg', 'dist/public/icon.svg');
for (const file of await readdir('dist/public')) if (/\.(js|css|html|svg)$/.test(file)) {
  const bytes = await readFile('dist/public/' + file);
  await writeFile('dist/public/' + file + '.br', brotliCompressSync(bytes));
  await writeFile('dist/public/' + file + '.gz', gzipSync(bytes));
}
await build({ entryPoints: ['src/server/main.ts'], outfile: 'dist/server.mjs', bundle: true, platform: 'node', target: 'node24', format: 'esm', external: ['sharp'], minify: true, banner: { js: "import { createRequire as __createRequire } from 'node:module';const require=__createRequire(import.meta.url);" } });
await writeFile('dist/browser-manifest.json', JSON.stringify(browser.metafile));
console.log('Built standalone photo web browser and fixed-purpose server.');
