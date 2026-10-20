import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, cpSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { preparePdfRenderBaseline } from './pdf-render-baseline.mjs';

const root = process.cwd(); const upstream = preparePdfRenderBaseline();
const temporary = mkdtempSync(resolve('.runtime/pdf-render-lifecycle-test-'));
const generated = join(temporary, 'generated');
const parse = code => ts.createSourceFile('bundle.js', code, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
const original = parse(readFileSync(join(upstream, 'dist/html2canvas.js'), 'utf8'));
let candidate;
const generate = (input, output) => spawnSync(process.execPath, ['scripts/generate-html2canvas-lifecycle.mjs', input, output], { cwd: root, encoding: 'utf8', timeout: 30000 });
const declaration = (file, name) => {
  const result = []; const visit = node => {
    if (ts.isVariableDeclaration(node) && node.name.getText(file) === name) result.push(node.initializer.getText(file));
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) result.push(node.getText(file));
    ts.forEachChild(node, visit);
  }; visit(file);
  assert.equal(result.length, 1, name); return result[0];
};

before(() => {
  const result = generate(upstream, generated); assert.equal(result.status, 0, result.stderr);
  candidate = parse(readFileSync(join(generated, 'dist/html2canvas.js'), 'utf8'));
});

test('preserves the synchronous callable, parser and original async helpers', () => {
  for (const name of ['html2canvas', 'parseTree', 'parseNodeTree', '__awaiter', '__generator']) assert.equal(declaration(candidate, name), declaration(original, name), name);
});

test('guards renderer generator callbacks, not nested ordinary callbacks', () => {
  let checked = 0;
  const visit = node => {
    if (ts.isCallExpression(node) && node.expression.getText(candidate) === 'assertRenderActive' && node.arguments[0]?.getText(candidate) === 'ownedRenderContext') {
      let owner = node.parent;
      while (owner && !ts.isFunctionLike(owner)) owner = owner.parent;
      assert.ok(owner && ts.isFunctionExpression(owner));
      assert.ok(ts.isCallExpression(owner.parent)); assert.equal(owner.parent.expression.getText(candidate), '__generator'); checked++;
    }
    ts.forEachChild(node, visit);
  }; visit(candidate); assert.equal(checked, 95);
});

test('keeps each renderer body identical apart from owner capture and synchronous assertions', () => {
  const methods = file => {
    const found = new Map();
    const visit = node => {
      if (ts.isBinaryExpression(node) && /^(CanvasRenderer|ForeignObjectRenderer)\.prototype\./.test(node.left.getText(file)) && ts.isFunctionExpression(node.right) && node.right.getText(file).includes('__awaiter(')) found.set(node.left.getText(file), node.right);
      ts.forEachChild(node, visit);
    }; visit(file); return found;
  };
  const before = methods(original); const after = methods(candidate); assert.equal(before.size, 12); assert.equal(after.size, before.size);
  const print = (node, file) => {
    const text = ts.createPrinter({ removeComments: true }).printNode(ts.EmitHint.Expression, node, file);
    const scanner = ts.createScanner(ts.ScriptTarget.Latest, true, ts.LanguageVariant.Standard, text); const tokens = [];
    for (let kind = scanner.scan(); kind !== ts.SyntaxKind.EndOfFileToken; kind = scanner.scan()) tokens.push([kind, scanner.getTokenText()]);
    return tokens;
  };
  for (const [name, body] of after) {
    const capture = body.body.statements[0]; assert.ok(ts.isVariableStatement(capture)); assert.equal(capture.declarationList.declarations.length, 1);
    assert.equal(capture.declarationList.declarations[0].name.getText(candidate), 'ownedRenderContext');
    assert.equal(capture.declarationList.declarations[0].initializer.getText(candidate), 'this.context');
    const transformed = ts.transform(body, [context => {
      const visit = node => {
        if (ts.isExpressionStatement(node) && ts.isCallExpression(node.expression) && node.expression.expression.getText(candidate) === 'assertRenderActive') return undefined;
        if (ts.isVariableStatement(node) && node.declarationList.declarations.length === 1 && node.declarationList.declarations[0].name.getText(candidate) === 'ownedRenderContext') return undefined;
        return ts.visitEachChild(node, visit, context);
      };
      return node => ts.visitNode(node, visit);
    }]);
    assert.deepEqual(print(transformed.transformed[0], candidate), print(before.get(name), original), name); transformed.dispose();
  }
});

test('UMD and min entries export the same explicit capability without browser globals', () => {
  for (const name of ['html2canvas.js', 'html2canvas.min.js']) {
    const module = { exports: {} }; runInNewContext(readFileSync(join(generated, 'dist', name), 'utf8'), { module, exports: module.exports, setTimeout }, { timeout: 5000 });
    assert.equal(typeof module.exports, 'function'); assert.equal(module.exports.renderLifecycleVersion, 2);
  }
});

test('generation is byte-deterministic for all modified browser files', () => {
  const repeated = join(temporary, 'repeated'); const result = generate(upstream, repeated); assert.equal(result.status, 0, result.stderr);
  for (const name of ['dist/html2canvas.js', 'dist/html2canvas.esm.js', 'dist/html2canvas.min.js', 'dist/types/index.d.ts', 'dist/types/core/context.d.ts', 'SOLVEFLOW-LIFECYCLE.md']) assert.deepEqual(readFileSync(join(generated, name)), readFileSync(join(repeated, name)), name);
});

test('rejects upstream drift rather than producing a plausible patch', () => {
  const changed = join(temporary, 'changed'); cpSync(upstream, changed, { recursive: true, dereference: true });
  writeFileSync(join(changed, 'dist/html2canvas.js'), '// drift\n' + readFileSync(join(changed, 'dist/html2canvas.js'), 'utf8'));
  const result = generate(changed, join(temporary, 'drift-output')); assert.notEqual(result.status, 0); assert.match(result.stderr, /Unexpected upstream UMD bytes/);
});

test('rejects an output outside runtime and keeps installed upstream untouched', () => {
  const outside = resolve('pdf-render-disallowed-output-' + process.pid); assert.equal(existsSync(outside), false);
  const result = generate(upstream, outside); assert.notEqual(result.status, 0); assert.equal(existsSync(outside), false);
  assert.equal(readFileSync(join(upstream, 'dist/html2canvas.js'), 'utf8'), original.text);
});
