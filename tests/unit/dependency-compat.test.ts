import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { it } from 'vitest';

const cwd = fileURLToPath(new URL('../../', import.meta.url));

// Resolve through the real consumer: a root-only import can test the wrong copy.
// A bounded subprocess also preserves CommonJS resolution used by Expo tools.
function checkDependency(source: string): void {
  execFileSync(process.execPath, ['--input-type=module', '-e', `
    import assert from 'node:assert/strict';
    import { createRequire } from 'node:module';
    import { resolve } from 'node:path';
    ${source}
  `], { cwd, timeout: 5_000, stdio: 'pipe' });
}

it('keeps Expo xcode IDs compatible while rejecting out-of-bounds UUID output', () => {
  checkDependency(`
    const mobile = createRequire(resolve('apps/mobile/package.json'));
    const expo = createRequire(mobile.resolve('expo/package.json'));
    const plugins = createRequire(expo.resolve('@expo/config-plugins'));
    const xcode = plugins('xcode');
    const uuid = createRequire(plugins.resolve('xcode'))('uuid');
    const project = xcode.project('fixture.pbxproj');
    const objects = {};
    project.hash = { project: { objects: { PBXFileReference: objects } } };
    for (let index = 0; index < 100; index++) {
      const id = project.generateUuid();
      assert.match(id, /^[0-9A-F]{24}$/);
      assert.equal(Object.hasOwn(objects, id), false);
      objects[id] = {};
    }
    const output = new Uint8Array(20);
    assert.equal(uuid.v5('fixture', uuid.v5.DNS, output, 4), output);
    assert.throws(() => uuid.v5('fixture', uuid.v5.DNS, new Uint8Array(8), 4), RangeError);
  `);
});

it('canonicalizes percent-encoded scheme-relative hosts in MCP schema URIs', () => {
  checkDependency(`
    const agent = createRequire(resolve('packages/agent/package.json'));
    const mcp = createRequire(agent.resolve('@modelcontextprotocol/sdk/server/index.js'));
    const uri = createRequire(mcp.resolve('ajv'))('fast-uri');
    assert.equal(uri.parse('//%41.com').host, 'a.com');
    assert.equal(uri.equal('//%41.com', '//a.com'), true);
    assert.equal(uri.equal('//%41.com', '//b.com'), false);
  `);
});

it('rejects cross-family subnets in the MCP rate-limit dependency', () => {
  checkDependency(`
    const agent = createRequire(resolve('packages/agent/package.json'));
    const mcp = createRequire(agent.resolve('@modelcontextprotocol/sdk/server/index.js'));
    const { Address4, Address6 } = createRequire(mcp.resolve('express-rate-limit'))('ip-address');
    assert.equal(new Address4('10.0.0.1').isInSubnet(new Address6('::/0')), false);
    assert.equal(new Address6('::1').isInSubnet(new Address4('0.0.0.0/0')), false);
    assert.equal(new Address4('10.0.0.1').isInSubnet(new Address4('10.0.0.0/8')), true);
    assert.equal(new Address4('11.0.0.1').isInSubnet(new Address4('10.0.0.0/8')), false);
    assert.equal(new Address6('::1').isInSubnet(new Address6('::/0')), true);
  `);
});

it('keeps MCP Express trust checks precise for mapped IPv6 proxies', () => {
  checkDependency(`
    const agent = createRequire(resolve('packages/agent/package.json'));
    const mcp = createRequire(agent.resolve('@modelcontextprotocol/sdk/server/index.js'));
    const express = createRequire(mcp.resolve('express'));
    const proxy = express('proxy-addr');
    assert.equal(express('proxy-addr/package.json').version, '2.0.8');
    const trust = proxy.compile('::ffff:127.0.0.1/128');
    assert.equal(trust('127.0.0.1'), true);
    assert.equal(trust('127.0.0.2'), false);
    const request = remoteAddress => ({ connection: { remoteAddress }, headers: { 'x-forwarded-for': '198.51.100.7' } });
    assert.equal(proxy(request('127.0.0.1'), trust), '198.51.100.7');
    assert.equal(proxy(request('127.0.0.2'), trust), '127.0.0.2');
  `);
});

it('preserves React Native devtools shell arguments and rejects comment line terminators', () => {
  checkDependency(`
    const mobile = createRequire(resolve('apps/mobile/package.json'));
    const native = createRequire(mobile.resolve('react-native/package.json'));
    const tools = createRequire(native.resolve('react-devtools-core/package.json'));
    const { quote, parse } = tools('shell-quote');
    assert.equal(tools('shell-quote/package.json').version, '1.11.0');
    const args = ['a b', '$name', 'x; echo fixture', "a'b", ''];
    assert.deepEqual(parse(quote(args), {}), args);
    for (const code of [10, 13, 0x2028, 0x2029]) {
      assert.throws(() => quote([{ comment: 'fixture' }, String.fromCharCode(code) + 'fixture']), TypeError);
    }
  `);
});

it('keeps Expo PostCSS source maps synchronous while bounding indexed section offsets', () => {
  checkDependency(`
    const mobile = createRequire(resolve('apps/mobile/package.json'));
    const expo = createRequire(mobile.resolve('expo/package.json'));
    const metro = createRequire(expo.resolve('@expo/metro-config'));
    const postcss = createRequire(metro.resolve('postcss'));
    const { SourceMapGenerator, SourceMapConsumer } = postcss('source-map-js');
    assert.equal(postcss('source-map-js/package.json').version, '1.2.2');
    const generated = new SourceMapGenerator({ file: 'fixture.css' });
    generated.addMapping({ generated: { line: 1, column: 0 }, original: { line: 4, column: 2 }, source: 'fixture.scss', name: 'color' });
    generated.setSourceContent('fixture.scss', '.fixture { color: red; }');
    const map = generated.toJSON();
    const consumer = new SourceMapConsumer(map);
    assert.deepEqual(consumer.originalPositionFor({ line: 1, column: 0 }), { source: 'fixture.scss', line: 4, column: 2, name: 'color' });
    assert.equal(consumer.sourceContentFor('fixture.scss'), '.fixture { color: red; }');
    for (const line of [-1, 0.5, Infinity, 10000001]) {
      assert.throws(() => new SourceMapConsumer({ version: 3, sections: [{ offset: { line, column: 0 }, map }] }));
    }
  `);
});

it('keeps the patched sharp native image path usable through the Agent', () => {
  checkDependency(`
    const agent = createRequire(resolve('packages/agent/package.json'));
    const sharp = agent('sharp');
    assert.equal(sharp.versions.sharp, '0.35.5');
    const pixels = await sharp({ create: { width: 12, height: 8, channels: 3, background: 'red' } }).png().toBuffer();
    const meta = await sharp(pixels).metadata();
    assert.equal(meta.format, 'png'); assert.equal(meta.width, 12); assert.equal(meta.height, 8);
  `);
});

it('uses the application KaTeX in remark-math without inheriting prototype trust', () => {
  checkDependency(String.raw`
    const mobile = createRequire(resolve('apps/mobile/package.json'));
    const remark = createRequire(mobile.resolve('remark-math'));
    const extension = createRequire(remark.resolve('micromark-extension-math'));
    const katex = extension('katex');
    assert.equal(katex.version, '0.18.7');
    assert.equal(katex.version, mobile('katex').version);
    assert.match(katex.renderToString('x^2', { trust: false }), /class="katex"/);
    const options = Object.assign(Object.create({ trust: true }), { strict: 'ignore', throwOnError: false });
    assert.doesNotMatch(katex.renderToString('\\href{https://fixture.invalid}{link}', options), /<a\b|href="/);
  `);
});
