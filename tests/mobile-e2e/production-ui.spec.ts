import { expect, test } from '@playwright/test';
import { configureLocalModel } from './local-fixture.js';

test.use({ reducedMotion: 'reduce' });

test('settings keep navigation available above a long form on a small screen', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await page.goto('/');
  await page.getByRole('tab', { name: '我的', exact: true }).click();
  await page.getByRole('button', { name: '设置', exact: true }).click();

  const back = page.getByRole('button', { name: '返回', exact: true });
  await page.screenshot({ path: testInfo.outputPath('settings-top.png') });
  await expect.soft(back).toBeInViewport({ ratio: 1 });
  await page.getByRole('button', { name: '保存设置', exact: true }).scrollIntoViewIfNeeded();
  await expect(back).toBeInViewport({ ratio: 1 });
  await back.click();
  await expect(page.getByRole('button', { name: '设置', exact: true })).toBeVisible();
});

test('connection feedback appears beside its action without scrolling through the verifier form', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  let requests = 0;
  await page.route('https://fixture-model.invalid/v1/chat/completions', async route => {
    requests++;
    await route.fulfill({ status: 429, contentType: 'application/json', body: '{"error":{"message":"private-provider-canary"}}' });
  });
  await page.goto('/');
  await configureLocalModel(page);
  await page.getByRole('tab', { name: '我的', exact: true }).click();
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByRole('switch', { name: '使用独立校验模型', exact: true }).click();
  // Fill a valid verifier so a solver connection test reaches the stub provider.
  await page.getByLabel('校验服务地址', { exact: true }).fill('https://fixture-model.invalid/v1');
  await page.getByLabel('校验供应商标识', { exact: true }).fill('fixture-provider');
  await page.getByLabel('校验模型引用名', { exact: true }).fill('fixture-verifier');
  await page.getByLabel('校验API Key', { exact: true }).fill('synthetic-verifier-secret');
  await page.getByRole('button', { name: '测试解题模型连接', exact: true }).click();
  const feedback = page.getByText(/模型服务请求过于频繁/);
  await expect(feedback).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('connection-feedback.png') });
  await expect(feedback).toBeInViewport({ ratio: 1 });
  expect(requests).toBe(1);
  await expect(page.getByText('private-provider-canary', { exact: false })).toHaveCount(0);
});

test('backup pages keep the same visible header in both themes and short landscape', async ({ page }, testInfo) => {
  await page.goto('/');
  await page.getByRole('tab', { name: '我的', exact: true }).click();
  for (const colorScheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme });
    for (const name of ['导出本地记录', '恢复本地记录']) {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.getByRole('button', { name, exact: true }).click();
      await page.setViewportSize({ width: 568, height: 320 });
      const back = page.getByRole('button', { name: '返回', exact: true });
      await expect(page.getByRole('heading', { name, exact: true })).toBeInViewport({ ratio: 1 });
      await expect(back).toBeInViewport({ ratio: 1 });
      const primary = page.getByRole('button', { name: name === '导出本地记录' ? '导出到本机' : '选择备份并恢复', exact: true });
      await primary.scrollIntoViewIfNeeded();
      await expect(primary).toBeInViewport({ ratio: 1 });
      await expect(back).toBeInViewport({ ratio: 1 });
      await page.screenshot({ path: testInfo.outputPath(`${name}-${colorScheme}.png`) });
      await back.click();
    }
  }
});
