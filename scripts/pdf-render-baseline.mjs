import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const baselineVariable = 'SOLVEFLOW_TEST_PDF_RENDER_BASELINE';
const upstreamHashes = {
  'dist/html2canvas.js': '01c5b468ffa0427e535e3019165d2efd2489650ec9cf1379d6ab79fdbf75736b',
  'dist/html2canvas.js.map': '08801ea2e2ccd746827ec72716068375862b84dd7ea88422b8e3f1912c40693f',
  'dist/html2canvas.esm.js': 'c3b0b8b257996d79b5e362d2aee2411ff74fd23e984e9900f5ba005ea4753d64',
  'dist/html2canvas.esm.js.map': 'b5535d532ea61361e094b1a24f9e2a9a5e714c9a7f8b68e2a924ad0409b09369',
  'dist/html2canvas.min.js': 'e87e550794322e574a1fda0c1549a3c70dae5a93d9113417a429016838eab8cb',
};

const describeError = error => error instanceof Error ? error.message : String(error);

function validationProblems(directory) {
  const problems = [];
  try {
    if (!statSync(directory).isDirectory()) return [`Not a package directory: ${directory}`];
  } catch (error) {
    return [`Reading package directory ${directory}: ${describeError(error)}`];
  }
  const manifestPath = join(directory, 'package.json');
  try {
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    if (manifest?.name !== 'html2canvas' || manifest?.version !== '1.4.1') {
      problems.push(`${manifestPath}: expected html2canvas@1.4.1, received ${JSON.stringify(manifest)}`);
    }
  } catch (error) {
    problems.push(`Reading package manifest ${manifestPath}: ${describeError(error)}`);
  }
  for (const [file, expected] of Object.entries(upstreamHashes)) {
    const path = join(directory, file);
    try {
      const actual = createHash('sha256').update(readFileSync(path)).digest('hex');
      if (actual !== expected) problems.push(`${path}: SHA-256 mismatch; expected ${expected}; actual ${actual}`);
    } catch (error) {
      problems.push(`Reading upstream artifact ${path}: ${describeError(error)}`);
    }
  }
  return problems;
}

function assertPristine(directory, source) {
  const problems = validationProblems(directory);
  if (problems.length) throw new Error(`Invalid PDF render baseline (${source}):\n${problems.join('\n')}`);
  return directory;
}

function patchEnvironment(staging) {
  const env = { ...process.env };
  for (const key of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_COMMON_DIR', 'GIT_INDEX_FILE']) delete env[key];
  // --no-index disables index updates, not repository discovery from .runtime.
  env.GIT_CEILING_DIRECTORIES = staging;
  return env;
}

/** Return an absolute, SHA-verified html2canvas@1.4.1 package directory. */
export function preparePdfRenderBaseline() {
  const explicit = process.env[baselineVariable];
  if (explicit !== undefined) {
    if (!explicit.trim()) throw new Error(`${baselineVariable} must name a pristine html2canvas@1.4.1 package directory`);
    return assertPristine(resolve(explicit), baselineVariable);
  }

  const installed = join(root, 'apps/mobile/node_modules/html2canvas');
  const installedProblems = validationProblems(installed);
  if (!installedProblems.length) return installed;

  const patch = join(root, 'patches/html2canvas@1.4.1.patch');
  let staging;
  try {
    if (!statSync(patch).isFile()) throw new Error(`Patch is not a regular file: ${patch}`);
    const runtime = join(root, '.runtime');
    mkdirSync(runtime, { recursive: true });
    staging = mkdtempSync(join(runtime, 'pdf-render-baseline-'));
    const candidate = join(staging, 'html2canvas');
    // pnpm's installed package is a symlink; the reverse patch must own every byte it edits.
    cpSync(installed, candidate, { recursive: true, dereference: true });
    const result = spawnSync('git', ['apply', '--reverse', '--no-index', patch], {
      cwd: candidate,
      env: patchEnvironment(staging),
      encoding: 'utf8',
      timeout: 30_000,
      maxBuffer: 4 * 1024 * 1024,
    });
    if (result.error || result.signal || result.status !== 0) {
      throw new Error([
        `git apply --reverse --no-index ${patch}`,
        `cwd: ${candidate}`,
        `exit: ${result.status}; signal: ${result.signal ?? 'none'}`,
        result.error ? `process error: ${describeError(result.error)}` : '',
        result.stdout ? `stdout:\n${result.stdout}` : '',
        result.stderr ? `stderr:\n${result.stderr}` : '',
      ].filter(Boolean).join('\n'));
    }
    return assertPristine(candidate, `reverse-applied ${patch}`);
  } catch (error) {
    const failure = new Error([
      'Failed to prepare an independent pristine PDF render baseline.',
      `Installed package validation:\n${installedProblems.join('\n')}`,
      `Recovery failure:\n${describeError(error)}`,
      `Supply ${baselineVariable} only with a verified pristine package.`,
    ].join('\n'), { cause: error });
    if (staging) {
      try {
        rmSync(staging, { recursive: true, force: true });
      } catch (cleanupError) {
        throw new AggregateError([failure, cleanupError], `${failure.message}\nCleanup failed for ${staging}: ${describeError(cleanupError)}`);
      }
    }
    throw failure;
  }
}
