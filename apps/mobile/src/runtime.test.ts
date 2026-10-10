import { beforeEach, expect, it, vi } from 'vitest';
const storage = vi.hoisted(() => ({ open: vi.fn(), expired: vi.fn() }));
vi.mock('expo/fetch', () => ({ fetch: vi.fn() }));
vi.mock('expo-crypto', () => ({ randomUUID: vi.fn() }));
vi.mock('@solveflow/agent/mobile', () => ({ solveOnDevice: vi.fn() }));
vi.mock('./local/documents', () => ({ openDocuments: storage.open }));
vi.mock('./local/secrets', () => ({ readKey: vi.fn(), writeKey: vi.fn() }));
vi.mock('./local/lock', () => ({ lockLocalApp: vi.fn() }));
vi.mock('./local/background', () => ({ background: {}, onBackgroundExpired: storage.expired }));
vi.mock('./local/web-env', () => ({ loadWebEnvironment: vi.fn().mockResolvedValue(null), webModelFetch: (_environment: unknown, fetch: unknown) => fetch }));
beforeEach(async () => { vi.resetModules(); vi.clearAllMocks(); const adapter = await import('./local/web-env'); vi.mocked(adapter.loadWebEnvironment).mockResolvedValue(null); });
it('retries runtime initialization after storage failure and shares one successful engine', async () => {
  const documents = { get: vi.fn().mockResolvedValue(null), keys: vi.fn().mockResolvedValue([]), put: vi.fn(), remove: vi.fn() };
  storage.open.mockRejectedValueOnce(new Error('storage unavailable')).mockResolvedValueOnce(documents);
  const { createRuntime } = await import('./runtime');
  const failed = createRuntime(); expect(createRuntime()).toBe(failed);
  await expect(failed).rejects.toThrow('storage unavailable');
  const retry = createRuntime(); expect(createRuntime()).toBe(retry);
  const runtime = await retry;
  expect(await createRuntime()).toBe(runtime); expect(storage.open).toHaveBeenCalledTimes(2);
  expect(storage.expired).toHaveBeenCalledOnce();
});

const profile = { provider: 'fixture', baseURL: 'https://fixture.invalid/v1', model: 'fixture', api: 'openai-completions' as const, contextWindow: 32768, maxTokens: 8192, maxTokensField: 'max_tokens' as const };
async function configuredRuntime() {
  const settings = { schemaVersion: 1 as const, solver: profile, verifier: null };
  const data = new Map([['settings', JSON.stringify({ settings, keySlot: 'a' })]]);
  const credentials = new Map<string, string | null>([['a.solver', 'synthetic-old']]);
  const documents = { get: vi.fn(async (key: string) => data.get(key) ?? null), keys: vi.fn().mockResolvedValue([]), put: vi.fn(async (key: string, value: string) => { data.set(key, value); }), remove: vi.fn() };
  storage.open.mockResolvedValue(documents);
  const secrets = await import('./local/secrets');
  vi.mocked(secrets.readKey).mockImplementation(async key => credentials.get(key) ?? null);
  vi.mocked(secrets.writeKey).mockImplementation(async (key, value) => { credentials.set(key, value); });
  const { createRuntime } = await import('./runtime');
  return { runtime: await createRuntime(), documents, data, credentials, settings };
}

it('reads legacy settings and stores the third key only in secure slots, including clear', async () => {
  const { runtime, data, credentials, settings } = await configuredRuntime();
  expect(await runtime.configured()).toBe(true); expect(runtime.settings?.backup).toBeUndefined();
  await runtime.saveSettings({ ...settings, backup: profile }, { solver: 'synthetic-new', verifier: null, backup: 'synthetic-backup' });
  expect((await runtime.credentials()).backup).toBe('synthetic-backup');
  expect(data.get('settings')).not.toContain('synthetic-');
  expect(credentials.get('a.solver')).toBeNull();
  await runtime.clearKeys(); expect((await runtime.credentials()).backup).toBeNull(); expect(await runtime.configured()).toBe(false);
});

it('keeps the old profile and credentials when third-profile persistence fails', async () => {
  const { runtime, documents, credentials, settings } = await configuredRuntime();
  documents.put.mockRejectedValueOnce(new Error('synthetic-storage-failure'));
  await expect(runtime.saveSettings({ ...settings, backup: profile }, { solver: 'synthetic-new', verifier: null, backup: 'synthetic-backup' })).rejects.toThrow('设置保存失败');
  expect(runtime.settings?.backup).toBeUndefined(); expect((await runtime.credentials()).solver).toBe('synthetic-old');
  expect(credentials.get('b.backup')).toBeNull(); expect(credentials.get('a.solver')).toBe('synthetic-old');
});

it('uses environment tokens without overwriting manual settings and stores the exam separately', async () => {
  const adapter = await import('./local/web-env');
  const { WebEnvironmentSchema } = await import('@solveflow/contracts/local');
  vi.mocked(adapter.loadWebEnvironment).mockResolvedValue(WebEnvironmentSchema.parse({ schemaVersion: 1, settings: { schemaVersion: 1, solver: { ...profile, model: 'environment' }, verifier: null, backup: null }, accessTokens: { solver: 'synthetic-access-token', verifier: null, backup: null } }));
  const { runtime, data, settings } = await configuredRuntime(); expect(runtime.environmentManaged).toBe(true); expect(runtime.settings?.solver.model).toBe('environment'); expect(await runtime.configured()).toBe(true);
  const before = data.get('settings');
  await runtime.saveSettings({ ...runtime.settings!, exam: 'esat', concurrency: { solver: 6, verifier: 4 } }, { solver: '', verifier: null });
  expect(data.get('settings')).toBe(before); expect(JSON.parse(data.get('web-environment-preferences')!)).toEqual({ exam: 'esat', concurrency: { solver: 6, verifier: 4 } }); expect(runtime.settings?.exam).toBe('esat');
  expect(runtime.engine.concurrency).toEqual({ solver: 6, verifier: 4 });
  await expect(runtime.saveSettings(settings, { solver: 'synthetic-old', verifier: null })).rejects.toThrow('模型由本地 .env 管理');
  await expect(runtime.clearKeys()).rejects.toThrow('本地 .env');
});

it('restores saved manual concurrency and retains it when settings persistence fails', async () => {
  const { runtime, documents, settings, data } = await configuredRuntime();
  expect(runtime.engine.concurrency).toEqual({ solver: 8, verifier: 8 });
  await runtime.saveSettings({ ...settings, concurrency: { solver: 7, verifier: 2 } }, { solver: 'synthetic-new', verifier: null });
  expect(runtime.engine.concurrency).toEqual({ solver: 7, verifier: 2 });
  documents.put.mockRejectedValueOnce(new Error('synthetic-storage-failure'));
  await expect(runtime.saveSettings({ ...settings, concurrency: { solver: 1, verifier: 1 } }, { solver: 'synthetic-next', verifier: null })).rejects.toThrow('保存失败');
  expect(runtime.engine.concurrency).toEqual({ solver: 7, verifier: 2 });
  vi.resetModules(); const { createRuntime } = await import('./runtime');
  const reopened = await createRuntime(); expect(reopened.engine.concurrency).toEqual({ solver: 7, verifier: 2 });
  expect(data.get('settings')).not.toContain('synthetic-');
});

it('restores environment concurrency separately and keeps legacy exam preferences readable', async () => {
  const { WebEnvironmentSchema } = await import('@solveflow/contracts/local');
  const adapter = await import('./local/web-env');
  vi.mocked(adapter.loadWebEnvironment).mockResolvedValue(WebEnvironmentSchema.parse({ schemaVersion: 1, settings: { schemaVersion: 1, solver: profile, verifier: null }, accessTokens: { solver: 'synthetic-access-token', verifier: null, backup: null } }));
  const { data } = await configuredRuntime();
  data.set('web-environment-exam', 'tmua');
  vi.resetModules(); let runtime = await (await import('./runtime')).createRuntime();
  expect(runtime.settings?.exam).toBe('tmua'); expect(runtime.engine.concurrency).toEqual({ solver: 8, verifier: 8 });
  await runtime.saveSettings({ ...runtime.settings!, concurrency: { solver: 8, verifier: 4 } }, { solver: '', verifier: null });
  vi.resetModules(); runtime = await (await import('./runtime')).createRuntime();
  expect(runtime.settings?.exam).toBe('tmua'); expect(runtime.engine.concurrency).toEqual({ solver: 8, verifier: 4 });
  data.set('web-environment-preferences', '{broken');
  vi.resetModules(); runtime = await (await import('./runtime')).createRuntime();
  expect(runtime.engine.concurrency).toEqual({ solver: 8, verifier: 8 });
  expect(runtime.settingsWarning).toContain('并发设置已损坏'); expect(data.get('web-environment-preferences')).toBe('{broken');
});

it('blocks dispatch and concurrent settings saves while preference persistence is in progress', async () => {
  const { runtime, documents, settings } = await configuredRuntime();
  let release = () => {}; let entered = false;
  const original = documents.put.getMockImplementation()!;
  documents.put.mockImplementationOnce(async (key, value) => { entered = true; await new Promise<void>(resolve => { release = resolve; }); await original(key, value); });
  const save = runtime.saveSettings({ ...settings, concurrency: { solver: 2, verifier: 2 } }, { solver: 'synthetic-new', verifier: null });
  try {
    await expect.poll(() => entered).toBe(true);
    await expect(runtime.enqueueBatch('not-dispatched')).rejects.toThrow('正在保存设置');
    await expect(runtime.saveSettings(settings, { solver: 'synthetic-old', verifier: null })).rejects.toThrow('等待解题结束');
  } finally { release(); await save; }
  expect(runtime.engine.concurrency).toEqual({ solver: 2, verifier: 2 });
});

it('rejects a prepared executor after a settings save completes before credentials return', async () => {
  const { runtime, settings } = await configuredRuntime();
  const secrets = await import('./local/secrets');
  const original = vi.mocked(secrets.readKey).getMockImplementation()!;
  let release = () => {}; let entered = false;
  vi.mocked(secrets.readKey).mockImplementationOnce(async key => {
    const value = await original(key);
    entered = true; await new Promise<void>(resolve => { release = resolve; }); return value;
  });
  // Attach the rejection assertion immediately so the delayed promise is never unhandled.
  const rejected = expect(runtime.enqueueBatch('not-dispatched')).rejects.toThrow('设置已变更');
  try {
    await expect.poll(() => entered).toBe(true);
    await runtime.saveSettings({ ...settings, concurrency: { solver: 4, verifier: 2 } }, { solver: 'synthetic-new', verifier: null });
  } finally { release(); }
  await rejected; expect(runtime.engine.actives).toEqual([]);
});

it('retains access to existing records and manual settings when the optional environment bridge is unavailable', async () => {
  const adapter = await import('./local/web-env'); vi.mocked(adapter.loadWebEnvironment).mockRejectedValueOnce(new Error('synthetic-offline'));
  const { runtime } = await configuredRuntime(); expect(runtime.environmentManaged).toBe(false); expect(runtime.settings?.solver.model).toBe('fixture'); expect(runtime.settingsWarning).toContain('历史仍可查看');
});
