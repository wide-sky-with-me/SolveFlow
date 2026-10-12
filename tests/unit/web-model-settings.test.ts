import { expect, it } from 'vitest';
import { mkdtemp, readFile, rm, stat, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadWebEnv } from '../../scripts/web-env.mjs';
import { openWebModelSettings } from '../../scripts/web-model-settings.mjs';
import { webServer } from '../../scripts/web-server.mjs';
import { WebEnvironmentSchema, type WebModelUpdate } from '../../packages/contracts/src/local.js';
const config = { WEB_ENV_ENABLED: 'true', SOLVEFLOW_LLM_BASE_URL: 'https://fixture.invalid/v1', SOLVEFLOW_LLM_API_KEY: 'synthetic-provider-secret', SOLVEFLOW_SOLVER_MODEL: 'primary' };
async function fixture(transport: typeof fetch = async () => Response.json({ ok: true })) {
  const directory = await mkdtemp(join(tmpdir(), 'solveflow-editor-'));
  const environment = await loadWebEnv(join(directory, '.env'), config); if (!environment) throw new Error('ENV');
  const file = join(directory, 'private', 'models.json');
  const manager = await openWebModelSettings(environment, file); if (!manager) throw new Error('MANAGER');
  const server = webServer(directory, null, environment, transport, undefined, manager);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('PORT');
  const base = `http://127.0.0.1:${address.port}`;
  const update = (): WebModelUpdate => ({ schemaVersion: 1, models: { solver: environment.roles.solver.profile, verifier: null, backup: null }, keys: { solver: null, verifier: null, backup: null } });
  const save = (value: unknown, token = environment.roles.solver.token, origin = base) => fetch(base + '/__solveflow/web-env/settings', { method: 'PUT', headers: { authorization: `Bearer ${token}`, origin }, body: JSON.stringify(value) });
  const preset = (path: string, method: string, value?: unknown, token = environment.roles.solver.token, origin = base) => fetch(base + '/__solveflow/web-env/presets' + path, { method, headers: { authorization: `Bearer ${token}`, origin }, ...(value === undefined ? {} : { body: JSON.stringify(value) }) });
  return { directory, environment, file, manager, base, update, save, preset, async close() { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); await rm(directory, { recursive: true, force: true }); } };
}
it('persists editable profiles privately, rotates tokens and restores after restart without changing .env', async () => {
  const f = await fixture();
  try {
    await writeFile(join(f.directory, '.env'), 'preserved');
    const token = f.environment.roles.solver.token; const value = f.update(); value.models.solver = { ...value.models.solver, model: 'edited', streaming: false };
    const response = await f.save(value); expect(response.status).toBe(200);
    const text = await response.text(); expect(text).not.toContain('synthetic-provider-secret');
    expect(WebEnvironmentSchema.parse(JSON.parse(text)).canEditModels).toBe(true);
    expect(f.environment.roles.solver.token).not.toBe(token); expect(f.environment.roles.solver.key).toBe(config.SOLVEFLOW_LLM_API_KEY);
    expect((await stat(f.file)).mode & 0o777).toBe(0o600); expect(await readFile(join(f.directory, '.env'), 'utf8')).toBe('preserved');
    const restored = await loadWebEnv(join(f.directory, 'missing'), config); if (!restored) throw new Error('ENV');
    await openWebModelSettings(restored, f.file); expect(restored.roles.solver.profile.model).toBe('edited'); expect(restored.roles.solver.key).toBe(config.SOLVEFLOW_LLM_API_KEY);
    expect((await f.save(value, token)).status).toBe(401);
  } finally { await f.close(); }
});
it('requires explicit new credentials for another destination and rejects unauthenticated, foreign and oversized edits', async () => {
  const f = await fixture();
  try {
    const original = f.environment.roles.solver.token; const value = f.update(); value.models.solver = { ...value.models.solver, baseURL: 'https://new-fixture.invalid/v1' };
    expect((await f.save(value)).status).toBe(400); expect(f.environment.roles.solver.token).toBe(original);
    expect((await f.save(value, 'wrong')).status).toBe(401); expect((await f.save(value, original, 'https://foreign.invalid')).status).toBe(403);
    expect((await f.save({ ...value, padding: 'x'.repeat(40000) })).status).toBe(413);
    value.keys.solver = 'synthetic-new-secret'; expect((await f.save(value)).status).toBe(200); expect(f.environment.roles.solver.key).toBe('synthetic-new-secret');
    expect(f.environment.roles.solver.profile.baseURL).toBe('https://new-fixture.invalid/v1');
  } finally { await f.close(); }
});
it('tests drafts with destination-bound credentials without saving them', async () => {
  const calls: { url: string; key: string | null }[] = [];
  const f = await fixture(async (url, init) => { calls.push({ url: String(url), key: new Headers(init?.headers).get('authorization') }); return Response.json({ ok: true }); });
  try {
    const profile = { ...f.environment.roles.solver.profile, model: 'draft' }; const token = f.environment.roles.solver.token;
    const test = (key: string | null, baseURL = profile.baseURL) => fetch(f.base + '/__solveflow/web-env/test/backup', { method: 'POST', headers: { authorization: `Bearer ${token}` }, body: JSON.stringify({ schemaVersion: 1, profile: { ...profile, baseURL }, key, request: { model: 'draft', max_tokens: 8 } }) });
    expect((await test(null)).status).toBe(200); expect((await test(null, 'https://another.invalid/v1')).status).toBe(400);
    expect((await test('synthetic-draft-secret', 'https://another.invalid/v1')).status).toBe(200);
    expect(calls).toEqual([{ url: 'https://fixture.invalid/v1/chat/completions', key: 'Bearer synthetic-provider-secret' }, { url: 'https://another.invalid/v1/chat/completions', key: 'Bearer synthetic-draft-secret' }]);
    expect(f.environment.roles.solver.profile.model).toBe('primary'); expect(f.environment.roles.backup).toBeNull(); await expect(stat(f.file)).rejects.toMatchObject({ code: 'ENOENT' });
  } finally { await f.close(); }
});
it('blocks saves while a request is active and blocks dispatch while an atomic save is pending', async () => {
  let stream: ReadableStreamDefaultController<Uint8Array> | undefined;
  const f = await fixture(async () => new Response(new ReadableStream<Uint8Array>({ start(controller) { stream = controller; controller.enqueue(new TextEncoder().encode('data: fixture\n\n')); } }), { headers: { 'content-type': 'text/event-stream' } }));
  try {
    const post = () => fetch(f.base + '/__solveflow/web-env/model/solver', { method: 'POST', headers: { authorization: `Bearer ${f.environment.roles.solver.token}` }, body: JSON.stringify({ model: 'primary', max_tokens: 8 }) });
    const response = await post(); expect((await f.save(f.update())).status).toBe(409);
    expect((await f.preset('', 'POST', { name: 'blocked', configuration: f.update() })).status).toBe(409);
    expect((await f.preset('/00000000-0000-4000-8000-000000000000/activate', 'POST')).status).toBe(409);
    expect((await f.preset('/00000000-0000-4000-8000-000000000000', 'DELETE')).status).toBe(409);
    stream?.close(); await response.text();
    const original = f.manager.save; let release = () => {}; let entered = false;
    const gate = new Promise<void>(resolve => { release = resolve; });
    f.manager.save = async value => { entered = true; await gate; return original(value); };
    const pending = f.save(f.update());
    try { await expect.poll(() => entered).toBe(true); expect((await post()).status).toBe(409); expect((await f.save(f.update())).status).toBe(409); }
    finally { release(); await pending; }
  } finally { await f.close(); }
});
it('keeps live settings on persistence failure and preserves unreadable sidecars for recovery', async () => {
  const f = await fixture();
  try {
    await mkdir(f.file, { recursive: true }); const token = f.environment.roles.solver.token; const value = f.update(); value.models.solver = { ...value.models.solver, model: 'not-saved' };
    expect((await f.save(value)).status).toBe(500); expect(f.environment.roles.solver.token).toBe(token); expect(f.environment.roles.solver.profile.model).toBe('primary');
    await rm(f.file, { recursive: true }); await writeFile(f.file, '{broken');
    await expect(openWebModelSettings(f.environment, f.file)).rejects.toThrow('配置无法读取'); expect(await readFile(f.file, 'utf8')).toBe('{broken');
  } finally { await f.close(); }
});
it('saves three-role presets without activating, restores secrets privately and binds loaded drafts to their source', async () => {
  const calls: string[] = [];
  const f = await fixture(async (_url, init) => { calls.push(new Headers(init?.headers).get('authorization') ?? ''); return Response.json({ ok: true }); });
  try {
    const token = f.environment.roles.solver.token;
    const alternate = { ...f.update().models.solver, baseURL: 'https://alternate.invalid/v1', model: 'alternate' };
    const configuration: WebModelUpdate = { schemaVersion: 1, models: { solver: alternate, verifier: alternate, backup: f.update().models.solver }, keys: { solver: 'synthetic-alternate', verifier: 'synthetic-review', backup: null } };
    const created = await f.preset('', 'POST', { name: ' Alternate ', configuration }); expect(created.status).toBe(200);
    const text = await created.text(); expect(text).not.toContain('synthetic-alternate'); expect(text).not.toContain('synthetic-provider-secret');
    const publicValue = WebEnvironmentSchema.parse(JSON.parse(text)); const entry = publicValue.presets?.[0]; if (!entry) throw new Error('PRESET');
    expect(entry.name).toBe('Alternate'); expect(f.environment.roles.solver.token).toBe(token); expect(f.environment.roles.solver.profile.model).toBe('primary');
    await expect(stat(f.file)).rejects.toMatchObject({ code: 'ENOENT' }); expect((await stat(f.file + '.presets')).mode & 0o777).toBe(0o600);
    const restored = await loadWebEnv(join(f.directory, 'missing'), config); if (!restored) throw new Error('ENV');
    await openWebModelSettings(restored, f.file); expect(restored.bootstrap.presets?.[0]?.id).toBe(entry.id); expect(restored.roles.solver.profile.model).toBe('primary');
    const testDraft = (baseURL = alternate.baseURL) => fetch(f.base + '/__solveflow/web-env/test/verifier', { method: 'POST', headers: { authorization: `Bearer ${token}` }, body: JSON.stringify({ schemaVersion: 1, profile: { ...alternate, baseURL }, key: null, presetId: entry.id, request: { model: 'alternate', max_tokens: 8 } }) });
    expect((await testDraft()).status).toBe(200); expect((await testDraft('https://foreign.invalid/v1')).status).toBe(400); expect(calls).toEqual(['Bearer synthetic-review']);
    const draft: WebModelUpdate = { ...configuration, presetId: entry.id, keys: { solver: null, verifier: null, backup: null }, models: { ...configuration.models, solver: { ...alternate, model: 'edited-draft' } } };
    expect((await f.save({ ...draft, models: { ...draft.models, solver: { ...alternate, baseURL: 'https://foreign.invalid/v1' } } })).status).toBe(400);
    expect((await f.save(draft)).status).toBe(200); expect(f.environment.roles.solver.key).toBe('synthetic-alternate'); expect(f.environment.roles.verifier?.key).toBe('synthetic-review'); expect(f.environment.roles.backup?.key).toBe('synthetic-provider-secret');
    expect(JSON.parse(await readFile(f.file, 'utf8'))).not.toHaveProperty('presetId');
    const activeToken = f.environment.roles.solver.token;
    expect((await f.preset(`/${entry.id}/activate`, 'POST')).status).toBe(200); expect(f.environment.roles.solver.profile.model).toBe('alternate'); expect(f.environment.roles.solver.token).not.toBe(activeToken);
    expect((await f.preset(`/${entry.id}`, 'DELETE')).status).toBe(200); expect(f.environment.roles.solver.profile.model).toBe('alternate');
    await expect(f.manager.save(draft)).rejects.toThrow('预设不存在');
    await openWebModelSettings(restored, f.file); expect(restored.roles.solver.profile.model).toBe('alternate'); expect(restored.bootstrap.presets).toEqual([]);
  } finally { await f.close(); }
});
it('bounds preset names, count, authorization and preserves active configuration on failed writes or corrupt presets', async () => {
  const f = await fixture();
  try {
    const input = { name: 'Preset', configuration: f.update() }; const token = f.environment.roles.solver.token;
    expect((await f.preset('', 'POST', input, 'wrong')).status).toBe(401); expect((await f.preset('', 'POST', input, token, 'https://foreign.invalid')).status).toBe(403);
    expect((await f.preset('', 'POST', { ...input, name: ' ' })).status).toBe(400);
    expect((await f.preset('', 'POST', { ...input, name: 'x'.repeat(41) })).status).toBe(400);
    expect((await f.preset('', 'POST', { ...input, padding: 'x'.repeat(40000) })).status).toBe(413);
    await mkdir(f.file + '.presets', { recursive: true }); expect((await f.preset('', 'POST', input)).status).toBe(500); expect(f.environment.bootstrap.presets).toEqual([]);
    await rm(f.file + '.presets', { recursive: true });
    expect((await f.preset('', 'POST', input)).status).toBe(200); expect((await f.preset('', 'POST', input)).status).toBe(400);
    for (let i = 1; i < 8; i++) expect((await f.preset('', 'POST', { ...input, name: `Preset ${i}` })).status).toBe(200);
    expect((await f.preset('', 'POST', { ...input, name: 'Too many' })).status).toBe(400); expect(f.environment.bootstrap.presets).toHaveLength(8); expect(f.environment.roles.solver.token).toBe(token);
    expect((await f.preset('/00000000-0000-4000-8000-000000000000/activate', 'POST')).status).toBe(400);
    await writeFile(f.file + '.presets', '{broken');
    await expect(openWebModelSettings(f.environment, f.file)).rejects.toThrow('配置预设无法读取'); expect(await readFile(f.file + '.presets', 'utf8')).toBe('{broken');
  } finally { await f.close(); }
});
