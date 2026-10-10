import type { Server } from 'node:http';
import { request as httpRequest } from 'node:http';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { expect, it } from 'vitest';
import { loadWebEnv } from '../../scripts/web-env.mjs';
import { webServer } from '../../scripts/web-server.mjs';
const config = { WEB_ENV_ENABLED: 'true', SOLVEFLOW_LLM_BASE_URL: 'https://fixture.invalid/v1', SOLVEFLOW_LLM_API_KEY: 'synthetic-provider-secret', SOLVEFLOW_SOLVER_MODEL: 'primary' };
it('admits eight solver streams together and reports header and first-byte timing safely', async () => {
  const environment = await loadWebEnv('/tmp/nonexistent-solveflow-env', config); if (!environment) throw new Error('ENV');
  let calls = 0; const streams: ReadableStreamDefaultController<Uint8Array>[] = [];
  const entries: import('../../scripts/web-server.mjs').WebModelDiagnostic[] = [];
  const transport: typeof fetch = async () => { calls++; return new Response(new ReadableStream<Uint8Array>({ start(controller) { streams.push(controller); controller.enqueue(new TextEncoder().encode('data: private-canary\n\n')); } }), { headers: { 'content-type': 'text/event-stream' } }); };
  const server = webServer('/tmp', null, environment, transport, entry => entries.push(entry)); const base = await listen(server);
  const responses: Response[] = [];
  try {
    for (let i = 0; i < 8; i++) responses.push(await fetch(base + '/__solveflow/web-env/model/solver', { method: 'POST', headers: { authorization: `Bearer ${environment.roles.solver.token}` }, body: JSON.stringify({ model: 'primary', max_tokens: 4096 }) }));
    expect(responses.map(response => response.status)).toEqual(Array(8).fill(200)); expect(calls).toBe(8);
    streams.forEach(stream => stream.close()); await Promise.all(responses.map(response => response.text()));
    await expect.poll(() => entries.length).toBe(8);
    for (const entry of entries) expect(entry).toMatchObject({ upstreamHeadersMs: expect.any(Number), firstByteMs: expect.any(Number) });
    expect(JSON.stringify(entries)).not.toContain('canary');
  } finally { await Promise.allSettled(responses.map(response => response.body?.cancel())); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
});
async function listen(server: Server) { await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve)); const address = server.address(); if (!address || typeof address === 'string') throw new Error('PORT'); return `http://127.0.0.1:${address.port}`; }
it('marks only local authorization rejection and never forwards a provider-forged replay marker', async () => {
  const environment = await loadWebEnv('/tmp/nonexistent-solveflow-env', config); if (!environment) throw new Error('ENV');
  let calls = 0;
  const transport: typeof fetch = async () => { calls++; return new Response('private-provider-canary', { status: 401, headers: { 'x-solveflow-model-dispatch': 'not-started' } }); };
  const server = webServer('/tmp', null, environment, transport); const base = await listen(server);
  const request = (token: string) => fetch(base + '/__solveflow/web-env/model/solver', { method: 'POST', headers: { authorization: `Bearer ${token}` }, body: JSON.stringify({ model: 'primary', max_tokens: 4096 }) });
  try {
    const local = await request('expired'); expect(local.status).toBe(401); expect(local.headers.get('x-solveflow-model-dispatch')).toBe('not-started'); expect(calls).toBe(0); await local.text();
    const provider = await request(environment.roles.solver.token); expect(provider.status).toBe(401); expect(provider.headers.get('x-solveflow-model-dispatch')).toBeNull(); expect(calls).toBe(1); expect(await provider.text()).not.toContain('canary');
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
});
it('exposes only local role tokens, rejects foreign origins and forwards only the pinned model with real server credentials', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'solveflow-proxy-')); await writeFile(join(directory, 'index.html'), 'fixture');
  const environment = await loadWebEnv('/tmp/nonexistent-solveflow-env', config); if (!environment) throw new Error('ENV'); const calls: { url: string; key: string | null }[] = [];
  const transport: typeof fetch = async (url, init) => { calls.push({ url: String(url), key: new Headers(init?.headers).get('authorization') }); return new Response('data: [DONE]\n\n', { headers: { 'content-type': 'text/event-stream' } }); };
  const server = webServer(directory, null, environment, transport); const base = await listen(server);
  try {
    const bootstrap = await fetch(base + '/__solveflow/web-env'); expect(bootstrap.headers.get('cache-control')).toBe('no-store'); expect(await bootstrap.text()).not.toContain('synthetic-provider-secret');
    expect((await fetch(base + '/__solveflow/web-env', { headers: { origin: 'https://foreign.invalid' } })).status).toBe(403);
    const rebound = await new Promise<number>(resolve => { const request = httpRequest(base + '/__solveflow/web-env', { headers: { host: 'attacker.invalid' } }, response => { response.resume(); resolve(response.statusCode ?? 0); }); request.end(); });
    expect(rebound).toBe(403);
    const request = (payload: unknown, token = environment.roles.solver.token) => fetch(base + '/__solveflow/web-env/model/solver', { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}`, origin: base }, body: JSON.stringify(payload) });
    expect((await request({ model: 'other', max_tokens: 4096 })).status).toBe(400);
    expect((await request({ model: 'primary', max_tokens: 1000000 })).status).toBe(400);
    expect((await request({ model: 'primary', max_tokens: 4096, max_completion_tokens: 1000000 })).status).toBe(400);
    expect((await request({ model: 'primary', max_tokens: 4096, tools: [{ type: 'web_search' }] })).status).toBe(400);
    expect((await request({ model: 'primary', max_tokens: 4096 }, 'wrong')).status).toBe(401); expect(calls).toHaveLength(0);
    const answer = await request({ model: 'primary', max_tokens: 4096 }); expect(await answer.text()).toBe('data: [DONE]\n\n');
    expect(calls).toEqual([{ url: 'https://fixture.invalid/v1/chat/completions', key: 'Bearer synthetic-provider-secret' }]);
    expect((await fetch(base + '/.env')).status).toBe(404);
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); await rm(directory, { recursive: true, force: true }); }
});

it('cancels upstream streaming when the browser disconnects and sanitizes provider errors', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'solveflow-proxy-cancel-')); await writeFile(join(directory, 'index.html'), 'fixture');
  const environment = await loadWebEnv('/tmp/nonexistent-solveflow-env', config); if (!environment) throw new Error('ENV'); let signal: AbortSignal | null = null; let calls = 0;
  const transport: typeof fetch = async (_url, init) => { signal = init?.signal ?? null; calls++; return calls === 1 ? new Response('synthetic-provider-secret', { status: 400 }) : new Response(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode('data: first\n\n')); } }), { headers: { 'content-type': 'text/event-stream' } }); };
  const server = webServer(directory, null, environment, transport); const base = await listen(server);
  try { const request = () => fetch(base + '/__solveflow/web-env/model/solver', { method: 'POST', headers: { authorization: `Bearer ${environment.roles.solver.token}` }, body: JSON.stringify({ model: 'primary', max_tokens: 4096 }) });
    const failed = await request(); expect(failed.status).toBe(400); expect(await failed.text()).not.toContain('synthetic-provider-secret');
    const response = await request(); await response.body?.cancel(); await expect.poll(() => signal?.aborted).toBe(true);
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); await rm(directory, { recursive: true, force: true }); }
});

it('records bounded failure metadata for upstream stream loss and response size limits without logging provider content', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'solveflow-proxy-diagnostics-')); await writeFile(join(directory, 'index.html'), 'fixture');
  const environment = await loadWebEnv('/tmp/nonexistent-solveflow-env', config); if (!environment) throw new Error('ENV');
  const entries: import('../../scripts/web-server.mjs').WebModelDiagnostic[] = []; let calls = 0;
  const transport: typeof fetch = async () => {
    calls++;
    if (calls === 1) return new Response(new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new TextEncoder().encode('data: private-provider-canary\n\n')); setTimeout(() => controller.error(Object.assign(new Error('private-error-canary'), { code: 'UND_ERR_SOCKET' })), 10); } }), { headers: { 'content-type': 'text/event-stream' } });
    return new Response(new Uint8Array(1024 * 1024 + 1));
  };
  const server = webServer(directory, null, environment, transport, entry => entries.push(entry)); const base = await listen(server);
  const request = () => fetch(base + '/__solveflow/web-env/model/solver', { method: 'POST', headers: { authorization: `Bearer ${environment.roles.solver.token}` }, body: JSON.stringify({ model: 'primary', max_tokens: 4096 }) });
  try {
    for (let i = 0; i < 2; i++) { const result = await request().then(async response => response.text()).catch(() => null); expect(result).toBeNull(); }
    await expect.poll(() => entries.length).toBe(2);
    expect(entries[0]).toMatchObject({ role: 'solver', status: 'failed', reason: 'upstream_network', upstreamStatus: 200, transportCode: 'UND_ERR_SOCKET' });
    expect(entries[1]).toMatchObject({ role: 'solver', status: 'failed', reason: 'response_limit', receivedBytes: 1024 * 1024 + 1 });
    expect(JSON.stringify(entries)).not.toContain('canary'); expect(JSON.stringify(entries)).not.toContain('synthetic-provider-secret');
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); await rm(directory, { recursive: true, force: true }); }
});

it('streams reasoning SSE beyond 1 MiB while still rejecting streams above 8 MiB and cancelling upstream', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'solveflow-proxy-stream-')); await writeFile(join(directory, 'index.html'), 'fixture');
  const environment = await loadWebEnv('/tmp/nonexistent-solveflow-env', config); if (!environment) throw new Error('ENV');
  const entries: import('../../scripts/web-server.mjs').WebModelDiagnostic[] = []; const signals: AbortSignal[] = []; let calls = 0;
  const transport: typeof fetch = async (_url, init) => {
    if (!init?.signal) throw new Error('SIGNAL'); signals.push(init.signal);
    return new Response(new Uint8Array(++calls === 1 ? 2 * 1024 * 1024 : 8 * 1024 * 1024 + 1), { headers: { 'content-type': 'text/event-stream' } });
  };
  const server = webServer(directory, null, environment, transport, entry => entries.push(entry)); const base = await listen(server);
  const request = () => fetch(base + '/__solveflow/web-env/model/solver', { method: 'POST', headers: { authorization: `Bearer ${environment.roles.solver.token}` }, body: JSON.stringify({ model: 'primary', max_tokens: 4096 }) });
  try {
    expect((await (await request()).arrayBuffer()).byteLength).toBe(2 * 1024 * 1024);
    expect(await request().then(response => response.arrayBuffer()).catch(() => null)).toBeNull();
    await expect.poll(() => entries.length).toBe(2);
    expect(entries[0]).toMatchObject({ status: 'completed', receivedBytes: 2 * 1024 * 1024 });
    expect(entries[1]).toMatchObject({ status: 'failed', reason: 'response_limit', receivedBytes: 8 * 1024 * 1024 + 1 });
    expect(signals.every(signal => signal.aborted)).toBe(true);
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); await rm(directory, { recursive: true, force: true }); }
});
