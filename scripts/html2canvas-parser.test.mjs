import { before, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { preparePdfRenderBaseline } from './pdf-render-baseline.mjs';

// Algorithm contracts only: these lightweight DOM/container doubles do not model
// native layout, style resolution, Shadow DOM distribution, or browser fidelity.
const root = process.cwd();
const parse = source => ts.createSourceFile('parser.js', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
const emit = source => ts.transpileModule(source, {
  compilerOptions: {
    target: ts.ScriptTarget.ES5,
    module: ts.ModuleKind.None,
    noEmitHelpers: true,
    downlevelIteration: true,
  },
}).outputText;

function declaration(file, name, optional = false, functionOnly = false) {
  const matches = [];
  const visit = node => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === name) {
      assert.ok(node.initializer, name + ' initializer');
      if (!functionOnly || ts.isFunctionExpression(node.initializer)) matches.push(node.initializer.getText(file));
    }
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) matches.push(node.getText(file));
    ts.forEachChild(node, visit);
  };
  visit(file);
  if (optional && matches.length === 0) return undefined;
  assert.equal(matches.length, 1, 'unique declaration: ' + name);
  return matches[0];
}

function replaceOnce(source, before, after) {
  assert.equal(source.split(before).length, 2, 'pinned oracle site: ' + before);
  return source.replace(before, after);
}

// Frozen R52 oracle, derived ONLY from the SHA-pinned pristine parseNodeTree.
// It deliberately keeps recursive yield* and the old 64-next driver even after
// the candidate becomes flat. Never import the generator's transform or select
// candidate code as an oracle; no ignored .runtime history is read here.
function r52Reference(original) {
  let walk = declaration(original, 'parseNodeTree');
  walk = replaceOnce(walk, 'function (context, node, parent, root)', 'function* referenceWalk(context, node, parent, root)');
  walk = replaceOnce(walk, 'nextNode = childNode.nextSibling;', 'nextNode = childNode.nextSibling; yield;');
  walk = replaceOnce(walk,
    'childNode.assignedNodes().forEach(function (childNode) { return parseNodeTree(context, childNode, parent, root); });',
    'var assigned = childNode.assignedNodes(); for (var assignedIndex = 0; assignedIndex < assigned.length; assignedIndex++) { yield* referenceWalk(context, assigned[assignedIndex], parent, root); }');
  walk = replaceOnce(walk, 'parseNodeTree(context, childNode.shadowRoot, container, root);',
    'yield* referenceWalk(context, childNode.shadowRoot, container, root);');
  walk = replaceOnce(walk, 'parseNodeTree(context, childNode, container, root);',
    'yield* referenceWalk(context, childNode, container, root);');
  assert.equal(walk.includes('parseNodeTree('), false, 'all pristine recursive sites converted');
  return emit(`${walk}
async function referenceParse(context, element) {
    assertRenderActive(context);
    var container = createContainer(context, element); container.flags |= 4;
    var iterator = referenceWalk(context, element, container, container); var count = 0;
    try {
        while (!iterator.next().done) {
            assertRenderActive(context);
            if (++count === 64) {
                count = 0;
                await context.renderLifecycle.yieldControl();
                assertRenderActive(context);
            }
        }
        assertRenderActive(context);
        return container;
    } finally { iterator.return(); }
}
function assertRenderActive(context) {
    if (context && context.renderLifecycle) context.renderLifecycle.assertActive();
}
`);
}

let original;
let candidate;
let referenceSource;
let candidateSource;
let commonSource;

before(() => {
  const upstream = preparePdfRenderBaseline();
  const temporary = mkdtempSync(resolve('.runtime/html2canvas-parser-test-'));
  const generated = join(temporary, 'generated');
  const result = spawnSync(process.execPath,
    ['scripts/generate-html2canvas-lifecycle.mjs', upstream, generated],
    { cwd: root, encoding: 'utf8', timeout: 30_000, maxBuffer: 4 * 1024 * 1024 });
  assert.ifError(result.error);
  assert.equal(result.signal, null, result.stderr);
  assert.equal(result.status, 0, result.stderr);
  original = parse(readFileSync(join(upstream, 'dist/html2canvas.js'), 'utf8'));
  candidate = parse(readFileSync(join(generated, 'dist/html2canvas.js'), 'utf8'));
  referenceSource = r52Reference(original);
  candidateSource = ['parseTreeCooperatively', 'walkRenderTree', 'assertRenderActive', '__values']
    .map(name => {
      const source = declaration(candidate, name, name === 'walkRenderTree' || name === '__values');
      return source === undefined ? '' : `var ${name} = (${source});`;
    }).join('\n');
  const predicates = ['isTextNode', 'isElementNode', 'isSlotElement', 'isTextareaElement',
    'isSVGElement', 'isSelectElement', 'isBodyElement', 'createsRealStackingContext',
    'createsStackingContext', 'LIST_OWNERS'];
  commonSource = `var __awaiter = (${declaration(original, '__awaiter')});
var originalGenerator = (${declaration(original, '__generator')});
var __generator = function (owner, body) {
    var machine = { dispatches: 0 };
    metrics.machines.push(machine);
    metrics.created++;
    return originalGenerator(owner, function (state) {
        metrics.dispatches++;
        machine.dispatches++;
        return body.call(this, state);
    });
};
var __values = function (value) {
    var method = typeof Symbol === 'function' && value[Symbol.iterator];
    if (method) return method.call(value);
    var index = 0;
    if (value && typeof value.length === 'number') return { next: function () {
        if (value && index >= value.length) value = undefined;
        return { value: value && value[index++], done: !value };
    } };
    throw new TypeError('Object is not iterable.');
};
${predicates.map(name => `var ${name} = (${declaration(original, name, false, name !== 'LIST_OWNERS')});`).join('\n')}`;
});

function fixture() {
  const state = {
    trace: [], created: [], texts: [], checks: 0, yields: 0, checkpoints: [],
    aborted: false, forbidDom: false, abortError: new Error('fixture-aborted'),
    onAssert: undefined, onYield: undefined, onCreate: undefined, onText: undefined,
  };
  const access = event => {
    assert.equal(state.forbidDom, false, 'DOM access after cancellation: ' + event);
    state.trace.push(event);
  };
  const link = (node, children) => {
    node.children = children;
    children.forEach((child, index) => { child.next = children[index + 1] ?? null; });
    return node;
  };
  const node = (id, nodeType, children = []) => {
    const value = { id, nodeType, next: null, children: [], spec: {}, shadow: null };
    Object.defineProperties(value, {
      firstChild: { get() { access('first:' + id); return value.children[0] ?? null; } },
      nextSibling: { get() { access('next:' + id); return value.next; } },
      shadowRoot: { get() { access('shadow:' + id); return value.shadow; } },
      slot: { get() { access('slot:' + id); return ''; } },
    });
    return link(value, children);
  };
  const element = (id, tagName = 'DIV', children = [], spec = {}) =>
    Object.assign(node(id, 1, children), { tagName, spec });
  const text = (id, data = id) => Object.assign(node(id, 3), { data });
  const fragment = (id, children = []) => node(id, 11, children);
  const assigned = (slot, values) => {
    const collection = new Proxy(values, {
      get(target, key, receiver) {
        if (key === 'length' || /^\d+$/.test(String(key))) access('assigned:' + slot.id + ':' + String(key));
        return Reflect.get(target, key, receiver);
      },
    });
    Object.defineProperty(slot, 'assignedNodes', { get() {
      access('assigned-method:' + slot.id);
      return () => { access('assigned-call:' + slot.id); return collection; };
    } });
    return values;
  };
  const context = { renderLifecycle: {
    assertActive() {
      state.checks++;
      state.trace.push('active:' + state.checks);
      state.onAssert?.();
      if (state.aborted) throw state.abortError;
    },
    yieldControl() {
      state.yields++;
      state.trace.push('yield:' + state.yields);
      state.checkpoints.push({
        snapshots: state.trace.filter(event => event.startsWith('next:')).length,
        texts: state.texts.length,
        created: state.created.map(container => container.id),
      });
      return state.onYield?.() ?? Promise.resolve();
    },
  } };
  const createContainer = (_context, value) => {
    access('create:' + value.id);
    state.onCreate?.(value);
    const spec = value.spec;
    const styles = {
      owner: value.id,
      opacity: spec.opacity ?? 1,
      isVisible: () => spec.visible !== false,
      isPositionedWithZIndex: () => Boolean(spec.positionedZ),
      isTransformed: () => Boolean(spec.transformed),
      isTransparent: () => Boolean(spec.transparent),
      isPositioned: () => Boolean(spec.positioned || spec.positionedZ),
      isFloating: () => Boolean(spec.floating),
    };
    const container = { id: value.id, flags: spec.flags ?? 0, styles, elements: [], textNodes: [] };
    state.created.push(container);
    return container;
  };
  function TextContainer(_context, value, styles) {
    access('text:' + value.id);
    state.onText?.(value);
    this.id = value.id;
    this.text = value.data;
    this.styleOwner = styles.owner;
    state.texts.push(this);
  }
  return { state, context, createContainer, TextContainer, element, text, fragment, node, link, assigned };
}

function start(kind, build) {
  const env = fixture();
  const element = build(env);
  const metrics = { created: 0, dispatches: 0, machines: [] };
  const source = kind === 'candidate' ? candidateSource : referenceSource;
  const entry = kind === 'candidate' ? 'parseTreeCooperatively' : 'referenceParse';
  const vm = runInNewContext(`${commonSource}\n${source}\n({ parse: ${entry} });`, {
    Promise, Symbol, metrics, Node: { ELEMENT_NODE: 1, TEXT_NODE: 3 },
    createContainer: env.createContainer, TextContainer: env.TextContainer,
  }, { timeout: 5_000 });
  return { ...env, metrics, entry: vm.parse, promise: vm.parse(env.context, element) };
}

function summary(container) {
  const result = [];
  const pending = [container];
  while (pending.length) {
    const value = pending.pop();
    result.push({ id: value.id, flags: value.flags,
      text: value.textNodes.map(item => ({ id: item.id, text: item.text, styleOwner: item.styleOwner })),
      elements: value.elements.map(item => item.id) });
    for (let index = value.elements.length - 1; index >= 0; index--) pending.push(value.elements[index]);
  }
  return result;
}

async function equivalent(build) {
  const reference = start('reference', build);
  const expected = await reference.promise;
  const actual = start('candidate', build);
  const received = await actual.promise;
  assert.notEqual(actual.entry, reference.entry, 'separately evaluated candidate and pristine R52 oracle');
  assert.deepEqual(summary(received), summary(expected), 'container/text/flag output against independent R52 oracle');
  assert.deepEqual(actual.state.trace, reference.state.trace, 'DOM access, mutation and lifecycle order against R52');
  return { actual, received, reference, expected };
}

async function equivalentFailure(build, validate) {
  const outcomes = [];
  for (const kind of ['reference', 'candidate']) {
    const run = start(kind, build);
    await assert.rejects(run.promise, error => {
      validate(run, error);
      return true;
    });
    outcomes.push(run);
  }
  assert.deepEqual(outcomes[1].state.trace, outcomes[0].state.trace, 'failure order against independent R52 oracle');
  return outcomes;
}

const textChildren = (env, count) => Array.from({ length: count }, (_, index) => env.text('t' + (index + 1)));
const textIds = run => run.state.texts.map(value => value.id);

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((accept, fail) => { resolve = accept; reject = fail; });
  return { promise, resolve, reject };
}

test('extracts independent parser entries, preserves synchronous parsing and all 95 renderer guards', async () => {
  for (const name of ['__awaiter', '__generator', 'parseTree', 'parseNodeTree']) {
    assert.equal(declaration(candidate, name), declaration(original, name), name + ' stays original');
  }
  let guards = 0;
  const visit = node => {
    if (ts.isCallExpression(node) && node.expression.getText(candidate) === 'assertRenderActive' &&
        node.arguments[0]?.getText(candidate) === 'ownedRenderContext') {
      let owner = node.parent;
      while (owner && !ts.isFunctionLike(owner)) owner = owner.parent;
      assert.ok(owner && ts.isFunctionExpression(owner));
      assert.ok(ts.isCallExpression(owner.parent));
      assert.equal(owner.parent.expression.getText(candidate), '__generator');
      guards++;
    }
    ts.forEachChild(node, visit);
  };
  visit(candidate);
  assert.equal(guards, 95, 'original renderer assertion gate');
  assert.match(referenceSource, /referenceWalk/);
  assert.match(candidateSource, /parseTreeCooperatively/);
  assert.equal(referenceSource.includes('parseTreeCooperatively'), false, 'oracle never aliases candidate');
  await equivalent(env => env.element('root'));
});

test('preserves nonblank raw text, ignores non-elements, and prunes invisible descendants', async () => {
  const { actual, received } = await equivalent(env => env.element('root', 'DIV', [
    env.text('blank', ' \t\n '), env.text('raw', '  visible text\n'),
    env.node('comment', 8, [env.text('comment-child')]),
    env.element('hidden', 'DIV', [env.text('hidden-child')], { visible: false }),
    env.element('visible', 'DIV', [env.text('nested')]),
  ]));
  assert.deepEqual(textIds(actual), ['raw', 'nested']);
  assert.equal(received.textNodes[0].text, '  visible text\n');
  assert.equal(received.textNodes[0].styleOwner, 'root');
  assert.equal(received.elements[0].textNodes[0].styleOwner, 'visible');
  assert.deepEqual(actual.state.created.map(value => value.id), ['root', 'hidden', 'visible']);
  assert.equal(actual.state.trace.includes('first:hidden'), false);
  assert.equal(actual.state.trace.includes('first:comment'), false);
  assert.deepEqual(received.elements.map(value => value.id), ['visible']);
});

test('preserves real-context precedence, positioned/floating flags, list owners and root transparency', async () => {
  const { received } = await equivalent(env => env.element('root', 'DIV', [
    env.element('real-list', 'OL', [], { flags: 16, positioned: true, opacity: 0.5 }),
    env.element('positioned', 'DIV', [], { positioned: true }),
    env.element('floating', 'DIV', [], { floating: true }),
    env.element('z-index', 'DIV', [], { positionedZ: true }),
    env.element('transformed', 'DIV', [], { transformed: true }),
    env.element('unordered', 'UL'), env.element('menu', 'MENU'),
    env.element('ordinary-li', 'LI'),
    env.element('opaque-parent', 'DIV', [env.element('body', 'BODY')]),
  ], { transparent: true }));
  const flags = Object.fromEntries(summary(received).map(value => [value.id, value.flags]));
  assert.deepEqual(flags, { root: 4, 'real-list': 28, positioned: 2, floating: 2,
    'z-index': 4, transformed: 4, unordered: 8, menu: 8, 'ordinary-li': 0,
    'opaque-parent': 0, body: 4 });
});

test('root is always created and ORs flag 4 without applying child-only visibility or shadow rules', async () => {
  const { actual, received } = await equivalent(env => {
    const value = env.element('root', 'SELECT', [env.text('root-light')], { visible: false, flags: 16 });
    value.shadow = env.fragment('root-shadow', [env.text('root-shadow-text')]);
    return value;
  });
  assert.equal(received.flags, 20);
  assert.deepEqual(textIds(actual), ['root-light']);
  assert.equal(actual.state.trace.includes('shadow:root'), false);
});

test('shadow roots take precedence over light children, even on normally excluded element kinds', async () => {
  const { actual, received } = await equivalent(env => env.element('root', 'DIV',
    ['DIV', 'TEXTAREA', 'svg', 'SELECT'].map((tag, index) => {
      const host = env.element('host' + index, tag, [env.text('light' + index)]);
      host.shadow = env.fragment('shadow' + index, [env.text('shadow-text' + index)]);
      return host;
    })));
  assert.deepEqual(textIds(actual), ['shadow-text0', 'shadow-text1', 'shadow-text2', 'shadow-text3']);
  assert.deepEqual(received.elements.map(value => value.textNodes[0].styleOwner), ['host0', 'host1', 'host2', 'host3']);
  assert.equal(actual.state.trace.some(event => /^first:host/.test(event)), false);
});

test('textarea, svg and select without shadow roots keep containers but skip descendants', async () => {
  const { actual, received } = await equivalent(env => env.element('root', 'DIV', [
    ...['TEXTAREA', 'svg', 'SELECT'].map(tag => env.element(tag, tag, [env.text(tag + '-child')])),
    env.element('normal', 'DIV', [env.text('normal-child')]),
  ]));
  assert.deepEqual(received.elements.map(value => value.id), ['TEXTAREA', 'svg', 'SELECT', 'normal']);
  assert.deepEqual(textIds(actual), ['normal-child']);
  for (const id of ['TEXTAREA', 'svg', 'SELECT']) assert.equal(actual.state.trace.includes('first:' + id), false);
});

test('slot assigned nodes contribute only their children, not their own containers or text', async () => {
  const { actual, received } = await equivalent(env => {
    const slot = env.element('slot', 'SLOT', [env.text('fallback')]);
    env.assigned(slot, [env.element('assigned-owner', 'OL', [env.text('assigned-text'),
      env.element('assigned-child', 'DIV', [env.text('nested-assigned')])]),
    env.text('assigned-text-node', 'assigned text itself is skipped')]);
    return env.element('root', 'DIV', [slot]);
  });
  assert.deepEqual(actual.state.created.map(value => value.id), ['root', 'assigned-child']);
  assert.deepEqual(textIds(actual), ['assigned-text', 'nested-assigned']);
  assert.equal(received.textNodes[0].styleOwner, 'root');
  assert.equal(received.elements[0].id, 'assigned-child');
  assert.equal(received.flags, 4);
});

test('empty assigned list skips slot fallback instead of creating a slot container', async () => {
  const { actual, received } = await equivalent(env => {
    const slot = env.element('slot', 'SLOT', [env.text('fallback')]);
    env.assigned(slot, []);
    return env.element('root', 'DIV', [slot, env.text('tail')]);
  });
  assert.deepEqual(actual.state.created.map(value => value.id), ['root']);
  assert.deepEqual(textIds(actual), ['tail']);
  assert.deepEqual(received.elements, []);
  assert.equal(actual.state.trace.includes('first:slot'), false);
});

test('slot lacking assignedNodes follows the ordinary element path', async () => {
  const { actual, received } = await equivalent(env => env.element('root', 'DIV', [
    env.element('slot', 'SLOT', [env.text('fallback')]),
  ]));
  assert.deepEqual(textIds(actual), ['fallback']);
  assert.equal(received.elements[0].id, 'slot');
  assert.equal(received.elements[0].textNodes[0].styleOwner, 'slot');
});

for (const mutation of ['grow', 'shrink']) {
  test('assigned list retains supported live length semantics when it can ' + mutation, async () => {
    const { actual } = await equivalent(env => {
      const slot = env.element('slot', 'SLOT');
      const first = env.element('assigned-first', 'DIV', textChildren(env, 64));
      const second = env.element('assigned-second', 'DIV', [env.text('second-child')]);
      const extra = env.element('assigned-extra', 'DIV', [env.text('extra-child')]);
      const values = env.assigned(slot, [first, second]);
      env.state.onYield = () => {
        assert.equal(env.state.trace.includes('assigned:slot:1'), false, 'later index stays unread during first subtree');
        env.state.trace.push('mutate:' + mutation);
        if (mutation === 'grow') values.push(extra);
        else values.length = 1;
      };
      return env.element('root', 'DIV', [slot]);
    });
    assert.deepEqual(textIds(actual), [
      ...Array.from({ length: 64 }, (_, index) => 't' + (index + 1)),
      ...(mutation === 'grow' ? ['second-child', 'extra-child'] : []),
    ]);
    assert.equal(actual.state.trace.filter(event => event === 'assigned-call:slot').length, 1);
    assert.equal(actual.state.trace.includes('first:assigned-second'), mutation === 'grow');
  });
}

test('assignedNodes, first index and assigned firstChild access wait until the slot yield resumes', async () => {
  const { actual } = await equivalent(env => {
    const slot = env.element('slot', 'SLOT');
    const oldOwner = env.element('old-owner', 'DIV', [env.text('old-child')]);
    const newOwner = env.element('new-owner', 'DIV', [env.text('new-child')]);
    const values = env.assigned(slot, [oldOwner]);
    env.state.onYield = () => {
      assert.equal(env.state.trace.some(event => event.startsWith('assigned-') || event.startsWith('assigned:')), false);
      assert.equal(env.state.trace.includes('first:old-owner'), false);
      assert.equal(env.state.trace.includes('first:new-owner'), false);
      env.state.trace.push('mutate:first-assigned');
      values[0] = newOwner;
    };
    return env.element('root', 'DIV', [...textChildren(env, 63), slot]);
  });
  assert.equal(actual.state.trace.includes('first:old-owner'), false);
  assert.equal(actual.state.trace.includes('first:new-owner'), true);
  assert.deepEqual(textIds(actual).slice(-1), ['new-child']);
  assert.ok(actual.state.trace.indexOf('yield:1') < actual.state.trace.indexOf('assigned:slot:0'));
});

test('nextSibling is snapshotted before yield while current-node processing remains deferred', async () => {
  const { actual } = await equivalent(env => {
    const pivot = env.text('pivot', 'before');
    const tail = env.text('original-tail');
    const replacement = env.text('replacement-tail');
    env.state.onYield = () => {
      assert.equal(env.state.trace.includes('next:pivot'), true);
      assert.equal(env.state.trace.includes('text:pivot'), false);
      env.state.trace.push('mutate:sibling');
      pivot.next = replacement;
      pivot.data = 'after';
    };
    return env.element('root', 'DIV', [...textChildren(env, 63), pivot, tail]);
  });
  assert.deepEqual(textIds(actual).slice(-2), ['pivot', 'original-tail']);
  assert.equal(actual.state.texts.find(value => value.id === 'pivot').text, 'after');
  assert.equal(actual.state.trace.includes('next:replacement-tail'), false);
  assert.ok(actual.state.trace.indexOf('next:pivot') < actual.state.trace.indexOf('yield:1'));
  assert.ok(actual.state.trace.indexOf('yield:1') < actual.state.trace.indexOf('text:pivot'));
});

for (const count of [0, 1, 63, 64, 65, 127, 128]) {
  test('64-next boundary with ' + count + ' direct text children', async () => {
    const { actual } = await equivalent(env => env.element('root', 'DIV', textChildren(env, count)));
    const yields = Math.floor(count / 64);
    assert.equal(actual.state.yields, yields);
    assert.equal(actual.state.checks, count + yields + 2, 'entry, each next yield, each await resumption, final');
    assert.equal(actual.state.texts.length, count);
    assert.deepEqual(actual.state.checkpoints.map(point => point.snapshots),
      Array.from({ length: yields }, (_, index) => (index + 1) * 64));
    assert.deepEqual(actual.state.checkpoints.map(point => point.texts),
      Array.from({ length: yields }, (_, index) => (index + 1) * 64 - 1));
  });
}

test('entry cancellation wins before root construction or any DOM access', async () => {
  const outcomes = await equivalentFailure(env => {
    env.state.aborted = true;
    return env.element('root', 'DIV', [env.text('unvisited')]);
  }, (run, error) => {
    assert.equal(error, run.state.abortError);
    assert.deepEqual(run.state.created, []);
    assert.deepEqual(run.state.trace, ['active:1']);
  });
  assert.equal(outcomes[1].state.yields, 0);
});

test('cancellation on next number 64 precedes yieldControl and processing that node', async () => {
  await equivalentFailure(env => {
    env.state.onAssert = () => { if (env.state.checks === 65) env.state.aborted = true; };
    return env.element('root', 'DIV', textChildren(env, 65));
  }, (run, error) => {
    assert.equal(error, run.state.abortError);
    assert.equal(run.state.yields, 0);
    assert.equal(run.state.texts.length, 63);
    assert.equal(run.state.trace.includes('next:t64'), true);
    assert.equal(run.state.trace.includes('text:t64'), false);
    assert.equal(run.state.trace.includes('next:t65'), false);
  });
});

test('cancellation while yieldControl is pending wins before resumed DOM processing', async () => {
  const traces = [];
  for (const kind of ['reference', 'candidate']) {
    const gate = deferred();
    const run = start(kind, env => {
      env.state.onYield = () => gate.promise;
      return env.element('root', 'DIV', textChildren(env, 65));
    });
    assert.equal(run.state.yields, 1);
    assert.equal(run.state.texts.length, 63);
    const atPause = run.state.trace.slice();
    run.state.aborted = true;
    run.state.forbidDom = true;
    gate.resolve();
    await assert.rejects(run.promise, error => error === run.state.abortError);
    assert.deepEqual(run.state.trace, [...atPause, 'active:66']);
    assert.equal(run.state.texts.length, 63);
    traces.push(run.state.trace);
  }
  assert.deepEqual(traces[1], traces[0]);
});

test('cancellation at traversal completion wins over a successful root return', async () => {
  await equivalentFailure(env => {
    env.state.onText = () => { env.state.aborted = true; };
    return env.element('root', 'DIV', [env.text('last')]);
  }, (run, error) => {
    assert.equal(error, run.state.abortError);
    assert.equal(run.state.texts.length, 1);
    assert.equal(run.state.checks, 3);
    assert.equal(run.state.yields, 0);
  });
});

test('yieldControl rejection propagates its actual error without continuing the tree', async () => {
  await equivalentFailure(env => {
    env.state.onYield = () => Promise.reject(env.state.abortError);
    return env.element('root', 'DIV', textChildren(env, 65));
  }, (run, error) => {
    assert.equal(error, run.state.abortError);
    assert.equal(run.state.yields, 1);
    assert.equal(run.state.texts.length, 63);
    assert.equal(run.state.trace.includes('text:t64'), false);
    assert.equal(run.state.trace.includes('next:t65'), false);
  });
});

test('container-construction failure propagates without visiting descendants or later siblings', async () => {
  await equivalentFailure(env => {
    env.state.onCreate = value => { if (value.id === 'broken') throw env.state.abortError; };
    return env.element('root', 'DIV', [env.element('broken', 'DIV', [env.text('unvisited-child')]),
      env.text('unvisited-sibling')]);
  }, (run, error) => {
    assert.equal(error, run.state.abortError);
    assert.deepEqual(run.state.created.map(value => value.id), ['root']);
    assert.equal(run.state.trace.includes('first:broken'), false);
    assert.equal(run.state.trace.includes('next:unvisited-sibling'), false);
    assert.deepEqual(textIds(run), []);
  });
});

test('deep tree keeps one walker plus the unchanged async driver, not recursive yield delegation', async t => {
  const depth = 512;
  const build = env => {
    let child = env.text('deep-leaf');
    for (let index = depth; index >= 1; index--) child = env.element('level-' + index, 'DIV', [child]);
    return env.element('root', 'DIV', [child]);
  };
  const reference = start('reference', build);
  const expected = await reference.promise;
  assert.equal(summary(expected).length, depth + 1);
  assert.deepEqual(textIds(reference), ['deep-leaf']);
  assert.ok(reference.metrics.created > 2, 'the independent R52 oracle remains intentionally recursive');
  const actual = start('candidate', build);
  let received;
  try {
    received = await actual.promise;
  } finally {
    t.diagnostic(JSON.stringify({ depth, reference: reference.metrics, candidate: actual.metrics },
      (key, value) => key === 'machines' ? undefined : value));
  }
  assert.equal(summary(received).length, depth + 1, 'normal completion reaches every container');
  assert.deepEqual(textIds(actual), ['deep-leaf']);
  assert.deepEqual(summary(received), summary(expected), 'deep-tree output still matches frozen R52');
  assert.deepEqual(actual.state.trace, reference.state.trace, 'deep-tree ordering still matches frozen R52');
  assert.ok(actual.metrics.dispatches > 0, 'instrumented original helper actually dispatched');
  assert.equal(actual.metrics.machines.reduce((sum, machine) => sum + machine.dispatches, 0), actual.metrics.dispatches);
  assert.equal(actual.metrics.created, 2,
    'one walker plus the unchanged async driver; recursive R52 yield* is intentionally red');
});
