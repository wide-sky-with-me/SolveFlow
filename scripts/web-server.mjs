import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { realpath, stat } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import proxyApi from './api-proxy.cjs';
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.ttf': 'font/ttf', '.woff': 'font/woff', '.woff2': 'font/woff2' };
export function webServer(directory, apiPort = null) {
  if (apiPort !== null && (!Number.isInteger(apiPort) || apiPort < 1024 || apiPort > 65535)) throw new Error('INVALID_API_PORT');
  const root = resolve(directory);
  return createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Permissions-Policy', 'camera=(self), microphone=(), geolocation=()');
    if (req.url?.startsWith('/api/v1/')) { if (apiPort === null) { res.writeHead(404); res.end(); } else proxyApi(req, res, apiPort); return; }
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; media-src 'self' blob:; font-src 'self' data:; connect-src 'self' https:; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
    res.setHeader('Cache-Control', 'no-cache');
    try {
      if (!['GET', 'HEAD'].includes(req.method ?? '')) { res.writeHead(405); res.end(); return; }
      const pathname = decodeURIComponent(new URL(req.url ?? '/', 'http://localhost').pathname);
      if (pathname.includes('\\') || pathname.includes('\0') || pathname.split('/').some(part => part.startsWith('.'))) throw new Error('PATH_DENIED');
      const target = await realpath(resolve(root, `.${pathname === '/' ? '/index.html' : pathname}`));
      if (!target.startsWith(root + sep) || !Object.hasOwn(types, extname(target))) throw new Error('PATH_DENIED');
      const info = await stat(target); if (!info.isFile()) throw new Error('NOT_FILE');
      res.setHeader('Content-Type', types[extname(target)]); res.setHeader('Content-Length', info.size);
      if (req.method === 'HEAD') res.end(); else { const stream = createReadStream(target); stream.on('error', () => res.destroy()); res.on('close', () => stream.destroy()); stream.pipe(res); }
    } catch { res.writeHead(404); res.end('Not found'); }
  });
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const server = webServer(fileURLToPath(new URL('../apps/mobile/dist/', import.meta.url)));
  server.requestTimeout = 15000; server.headersTimeout = 10000;
  server.listen(3100, '127.0.0.1', () => console.log('SolveFlow React Native Web: http://127.0.0.1:3100'));
  const stop = () => { server.closeAllConnections(); server.close(); };
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
}
