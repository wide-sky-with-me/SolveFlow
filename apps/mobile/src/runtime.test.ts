import { beforeEach, expect, it, vi } from 'vitest';
const storage = vi.hoisted(() => ({ open: vi.fn(), expired: vi.fn() }));
vi.mock('expo/fetch', () => ({ fetch: vi.fn() }));
vi.mock('expo-crypto', () => ({ randomUUID: vi.fn() }));
vi.mock('@solveflow/agent/mobile', () => ({ solveOnDevice: vi.fn() }));
vi.mock('./local/documents', () => ({ openDocuments: storage.open }));
vi.mock('./local/secrets', () => ({ readKey: vi.fn(), writeKey: vi.fn() }));
vi.mock('./local/lock', () => ({ lockLocalApp: vi.fn() }));
vi.mock('./local/background', () => ({ background: {}, onBackgroundExpired: storage.expired }));
vi.mock('./local/web-env', () => ({ loadWebEnvironment: vi.fn().mockResolvedValue(null), webModelFetch: (_environment: unknown, fetch: unknown) => fetch, webModelTestFetch: (_environment: unknown, _role: unknown, _profile: unknown, _key: unknown, fetch: unknown) => fetch, saveWebModelSettings: vi.fn(), mutateWebModelPresets: vi.fn() }));
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
it('applies acknowledged Web model edits without persisting provider keys or tokens in documents', async () => {
  const adapter = await import('./local/web-env'); const { WebEnvironmentSchema } = await import('@solveflow/contracts/local');
  const environment = WebEnvironmentSchema.parse({ schemaVersion: 1, canEditModels: true, settings: { schemaVersion: 1, solver: profile, verifier: null, backup: null }, accessTokens: { solver: 'old-token', verifier: null, backup: null } });
  vi.mocked(adapter.loadWebEnvironment).mockResolvedValue(environment);
  vi.mocked(adapter.saveWebModelSettings).mockResolvedValue({ ...environment, settings: { ...environment.settings, solver: { ...profile, model: 'edited' } }, accessTokens: { solver: 'new-token', verifier: null, backup: null } });
  const { runtime, data, documents } = await configuredRuntime(); const manual = data.get('settings');
  expect(runtime.modelSettingsEditable).toBe(true);
  await runtime.saveSettings({ ...runtime.settings!, solver: { ...profile, model: 'edited' }, exam: 'esat', concurrency: { solver: 12, verifier: 10 } }, { solver: 'synthetic-provider-key', verifier: null, backup: null });
  expect(runtime.settings?.solver.model).toBe('edited'); expect((await runtime.credentials()).solver).toBe('new-token'); expect(runtime.engine.concurrency).toEqual({ solver: 12, verifier: 10 });
  expect(data.get('settings')).toBe(manual); expect(JSON.stringify([...data])).not.toContain('new-token'); expect(JSON.stringify([...data])).not.toContain('synthetic-provider-key');
  vi.mocked(adapter.saveWebModelSettings).mockRejectedValueOnce(new Error('保存失败'));
  await expect(runtime.saveSettings({ ...runtime.settings!, solver: { ...profile, model: 'rejected' } }, { solver: '', verifier: null })).rejects.toThrow('保存失败'); expect(runtime.settings?.solver.model).toBe('edited');
  vi.mocked(adapter.saveWebModelSettings).mockResolvedValueOnce({ ...environment, settings: { ...environment.settings, solver: { ...profile, model: 'partially-saved' } } });
  documents.put.mockRejectedValueOnce(new Error('storage-error'));
  await expect(runtime.saveSettings({ ...runtime.settings!, solver: { ...profile, model: 'partially-saved' }, exam: 'tmua' }, { solver: '', verifier: null })).rejects.toThrow('模型配置已保存'); expect(runtime.settings?.solver.model).toBe('partially-saved'); expect(runtime.settings?.exam).toBe('esat');
});
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
    await expect(runtime.saveDefaultExam('act')).rejects.toThrow('结束当前解题');
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

it('quick exam changes persist without touching model profiles, keys or saved questions', async () => {
  const { runtime, data, documents, credentials } = await configuredRuntime();
  const secrets = await import('./local/secrets');
  vi.mocked(secrets.writeKey).mockClear();
  const before = runtime.settings; const keys = [...credentials];
  data.set('record.synthetic', 'preserved-question-with-tmua-snapshot');
  await runtime.saveDefaultExam('esat');
  expect(runtime.defaultExam).toBe('esat'); expect(runtime.settings).toEqual({ ...before, exam: 'esat' });
  expect([...credentials]).toEqual(keys); expect(secrets.writeKey).not.toHaveBeenCalled();
  expect(data.get('record.synthetic')).toBe('preserved-question-with-tmua-snapshot');
  documents.put.mockRejectedValueOnce(new Error('synthetic-write-failure'));
  await expect(runtime.saveDefaultExam('act')).rejects.toThrow('synthetic-write-failure');
  expect(runtime.defaultExam).toBe('esat');
  vi.resetModules(); const reopened = await (await import('./runtime')).createRuntime();
  expect(reopened.defaultExam).toBe('esat');
});

it('quick exam changes reuse environment preferences and retain manual settings and concurrency', async () => {
  const adapter = await import('./local/web-env');
  const { WebEnvironmentSchema } = await import('@solveflow/contracts/local');
  vi.mocked(adapter.loadWebEnvironment).mockResolvedValue(WebEnvironmentSchema.parse({ schemaVersion: 1, settings: { schemaVersion: 1, solver: profile, verifier: null, concurrency: { solver: 6, verifier: 4 } }, accessTokens: { solver: 'synthetic-access-token', verifier: null, backup: null } }));
  const { runtime, data } = await configuredRuntime(); const manual = data.get('settings');
  await runtime.saveDefaultExam('tmua');
  expect(data.get('settings')).toBe(manual);
  expect(JSON.parse(data.get('web-environment-preferences')!)).toEqual({ exam: 'tmua', concurrency: { solver: 6, verifier: 4 } });
  expect(runtime.engine.concurrency).toEqual({ solver: 6, verifier: 4 });
  vi.resetModules(); expect((await (await import('./runtime')).createRuntime()).defaultExam).toBe('tmua');
});

it('can save a default exam before model setup without creating a model configuration', async () => {
  const data = new Map<string, string>();
  storage.open.mockResolvedValue({ get: async (key: string) => data.get(key) ?? null, keys: async () => [], put: async (key: string, value: string) => { data.set(key, value); }, remove: vi.fn() });
  const runtime = await (await import('./runtime')).createRuntime();
  await runtime.saveDefaultExam('act'); expect(runtime.settings).toBeNull(); expect(data.get('settings')).toBeUndefined();
  vi.resetModules(); expect((await (await import('./runtime')).createRuntime()).defaultExam).toBe('act');
});
it('creates presets without activating and activates all roles while retaining exam, concurrency and secret isolation', async () => {
  const adapter = await import('./local/web-env'); const { WebEnvironmentSchema } = await import('@solveflow/contracts/local');
  const id = '00000000-0000-4000-8000-000000000001';
  const environment = WebEnvironmentSchema.parse({ schemaVersion: 1, canEditModels: true, canManagePresets: true, presets: [], settings: { schemaVersion: 1, solver: profile, verifier: null, backup: null }, accessTokens: { solver: 'old-token', verifier: null, backup: null } });
  vi.mocked(adapter.loadWebEnvironment).mockResolvedValue(environment);
  const { runtime, data } = await configuredRuntime();
  await runtime.saveSettings({ ...runtime.settings!, exam: 'esat', concurrency: { solver: 12, verifier: 10 } }, { solver: '', verifier: null });
  const models = { solver: { ...profile, model: 'alternate' }, verifier: { ...profile, model: 'review' }, backup: { ...profile, model: 'backup' } };
  const entry = { id, name: 'Alternate', models };
  vi.mocked(adapter.mutateWebModelPresets).mockResolvedValueOnce({ ...environment, presets: [entry] });
  await runtime.saveModelPreset('Alternate', { schemaVersion: 1, ...models }, { solver: 'synthetic-private-key', verifier: 'synthetic-private-key', backup: 'synthetic-private-key' });
  expect(runtime.settings?.solver.model).toBe('fixture'); expect(runtime.modelPresets).toEqual([entry]); expect((await runtime.credentials()).solver).toBe('old-token');
  vi.mocked(adapter.mutateWebModelPresets).mockResolvedValueOnce({ ...environment, presets: [entry], settings: { schemaVersion: 1, ...models }, accessTokens: { solver: 'new-token', verifier: 'new-review-token', backup: 'new-backup-token' } });
  await runtime.activateModelPreset(id);
  expect(runtime.settings).toMatchObject({ ...models, exam: 'esat', concurrency: { solver: 12, verifier: 10 } }); expect(runtime.engine.concurrency).toEqual({ solver: 12, verifier: 10 }); expect((await runtime.credentials()).backup).toBe('new-backup-token');
  expect(JSON.stringify([...data])).not.toContain('new-token'); expect(JSON.stringify([...data])).not.toContain('synthetic-private-key');
  let release = () => {}; vi.mocked(adapter.mutateWebModelPresets).mockImplementationOnce(() => new Promise(resolve => { release = () => resolve(environment); }));
  const pending = runtime.removeModelPreset(id);
  await expect(runtime.activateModelPreset(id)).rejects.toThrow('等待解题结束'); await expect(runtime.saveDefaultExam('tmua')).rejects.toThrow('结束当前解题');
  release(); await pending;
});

it('clears only authoritative single records, retains batches, and rolls back scoped deletion on storage failure', async () => {
  const { runtime, data, documents } = await configuredRuntime();
  const crypto = await import('expo-crypto'); let sequence = 0;
  vi.mocked(crypto.randomUUID).mockImplementation(() => `93000000-0000-4000-8000-${String(++sequence).padStart(12, '0')}`);
  documents.keys.mockImplementation(async () => [...data.keys()]);
  const batch = { id: '93000000-0000-4000-8000-000000000090', createdAt: new Date().toISOString(), title: 'Synthetic preserved batch', exam: 'general' as const, position: 1 };
  const single = await runtime.engine.create('data:image/jpeg;base64,AQID', 30, 20); const second = await runtime.engine.create('data:image/jpeg;base64,AQID', 30, 20);
  const grouped = await runtime.engine.create('data:image/jpeg;base64,AQID', 30, 20, 'general', batch);
  const before = [...data];
  await expect(runtime.removeSingleHistory()).rejects.toThrow('批量删除事务'); expect([...data]).toEqual(before);
  Object.assign(documents, { async batch(changes: { key: string; value: string | null }[]) { for (const { key, value } of changes) if (value === null) data.delete(key); else data.set(key, value); } });
  await runtime.removeSingleHistory();
  expect(data.has(`record.${single.session.id}`)).toBe(false); expect(data.has(`record.${second.session.id}`)).toBe(false);
  expect(await runtime.repository.read(grouped.session.id)).toEqual(grouped); expect(data.has('settings')).toBe(true);
  await runtime.removeSingleHistory(); expect((await runtime.repository.listHistory()).map(row => row.id)).toEqual([grouped.session.id]);
});
