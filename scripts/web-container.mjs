import { readFile, stat } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { WebStoredModelsSchema, WebEnvironmentSchema } from '../packages/contracts/dist/local.js';
import { webServer, webServerOptions } from './web-server.mjs';
import { openWebModelSettings } from './web-model-settings.mjs';

// Decision: .agents/notes/implemented/architecture/2026-10-14-container-web-loopback.md
export function containerEnvironment(value) {
  const stored = WebStoredModelsSchema.parse(value);
  const roles = Object.fromEntries(['solver', 'verifier', 'backup'].map(role => [role, stored.models[role] ? {
    profile: stored.models[role], key: stored.keys[role], token: randomBytes(32).toString('hex'),
  } : null]));
  const bootstrap = WebEnvironmentSchema.parse({ schemaVersion: 1,
    settings: { schemaVersion: 1, ...stored.models },
    accessTokens: Object.fromEntries(Object.entries(roles).map(([role, entry]) => [role, entry?.token ?? null])),
  });
  return { bootstrap, roles };
}

export async function startWebContainer({ directory, stateDirectory, port, host = '0.0.0.0', publicOrigin = null, transport = fetch, observe = () => {} }) {
  const file = resolve(stateDirectory, 'web-model-settings.json');
  if ((await stat(file)).size > 32768) throw new Error('WEB_MODELS_TOO_LARGE');
  const info = await readFile(file, { encoding: 'utf8', signal: AbortSignal.timeout(5000) });
  if (Buffer.byteLength(info) > 32768) throw new Error('WEB_MODELS_TOO_LARGE');
  const environment = containerEnvironment(JSON.parse(info));
  const modelSettings = await openWebModelSettings(environment, file, resolve(stateDirectory, 'web-model-presets.json'));
  const server = webServer(directory, null, environment, transport, observe, modelSettings);
  if (publicOrigin) {
    const origin = new URL(publicOrigin);
    if (origin.origin !== publicOrigin || origin.protocol !== 'https:' || !origin.hostname.endsWith('.ts.net')) throw new Error('INVALID_PRIVATE_HTTPS_ORIGIN');
    const handler = server.listeners('request')[0]; server.removeAllListeners('request');
    server.on('request', (req, res) => {
      const localHost = `127.0.0.1:${req.socket.localPort}`;
      const allowedHost = [origin.host, localHost, `localhost:${req.socket.localPort}`].includes(req.headers.host);
      const allowedOrigin = !req.headers.origin || [publicOrigin, `http://${localHost}`].includes(req.headers.origin);
      const allowedSite = !req.headers['sec-fetch-site'] || ['same-origin', 'none'].includes(req.headers['sec-fetch-site']);
      if (!allowedHost || !allowedOrigin || !allowedSite) { res.writeHead(403, { 'cache-control': 'no-store' }); res.end(); return; }
      // 入口仅发布到宿主回环并由私有 Tailnet Serve 接入；不信任转发头来选择目标或来源。
      req.headers.host = localHost; if (req.headers.origin) req.headers.origin = `http://${localHost}`;
      return handler(req, res);
    });
  }
  server.requestTimeout = 15000; server.headersTimeout = 10000;
  await new Promise((accept, reject) => { server.once('error', reject); server.listen(port, host, () => { server.off('error', reject); accept(); }); });
  return { server, environment };
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try {
    const { port, directory } = webServerOptions();
    const stateDirectory = process.env.SOLVEFLOW_WEB_STATE_DIR;
    if (!stateDirectory?.trim()) throw new Error('WEB_STATE_REQUIRED');
    const { server } = await startWebContainer({ directory, stateDirectory, port, publicOrigin: process.env.SOLVEFLOW_WEB_PUBLIC_ORIGIN ?? null, observe: entry => console.log(JSON.stringify(entry)) });
    console.log(JSON.stringify({ type: 'web.container.ready', port, modelsConfigured: true }));
    const stop = () => { server.closeAllConnections(); server.close(); };
    process.once('SIGINT', stop); process.once('SIGTERM', stop);
  } catch { console.error('WEB_CONTAINER_START_FAILED'); process.exitCode = 1; }
}
