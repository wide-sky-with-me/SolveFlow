import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { mkdir, copyFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { build } from 'esbuild';
const require = createRequire(new URL('../packages/image-input/package.json', import.meta.url));
export async function prepareImageCodec(directory) {
  await mkdir(directory, { recursive: true });
  await copyFile(require.resolve('libheif-js/libheif-wasm/libheif-bundle.js'), resolve(directory, 'heic-codec-1-23-5.js'));
  await copyFile(require.resolve('libheif-js/libheif-wasm/LICENSE'), resolve(directory, 'heic-license-1-23-5.txt'));
  await writeFile(resolve(directory, 'heic-source-1-23-5.txt'), 'libheif-js 1.23.5 (LGPL-3.0). Unmodified, separately replaceable decoder.\nSource and build instructions: https://github.com/catdad-experiments/libheif-js/tree/v1.23.5\nSource archive: https://registry.npmjs.org/libheif-js/-/libheif-js-1.23.5.tgz\n');
  await build({ entryPoints: [fileURLToPath(new URL('../packages/image-input/src/worker.ts', import.meta.url))], outfile: resolve(directory, 'heic-worker-1-23-5.js'), platform: 'browser', target: ['safari16', 'chrome110'], bundle: true, minify: true });
}
