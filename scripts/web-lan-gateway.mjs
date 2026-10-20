import { createServer } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import proxyApi from './api-proxy.cjs';
import { MAX_DEVICE_PHASE_DURATION_MS } from '../packages/contracts/dist/agent.js';

export function privateIPv4(address) {
  if (typeof address !== 'string') return false;
  const parts = address.split('.');
  if (parts.length !== 4 || parts.some(part => !/^\d{1,3}$/.test(part) || Number(part) > 255 || String(Number(part)) !== part)) return false;
  const [a, b] = parts.map(Number);
  return a === 10 || a === 172 && b >= 16 && b <= 31 || a === 192 && b === 168;
}

// Decision: .agents/notes/implemented/architecture/2026-10-14-container-web-loopback.md
export function lanGateway({ address, port, upstreamPort = port, tls = null, handleRequest = null }) {
  if (!privateIPv4(address) || !Number.isInteger(port) || port < 1024 || port > 65535 || !Number.isInteger(upstreamPort) || upstreamPort < 1024 || upstreamPort > 65535) throw new Error('INVALID_LAN_GATEWAY');
  const host = `${address}:${port}`; const origin = `${tls ? 'https' : 'http'}://${host}`;
  const server = (tls ? createHttpsServer : createServer)(tls ?? {}, (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    const site = req.headers['sec-fetch-site'];
    // A link from another page is cross-site navigation, not a cross-origin API call.
    const homeNavigation = req.method === 'GET' && req.url?.split('?')[0] === '/' && !req.headers.origin
      && req.headers['sec-fetch-mode'] === 'navigate' && req.headers['sec-fetch-dest'] === 'document';
    if (req.headers.host !== host || req.headers.origin && req.headers.origin !== origin || site && !['same-origin', 'none'].includes(site) && !homeNavigation || !req.url?.startsWith('/') || req.url.startsWith('//')) {
      res.writeHead(403, { 'cache-control': 'no-store' }); res.end(); return;
    }
    if (homeNavigation) req.headers['sec-fetch-site'] = 'none';
    if (req.headers.origin) req.headers.origin = `http://127.0.0.1:${upstreamPort}`;
    for (const header of ['forwarded', 'x-forwarded-host', 'x-forwarded-proto', 'x-forwarded-for']) delete req.headers[header];
    if (handleRequest?.(req, res)) return;
    return proxyApi(req, res, upstreamPort, MAX_DEVICE_PHASE_DURATION_MS + 10000);
  });
  server.requestTimeout = 15000; server.headersTimeout = 10000;
  return server;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try {
    const address = process.env.SOLVEFLOW_LAN_ADDRESS;
    const port = Number(process.env.SOLVEFLOW_LAN_PORT ?? '3130');
    const [key, cert] = await Promise.all([readFile(process.env.SOLVEFLOW_LAN_TLS_KEY), readFile(process.env.SOLVEFLOW_LAN_TLS_CERT)]);
    const server = lanGateway({ address, port, tls: { key, cert } });
    server.on('error', () => { console.error('LAN_GATEWAY_LISTEN_FAILED'); process.exitCode = 1; });
    server.listen(port, address, () => console.log(JSON.stringify({ type: 'web.lan.ready', url: `https://${address}:${port}`, pid: process.pid })));
    const stop = () => { server.closeAllConnections(); server.close(); };
    process.once('SIGINT', stop); process.once('SIGTERM', stop);
  } catch { console.error('LAN_GATEWAY_CONFIG_FAILED'); process.exitCode = 1; }
}
