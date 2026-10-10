import { afterEach, expect, it, vi } from 'vitest';
import { WebEnvironmentSchema } from '@solveflow/contracts/local';
import type { LocalFetch } from '@solveflow/agent/mobile';
import { webModelFetch } from './web-env.web.js';
const profile = { provider: 'fixture', baseURL: 'https://fixture.invalid/v1', model: 'fixture', api: 'openai-completions', contextWindow: 32768, maxTokens: 8192, maxTokensField: 'max_tokens' };
const environment = WebEnvironmentSchema.parse({ schemaVersion: 1, settings: { schemaVersion: 1, solver: profile, verifier: profile, backup: profile }, accessTokens: { solver: 'old-solver', verifier: 'old-verifier', backup: 'old-backup' } });
const fresh = { ...environment, accessTokens: { solver: 'new-solver', verifier: 'new-verifier', backup: 'new-backup' } };
const rejected = () => new Response('{}', { status: 401, headers: { 'x-solveflow-model-dispatch': 'not-started' } });
const request = (role: 'solver' | 'verifier' | 'backup', signal?: AbortSignal) => ({ method: 'POST', headers: { authorization: `Bearer ${environment.accessTokens[role]}` }, body: '{}', signal: signal ?? null });
afterEach(() => vi.useRealTimers());
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
