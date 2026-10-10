import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink, cp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { checkProjectDocs, lengthUnits, markdownLinks, headingAnchors } from './check-project-docs.mjs';

const noteName = '.agents/notes/implemented/storage/2026-10-03-save.md';
const note = '# 保存\n\n日期：2026-10-03。状态：implemented。范围：存储。\n\n## 背景\n来源。\n## 决定\n[实现](../../../../packages/example.ts)\n## 放弃的方案\n已记录。\n## 后果与限制\n有边界。\n## 验证\n待实际检查。\n';
async function fixture(t) {
  const root = await mkdtemp(path.join(tmpdir(), 'solveflow-docs-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const put = async (name, value) => { await mkdir(path.dirname(path.join(root, name)), { recursive: true }); await writeFile(path.join(root, name), value); };
  await put('AGENTS.md', '# Rules\n[架构](docs/architecture.md#当前-模型)\n');
  await put('docs/architecture.md', '# 当前 `模型`\n');
  await put('.agents/notes/README.md', '# Notes\n');
  await put(noteName, note);
  await put('packages/example.ts', `// Decision: ${noteName}\nexport const version = 1;\n`);
  const policy = { schemaVersion: 1, entrypoints: ['AGENTS.md'], scanRoots: ['packages'],
    budgets: Object.fromEntries(['rootRules', 'rules', 'readme', 'architecture', 'document', 'note', 'report'].map(key => [key, 500])), frozen: {} };
  return { root, put, policy, check: () => checkProjectDocs(root, policy) };
}

test('Chinese, mixed identifiers and Latin words all consume the budget', () => {
  assert.equal(lengthUnits('中文hello混合 world 世界'), 8);
  assert.equal(lengthUnits('中文没有空格'), 6);
});
test('links ignore fenced/inline examples and resolve reference definitions', () => {
  const parsed = markdownLinks('```md\n[x](ghost.md)\n```\n`[x](ghost2.md)`\n[真实](<file name.md>)\n[参考][REF]\n[REF]: other.md\n');
  assert.deepEqual(parsed, { links: ['file name.md', 'other.md'], missing: [] });
});
test('heading IDs retain code text, support Chinese and duplicate headings', () => {
  assert.deepEqual([...headingAnchors('# 当前 `模型`\n## Same\n## Same\n```\n# ghost\n```')], ['当前-模型', 'same', 'same-1']);
});
test('valid docs and source backlinks pass without writing files', async t => {
  const f = await fixture(t); const before = await readFile(path.join(f.root, noteName), 'utf8');
  const result = await f.check(); assert.deepEqual(result.errors, []); assert.equal(result.anchors, 1); assert.equal(result.notes, 1);
  assert.equal(await readFile(path.join(f.root, noteName), 'utf8'), before);
});
test('new unclassified documents and excessive Chinese content fail', async t => {
  const f = await fixture(t); await f.put('docs/ANOTHER_PROGRESS.md', '# Another\n');
  await f.put('docs/architecture.md', '中'.repeat(501));
  const errors = (await f.check()).errors.join('\n'); assert.match(errors, /no current home/); assert.match(errors, /Length 501/);
});
test('missing files, headings and reference definitions fail', async t => {
  const f = await fixture(t); await f.put('AGENTS.md', '[a](docs/missing.md)\n[b](docs/architecture.md#ghost)\n[c][undefined]\n');
  const errors = (await f.check()).errors.join('\n'); assert.match(errors, /missing.md/); assert.match(errors, /Missing heading/); assert.match(errors, /Missing link reference/);
});
test('encoded spaces, titles, relative fragments and external URLs are supported', async t => {
  const f = await fixture(t); await f.put('packages/some file.ts', '// file\n');
  await f.put('docs/architecture.md', '# 当前 `模型`\n[code](../packages/some%20file.ts "Code")\n[here](#当前-模型)\n[external](https://example.invalid/x)\n');
  assert.deepEqual((await f.check()).errors, []);
});
test('notes require sections, matching status and valid calendar dates', async t => {
  const f = await fixture(t); await f.put(noteName, note.replace('## 放弃的方案', '## 其他').replace('状态：implemented', '状态：proposed'));
  await f.put('.agents/notes/implemented/storage/2026-02-30-save.md', note);
  const errors = (await f.check()).errors.join('\n'); assert.match(errors, /Missing note section/); assert.match(errors, /Note status/); assert.match(errors, /Invalid note date/);
});
test('global indexes and unregistered archives fail', async t => {
  const f = await fixture(t); await f.put('.agents/notes/INDEX.md', '# Index\n');
  await f.put('.agents/notes/archived/storage/2026-10-03-save.md', note.replace('状态：implemented', '状态：archived'));
  const errors = (await f.check()).errors.join('\n'); assert.match(errors, /INDEX.md/); assert.match(errors, /reviewed frozen hash/);
});
test('frozen historical links are retained while edits and removal are detected', async t => {
  const f = await fixture(t); const historical = '# Before\n[old](missing.md)\n';
  f.policy.frozen['docs/OLD.md'] = createHash('sha256').update(historical).digest('hex');
  await f.put('docs/OLD.md', historical); assert.deepEqual((await f.check()).errors, []);
  await f.put('docs/OLD.md', historical + 'edit'); assert.match((await f.check()).errors.join('\n'), /Frozen document changed/);
  await rm(path.join(f.root, 'docs/OLD.md')); assert.match((await f.check()).errors.join('\n'), /ENOENT/);
});
test('source references require an implemented note and reciprocal source link', async t => {
  const f = await fixture(t); await f.put(noteName, note.replace('[实现](../../../../packages/example.ts)', 'No backlink'));
  assert.match((await f.check()).errors.join('\n'), /source backlink/);
  await f.put('packages/example.ts', '// Decision: .agents/notes/proposed/storage/2026-10-03-save.md\n');
  assert.match((await f.check()).errors.join('\n'), /Invalid decision anchor/);
  await f.put('packages/example.ts', '// Decision: .agents/notes/implemented/storage/2026-10-03-missing.md\n');
  assert.match((await f.check()).errors.join('\n'), /Broken local link/);
});
test('YAML and explicit root source anchors participate once in decision validation', async t => {
  const f = await fixture(t);
  f.policy.scanRoots.push('.github');
  f.policy.sourceFiles = ['pnpm-workspace.yaml', '.github/workflows/ci.yml'];
  await f.put('pnpm-workspace.yaml', `# Decision: ${noteName}\npackages: []\n`);
  await f.put('.github/workflows/ci.yml', `# Decision: ${noteName}\nname: Checks\n`);
  await f.put(noteName, `${note}\n[workspace](../../../../pnpm-workspace.yaml)\n[CI](../../../../.github/workflows/ci.yml)\n`);
  const result = await f.check();
  assert.deepEqual(result.errors, []);
  assert.equal(result.anchors, 3);
});
test('root configuration anchors reject missing decisions and missing backlinks', async t => {
  const f = await fixture(t); f.policy.sourceFiles = ['pnpm-workspace.yaml'];
  await f.put('pnpm-workspace.yaml', `# Decision: ${noteName}\n`);
  assert.match((await f.check()).errors.join('\n'), /pnpm-workspace.yaml: Decision note needs a source backlink/);
  await f.put('pnpm-workspace.yaml', '# Decision: .agents/notes/implemented/process/2026-10-03-missing.md\n');
  assert.match((await f.check()).errors.join('\n'), /pnpm-workspace.yaml: Broken local link/);
});
test('explicit sources reject unsafe paths, missing files and escaping symlinks', async t => {
  const f = await fixture(t); f.policy.sourceFiles = '../outside.yaml';
  await assert.rejects(f.check, /Invalid docs policy/);
  f.policy.sourceFiles = ['../outside.yaml'];
  await assert.rejects(f.check, /unsafe path/);
  f.policy.sourceFiles = ['missing.yaml'];
  assert.match((await f.check()).errors.join('\n'), /missing.yaml: Cannot validate source.*ENOENT/);
  const outside = await mkdtemp(path.join(tmpdir(), 'solveflow-doc-source-'));
  t.after(() => rm(outside, { recursive: true, force: true }));
  await writeFile(path.join(outside, 'config.yaml'), '# outside repository\n');
  await symlink(path.join(outside, 'config.yaml'), path.join(f.root, 'outside.yaml'));
  f.policy.sourceFiles = ['outside.yaml'];
  assert.match((await f.check()).errors.join('\n'), /outside.yaml: Cannot validate source.*escapes repository/);
});
test('note metadata date must match the dated path', async t => {
  const f = await fixture(t); await f.put(noteName, note.replace('日期：2026-10-03', '日期：2026-10-04'));
  assert.match((await f.check()).errors.join('\n'), /Note date must agree with its path/);
});
test('note metadata is required at the header rather than inside examples', async t => {
  const f = await fixture(t);
  await f.put(noteName, note.replace('日期：2026-10-03。状态：implemented。范围：存储。', '状态：implemented。') + '\n```md\n日期：2026-10-03。状态：implemented。\n```\n');
  assert.match((await f.check()).errors.join('\n'), /Missing or invalid note metadata/);
});
test('a status mention elsewhere cannot override mismatched note metadata', async t => {
  const f = await fixture(t);
  await f.put(noteName, note.replace('状态：implemented', '状态：proposed') + '\n未来才会转为状态：implemented。\n');
  assert.match((await f.check()).errors.join('\n'), /Note status must agree with its path/);
});
test('repository escape and symlink targets fail', async t => {
  const f = await fixture(t); await f.put('AGENTS.md', '[escape](../outside.md)\n');
  assert.match((await f.check()).errors.join('\n'), /escapes repository/);
  await symlink(tmpdir(), path.join(f.root, 'packages/outside'));
  assert.match((await f.check()).errors.join('\n'), /Symlinks are not allowed/);
});
test('invalid policy paths, hashes and non-positive budgets are rejected', async t => {
  const f = await fixture(t); f.policy.entrypoints.push('../AGENTS.md'); await assert.rejects(f.check, /unsafe path/);
  f.policy.entrypoints.pop(); f.policy.frozen['docs/OLD.md'] = 'bad'; await assert.rejects(f.check, /Invalid frozen/);
  delete f.policy.frozen['docs/OLD.md']; f.policy.budgets.note = 0; await assert.rejects(f.check, /Invalid budget/);
});
test('CLI returns success/failure without mutating input documents', async t => {
  const f = await fixture(t); await f.put('scripts/docs-policy.json', JSON.stringify(f.policy));
  await cp(new URL('./check-project-docs.mjs', import.meta.url), path.join(f.root, 'scripts/check-project-docs.mjs'));
  const run = () => {
    const result = spawnSync(process.execPath, [path.join(f.root, 'scripts/check-project-docs.mjs')], { encoding: 'utf8', timeout: 10000 });
    assert.ifError(result.error); return result;
  };
  const good = run(); assert.equal(good.status, 0, good.stderr); assert.match(good.stdout, /Docs OK/);
  await f.put('AGENTS.md', '[broken](missing.md)\n'); const bad = run(); assert.equal(bad.status, 1); assert.match(bad.stderr, /Broken local link/);
  assert.equal(await readFile(path.join(f.root, 'AGENTS.md'), 'utf8'), '[broken](missing.md)\n');
});
