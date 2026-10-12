// Decision: .agents/notes/implemented/architecture/2026-10-09-batch-dispatch-and-verification.md
import { WebEnvironmentSchema, WebModelUpdateSchema, WebModelTestSchema, WebModelPresetCreateSchema, WebModelPresetSchema, type WebEnvironment, type WebModelUpdate, type LocalModelProfile } from '@solveflow/contracts/local';
import type { LocalFetch } from '@solveflow/agent/mobile';
import type { ModelPresetAction } from './model-preset-action';
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
  let configuredTokens = environment.accessTokens;
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
    if (configuredTokens !== environment.accessTokens) { configuredTokens = environment.accessTokens; tokens = configuredTokens; }
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
// Decision: .agents/notes/implemented/architecture/2026-10-10-web-model-settings-editor.md
export async function saveWebModelSettings(environment: WebEnvironment, value: WebModelUpdate, transport: LocalFetch): Promise<WebEnvironment> {
  if (!environment.canEditModels) throw new Error('模型由本地 .env 管理，请更新 Web 服务后编辑。');
  const update = WebModelUpdateSchema.parse(value);
  const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await transport('/__solveflow/web-env/settings', { method: 'PUT', headers: { 'content-type': 'application/json', authorization: `Bearer ${environment.accessTokens.solver}` }, body: JSON.stringify(update), signal: controller.signal, credentials: 'omit', redirect: 'error', cache: 'no-store' });
    if (!response.ok) throw new Error(response.status === 409 ? '请等待当前模型请求结束，再保存配置。' : response.status === 401 ? '配置已变更，请刷新后重新保存。' : response.status === 400 ? '模型配置无效；新增或更换服务后请填写 API Key。' : '本机模型配置保存失败，原配置已保留。');
    const result: unknown = await response.json(); return WebEnvironmentSchema.parse(result);
  } catch (error) {
    if (controller.signal.aborted || error instanceof TypeError || error instanceof SyntaxError || (error instanceof Error && error.name === 'ZodError')) throw new Error('保存状态未确认，请刷新设置查看结果。');
    throw error;
  }
  finally { clearTimeout(timer); }
}
export async function mutateWebModelPresets(environment: WebEnvironment, action: ModelPresetAction, transport: LocalFetch): Promise<WebEnvironment> {
  if (!environment.canManagePresets) throw new Error('当前服务不支持配置预设，请更新服务。');
  const id = action.kind === 'create' ? null : WebModelPresetSchema.shape.id.parse(action.id);
  const body = action.kind === 'create' ? JSON.stringify(WebModelPresetCreateSchema.parse({ name: action.name, configuration: action.configuration })) : undefined;
  const path = `/__solveflow/web-env/presets${id ? `/${id}${action.kind === 'activate' ? '/activate' : ''}` : ''}`;
  const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await transport(path, { method: action.kind === 'remove' ? 'DELETE' : 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${environment.accessTokens.solver}` }, ...(body ? { body } : {}), signal: controller.signal, credentials: 'omit', redirect: 'error', cache: 'no-store' });
    if (!response.ok) {
      if (response.status === 409) throw new Error('请等待当前模型请求结束，再修改预设。');
      if (response.status === 401) throw new Error('配置已变更，请刷新后重新操作。');
      if (response.status === 400) {
        const value: unknown = await response.json();
        const allowed = ['配置预设不存在，请刷新设置。', '配置预设已满，请先移除不用的预设。', '预设名称已存在，请使用其他名称。', '请为新增或更换服务的模型填写 API Key。', '本机配置存储容量不足，请精简配置。'];
        if (typeof value === 'object' && value && 'error' in value && typeof value.error === 'object' && value.error && 'message' in value.error && typeof value.error.message === 'string' && allowed.includes(value.error.message)) throw new Error(value.error.message);
        throw new Error('预设配置无效，请检查名称、模型和密钥。');
      }
      throw new Error('配置预设保存失败，原配置已保留。');
    }
    const value: unknown = await response.json(); return WebEnvironmentSchema.parse(value);
  } catch (error) {
    // A timed-out mutation may already be durable; never replay it automatically.
    if (controller.signal.aborted || error instanceof TypeError || error instanceof SyntaxError || (error instanceof Error && error.name === 'ZodError')) throw new Error('操作状态未确认，请刷新设置查看结果。');
    throw error;
  } finally { clearTimeout(timer); }
}
export function webModelTestFetch(environment: WebEnvironment | null, role: 'solver' | 'verifier' | 'backup', profile: LocalModelProfile, key: string, transport: LocalFetch, presetId?: string): LocalFetch {
  if (!environment?.canEditModels) return webModelFetch(environment, transport);
  return async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url !== `${profile.baseURL}/${profile.api === 'openai-responses' ? 'responses' : 'chat/completions'}` || init?.method?.toUpperCase() !== 'POST' || typeof init.body !== 'string') throw new Error('连接测试配置不匹配。');
    const request: unknown = JSON.parse(init.body);
    const body = WebModelTestSchema.parse({ schemaVersion: 1, profile, key: key.trim() || null, request, ...(presetId ? { presetId } : {}) });
    return transport(`/__solveflow/web-env/test/${role}`, { ...init, headers: { 'content-type': 'application/json', authorization: `Bearer ${environment.accessTokens.solver}` }, body: JSON.stringify(body), credentials: 'omit', redirect: 'error', cache: 'no-store' });
  };
}
