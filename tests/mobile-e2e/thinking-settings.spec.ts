import { test, expect } from '@playwright/test';
import { configureLocalModel, modelSse } from './local-fixture.js';

test('two-level thinking control persists and sends the selected effort without changing model', async ({ page }) => {
  const bodies: unknown[] = [];
  await page.route('https://fixture-model.invalid/v1/chat/completions', async route => {
    bodies.push(route.request().postDataJSON());
    await route.fulfill({ contentType: 'text/event-stream', body: modelSse({ ok: true }) });
  });
  await page.goto('/'); await configureLocalModel(page);
  await page.getByRole('tab', { name: '我的', exact: true }).click();
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByRole('button', { name: '关闭', exact: true }).click();
  await page.getByRole('button', { name: '保存设置', exact: true }).click();
  await page.reload();
  await page.getByRole('tab', { name: '我的', exact: true }).click();
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await expect(page.getByRole('button', { name: '关闭', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.getByLabel('解题API Key', { exact: true }).fill('synthetic-fixture-secret');
  await page.getByRole('button', { name: '测试解题模型连接', exact: true }).click();
  await expect.poll(() => bodies.length).toBe(1);
  expect(bodies[0]).toMatchObject({ model: 'fixture-user-model', thinking: { type: 'disabled' } });
  await expect(page.getByText(/文本连接测试通过/)).toBeVisible();
  // Turning thinking on exposes the effort ladder; the protocol stays the selected one.
  await page.getByRole('button', { name: '开启', exact: true }).click();
  await page.getByRole('button', { name: '高', exact: true }).click();
  await page.getByRole('button', { name: '测试解题模型连接', exact: true }).click();
  await expect.poll(() => bodies.length).toBe(2);
  expect(bodies[1]).toMatchObject({ model: 'fixture-user-model', thinking: { type: 'enabled' }, reasoning_effort: 'max' });
  await page.getByRole('button', { name: '服务默认', exact: true }).click();
  await page.getByRole('button', { name: '测试解题模型连接', exact: true }).click();
  await expect.poll(() => bodies.length).toBe(3);
  expect(bodies[2]).not.toHaveProperty('thinking');
  expect(bodies[2]).toMatchObject({ model: 'fixture-user-model' });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
