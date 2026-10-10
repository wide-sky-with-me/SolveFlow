// Decision: .agents/notes/implemented/architecture/2026-10-09-batch-dispatch-and-verification.md
// Decision: .agents/notes/implemented/agent/2026-10-08-exam-flow-evidence-and-budgets.md
// Decision: .agents/notes/implemented/architecture/2026-10-09-batch-learning-admission.md
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { MAX_DEVICE_PHASE_DURATION_MS, MAX_MODEL_STREAM_BYTES, MAX_MODEL_JSON_BYTES } from '../packages/contracts/dist/agent.js';
import { MAX_LOCAL_MODEL_RUNS } from '../packages/contracts/dist/local.js';
const json = (res, status, message) => { res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify({ error: { message } })); };
function localRequest(req) {
  try {
    const address = new URL(`http://${req.headers.host}`);
    return !address.username && !address.password && address.pathname === '/' && !address.search && !address.hash && ['127.0.0.1', 'localhost', '[::1]'].includes(address.hostname) && address.port === String(req.socket.localPort)
      && (!req.headers.origin || req.headers.origin === address.origin)
      && (!req.headers['sec-fetch-site'] || ['same-origin', 'none'].includes(req.headers['sec-fetch-site']));
  } catch { return false; }
}
// Decision: .agents/notes/implemented/architecture/2026-10-08-local-web-environment.md
// Decision: .agents/notes/implemented/agent/2026-10-08-device-time-and-stream-budget.md
export function webModelProxy(environment, transport = fetch, observe = () => {}) {
  let active = 0;
  return async (req, res) => {
    if (!req.url?.startsWith('/__solveflow/web-env')) return false;
    res.setHeader('Cache-Control', 'no-store');
    if (!environment) { json(res, 404, '本地环境模式未启用。'); return true; }
    if (!localRequest(req)) { json(res, 403, '仅允许本地同源请求。'); return true; }
    if (req.url === '/__solveflow/web-env' && req.method === 'GET') { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(environment.bootstrap)); return true; }
    const match = /^\/__solveflow\/web-env\/model\/(solver|verifier|backup)$/.exec(req.url);
    if (!match || req.method !== 'POST') { json(res, 405, '请求不支持。'); return true; }
    const role = environment.roles[match[1]];
    if (!role || req.headers.authorization !== `Bearer ${role.token}`) { res.setHeader('X-SolveFlow-Model-Dispatch', 'not-started'); json(res, 401, '本地模型凭据无效，请刷新。'); return true; }
    if (active >= MAX_LOCAL_MODEL_RUNS) { json(res, 429, '本地模型请求繁忙。'); return true; }
    active++;
    const started = performance.now(); let received = 0; let dispatched = false; let upstreamStatus; let upstreamHeadersMs; let firstByteMs; let reason = 'completed'; let transportCode;
    const controller = new AbortController(); const abort = () => { if (!res.writableFinished && reason === 'completed') reason = 'client_disconnect'; controller.abort(); if (!req.complete) req.destroy(); };
    const timer = setTimeout(() => { reason = 'timeout'; abort(); }, MAX_DEVICE_PHASE_DURATION_MS); req.on('aborted', abort); res.on('close', abort);
    try {
      const chunks = []; let size = 0;
      for await (const chunk of req) { size += chunk.length; if (size > 16 * 1024 * 1024) { json(res, 413, '请求超过大小限制。'); return true; } chunks.push(chunk); }
      const body = Buffer.concat(chunks); let payload;
      try { payload = JSON.parse(body.toString('utf8')); } catch { json(res, 400, '模型请求格式无效。'); return true; }
      if (!payload || typeof payload !== 'object' || Array.isArray(payload) || payload.model !== role.profile.model || (payload.tools !== undefined && (!Array.isArray(payload.tools) || payload.tools.some(tool => !tool || tool.type !== 'function')))) { json(res, 400, '模型或工具请求不匹配。'); return true; }
      const tokenField = role.profile.api === 'openai-responses' ? 'max_output_tokens' : role.profile.maxTokensField;
      if (!Number.isInteger(payload[tokenField]) || payload[tokenField] < 1 || payload[tokenField] > role.profile.maxTokens || ['max_tokens', 'max_completion_tokens', 'max_output_tokens'].some(field => field !== tokenField && payload[field] !== undefined)) { json(res, 400, '输出额度超出配置。'); return true; }
      const endpoint = role.profile.api === 'openai-responses' ? 'responses' : 'chat/completions';
      dispatched = true;
      const upstream = await transport(`${role.profile.baseURL}/${endpoint}`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${role.key}` }, body, signal: controller.signal, redirect: 'error', credentials: 'omit', cache: 'no-store' });
      upstreamHeadersMs = Math.round(performance.now() - started);
      upstreamStatus = upstream.status;
      if (!upstream.ok || !upstream.body) { reason = upstream.ok ? 'upstream_empty' : 'upstream_http'; await upstream.body?.cancel(); json(res, upstream.ok ? 502 : upstream.status, '模型服务请求失败。'); return true; }
      const streaming = upstream.headers.get('content-type')?.startsWith('text/event-stream');
      res.setHeader('Content-Type', streaming ? 'text/event-stream' : 'application/json');
      const source = Readable.fromWeb(upstream.body);
      source.on('error', () => { if (reason === 'completed') reason = 'upstream_network'; });
      // SSE includes repeated frame metadata and hidden reasoning; it is larger than final JSON.
      const responseLimit = streaming ? MAX_MODEL_STREAM_BYTES : MAX_MODEL_JSON_BYTES;
      const bound = new Transform({ transform(chunk, _encoding, callback) { if (chunk.length) firstByteMs ??= Math.round(performance.now() - started); received += chunk.length; if (received > responseLimit) { reason = 'response_limit'; callback(new Error('MODEL_RESPONSE_TOO_LARGE')); } else callback(null, chunk); } });
      await pipeline(source, bound, res);
    } catch (error) {
      if (reason === 'completed') reason = 'upstream_network';
      const code = error?.cause?.code ?? error?.code;
      if (['UND_ERR_SOCKET', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_BODY_TIMEOUT', 'ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'EAI_AGAIN', 'ENOTFOUND'].includes(code)) transportCode = code;
      if (!res.headersSent && !res.destroyed) json(res, 502, '模型服务暂不可用。'); else res.destroy();
    }
    finally {
      controller.abort(); clearTimeout(timer); req.off('aborted', abort); res.off('close', abort); active--;
      if (dispatched) observe({ type: 'web.model', timestamp: new Date().toISOString(), role: match[1], status: reason === 'completed' ? 'completed' : ['client_disconnect', 'timeout'].includes(reason) ? 'cancelled' : 'failed', reason, ...(upstreamStatus === undefined ? {} : { upstreamStatus }), ...(upstreamHeadersMs === undefined ? {} : { upstreamHeadersMs }), ...(firstByteMs === undefined ? {} : { firstByteMs }), receivedBytes: received, elapsedMs: Math.round(performance.now() - started), ...(transportCode ? { transportCode } : {}) });
    }
    return true;
  };
}
