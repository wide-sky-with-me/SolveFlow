import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile, realpath, stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { extname, resolve, sep } from 'node:path';
import sharp from 'sharp';
import { PHOTO_BODY_BYTES, PhotoLoginSchema, PhotoSolveRequestSchema, PhotoStreamMessageSchema, type PhotoSolveRequest } from '@solveflow/contracts/photo';
import { PublicAgentEventSchema, SolveOutcomeSchema, type PublicAgentEvent, type SolveOutcome } from '@solveflow/contracts/agent';
import { PhotoAuth, LoginThrottle } from './auth.js';
import { PhotoLedger } from './ledger.js';
type Solve = (request: PhotoSolveRequest, accountId: string, signal: AbortSignal, onEvent: (event: PublicAgentEvent) => void) => Promise<SolveOutcome>;
export interface PhotoServiceOptions { origin: string; auth: PhotoAuth; ledger: PhotoLedger; publicDir: string; solve: Solve; maxConcurrent?: number }
function json(res: ServerResponse, status: number, value: unknown) { res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(value)); }
async function body(req: IncomingMessage, limit: number) {
  if (!req.headers['content-type']?.startsWith('application/json')) throw new Error('仅接受JSON请求。');
  const chunks: Buffer[] = []; let size = 0;
  const timer = setTimeout(() => req.destroy(), 45000);
  try {
    for await (const chunk of req) { const part: unknown = chunk; if (!(part instanceof Buffer)) throw new Error('无效请求。'); size += part.length; if (size > limit) throw new Error('请求过大。'); chunks.push(part); }
    const value: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8')); return value;
  } finally { clearTimeout(timer); }
}
export function createPhotoHandler(options: PhotoServiceOptions) {
  const throttle = new LoginThrottle(); const active = new Map<string, { account: string; nonce: string; controller: AbortController }>();
  const revoked = new Map<string, number>(); let loginCount = 0; let loginWindow = Date.now();
  return async (req: IncomingMessage, res: ServerResponse) => {
    res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('Referrer-Policy', 'no-referrer'); res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
    res.setHeader('Permissions-Policy', 'camera=(self), microphone=(), geolocation=()');
    if (options.origin.startsWith('https:')) res.setHeader('Strict-Transport-Security', 'max-age=31536000');
    try {
    const url = new URL(req.url ?? '/', options.origin);
    for (const [nonce, expires] of revoked) if (expires <= Date.now()) revoked.delete(nonce);
    let session = options.auth.session(req.headers.cookie);
    if (session && revoked.has(session.nonce)) session = null;
      if (url.pathname === '/api/session' && req.method === 'GET') { json(res, session ? 200 : 401, session ? { schemaVersion: 1, accountId: session.id } : { message: '请先输入访问密钥。' }); return; }
      if (url.pathname.startsWith('/api/')) {
        if (req.method !== 'POST') { json(res, 405, { message: '请求方式不支持。' }); return; }
        if (req.headers.origin !== options.origin || (req.headers['sec-fetch-site'] && req.headers['sec-fetch-site'] !== 'same-origin')) { json(res, 403, { message: '仅允许同源请求。' }); return; }
      }
      if (url.pathname === '/api/login') {
        if (Date.now() - loginWindow > 60000) { loginCount = 0; loginWindow = Date.now(); }
        const address = req.socket.remoteAddress ?? 'unknown';
        if (++loginCount > 60 || throttle.full || throttle.blocked(address)) { json(res, 429, { message: '尝试过于频繁，请稍后再试。' }); return; }
        const parsed = PhotoLoginSchema.safeParse(await body(req, 1024));
        const authenticated = parsed.success ? options.auth.login(parsed.data.key) : null;
        if (!authenticated) { throttle.fail(address); json(res, 401, { message: '访问密钥不正确。' }); return; }
        res.setHeader('Set-Cookie', authenticated.cookie); json(res, 200, { schemaVersion: 1, accountId: authenticated.session.id }); return;
      }
      if (url.pathname.startsWith('/api/') && !session) { json(res, 401, { message: '登录已失效，请重新输入访问密钥。' }); return; }
      if (url.pathname === '/api/logout' && session) {
        if (revoked.size >= 2048) { json(res, 503, { message: '暂时无法退出，请稍后重试。' }); return; }
        revoked.set(session.nonce, session.expires);
        for (const job of active.values()) if (job.nonce === session.nonce) job.controller.abort();
        res.setHeader('Set-Cookie', options.auth.clearCookie()); json(res, 200, { ok: true }); return;
      }
      if (url.pathname === '/api/solve' && session) {
        if (active.size >= (options.maxConcurrent ?? 4) || [...active.values()].filter(j => j.account === session.id).length >= 2) { json(res, 429, { message: '当前答题较多，请稍后再试。' }); return; }
        const jobId = randomUUID(); const controller = new AbortController();
        active.set(jobId, { account: session.id, nonce: session.nonce, controller });
        const cancel = () => { if (!res.writableEnded) controller.abort(); }; res.once('close', cancel); req.once('aborted', cancel);
        const deadline = setTimeout(() => controller.abort(), 6 * 60000);
        try {
          const request = PhotoSolveRequestSchema.parse(await body(req, PHOTO_BODY_BYTES));
          if (controller.signal.aborted) return;
          const acceptedSession = options.auth.session(req.headers.cookie);
          if (!acceptedSession || revoked.has(session.nonce)) { json(res, 401, { message: '登录已失效。' }); return; }
          const raw = Buffer.from(request.image.split(',')[1] ?? '', 'base64');
          if (raw.length > 4 * 1024 * 1024 || raw[0] !== 0xff || raw[1] !== 0xd8 || raw[2] !== 0xff) throw new Error('题图格式无效。');
          const image = await sharp(raw, { limitInputPixels: 16777216, failOn: 'warning' }).rotate().resize({ width: 2048, height: 2048, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 92 }).toBuffer();
          if (controller.signal.aborted) return;
          const account = session.id;
          // Claims survive restart and precede dispatch; no automatic replay on disconnect.
          await options.ledger.claim(account, request.requestId);
          if (controller.signal.aborted) return;
          res.writeHead(200, { 'content-type': 'application/x-ndjson; charset=utf-8', 'x-accel-buffering': 'no' }); res.flushHeaders();
          let sent = 0;
          const send = (value: unknown) => { const parsed = PhotoStreamMessageSchema.parse(value); if (!res.destroyed && !res.writableEnded && !controller.signal.aborted && (parsed.type === 'result' || ++sent <= 300)) res.write(JSON.stringify(parsed) + '\n'); };
          const heartbeat = setInterval(() => { if (!res.destroyed && !controller.signal.aborted) res.write('\n'); }, 15000);
          try {
            const outcome = await options.solve({ ...request, image: `data:image/jpeg;base64,${image.toString('base64')}` }, account, controller.signal, event => send({ type: 'event', event: PublicAgentEventSchema.parse(event) }));
            if (!controller.signal.aborted) send({ type: 'result', outcome: SolveOutcomeSchema.parse(outcome) });
          } finally { clearInterval(heartbeat); res.end(); }
        } finally { clearTimeout(deadline); res.off('close', cancel); req.off('aborted', cancel); active.delete(jobId); }
        return;
      }
      if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/__solveflow/')) { json(res, 404, { message: '入口不存在。' }); return; }
      if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); res.end(); return; }
      const path = decodeURIComponent(url.pathname);
      if (path.includes('\\') || path.includes('\0') || path.split('/').some(p => p.startsWith('.'))) throw new Error('无效路径。');
      const root = await realpath(options.publicDir); const target = await realpath(resolve(root, '.' + (path === '/' ? '/index.html' : path)));
      const mime: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf' };
      if (!target.startsWith(root + sep) || !mime[extname(target)] || !(await stat(target)).isFile()) { res.writeHead(404); res.end(); return; }
      res.setHeader('Content-Type', mime[extname(target)]!);
      res.setHeader('Vary', 'Accept-Encoding');
      let selected = target;
      const encoding = String(req.headers['accept-encoding'] ?? '').includes('br') ? 'br' : String(req.headers['accept-encoding'] ?? '').includes('gzip') ? 'gz' : null;
      if (encoding && ['.js', '.css', '.html', '.svg'].includes(extname(target))) {
        try { await stat(target + '.' + encoding); selected += '.' + encoding; res.setHeader('Content-Encoding', encoding === 'gz' ? 'gzip' : 'br'); } catch { /* Uncompressed source remains valid. */ }
      }
      if (path !== '/' && !path.endsWith('.html')) res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      if (req.method === 'HEAD') res.end(); else { const stream = createReadStream(selected); stream.on('error', () => res.destroy()); res.on('close', () => stream.destroy()); stream.pipe(res); }
    } catch (error) {
      if (res.headersSent) { if (!res.destroyed) res.destroy(); return; }
      const message = error instanceof Error && ['本次请求已提交，请查看历史记录。', '今日使用次数已达上限。', '额度记录暂不可用，请稍后重试。'].includes(error.message) ? error.message : '请求未完成，请检查图片或稍后重试。';
      json(res, 400, { message });
    }
  };
}
export function createPhotoTestServer(options: PhotoServiceOptions) { return createServer(createPhotoHandler(options)); }
