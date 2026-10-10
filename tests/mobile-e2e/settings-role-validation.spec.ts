import { expect, test, type Page } from '@playwright/test';
import { modelSse } from './local-fixture.js';

const roles = ['解题', '校验'] as const;

async function openIndependentSettings(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: '配置模型与考试类型', exact: true }).click();
  await page.getByRole('switch', { name: '使用独立校验模型', exact: true }).click();
}

test('concurrency settings persist, reject invalid limits and never test a model by themselves', async ({ page }, info) => {
  let requests = 0;
  await page.route('https://fixture-model.invalid/**', route => { requests++; return route.abort(); });
  await page.goto('/'); await page.getByRole('button', { name: '配置模型与考试类型', exact: true }).click();
  await fillProfile(page, '解题');
  await expect(page.getByLabel('答题并发', { exact: true })).toHaveValue('8');
  await expect(page.getByLabel('校验并发', { exact: true })).toHaveValue('8');
  for (const value of ['0', '33', '']) {
    await page.getByLabel('答题并发', { exact: true }).fill(value);
    await page.getByRole('button', { name: '保存设置', exact: true }).click();
    await expect(page.getByText('答题并发和校验并发必须是1–32的整数。', { exact: true })).toBeVisible();
    expect(requests).toBe(0);
  }
  await page.getByLabel('答题并发', { exact: true }).fill('2');
  await page.getByLabel('校验并发', { exact: true }).fill('4');
  await page.getByRole('button', { name: '保存设置', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0); await page.reload();
  await page.getByRole('tab', { name: '我的', exact: true }).click(); await page.getByRole('button', { name: '设置', exact: true }).click();
  await expect(page.getByLabel('答题并发', { exact: true })).toHaveValue('2');
  await expect(page.getByLabel('校验并发', { exact: true })).toHaveValue('4'); expect(requests).toBe(0);
  await page.getByRole('region', { name: '批量答题与校验并发', exact: true }).screenshot({ path: info.outputPath('concurrency-settings.png') });
});

async function fillProfile(page: Page, role: typeof roles[number]) {
  await page.getByLabel(`${role}服务地址`, { exact: true }).fill('https://fixture-model.invalid/v1');
  await page.getByLabel(`${role}供应商标识`, { exact: true }).fill('fixture-provider');
  await page.getByLabel(`${role}模型引用名`, { exact: true }).fill(`fixture-${role === '解题' ? 'solver' : 'verifier'}`);
  await page.getByLabel(`${role}API Key`, { exact: true }).fill('synthetic-fixture-secret');
}

for (const role of roles) {
  test(`${role} connection validates only its own profile while saving still requires both profiles`, async ({ page }) => {
    const bodies: unknown[] = [];
    await page.route('https://fixture-model.invalid/v1/chat/completions', async route => {
      bodies.push(route.request().postDataJSON());
      await route.fulfill({ contentType: 'text/event-stream', body: modelSse('OK') });
    });
    await openIndependentSettings(page);
    await fillProfile(page, role);
    const other = role === '解题' ? '校验' : '解题';
    await expect(page.getByLabel(`${other}服务地址`, { exact: true })).toHaveValue('');
    await expect(page.getByLabel(`${other}模型引用名`, { exact: true })).toHaveValue('');
    await expect(page.getByLabel(`${other}API Key`, { exact: true })).toHaveValue('');

    await page.getByRole('button', { name: `测试${role}模型连接`, exact: true }).click();
    await expect(page.getByRole('region', { name: `${role}模型`, exact: true }).getByText(/文本连接测试通过/)).toBeVisible();
    expect(bodies).toHaveLength(1);
    expect(bodies[0]).toMatchObject({ model: `fixture-${role === '解题' ? 'solver' : 'verifier'}` });

    await page.getByRole('button', { name: '保存设置', exact: true }).click();
    await expect(page.getByText(/保存失败。请检查 HTTPS 地址/)).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(1);
    await expect(page.getByRole('button', { name: '保存设置', exact: true })).toBeEnabled();
    expect(bodies).toHaveLength(1);
    await page.reload();
    await page.getByRole('button', { name: '配置模型与考试类型', exact: true }).click();
    await expect(page.getByLabel('解题服务地址', { exact: true })).toHaveValue('');
  });

  test(`${role} connection rejects its own invalid profile without a model request`, async ({ page }) => {
    let requests = 0;
    await page.route('https://fixture-model.invalid/v1/chat/completions', async route => {
      requests++;
      await route.fulfill({ contentType: 'text/event-stream', body: modelSse('OK') });
    });
    await openIndependentSettings(page);
    for (const value of roles) await fillProfile(page, value);
    await page.getByLabel(`${role}模型引用名`, { exact: true }).fill('');
    const button = page.getByRole('button', { name: `测试${role}模型连接`, exact: true });
    await button.click();
    await expect(page.getByRole('region', { name: `${role}模型`, exact: true }).getByText(/测试未通过。请检查配置/)).toBeVisible();
    await expect(button).toBeEnabled();
    expect(requests).toBe(0);
  });
}
