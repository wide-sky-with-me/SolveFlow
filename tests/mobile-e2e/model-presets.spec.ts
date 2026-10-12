import { expect, test } from '@playwright/test';
import { WebEnvironmentSchema, WebModelPresetCreateSchema, WebModelUpdateSchema, WebModelTestSchema, type WebModelPreset } from '../../packages/contracts/src/local.js';
import { modelSse } from './local-fixture.js';
const profile = { provider: 'fixture', baseURL: 'https://fixture.invalid/v1', model: 'primary', api: 'openai-completions', contextWindow: 32768, maxTokens: 8192, maxTokensField: 'max_tokens' };
const alternate = { ...profile, baseURL: 'https://alternate.invalid/v1', model: 'alternate' };
const id = '00000000-0000-4000-8000-000000000001';
test('whole-model presets load editable drafts, save copies, activate, recover after refresh and remove with confirmation', async ({ page }, info) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const entry: WebModelPreset = { id, name: 'Alternate', models: WebModelUpdateSchema.shape.models.parse({ solver: alternate, verifier: alternate, backup: profile }) };
  let environment = WebEnvironmentSchema.parse({ schemaVersion: 1, canEditModels: true, canManagePresets: true, presets: [entry], settings: { schemaVersion: 1, solver: profile, verifier: profile, backup: profile }, accessTokens: { solver: 'initial-solver', verifier: 'initial-review', backup: 'initial-backup' } });
  let copies = 0; let activations = 0; let removals = 0; let checks = 0; let saves = 0;
  await page.route('https://*.invalid/**', route => route.abort());
  await page.route('**/__solveflow/web-env', route => route.fulfill({ json: environment }));
  await page.route('**/__solveflow/web-env/presets**', async route => {
    expect(route.request().headers().authorization).toBe(`Bearer ${environment.accessTokens.solver}`);
    const url = new URL(route.request().url());
    if (route.request().method() === 'DELETE') { removals++; environment = { ...environment, presets: environment.presets?.filter(p => !url.pathname.endsWith(p.id)) ?? [] }; }
    else if (url.pathname.endsWith('/activate')) { activations++; const preset = environment.presets?.find(p => url.pathname.endsWith(`${p.id}/activate`)); if (!preset) throw new Error('FIXTURE_PRESET'); environment = WebEnvironmentSchema.parse({ ...environment, settings: { schemaVersion: 1, ...preset.models }, accessTokens: { solver: 'activated-solver', verifier: 'activated-review', backup: 'activated-backup' } }); }
    else { const input = WebModelPresetCreateSchema.parse(route.request().postDataJSON()); expect(input.configuration.presetId).toBe(id); expect(input.configuration.keys).toEqual({ solver: null, verifier: null, backup: null }); copies++; environment = { ...environment, presets: [...environment.presets ?? [], { id: '00000000-0000-4000-8000-000000000002', name: input.name, models: input.configuration.models }] }; }
    await route.fulfill({ json: environment });
  });
  await page.route('**/__solveflow/web-env/settings', async route => {
    saves++; const input = WebModelUpdateSchema.parse(route.request().postDataJSON()); environment = WebEnvironmentSchema.parse({ ...environment, settings: { schemaVersion: 1, ...input.models } }); await route.fulfill({ json: environment });
  });
  await page.route('**/__solveflow/web-env/test/*', async route => {
    const input = WebModelTestSchema.parse(route.request().postDataJSON()); expect(input.presetId).toBe(id); expect(input.key).toBeNull(); checks++;
    await route.fulfill({ contentType: 'text/event-stream', body: modelSse('OK') });
  });
  const settings = async () => { await page.getByRole('tab', { name: '我的', exact: true }).click(); await page.getByRole('button', { name: '设置', exact: true }).click(); };
  await page.goto('/'); await settings();
  await page.getByRole('button', { name: 'ESAT', exact: true }).click(); await page.getByLabel('答题并发', { exact: true }).fill('12'); await page.getByRole('button', { name: '保存设置', exact: true }).click(); await settings();
  await page.getByRole('button', { name: '选择预设', exact: true }).click(); await page.getByRole('region', { name: 'Alternate', exact: true }).getByRole('button', { name: '载入', exact: true }).click();
  await expect(page.getByLabel('解题模型引用名', { exact: true })).toHaveValue('alternate'); await expect(page.getByLabel('校验模型引用名', { exact: true })).toHaveValue('alternate'); await expect(page.getByLabel('备用模型引用名', { exact: true })).toHaveValue('primary');
  expect(environment.settings.solver.model).toBe('primary'); expect(activations).toBe(0);
  for (const role of ['解题', '校验', '备用']) await expect(page.getByLabel(`${role}API Key`, { exact: true })).toHaveValue('');
  await page.getByRole('button', { name: '测试解题模型连接', exact: true }).click(); await expect(page.getByText(/文本连接测试通过/)).toBeVisible(); expect(checks).toBe(1);
  await page.getByLabel('解题模型引用名', { exact: true }).fill('edited-alternate');
  await page.getByRole('button', { name: '另存为预设', exact: true }).click(); await page.getByLabel('预设名称', { exact: true }).fill('My copy'); await page.getByRole('button', { name: '保存预设', exact: true }).click(); await expect(page.getByLabel('预设名称')).toHaveCount(0); expect(copies).toBe(1); expect(environment.settings.solver.model).toBe('primary');
  await page.getByRole('button', { name: 'Alternate', exact: true }).click(); await page.getByRole('region', { name: 'My copy', exact: true }).getByRole('button', { name: '启用', exact: true }).click(); await expect(page.getByRole('dialog')).toHaveCount(0); expect(activations).toBe(1);
  await page.reload(); await settings(); await expect(page.getByLabel('解题模型引用名', { exact: true })).toHaveValue('edited-alternate'); await expect(page.getByLabel('答题并发', { exact: true })).toHaveValue('12'); await expect(page.getByRole('button', { name: 'ESAT', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: '选择预设', exact: true }).click(); await page.getByRole('region', { name: 'Alternate', exact: true }).getByRole('button', { name: '移除', exact: true }).click(); await page.getByRole('button', { name: '取消移除', exact: true }).click(); expect(removals).toBe(0);
  await page.getByRole('region', { name: 'Alternate', exact: true }).getByRole('button', { name: '移除', exact: true }).click(); await page.getByRole('button', { name: '确认移除', exact: true }).click(); await expect(page.getByRole('region', { name: 'Alternate', exact: true })).toHaveCount(0); expect(removals).toBe(1);
  await page.getByRole('button', { name: '关闭预设', exact: true }).click(); expect(saves).toBe(0); // Preferences alone never write model settings.
  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    for (const { width, height } of [{ width: 390, height: 1000 }, { width: 1280, height: 1000 }, { width: 1920, height: 1000 }, { width: 740, height: 390 }]) {
      await page.setViewportSize({ width, height }); await expect(page.getByRole('button', { name: '保存设置', exact: true })).toBeInViewport({ ratio: 1 }); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.getByRole('button', { name: '选择预设', exact: true }).click(); await expect(page.getByRole('region', { name: 'My copy', exact: true }).getByRole('button', { name: '启用', exact: true })).toBeInViewport({ ratio: 1 }); await page.screenshot({ path: info.outputPath(`presets-${width}-${scheme}.png`) }); await page.getByRole('button', { name: '关闭预设', exact: true }).click();
    }
  }
});
