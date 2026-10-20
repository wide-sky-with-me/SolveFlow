// Proposal (isolated candidate): .agents/notes/proposed/storage/2026-10-17-pdf-render-lifecycle.md
import { readFileSync, writeFileSync, cpSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, relative } from 'node:path';
import { createHash } from 'node:crypto';
import ts from 'typescript';
import { transformSync } from 'esbuild';

const [inputArg, outputArg] = process.argv.slice(2);
if (!inputArg || !outputArg) throw new Error('Usage: node scripts/generate-html2canvas-lifecycle.mjs ORIGINAL_PACKAGE STAGING_PACKAGE');
const root = process.cwd(); const input = resolve(inputArg); const output = resolve(outputArg);
if (!relative(resolve(root, '.runtime'), output).startsWith('..') && output !== resolve(root, '.runtime') && !existsSync(output)) {
  mkdirSync(output, { recursive: true });
} else throw new Error('Output must be a new .runtime staging directory');
const sha = value => createHash('sha256').update(value).digest('hex');
const original = readFileSync(resolve(input, 'dist/html2canvas.js'), 'utf8');
if (sha(original) !== '01c5b468ffa0427e535e3019165d2efd2489650ec9cf1379d6ab79fdbf75736b') throw new Error('Unexpected upstream UMD bytes');
const mapBytes = readFileSync(resolve(input, 'dist/html2canvas.js.map'));
if (sha(mapBytes) !== '08801ea2e2ccd746827ec72716068375862b84dd7ea88422b8e3f1912c40693f') throw new Error('Unexpected upstream source map');
const sourceMap = JSON.parse(mapBytes);
const upstreamIndex = sourceMap.sourcesContent[sourceMap.sources.indexOf('../../src/index.ts')];
if (typeof upstreamIndex !== 'string') throw new Error('Missing exact upstream index source');
const parse = code => ts.createSourceFile('vendor.ts', code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
const emit = code => ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES5, module: ts.ModuleKind.None, noEmitHelpers: true, downlevelIteration: true } }).outputText;
const findDeclaration = (file, name) => {
  const result = [];
  const visit = node => { if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === name) result.push(node); ts.forEachChild(node, visit); };
  visit(file); if (result.length !== 1) throw new Error('Expected one declaration: ' + name); return result[0];
};
const replaceOnce = (text, before, after) => {
  if (text.split(before).length !== 2) throw new Error('Upstream site drift: ' + before.slice(0, 90));
  return text.replace(before, after);
};

// Keep the original synchronous parser intact, including nested iframe construction.
const originalFile = parse(original);
const recursiveWalk = findDeclaration(originalFile, 'parseNodeTree').initializer;
if (!ts.isFunctionExpression(recursiveWalk) || recursiveWalk.body.statements.length !== 1) throw new Error('Unexpected upstream walker');
const traversalLoop = recursiveWalk.body.statements[0];
if (!ts.isForStatement(traversalLoop) || !ts.isBlock(traversalLoop.statement) || traversalLoop.statement.statements.length !== 2) throw new Error('Unexpected upstream traversal body');
const [snapshot, processChild] = traversalLoop.statement.statements;
if (snapshot.getText(originalFile) !== 'nextNode = childNode.nextSibling;') throw new Error('Unexpected sibling snapshot');
let step = processChild.getText(originalFile);
step = replaceOnce(step, 'childNode.assignedNodes().forEach(function (childNode) { return parseNodeTree(context, childNode, parent, root); });', 'stack.push({ kind: 1, assigned: childNode.assignedNodes(), index: 0, parent: parent, phase: 0 });');
step = replaceOnce(step, 'parseNodeTree(context, childNode.shadowRoot, container, root);', 'stack.push({ kind: 0, node: childNode.shadowRoot, parent: container, phase: 0 });');
step = replaceOnce(step, 'parseNodeTree(context, childNode, container, root);', 'stack.push({ kind: 0, node: childNode, parent: container, phase: 0 });');
if (step.includes('parseNodeTree(')) throw new Error('Unconverted recursive parser call');
// Keep the yield before node effects and defer each assigned subtree until entered.
// WALK: enter, snapshot/yield, process, resume siblings; ASSIGNED: pick, resume.
const walk = `function* walkRenderTree(context, node, parent, root) {
  var stack = [{ kind: 0, node: node, parent: parent, phase: 0 }];
  try {
    while (stack.length) {
      var frame = stack[stack.length - 1];
      if (frame.kind === 1) {
        if (frame.phase === 1) { frame.index++; frame.phase = 0; }
        if (frame.index < frame.assigned.length) {
          frame.phase = 1;
          stack.push({ kind: 0, node: frame.assigned[frame.index], parent: frame.parent, phase: 0 });
        } else { stack.pop(); }
        continue;
      }
      if (frame.phase === 0) { frame.child = frame.node.firstChild; frame.phase = 1; }
      if (frame.phase === 1) {
        if (!frame.child) { stack.pop(); continue; }
        frame.next = frame.child.nextSibling; frame.phase = 2;
        yield;
      }
      if (frame.phase === 2) {
        frame.phase = 3;
        var childNode = frame.child; parent = frame.parent;
        ${step}
        continue;
      }
      frame.child = frame.next; frame.phase = 1;
    }
  } finally { stack.length = 0; }
}`;
const additions = emit(`${walk}\nasync function parseTreeCooperatively(context, element) {
  assertRenderActive(context);
  var container = createContainer(context, element); container.flags |= 4;
  var iterator = walkRenderTree(context, element, container, container); var count = 0;
  try {
    while (!iterator.next().done) {
      assertRenderActive(context);
      if (++count === 64) { count = 0; await context.renderLifecycle.yieldControl(); assertRenderActive(context); }
    }
    assertRenderActive(context); return container;
  } finally { iterator.return(); }
}
function assertRenderActive(context) { if (context && context.renderLifecycle) context.renderLifecycle.assertActive(); }
`);
// The upstream ES5 await/generator helpers stay untouched.
let indexSource = upstreamIndex.replace(/^import .*;$/gm, '').replace(/^export default html2canvas;$/m, '').replace(/^export type /m, 'type ');
indexSource = replaceOnce(indexSource, 'cache: opts.cache,', 'cache: opts.cache, renderLifecycle: opts.renderLifecycle,');
indexSource = replaceOnce(indexSource, 'const context = new Context(contextOptions, windowBounds);', 'const context = new Context(contextOptions, windowBounds);\n    assertRenderActive(context);');
indexSource = replaceOnce(indexSource, 'const root = parseTree(context, clonedElement);', 'const root = context.renderLifecycle?.yieldControl ? await parseTreeCooperatively(context, clonedElement) : parseTree(context, clonedElement);\n        assertRenderActive(context);');
indexSource = replaceOnce(indexSource, '    let canvas;', '');
indexSource = replaceOnce(indexSource, 'const container = await documentCloner.toIFrame(ownerDocument, windowBounds);', 'let canvas: HTMLCanvasElement | undefined;\n    let container: HTMLIFrameElement | undefined;\n    let releaseLifecycle: (() => void) | undefined;\n    try {\n    releaseLifecycle = context.renderLifecycle?.onDispose?.(() => {\n        context.renderCanvases?.forEach(surface => { surface.width = 0; surface.height = 0; });\n        if (context.renderCanvases) context.renderCanvases.length = 0;\n        if (context.renderCloneContainer) DocumentCloner.destroy(context.renderCloneContainer);\n        context.renderCloneContainer = undefined;\n    });\n    container = await documentCloner.toIFrame(ownerDocument, windowBounds);\n    assertRenderActive(context);');
indexSource = replaceOnce(indexSource, '    if (opts.removeContainer ?? true) {', '    assertRenderActive(context);\n    } catch (error) {\n        if (canvas) { canvas.width = 0; canvas.height = 0; }\n        throw error;\n    } finally {\n    releaseLifecycle?.();\n    if (context.renderCanvases) { context.renderCanvases.forEach(surface => { if (surface !== canvas) { surface.width = 0; surface.height = 0; } }); context.renderCanvases.length = 0; }\n    if (opts.removeContainer ?? true) {');
indexSource = replaceOnce(indexSource, 'if (!DocumentCloner.destroy(container)) {', 'const ownedContainer = container ?? context.renderCloneContainer;\n        if (ownedContainer && !DocumentCloner.destroy(ownedContainer)) {');
indexSource = replaceOnce(indexSource, '    context.logger.debug(`Finished rendering`);', '    context.renderCloneContainer = undefined;\n    }\n    context.logger.debug(`Finished rendering`);');
const emittedIndex = parse(emit(indexSource));
const mainInitializer = findDeclaration(emittedIndex, 'renderElement').initializer.getText(emittedIndex);

function patchBundle(code) {
  const file = parse(code); const edits = [];
  const main = findDeclaration(file, 'renderElement').initializer;
  edits.push([main.getStart(file), main.end, mainInitializer]);
  const walkSite = findDeclaration(file, 'parseNodeTree').parent.parent;
  edits.push([walkSite.getStart(file), walkSite.getStart(file), additions + '\n']);
  let guardedMethods = 0; let guardedCases = 0; let contexts = 0; let iframeCatches = 0; let canvasRegistrations = 0; let cloneRegistrations = 0;
  const visit = node => {
    if (ts.isFunctionDeclaration(node) && node.name?.text === 'Context') {
      edits.push([node.body.statements.pos, node.body.statements.pos, '\nthis.renderLifecycle = options.renderLifecycle;']); contexts++;
    }
    if (ts.isBinaryExpression(node) && node.left.getText(file) === 'DocumentCloner.prototype.toIFrame' && ts.isFunctionExpression(node.right)) {
      const creations = node.right.body.statements.filter(statement => ts.isVariableStatement(statement) && statement.declarationList.declarations.some(declaration => ts.isIdentifier(declaration.name) && declaration.name.text === 'iframe' && declaration.initializer && ts.isCallExpression(declaration.initializer) && declaration.initializer.expression.getText(file) === 'createIFrameContainer'));
      if (creations.length !== 1) throw new Error('Expected one owned clone creation');
      edits.push([creations[0].end, creations[0].end, '\nthis.context.renderCloneContainer = iframe;']); cloneRegistrations++;
    }
    if (ts.isFunctionDeclaration(node) && node.name?.text === 'IFrameElementContainer') {
      const findCatch = item => { if (ts.isCatchClause(item)) { edits.push([item.block.statements.pos, item.block.statements.pos, '\nassertRenderActive(context);']); iframeCatches++; } ts.forEachChild(item, findCatch); }; findCatch(node.body);
    }
    if (ts.isFunctionDeclaration(node) && /^(CanvasRenderer|ForeignObjectRenderer)$/.test(node.name?.text ?? '')) {
      const register = item => {
        if (ts.isExpressionStatement(item) && ts.isBinaryExpression(item.expression) && item.expression.left.getText(file) === '_this.canvas') {
          edits.push([item.end, item.end, '\nif (context.renderLifecycle) (context.renderCanvases || (context.renderCanvases = [])).push(_this.canvas);']); canvasRegistrations++;
        }
        ts.forEachChild(item, register);
      }; register(node.body);
    }
    if (ts.isBinaryExpression(node) && ts.isPropertyAccessExpression(node.left) && /^(CanvasRenderer|ForeignObjectRenderer)\.prototype\./.test(node.left.getText(file)) && ts.isFunctionExpression(node.right)) {
      if (node.right.getText(file).includes('__awaiter(')) {
        guardedMethods++;
        if (node.right.getText(file).includes('ownedRenderContext')) throw new Error('Lifecycle binding collision');
        // Lowered loop generators use a different this; capture the method owner once.
        edits.push([node.right.body.statements.pos, node.right.body.statements.pos, '\nvar ownedRenderContext = this.context;']);
        const guardResumptions = item => {
          if (ts.isCallExpression(item) && ts.isIdentifier(item.expression) && item.expression.text === '__generator') {
            const callback = item.arguments[1];
            if (!callback || !ts.isFunctionExpression(callback) || callback.parameters.length !== 1 || !ts.isIdentifier(callback.parameters[0].name)) throw new Error('Unexpected generator callback');
            const stateName = callback.parameters[0].name.text;
            const dispatch = callback.body.statements.filter(statement => ts.isSwitchStatement(statement) && ts.isPropertyAccessExpression(statement.expression) && ts.isIdentifier(statement.expression.expression) && statement.expression.expression.text === stateName && statement.expression.name.text === 'label');
            if (dispatch.length === 0) {
              let awaits = 0;
              const countAwait = part => { if (ts.isReturnStatement(part) && part.expression && ts.isArrayLiteralExpression(part.expression) && part.expression.elements[0]?.getText(file) === '4') awaits++; ts.forEachChild(part, countAwait); };
              countAwait(callback.body);
              if (awaits) throw new Error('Await without generator dispatch');
              edits.push([callback.body.statements.pos, callback.body.statements.pos, '\nassertRenderActive(ownedRenderContext);']); guardedCases++;
            } else {
              if (dispatch.length !== 1) throw new Error('Expected one generator dispatch');
              for (const clause of dispatch[0].caseBlock.clauses) {
                edits.push([clause.statements.pos, clause.statements.pos, '\nassertRenderActive(ownedRenderContext);']); guardedCases++;
              }
            }
          }
          ts.forEachChild(item, guardResumptions);
        };
        guardResumptions(node.right);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  if (contexts !== 1 || iframeCatches !== 1 || cloneRegistrations !== 1 || canvasRegistrations !== 2 || guardedMethods !== 12 || guardedCases !== 95) throw new Error(JSON.stringify({ contexts, iframeCatches, cloneRegistrations, canvasRegistrations, guardedMethods, guardedCases }));
  for (const [start, end, replacement] of edits.sort((a, b) => b[0] - a[0])) code = code.slice(0, start) + replacement + code.slice(end);
  // Set capability after declaration, without wrapping the callable or adding any promise.
  const patched = parse(code); const callable = findDeclaration(patched, 'html2canvas').parent.parent;
  code = code.slice(0, callable.end) + '\nhtml2canvas.renderLifecycleVersion = 2;\n' + code.slice(callable.end);
  code = code.replace(/^\/\/# sourceMappingURL=.*$/gm, '');
  if (parse(code).parseDiagnostics.length) throw new Error('Generated bundle syntax error');
  return { code, guardedMethods, guardedCases };
}

cpSync(input, output, { recursive: true, dereference: true });
const generated = {};
for (const name of ['html2canvas.js', 'html2canvas.esm.js']) {
  const result = patchBundle(readFileSync(resolve(input, 'dist', name), 'utf8'));
  writeFileSync(resolve(output, 'dist', name), result.code); generated[name] = { sha256: sha(result.code), methods: result.guardedMethods, cases: result.guardedCases };
}
const min = transformSync(readFileSync(resolve(output, 'dist/html2canvas.js'), 'utf8'), { minify: true, target: 'es5', legalComments: 'inline' }).code;
writeFileSync(resolve(output, 'dist/html2canvas.min.js'), min);
const contextPath = resolve(output, 'dist/types/core/context.d.ts');
let context = readFileSync(contextPath, 'utf8');
context = 'export interface RenderLifecycle { assertActive(): void; yieldControl?: () => Promise<void>; onDispose?: (cleanup: () => void) => (() => void); }\n' + context;
context = replaceOnce(context, 'logging: boolean;', 'logging: boolean;\n    renderLifecycle?: RenderLifecycle;');
context = replaceOnce(context, 'export declare class Context {', 'export declare class Context {\n    readonly renderLifecycle?: RenderLifecycle;\n    renderCloneContainer?: HTMLIFrameElement | undefined;\n    renderCanvases?: HTMLCanvasElement[];');
writeFileSync(contextPath, context);
const indexPath = resolve(output, 'dist/types/index.d.ts');
let declaration = readFileSync(indexPath, 'utf8');
declaration = replaceOnce(declaration, 'declare const html2canvas: (element: HTMLElement, options?: Partial<Options>) => Promise<HTMLCanvasElement>;', 'declare const html2canvas: { (element: HTMLElement, options?: Partial<Options>): Promise<HTMLCanvasElement>; renderLifecycleVersion: 2; };');
writeFileSync(indexPath, declaration);
writeFileSync(resolve(output, 'SOLVEFLOW-LIFECYCLE.md'), '# Scoped browser lifecycle adapter\n\nhtml2canvas 1.4.1, MIT license retained. Generated by SolveFlow scripts/generate-html2canvas-lifecycle.mjs from pinned upstream UMD and source-map TypeScript. UMD, ESM and min browser entries plus public declarations are patched. Direct dist/lib imports are outside this adapter; stale browser sourceMappingURL references are removed. No global latest-task state.\n');
console.log(JSON.stringify({ output, generated }));
