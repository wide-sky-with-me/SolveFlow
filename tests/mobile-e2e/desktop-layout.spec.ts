import { expect, test, type Locator } from '@playwright/test';
import { chooseSyntheticPhoto, configureLocalModel, modelSse } from './local-fixture.js';

test.use({ reducedMotion: 'reduce' });

test('desktop home keeps the compact status bar above the camera without redundant introductions', async ({ page }, info) => {
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto('/');
  await page.getByRole('button', { name: '拍一张', exact: true }).click({ trial: true });
  const status = page.getByTestId('desktop-exam');
  await expect(status).toContainText('默认考试');
  await expect(page.getByTestId('desktop-intro')).toHaveCount(0);
  await expect(page.getByRole('region', { name: '拍题小提示', exact: true })).toHaveCount(0);
  const panel = await box(page.getByTestId('empty-camera'));
  const tabs = await box(page.getByTestId('question-tabs'));
  expect(panel.y - tabs.y - tabs.height).toBeLessThan(48);
  const currentTab = await box(page.getByRole('tab', { name: '当前题目', exact: true }));
  expect(currentTab.x).toBeCloseTo(panel.x, 0);
  expect(panel.y).toBeLessThan(180);
  expect((await box(status)).y + (await box(status)).height).toBeLessThan(tabs.y);
  expect(await page.getByTestId('desktop-brand').evaluate(node => getComputedStyle(node).fontFamily)).toContain('sans-serif');
  const shell = await box(page.getByTestId('workspace-shell'));
  expect(shell.width).toBe(1600);
  await page.screenshot({ path: info.outputPath('desktop-home-hierarchy.png') });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(status).toBeHidden();
  await expect(page.getByRole('region', { name: '拍题小提示', exact: true })).toHaveCount(0);
});

async function box(locator: Locator) {
  const bounds = await locator.boundingBox();
  if (!bounds) throw new Error('MISSING_LAYOUT_ELEMENT');
  return bounds;
}

test('wide home keeps navigation beside branding and primary actions within reach', async ({ page }, info) => {
  await page.goto('/');
  await page.getByRole('button', { name: '拍一张', exact: true }).click({ trial: true });
  await expect(page.getByTestId('launch-screen')).toHaveCount(0);
  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    for (const width of [1280, 1600, 1920]) {
      await page.setViewportSize({ width, height: 1000 });
      await expect(page.getByTestId('desktop-brand')).toBeVisible();
      const nav = await box(page.getByRole('navigation', { name: '主导航' }));
      const tabs = await box(page.getByTestId('question-tabs'));
      expect(nav.y + nav.height).toBeLessThanOrEqual(tabs.y + 1);
      const panel = page.getByTestId('empty-camera');
      const art = await box(panel.getByTestId('empty-art'));
      const body = await box(panel.getByTestId('empty-body'));
      expect(art.x + art.width).toBeLessThanOrEqual(body.x);
      for (const name of ['拍一张', '从相册选择', '配置模型与考试类型']) {
        await expect(page.getByRole('button', { name, exact: true })).toBeInViewport({ ratio: 1 });
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path: info.outputPath(`wide-home-${width}-${scheme}.png`) });
    }
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByTestId('desktop-brand')).toBeHidden();
  const nav = await box(page.getByRole('navigation', { name: '主导航' }));
  expect(nav.y).toBeGreaterThan(700);
  expect(nav.height).toBeLessThanOrEqual(56);
});

test('wide profile separates the summary and keeps every menu action clickable', async ({ page }, info) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto('/');
  await page.getByRole('tab', { name: '我的', exact: true }).click();
  const summary = await box(page.getByRole('button', { name: '查看历史题目', exact: true }));
  const menu = await box(page.getByTestId('profile-menu'));
  expect(summary.x + summary.width).toBeLessThan(menu.x);
  for (const name of ['收藏的题目', '设置', '导出本地记录', '恢复本地记录', '使用说明']) {
    await expect(page.getByRole('button', { name, exact: true })).toBeInViewport({ ratio: 1 });
  }
  await page.screenshot({ path: info.outputPath('wide-profile.png') });
  await page.getByRole('button', { name: '使用说明', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
});

test('wide settings align both roles and scroll real connection feedback into view', async ({ page }, info) => {
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.route('https://fixture-model.invalid/v1/chat/completions', route => route.fulfill({ status: 429, contentType: 'application/json', body: '{"error":{"message":"synthetic-error"}}' }));
  await page.goto('/');
  await configureLocalModel(page);
  await page.getByRole('tab', { name: '我的', exact: true }).click();
  await page.getByRole('button', { name: '设置', exact: true }).click();
  const solver = await box(page.getByRole('region', { name: '解题模型', exact: true }));
  const verifier = await box(page.getByRole('region', { name: '校验模型', exact: true }));
  expect(solver.x + solver.width).toBeLessThan(verifier.x);
  expect(solver.y).toBeCloseTo(verifier.y, 0);
  await page.getByRole('switch', { name: '使用独立校验模型', exact: true }).click();
  await page.getByLabel('校验服务地址', { exact: true }).fill('https://fixture-model.invalid/v1');
  await page.getByLabel('校验供应商标识', { exact: true }).fill('fixture-provider');
  await page.getByLabel('校验模型引用名', { exact: true }).fill('fixture-verifier');
  await page.getByLabel('校验API Key', { exact: true }).fill('synthetic-secret');
  await page.screenshot({ path: info.outputPath('wide-settings.png') });
  await page.getByRole('button', { name: '测试校验模型连接', exact: true }).click();
  await expect(page.getByText(/模型服务请求过于频繁/)).toBeInViewport({ ratio: 1 });
  await expect(page.getByRole('button', { name: '返回', exact: true })).toBeInViewport({ ratio: 1 });
  await page.getByRole('button', { name: '保存设置', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('resizing a wide answer preserves the question and follow-up draft', async ({ page }, info) => {
  const candidate = { schemaVersion: 1, kind: 'answer', problem: { text: 'x+1=3', subject: 'math', uncertainties: [] }, answer: '$x = 2$', steps: [], knowledgePoints: [], citationIds: [], clarificationQuestions: [] };
  await page.route('https://fixture-model.invalid/v1/chat/completions', route => route.fulfill({ contentType: 'text/event-stream', body: modelSse(candidate, route.request().postDataJSON()) }));
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto('/');
  await configureLocalModel(page);
  await chooseSyntheticPhoto(page);
  await page.getByRole('button', { name: '开始解题', exact: true }).click();
  await expect(page.getByText('未校验', { exact: true })).toBeVisible();
  const questionURL = page.url();
  await page.getByLabel('继续问这道题').fill('为什么两边要同时减去 1？');
  for (const width of [390, 1280, 1920]) {
    await page.setViewportSize({ width, height: 1000 });
    await expect(page.getByLabel('继续问这道题')).toHaveValue('为什么两边要同时减去 1？');
    await page.getByRole('button', { name: '发送同题追问', exact: true }).scrollIntoViewIfNeeded();
    await expect(page.getByRole('button', { name: '发送同题追问', exact: true })).toBeInViewport({ ratio: 1 });
    await page.getByRole('button', { name: '发送同题追问', exact: true }).click({ trial: true });
    await expect(page.locator('.katex').first()).toBeVisible();
    expect(page.url()).toBe(questionURL);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  await page.screenshot({ path: info.outputPath('wide-answer.png') });
});
