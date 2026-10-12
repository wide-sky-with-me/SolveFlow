// Decision: .agents/notes/implemented/architecture/2026-10-09-batch-dispatch-and-verification.md
// Decision: .agents/notes/implemented/agent/2026-10-08-exam-flow-evidence-and-budgets.md
// Decision: .agents/notes/implemented/architecture/2026-10-09-batch-learning-admission.md
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { MAX_DEVICE_PHASE_DURATION_MS, MAX_MODEL_STREAM_BYTES, MAX_MODEL_JSON_BYTES } from '../packages/contracts/dist/agent.js';
import { MAX_LOCAL_MODEL_RUNS } from '../packages/contracts/dist/local.js';
import { WebModelUpdateSchema, WebModelTestSchema, WebModelPresetCreateSchema } from '../packages/contracts/dist/local.js';
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
async function readBody(req, limit) {
  const chunks = []; let size = 0;
  for await (const chunk of req.iterator({ destroyOnReturn: false })) {
    size += chunk.length;
    if (size > limit) { req.resume(); throw new Error('REQUEST_TOO_LARGE'); }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}
export function webModelProxy(environment, transport = fetch, observe = () => {}, modelSettings = null) {
  let active = 0; let changing = false;
  return async (req, res) => {
    if (!req.url?.startsWith('/__solveflow/web-env')) return false;
    res.setHeader('Cache-Control', 'no-store');
    if (!environment) { json(res, 404, '本地环境模式未启用。'); return true; }
    if (!localRequest(req)) { json(res, 403, '仅允许本地同源请求。'); return true; }
    if (req.url === '/__solveflow/web-env' && req.method === 'GET') { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(environment.bootstrap)); return true; }
    const presetAction = /^\/__solveflow\/web-env\/presets\/([0-9a-f-]{36})(\/activate)?$/.exec(req.url);
    const createPreset = req.url === '/__solveflow/web-env/presets' && req.method === 'POST';
    const activatePreset = presetAction?.[2] && req.method === 'POST';
    const removePreset = presetAction && !presetAction[2] && req.method === 'DELETE';
    if (req.url === '/__solveflow/web-env/settings' && req.method === 'PUT' || createPreset || activatePreset || removePreset) {
      if (!modelSettings) { json(res, 405, '当前服务不支持编辑模型，请更新服务。'); return true; }
      if (req.headers.authorization !== `Bearer ${environment.roles.solver.token}`) { json(res, 401, '配置已变更，请刷新后重新保存。'); return true; }
      if (active || changing) { json(res, 409, '请等待当前模型请求结束，再保存配置。'); return true; }
      changing = true;
      try {
        const result = activatePreset ? await modelSettings.activatePreset(presetAction[1]) : removePreset ? await modelSettings.removePreset(presetAction[1]) : createPreset
          ? await modelSettings.createPreset(WebModelPresetCreateSchema.parse(JSON.parse((await readBody(req, 32768)).toString('utf8'))))
          : await modelSettings.save(WebModelUpdateSchema.parse(JSON.parse((await readBody(req, 32768)).toString('utf8'))));
        res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(result));
      } catch (error) {
        const missingKey = error.message === '请为新增或更换服务的模型填写 API Key。';
        const presetError = ['配置预设不存在，请刷新设置。', '配置预设已满，请先移除不用的预设。', '预设名称已存在，请使用其他名称。', '本机配置存储容量不足，请精简配置。'].includes(error.message);
        const invalid = error.name === 'ZodError' || error instanceof SyntaxError || missingKey || presetError;
        json(res, error.message === 'REQUEST_TOO_LARGE' ? 413 : invalid ? 400 : 500, missingKey || presetError ? error.message : invalid ? '模型配置无效，请检查字段。' : '保存模型配置失败，原配置已保留。');
      } finally { changing = false; }
      return true;
    }
    const match = /^\/__solveflow\/web-env\/(model|test)\/(solver|verifier|backup)$/.exec(req.url);
    if (!match || req.method !== 'POST') { json(res, 405, '请求不支持。'); return true; }
    const testing = match[1] === 'test'; const roleName = match[2];
    let role = environment.roles[roleName];
    if (testing && !modelSettings) { json(res, 405, '当前服务不支持测试未保存的配置。'); return true; }
    const token = testing ? environment.roles.solver.token : role?.token;
    if (!token || req.headers.authorization !== `Bearer ${token}`) { res.setHeader('X-SolveFlow-Model-Dispatch', 'not-started'); json(res, 401, '本地模型凭据无效，请刷新。'); return true; }
    if (changing) { json(res, 409, '正在保存模型配置，请稍后重试。'); return true; }
    if (active >= MAX_LOCAL_MODEL_RUNS) { json(res, 429, '本地模型请求繁忙。'); return true; }
    active++;
    const started = performance.now(); let received = 0; let dispatched = false; let upstreamStatus; let upstreamHeadersMs; let firstByteMs; let reason = 'completed'; let transportCode;
    const controller = new AbortController(); const abort = () => { if (!res.writableFinished && reason === 'completed') reason = 'client_disconnect'; controller.abort(); if (!req.complete) req.destroy(); };
    const timer = setTimeout(() => { reason = 'timeout'; abort(); }, MAX_DEVICE_PHASE_DURATION_MS); req.on('aborted', abort); res.on('close', abort);
    try {
      let body = await readBody(req, testing ? 65536 : 16 * 1024 * 1024); let payload;
      try { payload = JSON.parse(body.toString('utf8')); } catch { json(res, 400, '模型请求格式无效。'); return true; }
      if (testing) {
        try { const draft = WebModelTestSchema.parse(payload); role = modelSettings.resolveRole(roleName, draft.profile, draft.key, draft.presetId); payload = draft.request; body = Buffer.from(JSON.stringify(payload)); }
        catch { json(res, 400, '测试配置无效；更换服务时请填写新 API Key。'); return true; }
      }
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
      if (error?.message === 'REQUEST_TOO_LARGE') { json(res, 413, '请求超过大小限制。'); return true; }
      if (reason === 'completed') reason = 'upstream_network';
      const code = error?.cause?.code ?? error?.code;
      if (['UND_ERR_SOCKET', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_BODY_TIMEOUT', 'ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'EAI_AGAIN', 'ENOTFOUND'].includes(code)) transportCode = code;
      if (!res.headersSent && !res.destroyed) json(res, 502, '模型服务暂不可用。'); else res.destroy();
    }
    finally {
      controller.abort(); clearTimeout(timer); req.off('aborted', abort); res.off('close', abort); active--;
      if (dispatched) observe({ type: 'web.model', timestamp: new Date().toISOString(), role: roleName, status: reason === 'completed' ? 'completed' : ['client_disconnect', 'timeout'].includes(reason) ? 'cancelled' : 'failed', reason, ...(upstreamStatus === undefined ? {} : { upstreamStatus }), ...(upstreamHeadersMs === undefined ? {} : { upstreamHeadersMs }), ...(firstByteMs === undefined ? {} : { firstByteMs }), receivedBytes: received, elapsedMs: Math.round(performance.now() - started), ...(transportCode ? { transportCode } : {}) });
    }
    return true;
  };
}
