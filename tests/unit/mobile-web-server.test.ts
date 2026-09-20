import { createServer, type Server } from 'node:http';
import { mkdtemp, writeFile, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { webServer } from '../../scripts/web-server.mjs';
async function listen(server: Server) { await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve)); const address = server.address(); if (!address || typeof address === 'string') throw new Error('PORT_REQUIRED'); return address.port; }
async function close(server: Server) { server.closeAllConnections(); await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
it('serves RN assets with camera/CSP protections, blocks secret paths and proxies only the fixed API', async () => {
  const root = await mkdtemp(join(tmpdir(), 'solveflow-rn-assets-')); const outside = await mkdtemp(join(tmpdir(), 'solveflow-rn-outside-'));
  await writeFile(join(root, 'index.html'), '<html>RN Web</html>'); await writeFile(join(outside, 'secret.json'), 'private-fixture'); await symlink(join(outside, 'secret.json'), join(root, 'escape.json'));
  const upstream = createServer((req, res) => { res.setHeader('content-type', 'application/json'); res.setHeader('cache-control', 'private, no-store'); res.end(JSON.stringify({ path: req.url, auth: req.headers.authorization === 'Bearer synthetic-native' })); });
  const port = await listen(upstream); const server = webServer(root, port); const base = `http://127.0.0.1:${await listen(server)}`;
  try {
    const page = await fetch(base); expect(await page.text()).toContain('RN Web'); expect(page.headers.get('permissions-policy')).toContain('camera=(self)'); expect(page.headers.get('content-security-policy')).toContain("frame-ancestors 'none'");
    for (const path of ['/.env', '/escape.json', '/%2eenv', '/scripts/web-server.mjs', '/missing.js']) expect((await fetch(base + path)).status).toBe(404);
    expect((await fetch(base, { method: 'POST' })).status).toBe(405);
    const api = await fetch(base + '/api/v1/health', { headers: { authorization: 'Bearer synthetic-native' } });
    expect(await api.json()).toEqual({ path: '/api/v1/health', auth: true }); expect(api.headers.get('cache-control')).toContain('no-store');
  } finally { await close(server); await close(upstream); await rm(root, { recursive: true, force: true }); await rm(outside, { recursive: true, force: true }); }
});
