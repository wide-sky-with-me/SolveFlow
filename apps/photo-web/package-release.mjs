import { cp, mkdir, readFile, readdir, writeFile, realpath } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
const root = fileURLToPath(new URL('../../', import.meta.url));
const target = resolve(root, process.argv[2] ?? '.runtime/photo-public-release');
if (!target.startsWith(join(root, '.runtime') + '/')) throw new Error('Release must stay under ignored runtime directory.');
const require = createRequire(new URL('./package.json', import.meta.url));
const packages = new Map();
await mkdir(target, { recursive: true, mode: 0o700 });
if ((await readdir(target)).length !== 0) throw new Error('Choose an empty release directory; existing releases are preserved.');
await cp(new URL('./dist/', import.meta.url), join(target, 'dist'), { recursive: true });
await cp(new URL('./deploy/', import.meta.url), join(target, 'deploy'), { recursive: true });
await mkdir(join(target, 'bin'), { recursive: true });
await cp(process.execPath, join(target, 'bin/node'));
async function include(name, from, optional = false) {
  let file;
  // Native packages deliberately hide package.json behind exports. Resolve the
  // installed package root through Node's own search locations, without fetching.
  for (const base of from.resolve.paths(name) ?? []) {
    try { file = await realpath(join(base, name, 'package.json')); break; } catch { /* Continue Node's search path. */ }
  }
  if (!file) { if (optional) return; throw new Error('Missing installed runtime dependency ' + name); }
  let directory = dirname(file); let data;
  while (directory !== dirname(directory)) {
    try { const candidate = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8')); if (candidate.name === name) { data = candidate; break; } } catch { /* Walk to the resolved package root. */ }
    directory = dirname(directory);
  }
  if (!data) throw new Error('Unable to locate runtime package ' + name);
  if (packages.has(name)) { if (packages.get(name) !== data.version) throw new Error('Conflicting runtime versions.'); return; }
  packages.set(name, data.version);
  await cp(directory, join(target, 'node_modules', name), { recursive: true, dereference: true });
  const local = createRequire(join(directory, 'package.json'));
  for (const dependency of Object.keys(data.dependencies ?? {})) await include(dependency, local);
  for (const dependency of Object.keys(data.optionalDependencies ?? {})) await include(dependency, local, true);
}
await include('sharp', require);
await writeFile(join(target, 'package.json'), JSON.stringify({ private: true, type: 'module', description: 'Bundled SolveFlow photo service with exact installed native runtime dependencies.' }));
const files = [];
async function walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) { const path = join(dir, entry.name); if (entry.isDirectory()) await walk(path); else if (entry.isFile()) files.push({ path: path.slice(target.length + 1), sha256: createHash('sha256').update(await readFile(path)).digest('hex') }); else throw new Error('Unexpected runtime link.'); }
}
await walk(target);
const manifest = { schemaVersion: 1, nodeVersion: process.version, platform: process.platform, arch: process.arch, lockSha256: createHash('sha256').update(await readFile(join(root, 'pnpm-lock.yaml'))).digest('hex'), packages: Object.fromEntries(packages), files, credentialsIncluded: false, imagesIncluded: false };
await writeFile(join(target, 'manifest.json'), JSON.stringify(manifest, null, 2));
console.log(JSON.stringify({ target, nodeVersion: manifest.nodeVersion, packages: manifest.packages, files: files.length }));
