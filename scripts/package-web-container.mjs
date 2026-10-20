import { build } from 'esbuild';
import { readFile, writeFile, mkdir, cp, copyFile, access } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const destination = resolve(process.argv[2] ?? '.runtime/remote-web-2026-10-14/release');
try { await access(destination); throw new Error('RELEASE_EXISTS'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
await access(resolve(root, 'apps/mobile/dist/index.html'));
await mkdir(destination, { recursive: true, mode: 0o700 });
const mainGuard = "if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {";
// 原 Web 独立 CLI 在合并产物中的 import.meta 指向包入口；只关闭发布副本的独立启动分支。
await build({ entryPoints: [resolve(root, 'scripts/web-container.mjs')], outfile: resolve(destination, 'server.mjs'),
  bundle: true, platform: 'node', format: 'esm', target: 'node24', sourcemap: false,
  banner: { js: "import { createRequire as _createRequire } from 'node:module'; const require = _createRequire(import.meta.url);" },
  plugins: [{ name: 'disable-imported-cli', setup(builder) {
    builder.onLoad({ filter: /[\\/]web-server\.mjs$/ }, async ({ path }) => {
      const source = await readFile(path, 'utf8');
      if (source.split(mainGuard).length !== 2) throw new Error('WEB_CLI_GUARD_CHANGED');
      return { contents: source.replace(mainGuard, 'if (false) {'), loader: 'js', resolveDir: dirname(path) };
    });
  } }],
});
await build({ entryPoints: [resolve(root, 'scripts/web-lan-gateway.mjs')], outfile: resolve(destination, 'gateway.mjs'), bundle: true,
  platform: 'node', format: 'esm', target: 'node24', sourcemap: false,
  banner: { js: "import { createRequire as _createRequire } from 'node:module'; const require = _createRequire(import.meta.url);" } });
await cp(resolve(root, 'apps/mobile/dist'), resolve(destination, 'web'), { recursive: true, errorOnExist: true, force: false });
for (const name of ['Dockerfile', 'compose.yaml', '.dockerignore']) await copyFile(resolve(root, 'infra/web', name), resolve(destination, name));
const sha256 = data => createHash('sha256').update(data).digest('hex');
const manifest = { schemaVersion: 1, branch: execFileSync('git', ['branch', '--show-current'], { cwd: root, encoding: 'utf8' }).trim(),
  commit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
  includesUncommittedWorktree: true, sourceDiffSha256: sha256(execFileSync('git', ['diff', '--binary'], { cwd: root, maxBuffer: 16 * 1024 * 1024 })),
  createdAt: new Date().toISOString(), nodeVersion: JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8')).engines.node,
  serverSha256: sha256(await readFile(resolve(destination, 'server.mjs'))), gatewaySha256: sha256(await readFile(resolve(destination, 'gateway.mjs'))), indexSha256: sha256(await readFile(resolve(destination, 'web/index.html'))),
  credentialsIncluded: false, databaseIncluded: false,
};
await writeFile(resolve(destination, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', { mode: 0o600 });
console.log(JSON.stringify({ type: 'web.release.ready', directory: destination, ...manifest }));
