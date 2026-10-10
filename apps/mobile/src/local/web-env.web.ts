// Decision: .agents/notes/implemented/architecture/2026-10-09-batch-dispatch-and-verification.md
import { WebEnvironmentSchema, type WebEnvironment } from '@solveflow/contracts/local';
import type { LocalFetch } from '@solveflow/agent/mobile';
// Decision: .agents/notes/implemented/architecture/2026-10-08-local-web-environment.md
// Decision: .agents/notes/implemented/architecture/2026-10-08-web-token-renewal.md
export async function loadWebEnvironment(transport: LocalFetch, signal?: AbortSignal | null): Promise<WebEnvironment | null> {
  const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 5000);
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true }); if (signal?.aborted) abort();
  try {
    const response = await transport('/__solveflow/web-env', { signal: controller.signal, credentials: 'omit', redirect: 'error', cache: 'no-store' });
    if (response.status === 404 || response.status === 204) return null;
    if (!response.ok) throw new Error('本地环境配置不可用，请检查 .env 并重启 Web 服务。');
    const value: unknown = await response.json(); return WebEnvironmentSchema.parse(value);
  } catch { throw new Error('无法读取本地 Web 模型配置，请检查服务后刷新。'); }
  finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
}
export function webModelFetch(environment: WebEnvironment | null, transport: LocalFetch): LocalFetch {
  if (!environment) return transport;
  let tokens = environment.accessTokens;
  let renewal: Promise<WebEnvironment | null> | undefined;
  function renew(signal?: AbortSignal | null): Promise<WebEnvironment | null> {
    // A cancelled waiter cannot cancel renewal needed by another live request.
    const pending = renewal ??= loadWebEnvironment(transport).finally(() => { renewal = undefined; });
    if (!signal) return pending;
    return new Promise((resolve, reject) => {
      const abort = () => { signal?.removeEventListener('abort', abort); reject(new Error('CANCELLED')); };
      signal.addEventListener('abort', abort, { once: true });
      void pending.then(value => { signal.removeEventListener('abort', abort); resolve(value); }, error => { signal.removeEventListener('abort', abort); reject(error); });
      if (signal.aborted) abort();
    });
  }
  return async (input, init) => {
    const key = new Headers(init?.headers).get('authorization');
    for (const role of ['solver', 'verifier', 'backup'] as const) {
      const token = environment.accessTokens[role]; if (!token || key !== `Bearer ${token}`) continue;
      const profile = environment.settings[role];
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (!profile || url !== `${profile.baseURL}/${profile.api === 'openai-responses' ? 'responses' : 'chat/completions'}` || init?.method?.toUpperCase() !== 'POST') throw new Error('本地环境模型配置不匹配，请刷新后重试。');
      const send = (token: string) => {
        if (init.signal?.aborted) throw new Error('CANCELLED');
        const headers = new Headers(init.headers); headers.set('authorization', `Bearer ${token}`);
        return transport(`/__solveflow/web-env/model/${role}`, { ...init, headers, credentials: 'omit', redirect: 'error', cache: 'no-store' });
      };
      const response = await send(tokens[role] ?? token);
      // This marker is minted only by the local proxy before upstream dispatch.
      // An unmarked provider 401 must never cause automatic POST replay.
      if (response.status !== 401 || response.headers.get('x-solveflow-model-dispatch') !== 'not-started') return response;
      await response.body?.cancel();
      const current = await renew(init.signal);
      if (!current || (['solver', 'verifier', 'backup'] as const).some(slot => {
        return JSON.stringify(current.settings[slot] ?? null) !== JSON.stringify(environment.settings[slot] ?? null);
      })) throw new Error('本地模型配置已变更，请刷新后重试。');
      if (init.signal?.aborted) throw new Error('CANCELLED');
      const refreshedToken = current.accessTokens[role];
      if (!refreshedToken) throw new Error('本地模型配置已变更，请刷新后重试。');
      tokens = current.accessTokens;
      return send(refreshedToken);
    }
    return transport(input, init);
  };
}
