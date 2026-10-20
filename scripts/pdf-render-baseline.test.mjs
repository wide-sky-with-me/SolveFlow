import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import {
  cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync,
  readdirSync, rmSync, symlinkSync, writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';
import { preparePdfRenderBaseline } from './pdf-render-baseline.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const variable = 'SOLVEFLOW_TEST_PDF_RENDER_BASELINE';
const source = preparePdfRenderBaseline();
const artifacts = [
  'dist/html2canvas.js', 'dist/html2canvas.js.map', 'dist/html2canvas.esm.js',
  'dist/html2canvas.esm.js.map', 'dist/html2canvas.min.js',
];
mkdirSync(join(root, '.runtime'), { recursive: true });
const temporary = mkdtempSync(join(root, '.runtime/pdf-render-baseline-test-'));
after(() => {
  rmSync(temporary, { recursive: true, force: true });
  if (process.env[variable] === undefined && source !== join(root, 'apps/mobile/node_modules/html2canvas')) {
    rmSync(dirname(source), { recursive: true, force: true });
  }
});
const sha = path => createHash('sha256').update(readFileSync(path)).digest('hex');

function fixture(t) {
  const directory = mkdtempSync(join(temporary, 'case-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const scripts = join(directory, 'scripts');
  mkdirSync(scripts, { recursive: true });
  for (const file of ['pdf-render-baseline.mjs', 'pdf-render-baseline.d.mts']) {
    cpSync(join(root, 'scripts', file), join(scripts, file));
  }
  const installed = join(directory, 'apps/mobile/node_modules/html2canvas');
  mkdirSync(dirname(installed), { recursive: true });
  cpSync(source, installed, { recursive: true, dereference: true });
  return { directory, installed, module: pathToFileURL(join(scripts, 'pdf-render-baseline.mjs')).href };
}

function run(f, overrides = {}) {
  const env = { ...process.env, ...overrides };
  if (!Object.hasOwn(overrides, variable)) delete env[variable];
  const code = `import { preparePdfRenderBaseline } from ${JSON.stringify(f.module)};
    const baseline = preparePdfRenderBaseline();
    if (typeof baseline !== 'string') throw new Error('Expected synchronous string result');
    console.log(JSON.stringify(baseline));`;
  return spawnSync(process.execPath, ['--input-type=module', '-e', code], {
    cwd: join(f.directory, 'scripts'), env, encoding: 'utf8', timeout: 30_000,
  });
}

function success(result) {
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

function failure(result, pattern) {
  assert.equal(result.error, undefined);
  assert.notEqual(result.status, 0);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, pattern);
}

function adapt(f) {
  let patch = '';
  for (const file of ['dist/html2canvas.js', 'dist/html2canvas.esm.js']) {
    const path = join(f.installed, file);
    const original = readFileSync(path, 'utf8');
    const context = original.split('\n').slice(0, 3).map(line => ` ${line}`).join('\n');
    writeFileSync(path, `// isolated test adaptation\n${original}`);
    patch += `diff --git a/${file} b/${file}\n--- a/${file}\n+++ b/${file}\n@@ -1,3 +1,4 @@\n+// isolated test adaptation\n${context}\n`;
  }
  mkdirSync(join(f.directory, 'patches'));
  writeFileSync(join(f.directory, 'patches/html2canvas@1.4.1.patch'), patch);
}

function assertCleanFailure(f) {
  const runtime = join(f.directory, '.runtime');
  assert.deepEqual(existsSync(runtime) ? readdirSync(runtime) : [], []);
}

test('returns a pristine installed package synchronously without creating staging', t => {
  const f = fixture(t);
  assert.equal(success(run(f)), f.installed);
  assert.equal(existsSync(join(f.directory, '.runtime')), false);
});

test('explicit baseline wins over installed drift and resolves relative to the caller', t => {
  const f = fixture(t);
  const explicit = join(f.directory, 'explicit');
  cpSync(f.installed, explicit, { recursive: true });
  writeFileSync(join(f.installed, artifacts[0]), 'installed drift');
  assert.equal(success(run(f, { [variable]: '../explicit' })), explicit);
  assert.equal(existsSync(join(f.directory, '.runtime')), false);
});

for (const file of artifacts) {
  test(`reports exact SHA drift in an explicit baseline: ${file}`, t => {
    const f = fixture(t);
    const path = join(f.installed, file);
    const expected = sha(path);
    writeFileSync(path, 'baseline drift');
    const result = run(f, { [variable]: f.installed });
    failure(result, /Invalid PDF render baseline \(SOLVEFLOW_TEST_PDF_RENDER_BASELINE\)/);
    assert.ok(result.stderr.includes(`${path}: SHA-256 mismatch; expected ${expected}; actual ${sha(path)}`));
    assertCleanFailure(f);
  });
}

test('explicit missing, empty and non-directory paths fail without falling back', t => {
  const f = fixture(t);
  failure(run(f, { [variable]: join(f.directory, 'absent') }), /Reading package directory.*absent/);
  failure(run(f, { [variable]: '' }), /must name a pristine html2canvas@1.4.1/);
  failure(run(f, { [variable]: join(f.installed, 'package.json') }), /Not a package directory/);
  assertCleanFailure(f);
});

test('explicit missing artifacts and wrong package versions fail validation', t => {
  const f = fixture(t);
  rmSync(join(f.installed, 'dist/html2canvas.esm.js.map'));
  writeFileSync(join(f.installed, 'package.json'), JSON.stringify({ name: 'html2canvas', version: '9.0.0' }));
  const result = run(f, { [variable]: f.installed });
  failure(result, /expected html2canvas@1.4.1/);
  assert.match(result.stderr, /Reading upstream artifact.*html2canvas.esm.js.map.*ENOENT/);
});

test('reverse-applies the repository patch in independent copies despite inherited Git paths', t => {
  const f = fixture(t);
  adapt(f);
  const vendor = join(f.directory, 'shared-vendor');
  cpSync(f.installed, vendor, { recursive: true });
  rmSync(f.installed, { recursive: true });
  symlinkSync(vendor, f.installed, 'dir');
  const before = artifacts.map(file => sha(join(vendor, file)));
  const overrides = { GIT_DIR: '/missing-git-dir', GIT_WORK_TREE: root, GIT_INDEX_FILE: '/missing-index' };
  const baseline = success(run(f, overrides));
  const repeated = success(run(f, overrides));
  assert.notEqual(repeated, baseline);
  assert.ok(baseline.startsWith(join(f.directory, '.runtime/pdf-render-baseline-')));
  for (const file of artifacts) {
    assert.equal(sha(join(baseline, file)), sha(join(source, file)), file);
    assert.equal(sha(join(repeated, file)), sha(join(source, file)), file);
    assert.equal(lstatSync(join(baseline, file)).isSymbolicLink(), false);
  }
  assert.deepEqual(artifacts.map(file => sha(join(vendor, file))), before);
  assert.equal(lstatSync(f.installed).isSymbolicLink(), true);
});

test('missing recovery patch reports installed drift and its missing path', t => {
  const f = fixture(t);
  writeFileSync(join(f.installed, artifacts[0]), 'drift');
  const result = run(f);
  failure(result, /Failed to prepare an independent pristine PDF render baseline/);
  assert.match(result.stderr, /Installed package validation:[\s\S]*SHA-256 mismatch/);
  assert.match(result.stderr, /Recovery failure:[\s\S]*html2canvas@1.4.1.patch/);
  assertCleanFailure(f);
});

test('failed git reverse apply reports exit and stderr, preserves installed and removes staging', t => {
  const f = fixture(t);
  adapt(f);
  writeFileSync(join(f.installed, artifacts[0]), 'unexpected content');
  const before = artifacts.map(file => sha(join(f.installed, file)));
  const result = run(f);
  failure(result, /git apply --reverse --no-index/);
  assert.match(result.stderr, /exit: 1; signal: none/);
  assert.match(result.stderr, /stderr:[\s\S]*patch/);
  assertCleanFailure(f);
  assert.deepEqual(artifacts.map(file => sha(join(f.installed, file))), before);
});

test('successful reverse apply still fails on unpatched minified or map drift', t => {
  const f = fixture(t);
  adapt(f);
  writeFileSync(join(f.installed, 'dist/html2canvas.min.js'), 'extra minified drift');
  writeFileSync(join(f.installed, 'dist/html2canvas.js.map'), 'extra map drift');
  const result = run(f);
  failure(result, /Invalid PDF render baseline \(reverse-applied/);
  assert.match(result.stderr, /html2canvas.min.js: SHA-256 mismatch/);
  assert.match(result.stderr, /html2canvas.js.map: SHA-256 mismatch/);
  assertCleanFailure(f);
});

test('missing git executable is an explicit process failure, not a baseline fallback', t => {
  const f = fixture(t);
  adapt(f);
  const result = run(f, { PATH: '' });
  failure(result, /process error: spawnSync git ENOENT/);
  assertCleanFailure(f);
});

test('the declaration supports a strict NodeNext TypeScript consumer importing .mjs', t => {
  const f = fixture(t);
  const consumer = join(f.directory, 'consumer.mts');
  writeFileSync(consumer, `import { preparePdfRenderBaseline } from './scripts/pdf-render-baseline.mjs';\nconst prepare: () => string = preparePdfRenderBaseline;\nconst baseline: string = prepare();\nvoid baseline;\n`);
  const program = ts.createProgram([consumer], {
    strict: true, noEmit: true, noUncheckedIndexedAccess: true, exactOptionalPropertyTypes: true,
    target: ts.ScriptTarget.ES2024, module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext, types: [], skipLibCheck: true,
  });
  const diagnostics = ts.getPreEmitDiagnostics(program);
  assert.equal(diagnostics.length, 0, ts.formatDiagnosticsWithColorAndContext(diagnostics, {
    getCurrentDirectory: () => root, getCanonicalFileName: file => file, getNewLine: () => '\n',
  }));
});
