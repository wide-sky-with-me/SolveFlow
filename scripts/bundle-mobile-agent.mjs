import { build } from 'esbuild';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeFile } from 'node:fs/promises';
const root = fileURLToPath(new URL('../', import.meta.url));
const result = await build({ entryPoints: [resolve(root, 'packages/agent/dist/pi/mobile.js')], outfile: resolve(root, 'apps/mobile/.generated/agent.mjs'), bundle: true, platform: 'browser', format: 'esm', minify: true, metafile: true,
  external: ['@solveflow/contracts/*', 'zod'], define: { 'process.env': '{}' },
});
for (const path of Object.keys(result.metafile.inputs)) {
  if (/pi-coding-agent|packages\/(db|config)\/|apps\/api\//.test(path)) throw new Error('SERVER_CODE_IN_MOBILE_AGENT');
}
await writeFile(resolve(root, 'apps/mobile/.generated/agent-meta.json'), JSON.stringify(result.metafile));
console.log('Prepared browser-compatible Pi agent bundle without server configuration.');
