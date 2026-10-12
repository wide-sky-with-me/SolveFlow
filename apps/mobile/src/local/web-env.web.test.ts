import { afterEach, expect, it, vi } from 'vitest';
import { WebEnvironmentSchema } from '@solveflow/contracts/local';
import type { LocalFetch } from '@solveflow/agent/mobile';
import { webModelFetch, saveWebModelSettings, webModelTestFetch, mutateWebModelPresets } from './web-env.web.js';
const profile = { provider: 'fixture', baseURL: 'https://fixture.invalid/v1', model: 'fixture', api: 'openai-completions', contextWindow: 32768, maxTokens: 8192, maxTokensField: 'max_tokens' };
const environment = WebEnvironmentSchema.parse({ schemaVersion: 1, settings: { schemaVersion: 1, solver: profile, verifier: profile, backup: profile }, accessTokens: { solver: 'old-solver', verifier: 'old-verifier', backup: 'old-backup' } });
const fresh = { ...environment, accessTokens: { solver: 'new-solver', verifier: 'new-verifier', backup: 'new-backup' } };
const rejected = () => new Response('{}', { status: 401, headers: { 'x-solveflow-model-dispatch': 'not-started' } });
const request = (role: 'solver' | 'verifier' | 'backup', signal?: AbortSignal) => ({ method: 'POST', headers: { authorization: `Bearer ${environment.accessTokens[role]}` }, body: '{}', signal: signal ?? null });
afterEach(() => vi.useRealTimers());
it('saves profiles through the local endpoint and leaves the environment unchanged until acknowledged', async () => {
  const current = { ...environment, canEditModels: true };
  const update = { schemaVersion: 1 as const, models: { solver: { ...current.settings.solver, model: 'edited' }, verifier: null, backup: null }, keys: { solver: 'synthetic-new-key', verifier: null, backup: null } };
  const transport: LocalFetch = async (url, init) => { expect(url).toBe('/__solveflow/web-env/settings'); expect(init?.method).toBe('PUT'); expect(new Headers(init?.headers).get('authorization')).toBe('Bearer old-solver'); expect(JSON.parse(String(init?.body))).toEqual(update); return Response.json({ ...fresh, canEditModels: true, settings: { schemaVersion: 1, ...update.models }, accessTokens: { solver: 'new-solver', verifier: null, backup: null } }); };
  const next = await saveWebModelSettings(current, update, transport); expect(next.settings.solver.model).toBe('edited'); expect(current.settings.solver.model).toBe('fixture');
  const failing: LocalFetch = async () => new Response('{}', { status: 409 });
  await expect(saveWebModelSettings(current, update, failing)).rejects.toThrow('等待当前模型请求'); expect(current.accessTokens.solver).toBe('old-solver');
});
it('routes unsaved connection tests locally, preserves cancellation and never sends the draft key directly upstream', async () => {
  const current = { ...environment, canEditModels: true }; const controller = new AbortController();
  const draft = { ...current.settings.solver, baseURL: 'https://other.invalid/v1', model: 'draft' };
  const transport: LocalFetch = async (url, init) => { expect(url).toBe('/__solveflow/web-env/test/backup'); expect(init?.signal).toBe(controller.signal); expect(new Headers(init?.headers).get('authorization')).toBe('Bearer old-solver'); expect(JSON.parse(String(init?.body))).toEqual({ schemaVersion: 1, profile: draft, key: 'synthetic-draft', request: { model: 'draft' } }); return Response.json({}); };
  await webModelTestFetch(current, 'backup', draft, 'synthetic-draft', transport)(draft.baseURL + '/chat/completions', { method: 'POST', body: JSON.stringify({ model: 'draft' }), signal: controller.signal });
});
it('uses newly saved role tokens immediately without renewal or request replay', async () => {
  const current = { ...environment, accessTokens: { ...environment.accessTokens } }; let calls = 0;
  const transport: LocalFetch = async (_url, init) => { calls++; expect(new Headers(init?.headers).get('authorization')).toBe('Bearer new-solver'); return Response.json({}); };
  const fetch = webModelFetch(current, transport); Object.assign(current, fresh);
  await fetch(profile.baseURL + '/chat/completions', { method: 'POST', headers: { authorization: 'Bearer new-solver' }, body: '{}' }); expect(calls).toBe(1);
});
it.each(['solver', 'verifier', 'backup'] as const)('renews a rotated %s token only after a local unpaid rejection', async role => {
  const calls: string[] = []; let posts = 0;
  const transport: LocalFetch = async (url, init) => {
    calls.push(String(url)); if (url === '/__solveflow/web-env') return Response.json(fresh);
    if (++posts === 1) return rejected();
    expect(new Headers(init?.headers).get('authorization')).toBe(`Bearer ${fresh.accessTokens[role]}`);
    return new Response('{}', { status: 401 });
  };
  const result = await webModelFetch(environment, transport)(`${profile.baseURL}/chat/completions`, request(role));
  expect(result.status).toBe(401);
  expect(calls).toEqual([`/__solveflow/web-env/model/${role}`, '/__solveflow/web-env', `/__solveflow/web-env/model/${role}`]);
  expect(environment.accessTokens[role]).toBe(`old-${role}`);
});
it.each(['solver', 'verifier', 'backup'] as const)('rejects changed %s configuration before any upstream retry', async role => {
  const calls: string[] = [];
  const transport: LocalFetch = async url => {
    calls.push(String(url)); if (url !== '/__solveflow/web-env') return rejected();
    return Response.json({ ...fresh, settings: { ...fresh.settings, [role]: { ...profile, model: 'changed' } } });
  };
  await expect(webModelFetch(environment, transport)(`${profile.baseURL}/chat/completions`, request('solver'))).rejects.toThrow('配置已变更');
  expect(calls).toEqual(['/__solveflow/web-env/model/solver', '/__solveflow/web-env']);
});
it('cancels a renewal waiter immediately without replaying its model POST', async () => {
  const controller = new AbortController(); const calls: string[] = []; let finish = (_value: Response) => {};
  const pending = new Promise<Response>(resolve => { finish = resolve; });
  const transport: LocalFetch = async url => { calls.push(String(url)); return url === '/__solveflow/web-env' ? pending : rejected(); };
  const failed = expect(webModelFetch(environment, transport)(`${profile.baseURL}/chat/completions`, request('solver', controller.signal))).rejects.toThrow('CANCELLED');
  await expect.poll(() => calls.length).toBe(2); controller.abort(); await failed; finish(Response.json(fresh));
  expect(calls).toEqual(['/__solveflow/web-env/model/solver', '/__solveflow/web-env']);
});
it('bounds shared bootstrap renewal to five seconds and releases its timer', async () => {
  vi.useFakeTimers(); const calls: string[] = [];
  const transport: LocalFetch = async (url, init) => {
    calls.push(String(url)); if (url !== '/__solveflow/web-env') return rejected();
    return new Promise<Response>((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true }));
  };
  const failed = expect(webModelFetch(environment, transport)(`${profile.baseURL}/chat/completions`, request('solver'))).rejects.toThrow();
  await vi.advanceTimersByTimeAsync(5000); await failed;
  expect(calls).toEqual(['/__solveflow/web-env/model/solver', '/__solveflow/web-env']); expect(vi.getTimerCount()).toBe(0);
});
it('shares renewal across concurrent roles and cancellation does not stop another caller', async () => {
  let gets = 0; let paid = 0; let finish = (_value: Response) => {}; const controller = new AbortController();
  const pending = new Promise<Response>(resolve => { finish = resolve; });
  const transport: LocalFetch = async (url, init) => {
    if (url === '/__solveflow/web-env') { gets++; return pending; }
    if (new Headers(init?.headers).get('authorization')?.includes('old-')) return rejected();
    paid++; return new Response('{}');
  };
  const fetch = webModelFetch(environment, transport);
  const cancelled = expect(fetch(`${profile.baseURL}/chat/completions`, request('solver', controller.signal))).rejects.toThrow('CANCELLED');
  const live = fetch(`${profile.baseURL}/chat/completions`, request('verifier'));
  await expect.poll(() => gets).toBe(1); controller.abort(); await cancelled; finish(Response.json(fresh));
  expect((await live).ok).toBe(true); expect(gets).toBe(1); expect(paid).toBe(1);
});
it('authenticates preset mutations, preserves active state before acknowledgement and forwards preset-scoped draft tests', async () => {
  const current = { ...environment, canManagePresets: true, canEditModels: true };
  const id = '00000000-0000-4000-8000-000000000001'; const calls: string[] = [];
  const transport: LocalFetch = async (url, init) => { calls.push(String(url)); expect(new Headers(init?.headers).get('authorization')).toBe('Bearer old-solver');
    if (url === '/__solveflow/web-env/test/solver') expect(JSON.parse(String(init?.body))).toMatchObject({ presetId: id, key: null });
    return Response.json({ ...fresh, canManagePresets: true }); };
  await mutateWebModelPresets(current, { kind: 'create', name: 'Preset', configuration: { schemaVersion: 1, models: { solver: current.settings.solver, verifier: null, backup: null }, keys: { solver: null, verifier: null, backup: null } } }, transport);
  await mutateWebModelPresets(current, { kind: 'activate', id }, transport); await mutateWebModelPresets(current, { kind: 'remove', id }, transport);
  await webModelTestFetch(current, 'solver', current.settings.solver, '', transport, id)(profile.baseURL + '/chat/completions', { method: 'POST', body: JSON.stringify({ model: 'fixture' }) });
  expect(calls).toEqual(['/__solveflow/web-env/presets', `/__solveflow/web-env/presets/${id}/activate`, `/__solveflow/web-env/presets/${id}`, '/__solveflow/web-env/test/solver']); expect(current.accessTokens.solver).toBe('old-solver');
});
it('never retries an ambiguous preset mutation and sanitizes server errors', async () => {
  const current = { ...environment, canManagePresets: true }; const action = { kind: 'activate' as const, id: '00000000-0000-4000-8000-000000000001' };
  const transport = vi.fn(async () => { throw new TypeError('network'); });
  await expect(mutateWebModelPresets(current, action, transport)).rejects.toThrow('状态未确认'); expect(transport).toHaveBeenCalledOnce();
  await expect(mutateWebModelPresets(current, action, async () => Response.json({ error: { message: 'private-server-secret' } }, { status: 400 }))).rejects.toThrow('配置无效');
  await expect(mutateWebModelPresets(current, action, async () => Response.json({ error: { message: '预设名称已存在，请使用其他名称。' } }, { status: 400 }))).rejects.toThrow('名称已存在');
  await expect(mutateWebModelPresets(current, action, async () => new Response('{}', { status: 409 }))).rejects.toThrow('等待当前模型请求');
});
