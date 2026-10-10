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
