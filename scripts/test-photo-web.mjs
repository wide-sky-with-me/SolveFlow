import { build } from 'esbuild';
import { spawn } from 'node:child_process';
import { mkdir, stat, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createInterface } from 'node:readline';
const root = process.cwd();
await stat(resolve(root, 'apps/photo-web/dist/public/index.html'));
const output = resolve(root, '.runtime/photo-web-tests-' + new Date().toISOString().replace(/[:.]/g, '-'));
await mkdir(output, { recursive: true, mode: 0o700 });
await build({ entryPoints: ['tests/photo-web/fixture-server.ts'], outfile: 'apps/photo-web/.runtime/fixture-server.mjs', bundle: true, platform: 'node', format: 'esm', external: ['sharp'], banner: { js: "import {createRequire} from 'node:module';const require=createRequire(import.meta.url);" } });
const fixture = spawn(process.execPath, ['apps/photo-web/.runtime/fixture-server.mjs'], { cwd: root, stdio: ['ignore', 'pipe', 'inherit'] });
let tests;
try {
  const url = await new Promise((resolve, reject) => {
    const lines = createInterface({ input: fixture.stdout }); const timer = setTimeout(() => reject(new Error('PHOTO_FIXTURE_START_TIMEOUT')), 10000);
    fixture.once('exit', () => { clearTimeout(timer); reject(new Error('PHOTO_FIXTURE_EXITED')); });
    lines.once('line', line => { clearTimeout(timer); try { resolve(JSON.parse(line).url); } catch (e) { reject(e); } });
  });
  if (typeof url !== 'string' || !url.startsWith('http://127.0.0.1:')) throw new Error('INVALID_FIXTURE_URL');
  await writeFile(resolve(output, 'server.json'), JSON.stringify({ url, pid: fixture.pid }));
  tests = spawn('pnpm', ['exec', 'playwright', 'test', '--config', 'playwright.photo.config.ts', '--reporter', 'line'], { cwd: root, stdio: 'inherit', env: { ...process.env, SOLVEFLOW_PHOTO_TEST_URL: url, SOLVEFLOW_PHOTO_TEST_OUTPUT: output } });
  const timer = setTimeout(() => tests?.kill('SIGTERM'), 10 * 60000);
  process.exitCode = await new Promise(resolve => { tests.once('error', () => resolve(1)); tests.once('exit', code => resolve(code ?? 1)); });
  clearTimeout(timer);
} finally { tests?.kill('SIGTERM'); fixture.kill('SIGTERM'); }
