import { expect, it } from 'vitest';
import { WebEnvironmentSchema } from '@solveflow/contracts/local';
import { webModelFetch } from './web-env.web.js';
const profile = { provider: 'fixture', baseURL: 'https://fixture.invalid/v1', model: 'fixture', api: 'openai-completions', contextWindow: 32768, maxTokens: 8192, maxTokensField: 'max_tokens' };
const environment = WebEnvironmentSchema.parse({ schemaVersion: 1, settings: { schemaVersion: 1, solver: profile, verifier: profile }, accessTokens: { solver: 'old-solver', verifier: 'old-verifier', backup: null } });
const init = { method: 'POST', headers: { authorization: 'Bearer old-solver' }, body: '{}' };
it('does not enqueue a bootstrap GET in front of each model stream', async () => {
  const calls: string[] = [];
  const fetch = webModelFetch(environment, async url => { calls.push(String(url)); return new Response('{}'); });
  await Promise.all(Array.from({ length: 8 }, () => fetch(`${profile.baseURL}/chat/completions`, init)));
  expect(calls).toEqual(Array(8).fill('/__solveflow/web-env/model/solver'));
});
it('retries only a locally rejected unpaid POST, renews once, and reuses the fresh token', async () => {
  const calls: string[] = []; let paid = 0;
  const fresh = { ...environment, accessTokens: { ...environment.accessTokens, solver: 'new-solver' } };
  const fetch = webModelFetch(environment, async (url, options) => {
    calls.push(String(url)); if (url === '/__solveflow/web-env') return Response.json(fresh);
    if (new Headers(options?.headers).get('authorization') === 'Bearer old-solver') return new Response('{}', { status: 401, headers: { 'x-solveflow-model-dispatch': 'not-started' } });
    paid++; return new Response('{}');
  });
  await fetch(`${profile.baseURL}/chat/completions`, init); await fetch(`${profile.baseURL}/chat/completions`, init);
  expect(paid).toBe(2); expect(calls).toEqual(['/__solveflow/web-env/model/solver', '/__solveflow/web-env', '/__solveflow/web-env/model/solver', '/__solveflow/web-env/model/solver']);
  expect(environment.accessTokens.solver).toBe('old-solver');
});
it('does not replay an upstream 401 without the trusted local rejection marker', async () => {
  let calls = 0;
  const fetch = webModelFetch(environment, async () => { calls++; return new Response('{}', { status: 401 }); });
  expect((await fetch(`${profile.baseURL}/chat/completions`, init)).status).toBe(401); expect(calls).toBe(1);
});
