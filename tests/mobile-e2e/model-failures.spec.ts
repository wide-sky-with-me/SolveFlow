import { expect, test } from '@playwright/test';
import { configureLocalModel } from './local-fixture.js';

for (const [status, message] of [[400, '模型服务拒绝了请求'], [429, '模型服务请求过于频繁']] as const) {
  test(`connection test explains HTTP ${status} without exposing provider errors or retrying`, async ({ page }) => {
    let requests = 0;
    await page.route('https://fixture-model.invalid/v1/chat/completions', async route => {
      requests++; await route.fulfill({ status, contentType: 'application/json', body: '{"error":{"message":"private-provider-canary"}}' });
    });
    await page.goto('/'); await configureLocalModel(page);
    await page.getByRole('tab', { name: '我的', exact: true }).click();
    await page.getByRole('button', { name: '设置', exact: true }).click();
    await page.getByRole('button', { name: '测试解题模型连接', exact: true }).click();
    await expect(page.getByText(message, { exact: false })).toBeVisible();
    await expect(page.getByRole('button', { name: '测试解题模型连接', exact: true })).toBeEnabled();
    expect(requests).toBe(1);
    await expect(page.getByText('private-provider-canary', { exact: false })).toHaveCount(0);
  });
}
