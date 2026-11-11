import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { realpath, stat } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { pipeline } from 'node:stream';
import { createBrotliCompress, createGzip, constants as zlibConstants } from 'node:zlib';
import proxyApi from './api-proxy.cjs';
import { webModelProxy } from './web-model-proxy.mjs';
import { loadWebEnv } from './web-env.mjs';
import { openWebModelSettings } from './web-model-settings.mjs';
import { configureWebRequestTimeouts } from './web-request-limits.mjs';
const types = { '.txt': 'text/plain; charset=utf-8', '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.ttf': 'font/ttf', '.woff': 'font/woff', '.woff2': 'font/woff2' };
function staticEncoding(header) {
  const accepted = new Map();
  for (const entry of String(header ?? '').toLowerCase().split(',')) {
    const match = entry.trim().match(/^([a-z*]+)(?:\s*;\s*q=(0(?:\.\d{0,3})?|1(?:\.0{0,3})?))?$/);
    if (match) accepted.set(match[1], match[2] === undefined ? 1 : Number(match[2]));
  }
  const selected = ['br', 'gzip'].map(name => ({ name, quality: accepted.get(name) ?? accepted.get('*') ?? 0 }))
    .filter(option => option.quality > 0).sort((a, b) => b.quality - a.quality)[0];
  return selected && (accepted.get('identity') ?? 0) <= selected.quality ? selected.name : undefined;
}
export function webServerOptions(environment = process.env) {
  const value = environment.SOLVEFLOW_WEB_PORT ?? '3100'; const port = Number(value);
  if (!/^\d{1,5}$/.test(value) || !Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('INVALID_WEB_PORT');
  const directory = environment.SOLVEFLOW_WEB_DIR;
  if (directory !== undefined && !directory.trim()) throw new Error('INVALID_WEB_DIRECTORY');
  return { port, directory: resolve(directory ?? fileURLToPath(new URL('../apps/mobile/dist/', import.meta.url))) };
}
export function webServer(directory, apiPort = null, environment = null, modelFetch = fetch, onModelDiagnostic = () => {}, modelSettings = null) {
  if (apiPort !== null && (!Number.isInteger(apiPort) || apiPort < 1024 || apiPort > 65535)) throw new Error('INVALID_API_PORT');
  const root = resolve(directory);
  const modelProxy = webModelProxy(environment, modelFetch, onModelDiagnostic, modelSettings);
  const server = createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Permissions-Policy', 'camera=(self), microphone=(), geolocation=()');
    if (await modelProxy(req, res)) return;
    if (req.url?.startsWith('/api/v1/')) { if (apiPort === null) { res.writeHead(404); res.end(); } else proxyApi(req, res, apiPort); return; }
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' 'wasm-unsafe-eval' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; media-src 'self' blob:; font-src 'self' data:; connect-src 'self' https:; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
    res.setHeader('Cache-Control', 'no-cache');
    try {
      if (!['GET', 'HEAD'].includes(req.method ?? '')) { res.writeHead(405); res.end(); return; }
      const pathname = decodeURIComponent(new URL(req.url ?? '/', 'http://localhost').pathname);
      if (pathname.includes('\\') || pathname.includes('\0') || pathname.split('/').some(part => part.startsWith('.'))) throw new Error('PATH_DENIED');
      const target = await realpath(resolve(root, `.${pathname === '/' ? '/index.html' : pathname}`));
      if (!target.startsWith(root + sep) || !Object.hasOwn(types, extname(target))) throw new Error('PATH_DENIED');
      const info = await stat(target); if (!info.isFile()) throw new Error('NOT_FILE');
      res.setHeader('Content-Type', types[extname(target)]);
      // Decision: .agents/notes/implemented/architecture/2026-11-09-static-text-compression.md
      // Only public static text reaches this branch; model/SSE and private settings return above.
      const compressible = info.size >= 1024 && ['.html', '.js', '.css', '.svg', '.txt'].includes(extname(target));
      const encoding = compressible ? staticEncoding(req.headers['accept-encoding']) : undefined;
      if (compressible) res.setHeader('Vary', 'Accept-Encoding');
      if (encoding) res.setHeader('Content-Encoding', encoding); else res.setHeader('Content-Length', info.size);
      if (/^\/heic-codec-\d+-\d+-\d+\.js$/.test(pathname)) res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      if (req.method === 'HEAD') res.end();
      else {
        const file = createReadStream(target);
        const encoder = encoding === 'br' ? createBrotliCompress({ params: { [zlibConstants.BROTLI_PARAM_QUALITY]: 4, [zlibConstants.BROTLI_PARAM_LGWIN]: 20 } }) : encoding === 'gzip' ? createGzip({ level: 6 }) : null;
        pipeline(encoder ? [file, encoder, res] : [file, res], error => { if (error) res.destroy(); });
      }
    } catch { res.writeHead(404); res.end('Not found'); }
  });
  configureWebRequestTimeouts(server);
  return server;
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const { port, directory } = webServerOptions();
  const environment = await loadWebEnv(new URL('../.env', import.meta.url));
  const modelSettings = await openWebModelSettings(environment, fileURLToPath(new URL('../.runtime/web-model-settings.json', import.meta.url)), fileURLToPath(new URL('../.runtime/web-model-presets.json', import.meta.url)));
  const server = webServer(directory, null, environment, fetch, entry => console.log(JSON.stringify(entry)), modelSettings);
  server.listen(port, '127.0.0.1', () => console.log(`SolveFlow React Native Web: http://127.0.0.1:${port}`));
  const stop = () => { server.closeAllConnections(); server.close(); };
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
}
