import { createServer as createHttpServer } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import { readFile, stat } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { WebStoredModelsSchema } from '@solveflow/contracts/local';
import { SolverInputSchema } from '@solveflow/contracts/agent';
import { solveOnDevice } from '@solveflow/agent/mobile';
import { AccessKeysSchema, PhotoAuth } from './auth.js';
import { PhotoLedger } from './ledger.js';
import { createPhotoHandler } from './service.js';
import { preparePhotoActViews } from './image-views.js';
import { photoDispatch } from './dispatch.js';
const ConfigSchema = z.strictObject({ origin: z.url(), secret: z.string().min(32).max(200), accessKeys: AccessKeysSchema, models: WebStoredModelsSchema });
const path = process.env.SOLVEFLOW_PHOTO_CONFIG;
if (!path || ((await stat(path)).mode & 0o077) !== 0) throw new Error('Private photo configuration is required with mode 0600.');
const config = ConfigSchema.parse(JSON.parse(await readFile(path, 'utf8')));
const solverKey = config.models.keys.solver;
if (!solverKey) throw new Error('Solver credentials required.');
const origin = new URL(config.origin);
if (origin.origin !== config.origin || origin.username || origin.password || (origin.protocol !== 'https:' && !['127.0.0.1', 'localhost'].includes(origin.hostname))) throw new Error('Public origin requires HTTPS.');
for (const profile of Object.values(config.models.models)) if (profile && !profile.baseURL.startsWith('https://')) throw new Error('Models require HTTPS.');
const state = process.env.SOLVEFLOW_PHOTO_STATE ?? resolve(dirname(path), 'state');
const dispatchLimit = process.env.SOLVEFLOW_PHOTO_DISPATCH_LIMIT;
const dispatch = photoDispatch(dispatchLimit === undefined ? null : Number(dispatchLimit));
const handler = createPhotoHandler({ origin: config.origin, auth: new PhotoAuth(config.accessKeys, config.secret, origin.protocol === 'https:'), ledger: new PhotoLedger(resolve(state, 'ledger.json')), publicDir: resolve(dirname(fileURLToPath(import.meta.url)), 'public'),
  async solve(request, accountId, signal, onEvent) {
    const input = SolverInputSchema.parse({ schemaVersion: 1, role: 'solver', identity: { ownerId: accountId, sessionId: request.sessionId, runId: request.requestId }, exam: request.exam, answerMode: 'brief', verificationMode: 'manual', message: '', evidence: [], image: { bytes: Uint8Array.from(Buffer.from(request.image.split(',')[1] ?? '', 'base64')), mimeType: 'image/jpeg' } });
    const result = await solveOnDevice(input, { ...config.models.models, schemaVersion: 1 }, { ...config.models.keys, solver: solverKey }, dispatch, signal, onEvent, undefined, undefined, undefined, preparePhotoActViews);
    return result;
  },
});
async function tls() { const key = process.env.SOLVEFLOW_PHOTO_TLS_KEY, cert = process.env.SOLVEFLOW_PHOTO_TLS_CERT; if (!key || !cert) throw new Error('TLS files required.'); return { key: await readFile(key), cert: await readFile(cert) }; }
const https = origin.protocol === 'https:';
const server = https ? createHttpsServer(await tls(), handler) : createHttpServer(handler);
server.requestTimeout = 65000; server.headersTimeout = 15000; server.maxHeadersCount = 40;
const port = Number(process.env.SOLVEFLOW_PHOTO_PORT ?? (https ? 443 : 3188));
if (!Number.isSafeInteger(port) || port < 1 || port > 65535) throw new Error('Invalid port.');
server.listen(port, https ? '0.0.0.0' : '127.0.0.1', () => console.info(JSON.stringify({ event: 'photo.ready', port })));
server.maxConnections = 256;
const acmeRoot = process.env.SOLVEFLOW_PHOTO_ACME;
const acme = https && acmeRoot ? createHttpServer(async (req, res) => {
  const match = /^\/\.well-known\/acme-challenge\/([A-Za-z0-9_-]{1,160})$/.exec(req.url ?? '');
  if (match && ['GET', 'HEAD'].includes(req.method ?? '')) {
    try { const bytes = await readFile(resolve(acmeRoot, '.well-known/acme-challenge', match[1]!)); if (bytes.length > 4096) throw new Error('INVALID_CHALLENGE'); res.writeHead(200, { 'content-type': 'text/plain', 'cache-control': 'no-store' }); res.end(req.method === 'HEAD' ? undefined : bytes); }
    catch { res.writeHead(404); res.end(); } return;
  }
  res.writeHead(308, { location: config.origin + '/' }); res.end();
}) : null;
if (acme) { acme.requestTimeout = 10000; acme.headersTimeout = 5000; acme.listen(80, '0.0.0.0'); }
if (https) process.on('SIGHUP', () => { if ('setSecureContext' in server) void tls().then(options => server.setSecureContext(options)).catch(() => console.error('TLS reload failed.')); });
const stop = () => { server.closeAllConnections(); server.close(); acme?.closeAllConnections(); acme?.close(); };
process.once('SIGTERM', stop); process.once('SIGINT', stop);
